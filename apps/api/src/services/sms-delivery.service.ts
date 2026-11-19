import { prisma } from '@lead-recovery/database';
import type { BackgroundJob, Prisma, SmsDelivery, SmsDeliveryStatus } from '@prisma/client';
import type { SmsDeliveryRecord } from '@lead-recovery/types';

import { env } from '../env.js';
import { HttpError } from '../middleware/error-handler.js';
import { twilioMessageStatusSchema } from '../schemas/twilio.schema.js';
import { assertJobLease } from './conversation-lock.service.js';
import { updateLead } from './lead.service.js';
import {
  classifySmsFailure,
  smsProvider,
  SmsProviderFailure,
  type SmsProvider,
} from './twilio.service.js';
import { reserveProviderUsage } from './provider-usage.service.js';
import { companyJobId, enqueueBackgroundJob } from './background-job.service.js';
import { ProviderFailure } from './email-provider.service.js';
import { messageSidSchema } from '../schemas/twilio.schema.js';
import { z } from 'zod';

const providerStates = {
  accepted: 'ACCEPTED',
  scheduled: 'ACCEPTED',
  queued: 'ACCEPTED',
  sending: 'ACCEPTED',
  sent: 'SENT',
  delivered: 'DELIVERED',
  undelivered: 'FAILED',
  failed: 'FAILED',
  canceled: 'FAILED',
} as const;

export function nextSmsDeliveryStatus(
  current: SmsDeliveryStatus,
  providerStatus: string,
): SmsDeliveryStatus {
  const incoming = providerStates[twilioMessageStatusSchema.parse(providerStatus)];
  if (current === 'DELIVERED' || incoming === 'DELIVERED') return 'DELIVERED';
  if (current === 'FAILED' || incoming === 'FAILED') return 'FAILED';
  if (current === 'SENT' && incoming === 'ACCEPTED') return 'SENT';
  return incoming;
}

type StatusUpdate = {
  providerId: string;
  providerStatus: string;
  from?: string;
  to?: string;
  errorCode?: string | null;
};

export async function recordSmsStatus(
  id: string,
  input: StatusUpdate,
  db?: Prisma.TransactionClient,
): Promise<void> {
  if (!db) return prisma.$transaction((tx) => recordSmsStatus(id, input, tx));
  const reference = await db.smsDelivery.findUnique({
    where: { id },
    include: { message: { select: { outboundEvent: { select: { jobId: true } } } } },
  });
  if (!reference) throw new HttpError(404, 'SMS delivery not found.');
  const jobId = reference.message.outboundEvent?.jobId;
  // Use the same lock order as worker checkpoints. Provider receipts remain valid after lease loss.
  if (jobId) await db.$queryRaw`SELECT "id" FROM "BackgroundJob" WHERE "id" = ${jobId} FOR UPDATE`;
  await db.$queryRaw`SELECT "id" FROM "SmsDelivery" WHERE "id" = ${id} FOR UPDATE`;
  const delivery = await db.smsDelivery.findUniqueOrThrow({
    where: { id },
    include: {
      message: { include: { outboundEvent: true, lead: { select: { companyId: true } } } },
    },
  });
  if (
    (delivery.providerId && delivery.providerId !== input.providerId) ||
    (input.from && delivery.fromPhone !== input.from) ||
    (input.to && delivery.toPhone !== input.to)
  )
    throw new HttpError(409, 'The provider receipt does not match this SMS delivery.');

  const status = nextSmsDeliveryStatus(delivery.status, input.providerStatus);
  const changed = status !== delivery.status;
  const error =
    status === 'FAILED'
      ? `Twilio reported unsuccessful delivery${input.errorCode ? ` (code ${input.errorCode})` : ''}.`
      : null;
  await db.smsDelivery.update({
    where: { id },
    data: {
      status,
      providerId: input.providerId,
      ...(changed || !delivery.providerStatus ? { providerStatus: input.providerStatus } : {}),
      acceptedAt: delivery.acceptedAt ?? new Date(),
      deliveredAt: status === 'DELIVERED' ? (delivery.deliveredAt ?? new Date()) : null,
      ...(status === 'FAILED'
        ? {
            errorCode: delivery.errorCode ?? input.errorCode,
            lastError: changed ? error : (delivery.lastError ?? error),
          }
        : { lastError: null, errorCode: null }),
    },
  });
  const event = delivery.message.outboundEvent;
  if (event) {
    await db.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: 'COMPLETED',
        completedAt: event.completedAt ?? new Date(),
        ...(status === 'FAILED' ? { lastError: error } : {}),
      },
    });
    if (jobId) {
      await db.backgroundJob.updateMany({
        where: { id: jobId },
        data: { providerId: input.providerId },
      });
      await db.backgroundJob.updateMany({
        where: { id: jobId, status: { in: ['PENDING', 'BLOCKED', 'FAILED'] } },
        data: {
          status: 'SUCCEEDED',
          completedAt: new Date(),
          lastError: null,
          leaseToken: null,
          leaseUntil: null,
        },
      });
    }
  }
  if (status === 'FAILED' && (changed || !delivery.providerId))
    await updateLead(delivery.message.leadId, { needsHuman: true, status: 'NEEDS_HUMAN' }, db);
  if (status === 'ACCEPTED' || status === 'SENT')
    await enqueueBackgroundJob(
      db,
      delivery.message.lead.companyId,
      'SMS_STATUS_RECONCILIATION',
      `sms-status:${delivery.id}`,
      { deliveryId: delivery.id },
      { dueAt: new Date(Date.now() + 60000) },
    );
  else
    await db.backgroundJob.updateMany({
      where: {
        companyId: delivery.message.lead.companyId,
        eventKey: `sms-status:${delivery.id}`,
        status: { in: ['PENDING', 'FAILED', 'BLOCKED'] },
      },
      data: { status: 'CANCELLED', completedAt: new Date(), lastError: null },
    });
  if (changed)
    console.info(
      JSON.stringify({
        event: 'sms_delivery_status',
        deliveryId: id,
        providerId: input.providerId,
        status,
        errorCode: input.errorCode ?? null,
      }),
    );
}

