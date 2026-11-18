import { randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { prisma } from '@lead-recovery/database';
import type { BackgroundJob } from '@prisma/client';

import { env } from './env.js';
import {
  claimBackgroundJob,
  finishBackgroundJob,
  EMAIL_RETRY_WINDOW_MS,
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

export async function runJob(job: BackgroundJob): Promise<void> {
  await prisma.jobAttempt.create({ data: { jobId: job.id, attempt: job.attempts } });
  try {
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
      const claimed = await prisma.backgroundJob.updateMany({
        where: { id: job.id, leaseToken: job.leaseToken, status: 'RUNNING' },
        data: { deliveryPayload: email, firstAttemptAt },
      });
      if (!claimed.count) throw new ProviderFailure('The delivery lease was lost.', false);
      const providerId = await sendOwnerEmail({ ...job, firstAttemptAt }, email);
      if (job.kind === 'DOCUMENT_EMAIL') await recordDocumentEmailAcceptance(job, providerId);
      await finishBackgroundJob(job, { status: 'SUCCEEDED', providerId });
    } else {
      await processLeadFollowUpJob(job);
      await finishBackgroundJob(job, { status: 'SUCCEEDED' });
    }
  } catch (error) {
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
          ? `AI provider returned HTTP ${providerStatus}. Check provider configuration or retry availability.`
          : 'Background processing failed. Check the worker and provider configuration.';
    const blocked =
      error instanceof ProviderFailure
        ? error.blocked
        : (error instanceof HttpError && error.status === 503) ||
          providerStatus === 401 ||
          providerStatus === 403;
    const retryable =
      error instanceof ProviderFailure
        ? error.retryable
        : providerStatus
          ? providerStatus === 429 || providerStatus >= 500
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
        status,
        error: message,
      }),
    );
    await finishBackgroundJob(job, { status, error: message });
  }
}

export async function startWorker(): Promise<void> {
  const id = randomUUID();
  let stopping = false;
  process.once('SIGINT', () => {
    stopping = true;
  });
  process.once('SIGTERM', () => {
    stopping = true;
  });
  await prisma.workerHeartbeat.create({ data: { id } });
  console.log(JSON.stringify({ event: 'worker_started', workerId: id }));
  let nextScan = 0;
  try {
    while (!stopping) {
      try {
        await prisma.workerHeartbeat.update({ where: { id }, data: { lastSeenAt: new Date() } });
        await prisma.$executeRaw`UPDATE "BackgroundJob" SET "status" = 'FAILED', "leaseUntil" = NULL, "leaseToken" = NULL,
        "lastError" = 'Worker lease expired after the attempt limit. Verify provider delivery.', "updatedAt" = (NOW() AT TIME ZONE 'UTC')
        WHERE "status" = 'RUNNING' AND "leaseUntil" < (NOW() AT TIME ZONE 'UTC') AND "attempts" >= "maxAttempts"`;
        if (Date.now() >= nextScan) {
          await scheduleOwnerReminders();
          nextScan = Date.now() + 15000;
        }
        const job = await claimBackgroundJob();
        if (job) await runJob(job);
        else await wait(env.WORKER_POLL_INTERVAL_MS);
      } catch (error) {
        console.error(
          JSON.stringify({
            event: 'worker_iteration_failed',
            workerId: id,
            errorType: error instanceof Error ? error.name : 'Unknown',
          }),
        );
        await wait(5000);
      }
    }
  } finally {
    await prisma.workerHeartbeat.deleteMany({ where: { id } });
    await prisma.$disconnect();
  }
}

if (process.env.VITEST !== 'true') {
  startWorker().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: 'worker_stopped_with_error',
        error: error instanceof Error ? error.message : 'Unknown worker error',
      }),
    );
    process.exitCode = 1;
  });
}
