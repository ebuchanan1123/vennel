import { prisma } from '@lead-recovery/database';
import type { FollowUpInput, FollowUpTask, FollowUpSuggestion } from '@lead-recovery/types';
import type { Prisma } from '@prisma/client';

import { HttpError } from '../middleware/error-handler.js';
import { historyScope } from './history-scope.service.js';

export const followUpInclude = {
  assignedUser: { select: { id: true, name: true } },
  customer: { select: { id: true, name: true, phone: true } },
  lead: { select: { id: true, phone: true, status: true } },
  audits: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.FollowUpTaskInclude;
export const suggestionInclude = {
  customer: { select: { id: true, name: true, phone: true } },
  lead: { select: { id: true, phone: true, status: true } },
  task: { select: { id: true } },
} satisfies Prisma.FollowUpSuggestionInclude;

export function serializeFollowUp(
  task: Prisma.FollowUpTaskGetPayload<{ include: typeof followUpInclude }>,
): FollowUpTask {
  return {
    ...task,
    dueAt: task.dueAt.toISOString(),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    completedAt: task.completedAt?.toISOString() ?? null,
    cancelledAt: task.cancelledAt?.toISOString() ?? null,
    audits: task.audits.map((audit) => ({ ...audit, createdAt: audit.createdAt.toISOString() })),
  };
}
export function serializeSuggestion(
  suggestion: Prisma.FollowUpSuggestionGetPayload<{ include: typeof suggestionInclude }>,
): FollowUpSuggestion {
  return {
    ...suggestion,
    dueAt: suggestion.dueAt?.toISOString() ?? null,
    createdAt: suggestion.createdAt.toISOString(),
    taskId: suggestion.task?.id ?? null,
  };
}

export async function listFollowUps(companyId: string): Promise<FollowUpTask[]> {
  return (
    await prisma.followUpTask.findMany({
      where: { companyId },
      include: followUpInclude,
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
    })
  ).map(serializeFollowUp);
}
export async function listFollowUpSuggestions(companyId: string): Promise<FollowUpSuggestion[]> {
  return (
    await prisma.followUpSuggestion.findMany({
      where: { companyId, status: 'PENDING' },
      include: suggestionInclude,
      orderBy: { createdAt: 'desc' },
    })
  ).map(serializeSuggestion);
}

async function taskRecord(db: Prisma.TransactionClient, companyId: string, id: string) {
  const task = await db.followUpTask.findFirst({
    where: { id, companyId },
    include: followUpInclude,
  });
  if (!task) throw new HttpError(404, 'Follow-up not found in this business.');
  return task;
}

export async function createFollowUp(
  companyId: string,
  input: FollowUpInput,
  actorId = 'system',
  db: Prisma.TransactionClient = prisma,
  source: FollowUpTask['source'] = 'MANUAL',
  suggestionId?: string,
): Promise<FollowUpTask> {
  await historyScope(db, companyId, input);
  const task = await db.followUpTask.create({
    data: {
      ...input,
      companyId,
      dueAt: new Date(input.dueAt),
      source,
      sourceSuggestionId: suggestionId,
      audits: {
        create: {
          revision: 1,
          actor: actorId,
          action: 'CREATED',
          details: { ...input, source },
        },
      },
    },
    include: followUpInclude,
  });
  return serializeFollowUp(task);
}

export async function updateFollowUp(
  companyId: string,
  id: string,
  revision: number,
  input: FollowUpInput,
  actorId = 'system',
): Promise<FollowUpTask> {
  return prisma.$transaction(async (tx) => {
    const existing = await taskRecord(tx, companyId, id);
    if (existing.revision !== revision)
      throw new HttpError(409, 'This task changed. Refresh before editing.');
    await historyScope(tx, companyId, input);
    const updated = await tx.followUpTask.updateMany({
      where: { id, companyId, revision },
      data: { ...input, dueAt: new Date(input.dueAt), revision: { increment: 1 } },
    });
    if (updated.count !== 1) throw new HttpError(409, 'This task changed while saving.');
    await tx.followUpAudit.create({
      data: {
        taskId: id,
        revision: revision + 1,
        actor: actorId,
        action: 'UPDATED',
        details: {
          before: {
            dueAt: existing.dueAt.toISOString(),
            title: existing.title,
            priority: existing.priority,
            notes: existing.notes,
            customerId: existing.customerId,
            leadId: existing.leadId,
            callNoteId: existing.callNoteId,
            type: existing.type,
          },
          after: input,
        },
      },
    });
    return serializeFollowUp(await taskRecord(tx, companyId, id));
  });
}

export async function changeFollowUpStatus(
  companyId: string,
  id: string,
  revision: number,
  status: FollowUpTask['status'],
  actorId = 'system',
): Promise<FollowUpTask> {
  return prisma.$transaction(async (tx) => {
    const existing = await taskRecord(tx, companyId, id);
    if (existing.revision !== revision)
      throw new HttpError(409, 'This task changed. Refresh before updating its status.');
    const updated = await tx.followUpTask.updateMany({
      where: { id, companyId, revision },
      data: {
        status,
        revision: { increment: 1 },
        completedAt: status === 'COMPLETED' ? (existing.completedAt ?? new Date()) : null,
        cancelledAt: status === 'CANCELLED' ? (existing.cancelledAt ?? new Date()) : null,
      },
    });
    if (updated.count !== 1) throw new HttpError(409, 'This task changed while saving.');
    await tx.followUpAudit.create({
      data: {
        taskId: id,
        revision: revision + 1,
        actor: actorId,
        action: status,
        details: {
          previousStatus: existing.status,
          status,
          previousCompletedAt: existing.completedAt?.toISOString() ?? null,
          previousCancelledAt: existing.cancelledAt?.toISOString() ?? null,
        },
      },
    });
    return serializeFollowUp(await taskRecord(tx, companyId, id));
  });
}

export async function acceptFollowUpSuggestion(
  companyId: string,
  id: string,
  input: {
    customerId: string;
    dueAt: string;
    title: string;
    priority: FollowUpTask['priority'];
    notes: string | null;
    assignedUserId?: string | null;
  },
  actorId = 'system',
): Promise<FollowUpTask> {
  return prisma.$transaction(async (tx) => {
    const suggestion = await tx.followUpSuggestion.findFirst({
      where: { id, companyId },
      include: suggestionInclude,
    });
    if (!suggestion) throw new HttpError(404, 'Suggestion not found in this business.');
    if (suggestion.task)
      return serializeFollowUp(await taskRecord(tx, companyId, suggestion.task.id));
    if (suggestion.status !== 'PENDING')
      throw new HttpError(409, 'This suggestion was already reviewed.');
    if (suggestion.customerId && suggestion.customerId !== input.customerId)
      throw new HttpError(400, 'Use the customer associated with this suggestion.');
    const claimed = await tx.followUpSuggestion.updateMany({
      where: { id, companyId, status: 'PENDING' },
      data: { status: 'ACCEPTED', reviewedAt: new Date() },
    });
    if (claimed.count !== 1)
      throw new HttpError(
        409,
        'This suggestion was accepted in another request. Refresh to view its task.',
      );
    return createFollowUp(
      companyId,
      {
        ...input,
        leadId: suggestion.leadId,
        callNoteId: suggestion.callNoteId,
        type: suggestion.type,
      },
      actorId,
      tx,
      suggestion.source,
      suggestion.id,
    );
  });
}

export async function dismissFollowUpSuggestion(companyId: string, id: string): Promise<void> {
  const updated = await prisma.followUpSuggestion.updateMany({
    where: { id, companyId, status: 'PENDING' },
    data: { status: 'DISMISSED', reviewedAt: new Date() },
  });
  if (updated.count !== 1)
    throw new HttpError(404, 'Pending suggestion not found in this business.');
}
