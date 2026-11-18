import { z } from 'zod';

export const twilioVoiceSchema = z.object({
  CallSid: z.string().min(1),
  From: z.string().min(1),
  To: z.string().min(1),
});

export const twilioVoiceStatusSchema = z.object({
  CallSid: z.string().min(1),
  DialCallStatus: z.string().optional(),
  From: z.string().min(1),
  To: z.string().min(1),
});

export const twilioSmsSchema = z.object({
  MessageSid: z.string().min(1),
  Body: z.string().min(1),
  From: z.string().min(1),
  To: z.string().min(1),
});
