import twilio from 'twilio';
import type { Request } from 'express';

import { env } from '../env.js';

const twilioClient = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN
  ? twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN)
  : null;

export function validateTwilioSignature(req: Request): boolean {
  if (!env.TWILIO_VALIDATE_SIGNATURES) {
    return true;
  }

  if (!env.TWILIO_AUTH_TOKEN) {
    return false;
  }

  const signature = req.header('x-twilio-signature');

  if (!signature) {
    return false;
  }

  const webhookUrl = `${env.API_BASE_URL}${req.originalUrl}`;

  return twilio.validateRequest(env.TWILIO_AUTH_TOKEN, signature, webhookUrl, req.body);
}

export async function sendSms(to: string, body: string, from?: string): Promise<string | null> {
  if (!twilioClient) {
    console.warn('Twilio client not configured; skipping SMS send.');
    return null;
  }

  const sender = from ?? env.TWILIO_PHONE_NUMBER;

  if (!sender) {
    console.warn('Twilio sender number missing; skipping SMS send.');
    return null;
  }

  const response = await twilioClient.messages.create({
    to,
    from: sender,
    body,
  });

  return response.sid;
}

export function createMissedCallGreeting(companyName: string): string {
  return `Hi! Sorry we missed your call to ${companyName}. What can we help you with today?`;
}
