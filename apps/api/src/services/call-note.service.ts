import { prisma } from '@lead-recovery/database';
import type { CallNote, CallNoteInput } from '@lead-recovery/types';
import { Prisma } from '@prisma/client';

import { HttpError } from '../middleware/error-handler.js';
import { noteExtractionSchema } from '../schemas/call-note.schema.js';
import { customerBodySchema } from '../schemas/workspace.schema.js';
import { historyScope } from './history-scope.service.js';
import { extractCallNote } from './note-extraction.service.js';

export const callNoteInclude = {
  customer: true,
  lead: true,
  audits: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.CallNoteInclude;
export type CallNoteRecord = Prisma.CallNoteGetPayload<{ include: typeof callNoteInclude }>;

function storedExtraction(value: Prisma.JsonValue | null) {
  if (value === null) return null;
  const result = noteExtractionSchema.safeParse(value);
  if (!result.success) throw new Error('Stored call-note information failed validation.');
  return result.data;
}

export function serializeCallNote(note: CallNoteRecord): CallNote {
  const customer = note.customer;
  const lead = note.lead;
  return {
    id: note.id,
    companyId: note.companyId,
    customerId: note.customerId,
    leadId: note.leadId,
    originalText: note.originalText,
    text: note.text,
    source: note.source,
    direction: note.direction,
    occurredAt: note.occurredAt.toISOString(),
    phone: note.phone,
    revision: note.revision,
    reviewStatus: note.reviewStatus,
    extraction: storedExtraction(note.extraction),
    extractionRevision: note.extractionRevision,
    confirmedData: storedExtraction(note.confirmedData),
    confirmedFields: note.confirmedFields,
    reviewedAt: note.reviewedAt?.toISOString() ?? null,
    isArchived: note.isArchived,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone } : null,
    lead: lead ? { id: lead.id, phone: lead.phone, status: lead.status } : null,
    audits: note.audits.map((audit) => ({ ...audit, createdAt: audit.createdAt.toISOString() })),
    reviewContext: {
      customer: customer
        ? {
            id: customer.id,
            name: customer.name,
            phone: customer.phone,
            email: customer.email,
            address: customer.address,
            updatedAt: customer.updatedAt.toISOString(),
          }
        : null,
      lead: lead
        ? {
            id: lead.id,
            updatedAt: lead.updatedAt.toISOString(),
            summary: lead.summary,
            serviceType: lead.serviceType,
            issue: lead.issue,
            location: lead.location,
            urgency: lead.urgency,
            preferredTime: lead.preferredTime,
            projectType: lead.projectType,
            budgetRange: lead.budgetRange,
            timeline: lead.timeline,
            propertyOwner: lead.propertyOwner,
          }
        : null,
    },
  };
}

export async function callNoteRecord(
  companyId: string,
  id: string,
  db: Prisma.TransactionClient = prisma,
): Promise<CallNoteRecord> {
  const note = await db.callNote.findFirst({ where: { id, companyId }, include: callNoteInclude });
  if (!note) throw new HttpError(404, 'Call note not found in this business.');
  return note;
}
export async function getCallNote(companyId: string, id: string): Promise<CallNote> {
  return serializeCallNote(await callNoteRecord(companyId, id));
}
export async function listCallNotes(companyId: string): Promise<CallNote[]> {
  return (
    await prisma.callNote.findMany({
      where: { companyId, isArchived: false },
      include: callNoteInclude,
      orderBy: { occurredAt: 'desc' },
    })
  ).map(serializeCallNote);
}

export async function createCallNote(
  companyId: string,
  input: CallNoteInput,
  source: 'TEXT' | 'VOICE' = 'TEXT',
  actorId = 'system',
): Promise<CallNote> {
  return prisma.$transaction(async (tx) => {
    const customer = input.newCustomer
      ? await tx.customer.create({
          data: { ...customerBodySchema.parse(input.newCustomer), companyId },
        })
      : null;
    const customerId = customer?.id ?? input.customerId;
    await historyScope(tx, companyId, { customerId, leadId: input.leadId });
    const note = await tx.callNote.create({
      data: {
        companyId,
        customerId,
        leadId: input.leadId,
        originalText: input.text,
        text: input.text,
        source,
        direction: input.direction,
        occurredAt: new Date(input.occurredAt),
        phone: input.phone,
        confirmedFields: [],
        audits: {
          create: {
            revision: 1,
            action: 'CREATED',
            actor: actorId,
            details: {
              text: input.text,
              source,
              direction: input.direction,
              occurredAt: input.occurredAt,
              customerId,
              leadId: input.leadId,
              phone: input.phone,
            },
          },
        },
      },
      include: callNoteInclude,
    });
    return serializeCallNote(note);
  });
}

