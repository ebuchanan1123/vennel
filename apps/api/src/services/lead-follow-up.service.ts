import { prisma } from '@lead-recovery/database';
import type { BackgroundJob, Lead, Prisma } from '@prisma/client';
import { z } from 'zod';

import { HttpError } from '../middleware/error-handler.js';
import { companyJobId, enqueueBackgroundJob } from './background-job.service.js';
import { suggestLeadFollowUps } from './note-extraction.service.js';
import { enqueueOwnerNotification } from './notification.service.js';
import { assertJobLease } from './conversation-lock.service.js';

export async function recordLeadCreated(db: Prisma.TransactionClient, lead: Lead): Promise<void> {
  await enqueueOwnerNotification(db, lead.companyId, `new-lead:${lead.id}`, {
    kind: 'NEW_LEAD',
    leadId: lead.id,
  });
}

export async function recordLeadMilestone(
  db: Prisma.TransactionClient,
  previous: Lead,
  lead: Lead,
): Promise<void> {
  if (
    (!previous.needsHuman && lead.needsHuman) ||
    (previous.status !== 'NEEDS_HUMAN' && lead.status === 'NEEDS_HUMAN')
  ) {
    await enqueueOwnerNotification(
      db,
      lead.companyId,
      `human-attention:${lead.id}:${lead.updatedAt.toISOString()}`,
      { kind: 'HUMAN_ATTENTION', leadId: lead.id },
    );
  }
  if (
    previous.status !== lead.status &&
    (lead.status === 'QUALIFIED' || lead.status === 'NEEDS_HUMAN')
  ) {
    await enqueueBackgroundJob(
      db,
      lead.companyId,
      'LEAD_FOLLOW_UP_SUGGESTIONS',
      `lead-milestone:${lead.id}:${lead.status}:${lead.updatedAt.toISOString()}`,
      { leadId: lead.id, milestone: lead.status },
    );
  }
}

export async function processLeadFollowUpJob(job: BackgroundJob): Promise<void> {
  const companyId = companyJobId(job);
  const parsed = z
    .object({ leadId: z.string().min(1), milestone: z.enum(['QUALIFIED', 'NEEDS_HUMAN']) })
    .safeParse(job.payload);
  if (!parsed.success) throw new HttpError(400, 'The lead-suggestion job payload is invalid.');
  const lead = await prisma.lead.findFirst({
    where: { id: parsed.data.leadId, companyId },
    include: {
      company: true,
      messages: { where: { direction: 'INBOUND' }, orderBy: { createdAt: 'desc' }, take: 30 },
    },
  });
  if (!lead || lead.outcome === 'WON' || lead.outcome === 'LOST' || lead.status === 'CLOSED')
    return;
  const text = lead.messages
    .reverse()
    .map((message) => message.body)
    .join('\n');
  if (!text)
    throw new HttpError(400, 'The lead has no customer conversation for follow-up suggestions.');
  const actions = await suggestLeadFollowUps({
    companyId,
    text,
    timeZone: lead.company.timeZone,
    occurredAt: lead.lastActivityAt.toISOString(),
  });
  await prisma.$transaction(async (tx) => {
    await assertJobLease(tx, job);
    const current = await tx.lead.findFirst({ where: { id: lead.id, companyId } });
    if (!current) throw new HttpError(404, 'The lead no longer exists.');
    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index];
      if (!action) continue;
      await tx.followUpSuggestion.upsert({
        where: {
          companyId_sourceKey: { companyId, sourceKey: `${job.eventKey}:${index}` },
        },
        create: {
          companyId,
          leadId: lead.id,
          customerId: current.customerId,
          sourceKey: `${job.eventKey}:${index}`,
          ...action,
          dueAt: action.dueAt ? new Date(action.dueAt) : null,
          source: 'AI',
        },
        update: {},
      });
    }
  });
}
