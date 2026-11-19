import { randomUUID } from 'node:crypto';
import { prisma } from '@lead-recovery/database';
import type { BackgroundJobRecord } from '@lead-recovery/types';
import { Prisma, type BackgroundJob } from '@prisma/client';

import { HttpError } from '../middleware/error-handler.js';
import { assertJobLease, JobLeaseLostError } from './conversation-lock.service.js';

export const EMAIL_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
export const LEASE_MS = 120000;

export function companyJobId(job: BackgroundJob): string {
  if (!job.companyId) throw new HttpError(400, 'This background job requires a business scope.');
  return job.companyId;
}

export function retryDelayMs(attempt: number): number {
  return Math.min(3600000, 30000 * 2 ** Math.min(attempt - 1, 7));
}

export async function enqueueBackgroundJob(
  db: Prisma.TransactionClient,
  companyId: string,
  kind: BackgroundJob['kind'],
  eventKey: string,
  payload: Prisma.InputJsonValue,
  options?: { dueAt?: Date; maxAttempts?: number },
) {
  return db.backgroundJob.upsert({
    where: { companyId_eventKey: { companyId, eventKey } },
    create: { companyId, kind, eventKey, payload, ...options },
    update: {},
  });
}

export async function claimBackgroundJob(): Promise<BackgroundJob | null> {
  const token = randomUUID();
  return prisma.$transaction(async (tx) => {
    // Prisma DateTime columns contain UTC timestamps without a SQL time zone.
    const jobs = await tx.$queryRaw<BackgroundJob[]>`
    UPDATE "BackgroundJob" SET
      "status" = 'RUNNING', "leaseToken" = ${token},
      "leaseUntil" = (NOW() AT TIME ZONE 'UTC') + INTERVAL '120 seconds',
      "attempts" = "attempts" + 1, "updatedAt" = (NOW() AT TIME ZONE 'UTC')
    WHERE "id" = (
      SELECT candidate."id" FROM "BackgroundJob" candidate
      WHERE ((candidate."status" = 'PENDING' AND candidate."dueAt" <= (NOW() AT TIME ZONE 'UTC'))
        OR (candidate."status" = 'RUNNING' AND candidate."leaseUntil" < (NOW() AT TIME ZONE 'UTC')))
        AND candidate."attempts" < candidate."maxAttempts"
        AND NOT EXISTS (
          SELECT 1 FROM "WebhookEvent" current_event
          JOIN "WebhookEvent" earlier ON earlier."conversationId" = current_event."conversationId"
            AND earlier."sequence" < current_event."sequence"
          WHERE current_event."jobId" = candidate."id" AND earlier."status" <> 'COMPLETED'
        )
      ORDER BY candidate."dueAt", candidate."createdAt", candidate."id"
      FOR UPDATE OF candidate SKIP LOCKED LIMIT 1
    )
    RETURNING *`;
    const job = jobs[0];
    if (!job) return null;
    await tx.jobAttempt.updateMany({
      where: { jobId: job.id, attempt: { lt: job.attempts }, finishedAt: null },
      data: {
        finishedAt: new Date(),
        outcome: 'LEASE_EXPIRED',
        error: 'The previous worker lease expired before completion.',
      },
    });
    await tx.jobAttempt.upsert({
      where: { jobId_attempt: { jobId: job.id, attempt: job.attempts } },
      create: { jobId: job.id, attempt: job.attempts },
      update: {},
    });
    return job;
  });
}

export async function renewBackgroundJobLease(job: BackgroundJob): Promise<boolean> {
  const changed = await prisma.$executeRaw`
    UPDATE "BackgroundJob" SET
      "leaseUntil" = (NOW() AT TIME ZONE 'UTC') + INTERVAL '120 seconds',
      "updatedAt" = (NOW() AT TIME ZONE 'UTC')
    WHERE "id" = ${job.id} AND "status" = 'RUNNING' AND "leaseToken" = ${job.leaseToken}
      AND "leaseUntil" > (NOW() AT TIME ZONE 'UTC')`;
  return changed === 1;
}

