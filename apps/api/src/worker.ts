import { randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { prisma } from '@lead-recovery/database';
import type { BackgroundJob } from '@prisma/client';
import { ZodError } from 'zod';

import { env } from './env.js';
import {
  claimBackgroundJob,
  finishBackgroundJob,
  renewBackgroundJobLease,
  reapExpiredBackgroundJobs,
  EMAIL_RETRY_WINDOW_MS,
  LEASE_MS,
} from './services/background-job.service.js';
import {
  emailConfigured,
  prepareOwnerEmail,
  ProviderFailure,
  scheduleOwnerReminders,
  sendOwnerEmail,
} from './services/notification.service.js';
import {
  prepareDocumentEmail,
  recordDocumentEmailAcceptance,
} from './services/document-delivery.service.js';
import { processLeadFollowUpJob } from './services/lead-follow-up.service.js';
import { HttpError } from './middleware/error-handler.js';
import { prepareAccountEmail } from './services/account-email.service.js';
import {
  processCommunicationJob,
  recordCommunicationFailure,
} from './services/communication.service.js';
import { assertJobLease, JobLeaseLostError } from './services/conversation-lock.service.js';
import { processSmsReconciliation } from './services/sms-delivery.service.js';
import { ProviderUsageLimitError } from './services/provider-usage.service.js';

function maintainLease(job: BackgroundJob): () => Promise<void> {
  let renewing: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (renewing) return;
    renewing = renewBackgroundJobLease(job)
      .then((renewed) => {
        if (!renewed) console.warn(JSON.stringify({ event: 'job_lease_lost', jobId: job.id }));
      })
      .catch((error: unknown) => {
        console.error(
          JSON.stringify({
            event: 'job_lease_renewal_failed',
            jobId: job.id,
            errorType: error instanceof Error ? error.name : 'Unknown',
          }),
        );
      })
      .finally(() => {
        renewing = undefined;
      });
  }, LEASE_MS / 3);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await renewing;
  };
}

export async function runJob(job: BackgroundJob): Promise<void> {
  const stopHeartbeat = maintainLease(job);
  const communication = job.kind === 'INBOUND_SMS' || job.kind === 'MISSED_CALL_RECOVERY';
  try {
    await prisma.$transaction((tx) => assertJobLease(tx, job));
    await prisma.jobAttempt.upsert({
      where: { jobId_attempt: { jobId: job.id, attempt: job.attempts } },
      create: { jobId: job.id, attempt: job.attempts },
      update: {},
    });
    let providerId: string | undefined;
    if (job.kind === 'AUTH_EMAIL' || job.kind === 'OWNER_EMAIL' || job.kind === 'DOCUMENT_EMAIL') {
      const email =
        job.kind === 'AUTH_EMAIL'
          ? await prepareAccountEmail(job)
          : job.kind === 'DOCUMENT_EMAIL'
            ? await prepareDocumentEmail(job)
            : await prepareOwnerEmail(job);
      if (!email) {
        await finishBackgroundJob(job, {
          status: 'CANCELLED',
          error: 'Notification is no longer authorized or relevant.',
        });
        return;
      }
      if (!emailConfigured())
        throw new ProviderFailure('Resend is not configured. No email was sent.', false, true);
      const firstAttemptAt = job.firstAttemptAt ?? new Date();
      await prisma.$transaction(async (tx) => {
        await assertJobLease(tx, job);
        await tx.backgroundJob.update({
          where: { id: job.id },
          data: { deliveryPayload: email, firstAttemptAt },
        });
      });
      providerId = await sendOwnerEmail({ ...job, firstAttemptAt }, email);
      if (job.kind === 'DOCUMENT_EMAIL') await recordDocumentEmailAcceptance(job, providerId);
    } else if (communication) {
      await processCommunicationJob(job);
    } else if (job.kind === 'SMS_STATUS_RECONCILIATION') {
      await processSmsReconciliation(job);
    } else if (job.kind === 'LEAD_FOLLOW_UP_SUGGESTIONS') {
      await processLeadFollowUpJob(job);
    } else {
      throw new HttpError(400, 'This background job kind is not supported by this worker.');
    }
    if (await finishBackgroundJob(job, { status: 'SUCCEEDED', providerId }))
      console.info(
        JSON.stringify({
          event: 'background_job_completed',
          jobId: job.id,
          companyId: job.companyId,
          kind: job.kind,
          attempt: job.attempts,
        }),
      );
  } catch (error) {
    if (error instanceof JobLeaseLostError) {
      console.warn(
        JSON.stringify({ event: 'job_lease_lost', jobId: job.id, companyId: job.companyId }),
      );
      return;
    }
    const providerStatus =
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof error.status === 'number'
        ? error.status
        : null;
    const message =
      error instanceof ProviderFailure || error instanceof HttpError
        ? error.message
        : providerStatus
          ? `Provider returned HTTP ${providerStatus}. Check configuration or retry availability.`
          : error instanceof ZodError
            ? 'The background job payload or provider output is invalid.'
            : 'Background processing failed. Check the worker and provider configuration.';
    const blocked =
      error instanceof ProviderFailure
        ? error.blocked
        : error instanceof ProviderUsageLimitError ||
          (error instanceof HttpError && error.status === 503) ||
          providerStatus === 401 ||
          providerStatus === 403;
    const retryable =
      error instanceof ProviderFailure
        ? error.retryable
        : error instanceof ZodError
          ? false
          : providerStatus
            ? providerStatus === 408 || providerStatus === 429 || providerStatus >= 500
            : true;
    const expired =
      (job.kind === 'AUTH_EMAIL' || job.kind === 'OWNER_EMAIL' || job.kind === 'DOCUMENT_EMAIL') &&
      job.firstAttemptAt &&
      Date.now() - job.firstAttemptAt.getTime() >= EMAIL_RETRY_WINDOW_MS;
    const status = blocked
      ? 'BLOCKED'
      : retryable && job.attempts < job.maxAttempts && !expired
        ? 'PENDING'
        : 'FAILED';
    console.error(
      JSON.stringify({
        event: 'background_job_failed',
        jobId: job.id,
        companyId: job.companyId,
        kind: job.kind,
        attempt: job.attempts,
        status,
        error: message,
      }),
    );
    if (communication) await recordCommunicationFailure(job, message, status !== 'PENDING');
    await finishBackgroundJob(job, { status, error: message });
  } finally {
    await stopHeartbeat();
  }
}

