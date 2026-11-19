import { prisma } from '@lead-recovery/database';
import type { BackgroundJob, Prisma } from '@prisma/client';
import { z } from 'zod';

import { env } from '../env.js';
import { HttpError } from '../middleware/error-handler.js';
import { enqueueBackgroundJob, companyJobId } from './background-job.service.js';
import { assertJobLease } from './conversation-lock.service.js';
import { EMERGENCY_ESCALATION_MESSAGE, isEmergencyMessage } from './emergency.service.js';
import { IRRELEVANT_MESSAGE_REPLY, isIrrelevantMessage } from './irrelevant-message.service.js';
import {
  createMessage,
  findOrCreateActiveLead,
  findOrCreateLeadForMissedCall,
  getRecentMessages,
  updateLead,
  type LeadUpdates,
} from './lead.service.js';
import { hasRecentDuplicateMissedCall } from './missed-call-duplicate.service.js';
import { generateQualificationResponse } from './qualification.service.js';
import { sendSmsDelivery } from './sms-delivery.service.js';
import { createMissedCallGreeting } from './twilio.service.js';
import { ProviderFailure } from './email-provider.service.js';
import { ProviderUsageLimitError } from './provider-usage.service.js';
import { normalizePhone } from './company.service.js';
import { twilioPhoneSchema } from '../schemas/twilio.schema.js';

export const QUALIFICATION_FALLBACK_MESSAGE =
  "Thanks - I've passed this along to the team, and someone will follow up with you.";
const HARDCODED_MESSAGE = 'SMS webhook received. Reply mode is hardcoded for webhook verification.';
const payloadSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  body: z.string().optional(),
});

export async function persistCommunicationEvent(input: {
  companyId: string;
  eventType: 'SMS_MESSAGE' | 'VOICE_STATUS';
  providerId: string;
  from: string;
  to: string;
  body?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const legacy = await tx.webhookEvent.findFirst({
      where: {
        companyId: null,
        eventType: input.eventType,
        externalId:
          input.eventType === 'SMS_MESSAGE'
            ? input.providerId
            : { startsWith: `voice-status:${input.providerId}:` },
      },
    });
    if (legacy) return legacy;
    const externalId = `${input.companyId}:${input.eventType}:${input.providerId}`;
    const existing = await tx.webhookEvent.findUnique({ where: { externalId } });
    if (existing) return existing;
    const conversation = await tx.conversation.upsert({
      where: { companyId_phone: { companyId: input.companyId, phone: input.from } },
      create: { companyId: input.companyId, phone: input.from, nextSequence: 1 },
      update: { nextSequence: { increment: 1 } },
    });
    const event = await tx.webhookEvent.upsert({
      where: { externalId },
      create: {
        externalId,
        companyId: input.companyId,
        eventType: input.eventType,
        providerId: input.providerId,
        conversationId: conversation.id,
        sequence: conversation.nextSequence,
        payload: { from: input.from, to: input.to, ...(input.body ? { body: input.body } : {}) },
      },
      update: {},
    });
    if (event.jobId) return event;
    const job = await enqueueBackgroundJob(
      tx,
      input.companyId,
      input.eventType === 'SMS_MESSAGE' ? 'INBOUND_SMS' : 'MISSED_CALL_RECOVERY',
      `communication:${externalId}`,
      { webhookEventId: event.id },
    );
    return tx.webhookEvent.update({ where: { id: event.id }, data: { jobId: job.id } });
  });
}

async function createOutbound(
  db: Prisma.TransactionClient,
  eventId: string,
  leadId: string,
  from: string,
  to: string,
  body: string,
) {
  const message = await createMessage(leadId, 'OUTBOUND', body, db);
  await db.smsDelivery.create({ data: { messageId: message.id, fromPhone: from, toPhone: to } });
  await db.webhookEvent.update({
    where: { id: eventId },
    data: { outboundMessageId: message.id },
  });
}

