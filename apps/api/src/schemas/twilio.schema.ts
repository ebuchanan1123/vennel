import { z } from 'zod';

export const twilioPhoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/);
const phone = twilioPhoneSchema;
const callSid = z.string().regex(/^CA[a-fA-F0-9]{32}$/);
export const messageSidSchema = z.string().regex(/^(SM|MM)[a-fA-F0-9]{32}$/);
const accountSid = z
  .string()
  .regex(/^AC[a-fA-F0-9]{32}$/)
  .optional();

export const twilioVoiceSchema = z.object({
  CallSid: callSid,
  AccountSid: accountSid,
  From: z.union([phone, z.enum(['anonymous', 'unknown', 'restricted'])]),
  To: phone,
});

export const twilioVoiceStatusSchema = twilioVoiceSchema.extend({
  DialCallStatus: z.enum(['completed', 'answered', 'busy', 'no-answer', 'failed', 'canceled']),
});

export const twilioSmsSchema = z.object({
  MessageSid: messageSidSchema,
  AccountSid: accountSid,
  Body: z.string().trim().min(1).max(1600),
  From: phone,
  To: phone,
});

export const twilioMessageStatusSchema = z.enum([
  'accepted',
  'scheduled',
  'queued',
  'sending',
  'sent',
  'delivered',
  'undelivered',
  'failed',
  'canceled',
]);

export const twilioSmsStatusSchema = z.object({
  MessageSid: messageSidSchema,
  MessageStatus: twilioMessageStatusSchema,
  AccountSid: accountSid,
  From: phone.optional(),
  To: phone.optional(),
  ErrorCode: z
    .string()
    .regex(/^\d{1,10}$/)
    .optional(),
});
