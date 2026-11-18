import twilio from 'twilio';
import type { Request } from 'express';

import { env } from '../env.js';
import { ProviderFailure } from './email-provider.service.js';
import { messageSidSchema, twilioMessageStatusSchema } from '../schemas/twilio.schema.js';

const twilioClient =
  env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN
    ? twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, {
        autoRetry: false,
        maxRetries: 0,
        timeout: env.SMS_PROVIDER_TIMEOUT_MS,
      })
    : null;

export function validateTwilioSignature(req: Request): boolean {
  if (
    env.TWILIO_ACCOUNT_SID &&
    req.body?.AccountSid &&
    req.body.AccountSid !== env.TWILIO_ACCOUNT_SID
  )
    return false;
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

export class SmsProviderFailure extends ProviderFailure {
  constructor(
    message: string,
    retryable: boolean,
    blocked = false,
    public readonly uncertain = false,
  ) {
    super(message, retryable, blocked);
    this.name = 'SmsProviderFailure';
  }
}

export function classifySmsFailure(error: unknown): SmsProviderFailure {
  if (error instanceof SmsProviderFailure) return error;
  const status =
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
      ? error.status
      : null;
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  if (status === 429)
    return new SmsProviderFailure(
      'Twilio rejected the request due to rate limiting (HTTP 429).',
      true,
    );
  if (status && status >= 400 && status < 500)
    return new SmsProviderFailure(
      `Twilio rejected the SMS request (HTTP ${status}).`,
      false,
      status === 401 || status === 403,
    );
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ECONNREFUSED')
    return new SmsProviderFailure(
      'Twilio could not be contacted before sending the request.',
      true,
    );
  // Twilio Messaging does not provide a send idempotency key. A timeout or 5xx is not proof of rejection.
  return new SmsProviderFailure(
    'Twilio acceptance is unknown. Verify provider records before authorizing another SMS.',
    false,
    true,
    true,
  );
}

export type SmsReceipt = {
  id: string;
  status: string;
  from: string;
  to: string;
  body: string;
  errorCode: string | null;
};

export interface SmsProvider {
  configured(): boolean;
  send(input: {
    to: string;
    from: string;
    body: string;
    statusCallback: string;
  }): Promise<SmsReceipt>;
  fetch(providerId: string): Promise<SmsReceipt>;
}

export const smsProvider: SmsProvider = {
  configured: () => Boolean(twilioClient),
  async send(input) {
    if (!twilioClient)
      throw new SmsProviderFailure('Twilio is not configured. No SMS was sent.', false, true);
    try {
      const response = await twilioClient.messages.create(input);
      return {
        id: messageSidSchema.parse(response.sid),
        status: twilioMessageStatusSchema.parse(response.status),
        from: response.from,
        to: response.to,
        body: response.body,
        errorCode: response.errorCode?.toString() ?? null,
      };
    } catch (error) {
      throw classifySmsFailure(error);
    }
  },
  async fetch(providerId) {
    if (!twilioClient)
      throw new SmsProviderFailure(
        'Twilio is not configured. Status lookup is unavailable.',
        false,
        true,
      );
    const response = await twilioClient.messages(messageSidSchema.parse(providerId)).fetch();
    return {
      id: messageSidSchema.parse(response.sid),
      status: twilioMessageStatusSchema.parse(response.status),
      from: response.from,
      to: response.to,
      body: response.body,
      errorCode: response.errorCode?.toString() ?? null,
    };
  },
};

export function createMissedCallGreeting(companyName: string): string {
  return `Hi! Sorry we missed your call to ${companyName}. What can we help you with today?`;
}