export async function processCommunicationJob(job: BackgroundJob): Promise<void> {
  const companyId = companyJobId(job);
  const { webhookEventId } = z.object({ webhookEventId: z.string().min(1) }).parse(job.payload);
  let event = await prisma.$transaction(async (tx) => {
    await assertJobLease(tx, job);
    const current = await tx.webhookEvent.findFirst({
      where: { id: webhookEventId, companyId, jobId: job.id },
      include: { company: true },
    });
    if (!current?.company)
      throw new HttpError(404, 'Communication event not found in this business.');
    if (current.status === 'COMPLETED') return current;
    if (!current.company.isActive)
      throw new ProviderFailure(
        'The business is inactive. Communications are paused.',
        false,
        true,
      );
    const payload = payloadSchema.parse(current.payload);
    if (
      !current.company.twilioPhoneNumber ||
      normalizePhone(current.company.twilioPhoneNumber) !== payload.to
    )
      throw new ProviderFailure(
        'The receiving Twilio number is no longer assigned to this business.',
        false,
        true,
      );
    await tx.webhookEvent.update({
      where: { id: current.id },
      data: { status: 'PROCESSING', attempts: job.attempts },
    });
    if (current.eventType === 'SMS_MESSAGE' && !current.inboundMessageId) {
      if (!payload.body) throw new HttpError(400, 'The inbound SMS body is missing.');
      const lead = await findOrCreateActiveLead(companyId, payload.from, 'SMS', tx);
      const message = await createMessage(lead.id, 'INBOUND', payload.body, tx);
      current.inboundMessageId = message.id;
      await tx.webhookEvent.update({
        where: { id: current.id },
        data: { inboundMessageId: message.id },
      });
    }
    if (current.eventType === 'VOICE_STATUS' && !current.outboundMessageId) {
      if (!twilioPhoneSchema.safeParse(payload.from).success) {
        current.status = 'COMPLETED';
        await tx.webhookEvent.update({
          where: { id: current.id },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            lastError: 'The caller ID is unavailable; no SMS-capable recovery number was supplied.',
          },
        });
        console.warn(
          JSON.stringify({
            event: 'missed_call_without_sms_number',
            companyId,
            webhookEventId: current.id,
          }),
        );
        return current;
      }
      const greeting = createMissedCallGreeting(current.company.name);
      const previous = await tx.message.findFirst({
        where: {
          direction: 'OUTBOUND',
          body: greeting,
          lead: { companyId, phone: payload.from },
          OR: [{ smsDelivery: null }, { smsDelivery: { status: { not: 'FAILED' } } }],
        },
        orderBy: { createdAt: 'desc' },
      });
      if (hasRecentDuplicateMissedCall(previous?.body, greeting, previous?.createdAt, new Date())) {
        current.status = 'COMPLETED';
        await tx.webhookEvent.update({
          where: { id: current.id },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
        return current;
      }
      const lead = await findOrCreateLeadForMissedCall(companyId, payload.from, tx);
      await createOutbound(tx, current.id, lead.id, payload.to, payload.from, greeting);
    }
    return current;
  });
  if (event.status === 'COMPLETED') return;
  const company = event.company;
  if (!company) throw new HttpError(404, 'The business no longer exists.');

  if (event.eventType === 'SMS_MESSAGE' && !event.outboundMessageId) {
    const payload = payloadSchema.parse(event.payload);
    const message = await prisma.message.findUniqueOrThrow({
      where: { id: event.inboundMessageId ?? '' },
      include: { lead: true },
    });
    let reply: string;
    let updates: LeadUpdates = {};
    let qualificationError: string | null = null;
    if (isEmergencyMessage(message.body)) {
      reply = EMERGENCY_ESCALATION_MESSAGE;
      updates = {
        status: 'NEEDS_HUMAN',
        needsHuman: true,
        summary: 'Emergency language detected in SMS conversation.',
      };
    } else if (isIrrelevantMessage(message.body)) {
      reply = IRRELEVANT_MESSAGE_REPLY;
      updates = {
        status: 'NEEDS_HUMAN',
        needsHuman: true,
        summary: 'Message appears irrelevant or spam; escalated for human review.',
      };
    } else if (env.TWILIO_SMS_REPLY_MODE === 'hardcoded') {
      reply = HARDCODED_MESSAGE;
    } else {
      const recentMessages = await getRecentMessages(message.leadId, 10);
      try {
        const qualification = await generateQualificationResponse({
          company,
          lead: message.lead,
          latestCustomerMessage: message.body,
          recentMessages,
        });
        const { reply: qualifiedReply, ...fields } = qualification;
        reply = qualifiedReply;
        updates = fields;
      } catch (error) {
        const status =
          typeof error === 'object' &&
          error !== null &&
          'status' in error &&
          typeof error.status === 'number'
            ? error.status
            : null;
        const retryable =
          !(error instanceof ProviderUsageLimitError) &&
          (!status || status === 429 || status >= 500);
        qualificationError =
          error instanceof ProviderUsageLimitError
            ? error.message
            : status
              ? `AI qualification failed (HTTP ${status}).`
              : 'AI qualification was unavailable, timed out, or returned invalid output.';
        console.warn(
          JSON.stringify({
            event: 'sms_qualification_failed',
            jobId: job.id,
            companyId,
            attempt: job.attempts,
            providerStatus: status,
            retryable,
          }),
        );
        if (env.OPENAI_API_KEY && retryable && job.attempts < job.maxAttempts)
          throw new ProviderFailure(qualificationError, true);
        reply = QUALIFICATION_FALLBACK_MESSAGE;
        updates = { needsHuman: true, status: 'NEEDS_HUMAN' };
      }
    }
    await prisma.$transaction(async (tx) => {
      await assertJobLease(tx, job);
      const currentLead = await tx.lead.findUniqueOrThrow({ where: { id: message.leadId } });
      if (currentLead.updatedAt.getTime() !== message.lead.updatedAt.getTime())
        throw new ProviderFailure(
          'Lead data changed during qualification. Retry against the current conversation state.',
          true,
        );
      await updateLead(message.leadId, updates, tx);
      await createOutbound(tx, event.id, message.leadId, payload.to, payload.from, reply);
      if (qualificationError)
        await tx.webhookEvent.update({
          where: { id: event.id },
          data: { lastError: qualificationError },
        });
    });
  }
  event = await prisma.webhookEvent.findUniqueOrThrow({
    where: { id: event.id },
    include: { company: true },
  });
  const delivery = await prisma.smsDelivery.findUniqueOrThrow({
    where: { messageId: event.outboundMessageId ?? '' },
  });
  await sendSmsDelivery(job, delivery.id);
}

export async function recordCommunicationFailure(
  job: BackgroundJob,
  error: string,
  needsHuman: boolean,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertJobLease(tx, job);
    const event = await tx.webhookEvent.findFirst({
      where: {
        jobId: job.id,
        status: { not: 'COMPLETED' },
        job: { status: 'RUNNING', leaseToken: job.leaseToken },
      },
      include: { inboundMessage: true, outboundMessage: true },
    });
    if (!event) return;
    await tx.webhookEvent.update({
      where: { id: event.id },
      data: { status: 'FAILED', lastError: error },
    });
    const leadId = event.inboundMessage?.leadId ?? event.outboundMessage?.leadId;
    if (needsHuman && leadId)
      await updateLead(leadId, { status: 'NEEDS_HUMAN', needsHuman: true }, tx);
  });
}