export async function reapExpiredBackgroundJobs(): Promise<void> {
  // Lead writes enqueue jobs themselves; load their side effects after queue modules initialize.
  const { updateLead } = await import('./lead.service.js');
  await prisma.$transaction(async (tx) => {
    const jobs = await tx.$queryRaw<BackgroundJob[]>`
      UPDATE "BackgroundJob" SET "status" = 'FAILED', "leaseToken" = NULL, "leaseUntil" = NULL,
        "lastError" = 'Worker lease expired after the attempt limit. Verify provider delivery before retrying.',
        "completedAt" = (NOW() AT TIME ZONE 'UTC'), "updatedAt" = (NOW() AT TIME ZONE 'UTC')
      WHERE "id" IN (
        SELECT "id" FROM "BackgroundJob"
        WHERE "status" = 'RUNNING' AND "leaseUntil" < (NOW() AT TIME ZONE 'UTC')
          AND "attempts" >= "maxAttempts"
        ORDER BY "leaseUntil" FOR UPDATE SKIP LOCKED LIMIT 100
      ) RETURNING *`;
    for (const job of jobs) {
      let outcome = 'LEASE_EXPIRED';
      if (job.kind === 'INBOUND_SMS' || job.kind === 'MISSED_CALL_RECOVERY') {
        const event = await tx.webhookEvent.findUnique({
          where: { jobId: job.id },
          include: {
            inboundMessage: true,
            outboundMessage: { include: { smsDelivery: true } },
          },
        });
        if (event?.status === 'COMPLETED') {
          outcome = 'SUCCEEDED';
          await tx.backgroundJob.update({
            where: { id: job.id },
            data: {
              status: 'SUCCEEDED',
              lastError: null,
              providerId: event.outboundMessage?.smsDelivery?.providerId,
            },
          });
        } else if (event) {
          await tx.webhookEvent.update({
            where: { id: event.id },
            data: { status: 'FAILED', lastError: job.lastError },
          });
          const delivery = event.outboundMessage?.smsDelivery;
          if (delivery?.status === 'SENDING' && !delivery.providerId)
            await tx.smsDelivery.update({
              where: { id: delivery.id },
              data: { status: 'UNKNOWN', lastError: job.lastError },
            });
          const leadId = event.inboundMessage?.leadId ?? event.outboundMessage?.leadId;
          if (leadId) await updateLead(leadId, { status: 'NEEDS_HUMAN', needsHuman: true }, tx);
        }
      }
      await tx.jobAttempt.updateMany({
        where: { jobId: job.id, finishedAt: null },
        data: {
          finishedAt: new Date(),
          outcome,
          error: outcome === 'SUCCEEDED' ? null : job.lastError,
        },
      });
      console.warn(
        JSON.stringify({
          event: 'background_job_lease_exhausted',
          jobId: job.id,
          companyId: job.companyId,
          outcome,
        }),
      );
    }
  });
}

export async function finishBackgroundJob(
  job: BackgroundJob,
  result: {
    status: 'SUCCEEDED' | 'CANCELLED' | 'FAILED' | 'BLOCKED' | 'PENDING';
    error?: string;
    providerId?: string;
  },
): Promise<boolean> {
  const updated = await prisma.$transaction(async (tx) => {
    let leaseHeld = true;
    try {
      await assertJobLease(tx, job);
    } catch (error) {
      if (!(error instanceof JobLeaseLostError)) throw error;
      leaseHeld = false;
    }
    const changed = leaseHeld
      ? await tx.backgroundJob.updateMany({
          where: {
            id: job.id,
            status: 'RUNNING',
            leaseToken: job.leaseToken,
          },
          data: {
            status: result.status,
            leaseToken: null,
            leaseUntil: null,
            lastError: result.error ?? null,
            providerId: result.providerId,
            completedAt:
              result.status === 'SUCCEEDED' || result.status === 'CANCELLED' ? new Date() : null,
            ...(result.status === 'PENDING'
              ? { dueAt: new Date(Date.now() + retryDelayMs(job.attempts)) }
              : {}),
          },
        })
      : { count: 0 };
    let outcome = result;
    if (changed.count && (job.kind === 'INBOUND_SMS' || job.kind === 'MISSED_CALL_RECOVERY')) {
      const event = await tx.webhookEvent.findUnique({
        where: { jobId: job.id },
        include: { outboundMessage: { include: { smsDelivery: true } } },
      });
      if (event?.status === 'COMPLETED') {
        outcome = {
          status: 'SUCCEEDED',
          providerId: event.outboundMessage?.smsDelivery?.providerId ?? undefined,
        };
        await tx.backgroundJob.updateMany({
          where: { id: job.id },
          data: {
            status: outcome.status,
            lastError: null,
            providerId: outcome.providerId,
            completedAt: new Date(),
          },
        });
      }
    }
    await tx.jobAttempt.updateMany({
      where: {
        jobId: job.id,
        attempt: job.attempts,
        ...(changed.count ? {} : { finishedAt: null }),
      },
      data: {
        finishedAt: new Date(),
        outcome: changed.count ? outcome.status : 'LEASE_LOST',
        error: outcome.error,
        providerId: outcome.providerId,
      },
    });
    return changed;
  });
  if (updated.count !== 1)
    console.warn(
      JSON.stringify({ event: 'job_lease_lost', jobId: job.id, companyId: job.companyId }),
    );
  return updated.count === 1;
}

