import { prisma } from '@lead-recovery/database';
import type { BackgroundJob, Prisma, SmsDeliveryStatus } from '@prisma/client';

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
    include: { message: { include: { outboundEvent: true } } },
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
  const prepared = await prisma.$transaction(async (tx) => {
    await assertJobLease(tx, job);
    const delivery = await tx.smsDelivery.findFirst({
      where: { id: deliveryId, message: { lead: { companyId: job.companyId ?? '' } } },
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