export async function sendSmsDelivery(
  job: BackgroundJob,
  deliveryId: string,
  provider: SmsProvider = smsProvider,
): Promise<void> {
  const companyId = companyJobId(job);
  const prepared = await prisma.$transaction(async (tx) => {
    await assertJobLease(tx, job);
    const delivery = await tx.smsDelivery.findFirst({
      where: { id: deliveryId, message: { lead: { companyId } } },
      include: { message: true },
    });
    if (!delivery) throw new HttpError(404, 'SMS delivery not found in this business.');
    if (delivery.providerId) return { delivery, send: false };
    if (delivery.status === 'SENDING' || delivery.status === 'UNKNOWN') {
      await tx.smsDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'UNKNOWN',
          lastError:
            'The previous worker may have submitted this SMS. Verify Twilio records before retrying.',
        },
      });
      return { delivery, send: false };
    }
    if (!provider.configured())
      throw new SmsProviderFailure('Twilio is not configured. No SMS was sent.', false, true);
    await reserveProviderUsage(companyId, 'SMS_SEND', 1, tx);
    await tx.smsDelivery.update({
      where: { id: delivery.id },
      data: { status: 'SENDING', sendStartedAt: new Date(), lastError: null, errorCode: null },
    });
    return { delivery, send: true };
  });
  const { delivery } = prepared;
  if (!prepared.send) {
    if (delivery.providerId) {
      const receipt = await provider.fetch(delivery.providerId);
      if (receipt.body !== delivery.message.body)
        throw new HttpError(409, 'The provider receipt does not match this SMS content.');
      await recordSmsStatus(delivery.id, {
        providerId: receipt.id,
        providerStatus: receipt.status,
        from: receipt.from,
        to: receipt.to,
        errorCode: receipt.errorCode,
      });
      return;
    }
    throw new SmsProviderFailure(
      'The previous SMS send has an unknown outcome. Reconcile it before retrying.',
      false,
      true,
      true,
    );
  }

  await prisma.$transaction((tx) => assertJobLease(tx, job));
  let receipt;
  try {
    receipt = await provider.send({
      to: delivery.toPhone,
      from: delivery.fromPhone,
      body: delivery.message.body,
      statusCallback: `${env.API_BASE_URL}/webhooks/twilio/sms/status/${delivery.id}`,
    });
  } catch (error) {
    const failure = classifySmsFailure(error);
    const alreadyAccepted = await prisma.$transaction(async (tx) => {
      await assertJobLease(tx, job);
      const current = await tx.smsDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      if (current.providerId) return true;
      await tx.smsDelivery.update({
        where: { id: current.id },
        data: {
          status: failure.uncertain ? 'UNKNOWN' : 'FAILED',
          lastError: failure.message,
          errorCode: failure.providerCode ?? null,
        },
      });
      return false;
    });
    if (!alreadyAccepted) throw failure;
    return;
  }
  console.info(
    JSON.stringify({
      event: 'sms_provider_receipt',
      deliveryId: delivery.id,
      providerId: receipt.id,
      providerStatus: receipt.status,
    }),
  );
  await recordSmsStatus(delivery.id, {
    providerId: receipt.id,
    providerStatus: receipt.status,
    from: receipt.from,
    to: receipt.to,
    errorCode: receipt.errorCode,
  });
}