export async function listBackgroundJobs(companyId: string): Promise<BackgroundJobRecord[]> {
  const jobs = await prisma.backgroundJob.findMany({
    where: { companyId },
    include: { history: { orderBy: { attempt: 'desc' } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return jobs.map((job) => ({
    id: job.id,
    kind: job.kind,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    dueAt: job.dueAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
    lastError: job.lastError,
    providerId: job.providerId,
    createdAt: job.createdAt.toISOString(),
    history: job.history.map((attempt) => ({
      attempt: attempt.attempt,
      startedAt: attempt.startedAt.toISOString(),
      finishedAt: attempt.finishedAt?.toISOString() ?? null,
      outcome: attempt.outcome,
      error: attempt.error,
      providerId: attempt.providerId,
    })),
  }));
}

export async function retryBackgroundJob(companyId: string, id: string): Promise<void> {
  const job = await prisma.backgroundJob.findFirst({ where: { id, companyId } });
  if (!job) throw new HttpError(404, 'Background job not found in this business.');
  if (job.status !== 'FAILED' && job.status !== 'BLOCKED')
    throw new HttpError(409, 'Only failed or blocked jobs can be retried.');
  if (job.kind === 'INBOUND_SMS' || job.kind === 'MISSED_CALL_RECOVERY') {
    const event = await prisma.webhookEvent.findUnique({
      where: { jobId: job.id },
      include: { outboundMessage: { include: { smsDelivery: true } } },
    });
    const delivery = event?.outboundMessage?.smsDelivery;
    if (delivery?.status === 'UNKNOWN' || delivery?.status === 'SENDING')
      throw new HttpError(
        409,
        'The SMS provider outcome is uncertain. Reconcile delivery before retrying; do not send another SMS blindly.',
      );
  }
  if (
    (job.kind === 'AUTH_EMAIL' || job.kind === 'OWNER_EMAIL' || job.kind === 'DOCUMENT_EMAIL') &&
    job.firstAttemptAt &&
    Date.now() - job.firstAttemptAt.getTime() >= EMAIL_RETRY_WINDOW_MS
  ) {
    throw new HttpError(
      409,
      'The safe provider retry window expired. Verify delivery before initiating another email.',
    );
  }
  if (job.kind === 'DOCUMENT_EMAIL') {
    const delivery = await prisma.documentDelivery.findFirst({
      where: { jobId: job.id, companyId },
      include: { company: true, events: true },
    });
    if (
      !delivery ||
      !delivery.company.isActive ||
      !delivery.company.documentEmailEnabled ||
      delivery.acceptedAt ||
      delivery.events.length > 0
    ) {
      throw new HttpError(
        409,
        'This document email is no longer authorized for retry, or already reached the provider.',
      );
    }
  }
  const changed = await prisma.backgroundJob.updateMany({
    where: { id, companyId, status: job.status },
    data: {
      status: 'PENDING',
      dueAt: new Date(),
      lastError: null,
      maxAttempts: Math.max(job.maxAttempts, job.attempts + 3),
    },
  });
  if (!changed.count) throw new HttpError(409, 'This job changed. Refresh its status.');
}