export async function startWorker(signal?: AbortSignal): Promise<void> {
  const id = randomUUID();
  const stop = new AbortController();
  const active = new Set<Promise<void>>();
  const shutdown = () => {
    stop.abort();
    console.info(
      JSON.stringify({ event: 'worker_draining', workerId: id, activeJobs: active.size }),
    );
  };
  if (signal?.aborted) return;
  signal?.addEventListener('abort', shutdown, { once: true });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  let nextScan = 0;
  let heartbeatCreated = false;
  try {
    await prisma.workerHeartbeat.create({ data: { id, lastSeenAt: new Date(0) } });
    heartbeatCreated = true;
    console.log(
      JSON.stringify({
        event: 'worker_started',
        workerId: id,
        concurrency: env.WORKER_CONCURRENCY,
      }),
    );
    while (!stop.signal.aborted) {
      try {
        if (Date.now() >= nextScan) {
          await reapExpiredBackgroundJobs();
          await scheduleOwnerReminders();
          nextScan = Date.now() + 15000;
        }
        while (!stop.signal.aborted && active.size < env.WORKER_CONCURRENCY) {
          const job = await claimBackgroundJob();
          if (!job) break;
          const running = runJob(job)
            .catch((error: unknown) => {
              console.error(
                JSON.stringify({
                  event: 'job_runner_failed',
                  jobId: job.id,
                  errorType: error instanceof Error ? error.name : 'Unknown',
                }),
              );
            })
            .finally(() => {
              active.delete(running);
            });
          active.add(running);
        }
        await prisma.workerHeartbeat.update({ where: { id }, data: { lastSeenAt: new Date() } });
        await wait(Math.min(env.WORKER_POLL_INTERVAL_MS, 5000), undefined, { signal: stop.signal });
      } catch (error) {
        if (stop.signal.aborted && error instanceof Error && error.name === 'AbortError') break;
        console.error(
          JSON.stringify({
            event: 'worker_iteration_failed',
            workerId: id,
            errorType: error instanceof Error ? error.name : 'Unknown',
          }),
        );
        if (!stop.signal.aborted) await wait(1000);
      }
    }
  } finally {
    await Promise.all(active);
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    signal?.removeEventListener('abort', shutdown);
    try {
      if (heartbeatCreated) await prisma.workerHeartbeat.deleteMany({ where: { id } });
    } finally {
      await prisma.$disconnect();
    }
    console.info(JSON.stringify({ event: 'worker_stopped', workerId: id }));
  }
}

if (process.env.VITEST !== 'true') {
  startWorker().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: 'worker_stopped_with_error',
        errorType: error instanceof Error ? error.name : 'Unknown',
      }),
    );
    process.exitCode = 1;
  });
}