export async function updateCallNote(
  companyId: string,
  id: string,
  revision: number,
  input: CallNoteInput,
  actorId = 'system',
): Promise<CallNote> {
  return prisma.$transaction(async (tx) => {
    const existing = await callNoteRecord(companyId, id, tx);
    if (existing.revision !== revision || existing.isArchived)
      throw new HttpError(409, 'This note changed or was archived. Refresh before editing.');
    const created = input.newCustomer
      ? await tx.customer.create({
          data: { ...customerBodySchema.parse(input.newCustomer), companyId },
        })
      : null;
    const customerId = created?.id ?? input.customerId;
    const changingHistory = existing.customerId !== customerId || existing.leadId !== input.leadId;
    if (
      changingHistory &&
      (existing.reviewStatus === 'REVIEWED' ||
        (await tx.followUpTask.count({ where: { callNoteId: id } })) > 0)
    ) {
      throw new HttpError(
        409,
        'This note already has confirmed history. Create a new note rather than moving it to another customer or lead.',
      );
    }
    await historyScope(tx, companyId, { customerId, leadId: input.leadId });
    const updated = await tx.callNote.updateMany({
      where: { id, companyId, revision },
      data: {
        customerId,
        leadId: input.leadId,
        text: input.text,
        direction: input.direction,
        occurredAt: new Date(input.occurredAt),
        phone: input.phone,
        revision: { increment: 1 },
        reviewStatus: 'DRAFT',
        extraction: Prisma.JsonNull,
        extractionRevision: null,
        confirmedData: Prisma.JsonNull,
        confirmedFields: [],
        reviewedAt: null,
      },
    });
    if (updated.count !== 1) throw new HttpError(409, 'This note changed while saving.');
    await tx.followUpSuggestion.updateMany({
      where: { callNoteId: id, status: 'PENDING' },
      data: { status: 'DISMISSED', reviewedAt: new Date() },
    });
    await tx.callNoteAudit.create({
      data: {
        noteId: id,
        revision: revision + 1,
        action: 'EDITED',
        actor: actorId,
        details: {
          before: {
            text: existing.text,
            occurredAt: existing.occurredAt.toISOString(),
            direction: existing.direction,
            phone: existing.phone,
            customerId: existing.customerId,
            leadId: existing.leadId,
          },
          after: {
            text: input.text,
            occurredAt: input.occurredAt,
            direction: input.direction,
            phone: input.phone,
            customerId,
            leadId: input.leadId,
          },
        },
      },
    });
    return serializeCallNote(await callNoteRecord(companyId, id, tx));
  });
}

export async function analyzeCallNote(
  companyId: string,
  id: string,
  revision: number,
  actorId = 'system',
): Promise<CallNote> {
  const note = await callNoteRecord(companyId, id);
  if (note.revision !== revision || note.isArchived || note.reviewStatus === 'REVIEWED') {
    throw new HttpError(409, 'Edit or refresh this note before analyzing it again.');
  }
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const extraction = await extractCallNote({
    company,
    text: note.text,
    occurredAt: note.occurredAt,
  });
  return prisma.$transaction(async (tx) => {
    const updated = await tx.callNote.updateMany({
      where: { id, companyId, revision, isArchived: false },
      data: {
        extraction,
        reviewStatus: 'EXTRACTED',
        extractionRevision: revision + 1,
        revision: { increment: 1 },
      },
    });
    if (updated.count !== 1)
      throw new HttpError(
        409,
        'The note changed during analysis. The stale suggestions were not saved.',
      );
    await tx.callNoteAudit.create({
      data: {
        noteId: id,
        revision: revision + 1,
        action: 'AI_EXTRACTED',
        actor: actorId,
        details: { sourceText: note.text, extraction },
      },
    });
    return serializeCallNote(await callNoteRecord(companyId, id, tx));
  });
}

export async function archiveCallNote(
  companyId: string,
  id: string,
  revision: number,
  isArchived: boolean,
  actorId = 'system',
): Promise<CallNote> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.callNote.updateMany({
      where: { id, companyId, revision },
      data: { isArchived, revision: { increment: 1 } },
    });
    if (updated.count !== 1)
      throw new HttpError(409, 'The note changed or is not in this business.');
    await tx.callNoteAudit.create({
      data: {
        noteId: id,
        revision: revision + 1,
        action: isArchived ? 'ARCHIVED' : 'RESTORED',
        actor: actorId,
        details: { isArchived },
      },
    });
    return serializeCallNote(await callNoteRecord(companyId, id, tx));
  });
}
