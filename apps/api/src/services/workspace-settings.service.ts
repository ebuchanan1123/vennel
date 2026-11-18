import { randomUUID } from 'node:crypto';
import { prisma } from '@lead-recovery/database';
import { isBusinessTimeZone, type WorkspaceSettings } from '@lead-recovery/types';
import { z } from 'zod';

import { HttpError } from '../middleware/error-handler.js';
import { emailConfigured } from './notification.service.js';
import { emailDisplayName } from './email-provider.service.js';
import { env } from '../env.js';

export const workspaceSettingsSchema = z
  .object({
    timeZone: z.string().refine(isBusinessTimeZone, 'Choose a valid IANA business time zone.'),
    notifications: z
      .object({
        enabled: z.boolean(),
        recipientEmail: z.string().email().nullable(),
        newLeads: z.boolean(),
        humanAttention: z.boolean(),
        overdueFollowUps: z.boolean(),
        documentReview: z.boolean(),
        documentReminderHours: z.number().int().min(1).max(168),
        consent: z.boolean(),
      })
      .strict(),
    documentEmail: z
      .object({
        enabled: z.boolean(),
        senderName: z
          .string()
          .trim()
          .min(1)
          .max(120)
          .refine(
            (value) => emailDisplayName(value) === value,
            'Use a sender name without control characters or angle brackets.',
          ),
        replyTo: z.string().trim().email().nullable(),
        authorized: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.notifications.enabled &&
      (!value.notifications.recipientEmail || !value.notifications.consent)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['notifications'],
        message: 'Confirm the owner email and opt-in consent before enabling notifications.',
      });
    }
    if (value.documentEmail?.enabled && !value.documentEmail.authorized) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['documentEmail'],
        message: 'Confirm authorization to send requested documents from this business.',
      });
    }
  });

export async function getWorkspaceSettings(companyId: string): Promise<WorkspaceSettings> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const [preferences, worker, failedJobs, blockedJobs] = await Promise.all([
    prisma.notificationPreference.findUnique({ where: { companyId } }),
    prisma.workerHeartbeat.findFirst({ orderBy: { lastSeenAt: 'desc' } }),
    prisma.backgroundJob.count({ where: { companyId, status: 'FAILED' } }),
    prisma.backgroundJob.count({ where: { companyId, status: 'BLOCKED' } }),
  ]);
  return {
    now: new Date().toISOString(),
    timeZone: company.timeZone,
    notifications: {
      enabled: preferences?.enabled ?? false,
      recipientEmail: preferences?.recipientEmail ?? null,
      consentedAt: preferences?.consentedAt?.toISOString() ?? null,
      newLeads: preferences?.newLeads ?? true,
      humanAttention: preferences?.humanAttention ?? true,
      overdueFollowUps: preferences?.overdueFollowUps ?? true,
      documentReview: preferences?.documentReview ?? true,
      documentReminderHours: preferences?.documentReminderHours ?? 24,
    },
    emailProviderConfigured: emailConfigured(),
    workerHealthy: Boolean(worker && Date.now() - worker.lastSeenAt.getTime() < 120000),
    failedJobs,
    blockedJobs,
    documentEmail: {
      enabled: company.documentEmailEnabled,
      senderName: company.documentSenderName ?? company.name,
      replyTo: company.documentReplyTo,
      senderEmail: env.RESEND_FROM_EMAIL ?? null,
      webhookConfigured: Boolean(env.RESEND_WEBHOOK_SECRET),
    },
  };
}

export async function updateWorkspaceSettings(
  companyId: string,
  input: z.infer<typeof workspaceSettingsSchema>,
): Promise<WorkspaceSettings> {
  const previous = await prisma.notificationPreference.findUnique({ where: { companyId } });
  const email = input.notifications.recipientEmail?.toLowerCase() ?? null;
  const renewConsent =
    input.notifications.enabled && (!previous?.enabled || previous.recipientEmail !== email);
  const data = {
    enabled: input.notifications.enabled,
    recipientEmail: email,
    consentedAt: input.notifications.enabled
      ? renewConsent
        ? new Date()
        : (previous?.consentedAt ?? new Date())
      : (previous?.consentedAt ?? null),
    newLeads: input.notifications.newLeads,
    humanAttention: input.notifications.humanAttention,
    overdueFollowUps: input.notifications.overdueFollowUps,
    documentReview: input.notifications.documentReview,
    documentReminderHours: input.notifications.documentReminderHours,
    ...(renewConsent ? { optOutToken: randomUUID() } : {}),
  };
  await prisma.$transaction(async (tx) => {
    const company = await tx.company.updateMany({
      where: { id: companyId, isActive: true },
      data: {
        timeZone: input.timeZone,
        ...(input.documentEmail
          ? {
              documentEmailEnabled: input.documentEmail.enabled,
              documentSenderName: input.documentEmail.senderName,
              documentReplyTo: input.documentEmail.replyTo?.toLowerCase() ?? null,
            }
          : {}),
      },
    });
    if (!company.count) throw new HttpError(404, 'Active business not found.');
    await tx.notificationPreference.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
    });
    if (!input.notifications.enabled || renewConsent) {
      await tx.backgroundJob.updateMany({
        where: { companyId, kind: 'OWNER_EMAIL', status: { in: ['PENDING', 'FAILED', 'BLOCKED'] } },
        data: {
          status: 'CANCELLED',
          lastError: 'Notification preferences changed.',
          completedAt: new Date(),
        },
      });
    }
    if (input.documentEmail && !input.documentEmail.enabled) {
      await tx.backgroundJob.updateMany({
        where: {
          companyId,
          kind: 'DOCUMENT_EMAIL',
          status: { in: ['PENDING', 'FAILED', 'BLOCKED'] },
        },
        data: {
          status: 'CANCELLED',
          lastError: 'The owner disabled customer document delivery.',
          completedAt: new Date(),
        },
      });
    }
  });
  return getWorkspaceSettings(companyId);
}
