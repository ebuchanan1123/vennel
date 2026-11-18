import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';

const mocks = vi.hoisted(() => {
  const db = {
    followUpTask: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    followUpAudit: { create: vi.fn() },
    followUpSuggestion: { findFirst: vi.fn(), updateMany: vi.fn() },
    customer: { findFirst: vi.fn() },
    lead: { findFirst: vi.fn() },
    callNote: { findFirst: vi.fn() },
  };
  return { db, transaction: vi.fn() };
});
vi.mock('@lead-recovery/database', () => ({
  prisma: { ...mocks.db, $transaction: mocks.transaction },
}));
import {
  acceptFollowUpSuggestion,
  changeFollowUpStatus,
  followUpInclude,
  updateFollowUp,
} from './follow-up.service.js';

const date = new Date('2026-11-08T15:00:00Z');
const task = {
  id: 'task-a',
  companyId: 'business-a',
  customerId: 'customer-a',
  leadId: null,
  callNoteId: null,
  assignedUserId: null,
  assignedUser: null,
  type: 'CALL_CUSTOMER',
  title: 'Call Taylor',
  dueAt: date,
  status: 'PENDING',
  priority: 'NORMAL',
  notes: null,
  source: 'MANUAL',
  revision: 1,
  sourceSuggestionId: null,
  completedAt: null,
  cancelledAt: null,
  createdAt: date,
  updatedAt: date,
  customer: { id: 'customer-a', name: 'Taylor', phone: null },
  lead: null,
  audits: [],
} satisfies Prisma.FollowUpTaskGetPayload<{ include: typeof followUpInclude }>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation((callback: (db: typeof mocks.db) => unknown) =>
    callback(mocks.db),
  );
  mocks.db.followUpTask.findFirst.mockResolvedValue(task);
  mocks.db.followUpTask.create.mockResolvedValue(task);
  mocks.db.followUpTask.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.customer.findFirst.mockResolvedValue({
    id: task.customerId,
    companyId: task.companyId,
    isArchived: false,
  });
});

describe('follow-up lifecycle', () => {
  it('records completion timestamps and audits without changing a lead or booking', async () => {
    await changeFollowUpStatus('business-a', task.id, 1, 'COMPLETED');
    expect(mocks.db.followUpTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: task.id, companyId: 'business-a', revision: 1 },
        data: expect.objectContaining({ status: 'COMPLETED', completedAt: expect.any(Date) }),
      }),
    );
    expect(mocks.db.followUpAudit.create).toHaveBeenCalled();
  });
  it('reschedules with an atomic revision check and preserves the previous due time in history', async () => {
    await updateFollowUp('business-a', task.id, 1, {
      customerId: task.customerId,
      leadId: null,
      type: 'CALL_CUSTOMER',
      title: task.title,
      dueAt: '2030-01-01T12:00:00Z',
      priority: 'HIGH',
      notes: null,
    });
    expect(mocks.db.followUpTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dueAt: new Date('2030-01-01T12:00:00Z') }),
      }),
    );
    expect(mocks.db.followUpAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          details: expect.objectContaining({
            before: expect.objectContaining({ dueAt: date.toISOString() }),
          }),
        }),
      }),
    );
  });
  it('rejects stale updates and cross-business task IDs', async () => {
    await expect(
      changeFollowUpStatus('business-a', task.id, 99, 'CANCELLED'),
    ).rejects.toMatchObject({ status: 409 });
    mocks.db.followUpTask.findFirst.mockResolvedValue(null);
    await expect(changeFollowUpStatus('business-b', task.id, 1, 'COMPLETED')).rejects.toMatchObject(
      { status: 404 },
    );
    expect(mocks.db.followUpTask.updateMany).not.toHaveBeenCalled();
  });
  it('returns an already-created suggestion task without duplicating it', async () => {
    mocks.db.followUpSuggestion.findFirst.mockResolvedValue({
      id: 'suggestion-a',
      task: { id: task.id },
    });
    expect(
      (
        await acceptFollowUpSuggestion('business-a', 'suggestion-a', {
          customerId: task.customerId,
          dueAt: date.toISOString(),
          title: task.title,
          priority: 'NORMAL',
          notes: null,
        })
      ).id,
    ).toBe(task.id);
    expect(mocks.db.followUpTask.create).not.toHaveBeenCalled();
  });
  it('rejects a suggestion claimed by another worker or request', async () => {
    mocks.db.followUpSuggestion.findFirst.mockResolvedValue({
      id: 'suggestion-a',
      companyId: 'business-a',
      customerId: task.customerId,
      status: 'PENDING',
      task: null,
    });
    mocks.db.followUpSuggestion.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      acceptFollowUpSuggestion('business-a', 'suggestion-a', {
        customerId: task.customerId,
        dueAt: date.toISOString(),
        title: task.title,
        priority: 'NORMAL',
        notes: null,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.db.followUpTask.create).not.toHaveBeenCalled();
  });
});
