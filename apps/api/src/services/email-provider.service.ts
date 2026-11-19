import { createHash } from 'node:crypto';
import type { BackgroundJob } from '@prisma/client';
import { z } from 'zod';

import { env } from '../env.js';
import { EMAIL_RETRY_WINDOW_MS } from './background-job.service.js';

export const outboundEmailSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().email(),
    subject: z.string().min(1),
    text: z.string(),
    html: z.string(),
    headers: z.record(z.string(), z.string()),
    reply_to: z.string().email().optional(),
  })
  .strict();
export type OutboundEmail = z.infer<typeof outboundEmailSchema>;

export class ProviderFailure extends Error {
  constructor(
    message: string,
    public retryable: boolean,
    public blocked = false,
  ) {
    super(message);
    this.name = 'ProviderFailure';
  }
}

export function emailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL);
}

export function escapeEmailHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}

export function emailDisplayName(value: string): string {
  return [...value]
    .filter(
      (character) =>
        character.charCodeAt(0) >= 32 &&
        character.charCodeAt(0) !== 127 &&
        !'"<>'.includes(character),
    )
    .join('')
    .slice(0, 120);
}

export async function sendTransactionalEmail(
  job: BackgroundJob,
  email: OutboundEmail,
): Promise<string> {
  if (!emailConfigured())
    throw new ProviderFailure('Resend is not configured. No email was sent.', false, true);
  if (job.firstAttemptAt && Date.now() - job.firstAttemptAt.getTime() >= EMAIL_RETRY_WINDOW_MS) {
    throw new ProviderFailure(
      'Provider idempotency window expired; verify delivery before sending again.',
      false,
    );
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Idempotency-Key': createHash('sha256')
        .update(`${job.companyId}:${job.eventKey}`)
        .digest('hex'),
    },
    body: JSON.stringify(email),
    signal: AbortSignal.timeout(20000),
  }).catch(() => {
    throw new ProviderFailure(
      'Resend could not be reached; the same idempotency key will be reused.',
      true,
    );
  });
  if (!response.ok)
    throw new ProviderFailure(
      `Resend returned HTTP ${response.status}.`,
      response.status === 429 || response.status >= 500,
      response.status === 401 || response.status === 403,
    );
  let result: unknown;
  try {
    result = await response.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new ProviderFailure(
      'Resend returned an unreadable receipt; retry safely with the same idempotency key.',
      true,
    );
  }
  const parsed = z.object({ id: z.string().min(1) }).safeParse(result);
  if (!parsed.success)
    throw new ProviderFailure(
      'Resend returned an unreadable receipt; retry safely with the same idempotency key.',
      true,
    );
  return parsed.data.id;
}
