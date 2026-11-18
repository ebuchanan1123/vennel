import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundJob } from '@prisma/client';
import { prisma } from '@lead-recovery/database';

const mocks = vi.hoisted(() => ({
  db: {
    backgroundJob: { upsert: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
    jobAttempt: { updateMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));
vi.mock('@lead-recovery/database', () => ({ prisma: mocks.db }));
import {
  claimBackgroundJob,
  enqueueBackgroundJob,
  finishBackgroundJob,
  retryBackgroundJob,
  retryDelayMs,
} from './background-job.service.js';

const now = new Date();
const job: BackgroundJob = {
  id: 'job-a',
  companyId: 'business-a',
  userId: null,
  kind: 'OWNER_EMAIL',
  eventKey: 'unique-event',
  payload: {},
  deliveryPayload: null,
  status: 'RUNNING',
  dueAt: now,
  attempts: 1,
  maxAttempts: 5,
  leaseToken: 'lease-a',
  leaseUntil: now,
  firstAttemptAt: null,
  completedAt: null,
  lastError: null,
  providerId: null,
  createdAt: now,
  updatedAt: now,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.backgroundJob.updateMany.mockResolvedValue({ count: 1 });
});
describe('durable job leasing and idempotency', () => {
  it('uses a database unique event key rather than process-local deduplication', async () => {
    await enqueueBackgroundJob(prisma, 'business-a', 'OWNER_EMAIL', 'unique-event', {});
    expect(mocks.db.backgroundJob.upsert).toHaveBeenCalledWith({
      where: { companyId_eventKey: { companyId: 'business-a', eventKey: 'unique-event' } },
      create: {
        companyId: 'business-a',
        kind: 'OWNER_EMAIL',
        eventKey: 'unique-event',
        payload: {},
      },
      update: {},
    });
  });
  it('claims work with row locks and skip-locked semantics for multiple workers', async () => {
    mocks.db.$queryRaw.mockResolvedValue([job]);
    expect(await claimBackgroundJob()).toEqual(job);
    const query = mocks.db.$queryRaw.mock.calls[0]?.[0].join(' ');
    expect(query).toContain('FOR UPDATE SKIP LOCKED');
    expect(query).toContain('"leaseUntil" < (NOW() AT TIME ZONE \'UTC\')');
  });
  it('fences completion by the current lease token and records the attempt', async () => {
    await finishBackgroundJob(job, { status: 'SUCCEEDED', providerId: 'email-a' });
    expect(mocks.db.backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: job.id, status: 'RUNNING', leaseToken: job.leaseToken },
      }),
    );
    expect(mocks.db.jobAttempt.updateMany).toHaveBeenCalled();
  });
  it('does not restart an email retry window after expiry', async () => {
    mocks.db.backgroundJob.findFirst.mockResolvedValue({
      ...job,
      status: 'FAILED',
      firstAttemptAt: new Date(Date.now() - 24 * 3600000),
    });
    await expect(retryBackgroundJob('business-a', job.id)).rejects.toMatchObject({ status: 409 });
    expect(mocks.db.backgroundJob.updateMany).not.toHaveBeenCalled();
  });
  it('uses bounded exponential retry delays', () => {
    expect(retryDelayMs(1)).toBe(30000);
    expect(retryDelayMs(3)).toBe(120000);
    expect(retryDelayMs(100)).toBeLessThanOrEqual(3600000);
  });
});
