import { prisma } from '@lead-recovery/database';
import {
  LeadOutcome,
  LeadSource,
  LeadStatus,
  MessageDirection,
  type Lead,
  type UrgencyLevel,
} from '@prisma/client';
import { recordLeadCreated, recordLeadMilestone } from './lead-follow-up.service.js';
import { callNoteInclude, serializeCallNote } from './call-note.service.js';
import { followUpInclude, serializeFollowUp } from './follow-up.service.js';

type LeadUpdates = {
  source?: LeadSource;
  status?: LeadStatus;
  serviceType?: string | null;
  issue?: string | null;
  location?: string | null;
  urgency?: UrgencyLevel | null;
  preferredTime?: string | null;
  budgetRange?: string | null;
  projectType?: string | null;
  timeline?: string | null;
  propertyOwner?: boolean | null;
  needsHuman?: boolean;
  summary?: string | null;
  lastActivityAt?: Date;
};

export type LeadOutcomeUpdate = {
  outcome: LeadOutcome;
  estimatedValue?: number | null;
  actualValue?: number | null;
  lostReason?: string | null;
};

/**
 * Statuses that fully resolve a lead — a new missed call from the same number
 * should always start a fresh lead rather than appending to this one.
 */
const TERMINAL_STATUSES_FOR_MISSED_CALL: LeadStatus[] = [
  LeadStatus.QUALIFIED,
  LeadStatus.NEEDS_HUMAN,
  LeadStatus.BOOKED,
  LeadStatus.CLOSED,
  LeadStatus.DISQUALIFIED,
];

/**
 * Statuses where an inbound SMS should continue the same lead thread.
 * QUALIFIED is included so a fully-qualified lead can still receive
 * follow-up messages without restarting the qualification flow.
 */
const SMS_CONTINUABLE_STATUSES: LeadStatus[] = [
  LeadStatus.NEW,
  LeadStatus.QUALIFYING,
  LeadStatus.NEEDS_HUMAN,
  LeadStatus.QUALIFIED,
];

/** A lead with no activity for 30 minutes is considered stale for missed-call purposes. */
export const LEAD_STALE_THRESHOLD_MS = 30 * 60 * 1000;

function normalizePhone(value: string): string {
  return value.replace(/[^\d+]/g, '');
}

/**
 * Pure decision function — exported for unit tests.
 * Returns true if a new lead should be created for an incoming missed call.
 */
export function shouldCreateNewLeadForMissedCall(
  existing: { status: LeadStatus; lastActivityAt: Date } | null,
  now: Date,
): boolean {
  if (!existing) return true;
  if ((TERMINAL_STATUSES_FOR_MISSED_CALL as string[]).includes(existing.status)) return true;
  if (now.getTime() - existing.lastActivityAt.getTime() > LEAD_STALE_THRESHOLD_MS) return true;
  return false;
}

function createFreshLead(companyId: string, phone: string, source: LeadSource): Promise<Lead> {
  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        companyId,
        phone,
        source,
        status: LeadStatus.NEW,
        needsHuman: false,
        lastActivityAt: new Date(),
      },
    });
    await recordLeadCreated(tx, lead);
    return lead;
  });
}

export async function recordWebhookEventOnce(
  eventType: string,
  externalId: string,
): Promise<boolean> {
  try {
    await prisma.webhookEvent.create({
      data: {
        eventType,
        externalId,
      },
    });

    return true;
  } catch (error: unknown) {
    const maybeCode = (error as { code?: string } | undefined)?.code;
    if (maybeCode === 'P2002') {
      return false;
    }

    throw error;
  }
}

/**
 * Used by the missed-call voice flow.
 * Creates a new lead whenever the previous one is terminal or stale.
 */
export async function findOrCreateLeadForMissedCall(
  companyId: string,
  phone: string,
): Promise<Lead> {
  const normalizedPhone = normalizePhone(phone);

  const existing = await prisma.lead.findFirst({
    where: { companyId, phone: normalizedPhone },
    orderBy: { lastActivityAt: 'desc' },
  });

  if (shouldCreateNewLeadForMissedCall(existing, new Date())) {
    return createFreshLead(companyId, normalizedPhone, LeadSource.MISSED_CALL);
  }

  if (existing!.source !== LeadSource.MISSED_CALL) {
    return prisma.lead.update({
      where: { id: existing!.id },
      data: { source: LeadSource.MISSED_CALL },
    });
  }

  return existing!;
}

/**
 * Used by the inbound SMS flow.
 * Continues the most recently active (in-progress) lead so replies thread correctly.
 */
export async function findOrCreateActiveLead(
  companyId: string,
  phone: string,
  source: LeadSource,
): Promise<Lead> {
  const normalizedPhone = normalizePhone(phone);

  const existing = await prisma.lead.findFirst({
    where: {
      companyId,
      phone: normalizedPhone,
      status: { in: SMS_CONTINUABLE_STATUSES },
    },
    orderBy: { lastActivityAt: 'desc' },
  });

  if (existing) {
    if (existing.source !== source) {
      return prisma.lead.update({
        where: { id: existing.id },
        data: { source },
      });
    }
    return existing;
  }

  return createFreshLead(companyId, normalizedPhone, source);
}

