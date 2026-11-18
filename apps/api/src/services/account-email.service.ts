import { createHash } from 'node:crypto';
import type { BackgroundJob, PrismaClient } from '@prisma/client';
import { prisma } from '@lead-recovery/database';
import { z } from 'zod';

import { env } from '../env.js';
import {
  emailDisplayName,
  escapeEmailHtml,
  ProviderFailure,
  type OutboundEmail,
} from './email-provider.service.js';

export const accountEmailSchema = z
  .object({
    userId: z.string().min(1),
    email: z.string().email(),
    url: z.string().url(),
    type: z.enum(['VERIFY_EMAIL', 'PASSWORD_RESET']),
    expiresAt: z.string().datetime(),
  })
  .strict();
export type AccountEmail = z.infer<typeof accountEmailSchema>;

export async function enqueueAccountEmail(
  database: PrismaClient,
  data: Omit<AccountEmail, 'expiresAt'>,
  baseURL: string,
): Promise<void> {
  const parsed = accountEmailSchema.parse({
    ...data,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });
  const url = new URL(parsed.url);
  if (
    url.origin !== new URL(baseURL).origin ||
    (parsed.type === 'VERIFY_EMAIL'
      ? url.pathname !== '/api/auth/verify-email'
      : !url.pathname.startsWith('/api/auth/reset-password/'))
  ) {
    throw new Error('The account email URL is outside the configured application.');
  }
  const hash = createHash('sha256').update(parsed.url).digest('hex');
  await database.backgroundJob.upsert({
    where: {
      userId_eventKey: {
        userId: parsed.userId,
        eventKey: `auth:${parsed.userId}:${parsed.type}:${hash}`,
      },
    },
    create: {
      companyId: null,
      userId: parsed.userId,
      kind: 'AUTH_EMAIL',
      eventKey: `auth:${parsed.userId}:${parsed.type}:${hash}`,
      payload: parsed,
    },
    update: {},
  });
}

export async function prepareAccountEmail(job: BackgroundJob): Promise<OutboundEmail | null> {
  const parsed = accountEmailSchema.safeParse(job.payload);
  if (!parsed.success) throw new ProviderFailure('The account email job is invalid.', false);
  const data = parsed.data;
  if (job.kind !== 'AUTH_EMAIL' || job.companyId !== null || job.userId !== data.userId)
    throw new ProviderFailure('The account email job has an invalid account scope.', false);
  if (new Date(data.expiresAt).getTime() <= Date.now()) return null;
  const user = await prisma.user.findUnique({
    where: { id: data.userId },
    select: { id: true, name: true, email: true, emailVerified: true },
  });
  if (!user || user.email !== data.email || (data.type === 'VERIFY_EMAIL' && user.emailVerified))
    return null;
  if (new URL(data.url).origin !== new URL(env.DASHBOARD_BASE_URL).origin)
    throw new ProviderFailure('The account link does not match the application origin.', false);
  if (data.email.toLowerCase().endsWith('.test'))
    throw new ProviderFailure(
      'Reserved .test account emails are never sent to a live provider. Use the local development email command in tests.',
      false,
      true,
    );
  if (!env.RESEND_FROM_EMAIL)
    throw new ProviderFailure('Account email requires a verified RESEND_FROM_EMAIL.', false, true);
  const title =
    data.type === 'VERIFY_EMAIL'
      ? 'Verify your Lead Recovery email'
      : 'Reset your Lead Recovery password';
  const notice =
    data.type === 'VERIFY_EMAIL'
      ? 'Verify your email address to finish creating your account.'
      : 'Use this link to reset your password. Existing sessions will be revoked.';
  if (job.deliveryPayload) {
    const saved = (await import('./email-provider.service.js')).outboundEmailSchema.safeParse(
      job.deliveryPayload,
    );
    if (!saved.success || saved.data.to !== data.email)
      throw new ProviderFailure('The saved account email is invalid.', false);
    return saved.data;
  }
  return {
    from: `Lead Recovery <${env.RESEND_FROM_EMAIL}>`,
    to: data.email,
    subject: title,
    text: `${title}\n\nHi ${emailDisplayName(user.name)},\n\n${notice}\n\n${data.url}\n\nIf you did not request this, ignore this email. Account links expire.`,
    html: `<h2>${title}</h2><p>Hi ${escapeEmailHtml(user.name)},</p><p>${notice}</p><p><a href="${escapeEmailHtml(data.url)}">${data.type === 'VERIFY_EMAIL' ? 'Verify email address' : 'Reset password'}</a></p><p>If you did not request this, ignore this email. Account links expire.</p>`,
    headers: {},
  };
}