export async function processSmsReconciliation(
  job: BackgroundJob,
  provider: SmsProvider = smsProvider,
): Promise<void> {
  const companyId = companyJobId(job);
  const { deliveryId } = z.object({ deliveryId: z.string().min(1) }).parse(job.payload);
  const delivery = await prisma.smsDelivery.findFirst({
    where: { id: deliveryId, message: { lead: { companyId } } },
    include: { message: true },
  });
  if (!delivery) throw new HttpError(404, 'SMS delivery not found in this business.');
  if (delivery.status === 'DELIVERED' || delivery.status === 'FAILED') return;
  if (!delivery.providerId)
    throw new ProviderFailure(
      'A provider message ID is required for status reconciliation.',
      false,
      true,
    );
  const receipt = await provider.fetch(delivery.providerId);
  if (receipt.body !== delivery.message.body)
    throw new ProviderFailure('The provider receipt does not match the recorded SMS.', false, true);
  await recordSmsStatus(delivery.id, {
    providerId: receipt.id,
    providerStatus: receipt.status,
    from: receipt.from,
    to: receipt.to,
    errorCode: receipt.errorCode,
  });
  if (
    receipt.status !== 'delivered' &&
    receipt.status !== 'failed' &&
    receipt.status !== 'undelivered' &&
    receipt.status !== 'canceled'
  )
    throw new ProviderFailure(
      'Provider acceptance is recorded, but final SMS delivery is not confirmed.',
      true,
    );
}

export const smsReconciliationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('LOOKUP'), providerId: messageSidSchema.optional() }).strict(),
  z.object({ action: z.literal('CONFIRM_NOT_SENT'), approved: z.literal(true) }).strict(),
]);

function serializeSmsDelivery(delivery: SmsDelivery): SmsDeliveryRecord {
  return {
    id: delivery.id,
    status: delivery.status,
    providerId: delivery.providerId,
    providerStatus: delivery.providerStatus,
    acceptedAt: delivery.acceptedAt?.toISOString() ?? null,
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
    lastError: delivery.lastError,
    errorCode: delivery.errorCode,
  };
}

export async function reconcileSmsDelivery(
  companyId: string,
  id: string,
  actorId: string,
  input: z.infer<typeof smsReconciliationSchema>,
  provider: SmsProvider = smsProvider,
): Promise<SmsDeliveryRecord> {
  const delivery = await prisma.smsDelivery.findFirst({
    where: { id, message: { lead: { companyId } } },
    include: { message: { include: { outboundEvent: true } } },
  });
  if (!delivery) throw new HttpError(404, 'SMS delivery not found in this business.');
  if (input.action === 'LOOKUP') {
    const providerId = input.providerId ?? delivery.providerId;
    if (!providerId)
      throw new HttpError(
        400,
        'Enter the matching Twilio MessageSid after checking provider records.',
      );
    if (!provider.configured())
      throw new HttpError(503, 'Twilio is not configured. Provider status cannot be checked.');
    const receipt = await provider.fetch(providerId).catch((error: unknown) => {
      if (!(error instanceof SmsProviderFailure)) throw error;
      console.error(
        JSON.stringify({
          event: 'sms_manual_lookup_failed',
          companyId,
          deliveryId: id,
          retryable: error.retryable,
        }),
      );
      throw new HttpError(error.blocked ? 503 : 502, error.message);
    });
    if (receipt.body !== delivery.message.body)
      throw new HttpError(409, 'The provider receipt does not match the recorded SMS content.');
    const updated = await prisma.$transaction(async (tx) => {
      await recordSmsStatus(
        id,
        {
          providerId: receipt.id,
          providerStatus: receipt.status,
          from: receipt.from,
          to: receipt.to,
          errorCode: receipt.errorCode,
        },
        tx,
      );
      await tx.smsDeliveryReview.create({
        data: { deliveryId: id, actorId, action: input.action, providerId: receipt.id },
      });
      return tx.smsDelivery.findUniqueOrThrow({ where: { id } });
    });
    return serializeSmsDelivery(updated);
  }
  const updated = await prisma.$transaction(async (tx) => {
    const jobId = delivery.message.outboundEvent?.jobId;
    if (!jobId) throw new HttpError(409, 'This SMS has no recoverable sending job.');
    await tx.$queryRaw`SELECT "id" FROM "BackgroundJob" WHERE "id" = ${jobId} FOR UPDATE`;
    const currentJob = await tx.backgroundJob.findUniqueOrThrow({ where: { id: jobId } });
    const current = await tx.smsDelivery.findUniqueOrThrow({ where: { id } });
    if (
      (currentJob.status !== 'BLOCKED' && currentJob.status !== 'FAILED') ||
      (current.status !== 'UNKNOWN' && current.status !== 'SENDING') ||
      current.providerId
    )
      throw new HttpError(
        409,
        'Only a stopped, uncertain send with no provider receipt can be authorized again.',
      );
    const updatedDelivery = await tx.smsDelivery.update({
      where: { id },
      data: { status: 'PENDING', lastError: null, sendStartedAt: null },
    });
    await tx.smsDeliveryReview.create({
      data: { deliveryId: id, actorId, action: input.action },
    });
    await tx.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: 'PENDING',
        dueAt: new Date(),
        lastError: null,
        completedAt: null,
        maxAttempts: Math.max(currentJob.maxAttempts, currentJob.attempts + 3),
      },
    });
    console.warn(
      JSON.stringify({
        event: 'sms_resend_manually_authorized',
        deliveryId: id,
        companyId,
        actorId,
      }),
    );
    return updatedDelivery;
  });
  return serializeSmsDelivery(updated);
}