/** Prisma Decimal fields serialize as strings by default; convert to number for API consumers. */
export function serializeLeadMoney<T extends { estimatedValue: unknown; actualValue: unknown }>(
  lead: T,
): Omit<T, 'estimatedValue' | 'actualValue'> & {
  estimatedValue: number | null;
  actualValue: number | null;
} {
  return {
    ...lead,
    estimatedValue: lead.estimatedValue == null ? null : Number(lead.estimatedValue),
    actualValue: lead.actualValue == null ? null : Number(lead.actualValue),
  };
}

export async function listLeads(filters: {
  companyId?: string;
  status?: string;
  outcome?: string;
  companyIds?: string[];
}) {
  return prisma.lead.findMany({
    where: {
      companyId: filters.companyId ?? (filters.companyIds ? { in: filters.companyIds } : undefined),
      status: filters.status ? (filters.status as LeadStatus) : undefined,
      outcome: filters.outcome ? (filters.outcome as LeadOutcome) : undefined,
    },
    include: {
      company: true,
      customer: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getLeadDetail(leadId: string, companyId?: string) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, companyId },
    include: {
      company: true,
      customer: true,
      callNotes: {
        where: { isArchived: false },
        include: callNoteInclude,
        orderBy: { occurredAt: 'desc' },
      },
      followUps: { include: followUpInclude, orderBy: { dueAt: 'asc' } },
      documents: {
        select: { id: true, kind: true, status: true, number: true, title: true },
        orderBy: { createdAt: 'desc' },
      },
      messages: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  return lead
    ? {
        ...lead,
        callNotes: lead.callNotes.map(serializeCallNote),
        followUps: lead.followUps.map(serializeFollowUp),
      }
    : null;
}

/**
 * Creates a message and simultaneously bumps lastActivityAt on the lead
 * so stale-window logic stays accurate.
 */
export async function createMessage(leadId: string, direction: MessageDirection, body: string) {
  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: { leadId, direction, body },
    }),
    prisma.lead.update({
      where: { id: leadId },
      data: { lastActivityAt: new Date() },
    }),
  ]);
  return message;
}

export async function getLatestOutboundMessage(leadId: string) {
  return prisma.message.findFirst({
    where: {
      leadId,
      direction: MessageDirection.OUTBOUND,
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getRecentMessages(leadId: string, limit: number) {
  return prisma.message.findMany({
    where: { leadId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function updateLead(leadId: string, updates: LeadUpdates): Promise<Lead> {
  return prisma.$transaction(async (tx) => {
    const previous = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
    const lead = await tx.lead.update({ where: { id: leadId }, data: updates });
    await recordLeadMilestone(tx, previous, lead);
    return lead;
  });
}

export type LeadOutcomePatch = {
  outcome: LeadOutcome;
  estimatedValue?: number | null;
  actualValue?: number | null;
  lostReason?: string | null;
  contactedAt?: Date;
  bookedAt?: Date;
  completedAt?: Date;
};

/**
 * Pure decision function — exported for unit tests.
 * Computes the DB patch for an outcome update without touching Prisma.
 * Never overwrites a field the caller omitted; timestamps are stamped
 * only on first transition into that outcome.
 */
export function computeOutcomePatch(
  existing: Pick<Lead, 'contactedAt' | 'bookedAt' | 'completedAt'>,
  update: LeadOutcomeUpdate,
): LeadOutcomePatch {
  const patch: LeadOutcomePatch = { outcome: update.outcome };

  if (update.estimatedValue !== undefined) {
    patch.estimatedValue = update.estimatedValue;
  }
  if (update.actualValue !== undefined) {
    patch.actualValue = update.actualValue;
  }
  if (update.lostReason !== undefined) {
    patch.lostReason = update.lostReason;
  }

  if (update.outcome === LeadOutcome.CONTACTED && !existing.contactedAt) {
    patch.contactedAt = new Date();
  }
  if (update.outcome === LeadOutcome.BOOKED && !existing.bookedAt) {
    patch.bookedAt = new Date();
  }
  if (update.outcome === LeadOutcome.WON && !existing.completedAt) {
    patch.completedAt = new Date();
  }

  return patch;
}

/**
 * Updates the commercial outcome for a lead. Independent of AI qualification
 * status — a lead can be QUALIFIED and separately WON, LOST, etc.
 */
export async function updateLeadOutcome(leadId: string, update: LeadOutcomeUpdate): Promise<Lead> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
    await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${existing.companyId} FOR UPDATE`;
    const patch = computeOutcomePatch(existing, update);
    return tx.lead.update({ where: { id: leadId }, data: patch });
  });
}

/**
 * Dev-only: hard-delete all leads (and their messages) for a given phone + company.
 * Returns the number of leads deleted.
 */
export async function deleteLeadsByPhone(companyId: string, phone: string): Promise<number> {
  const normalizedPhone = normalizePhone(phone);
  const result = await prisma.lead.deleteMany({
    where: { companyId, phone: normalizedPhone },
  });
  return result.count;
}
