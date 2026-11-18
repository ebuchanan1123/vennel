import { prisma } from '@lead-recovery/database';
import { formatBusinessTime } from '@lead-recovery/types';
import type { BackgroundJob, Prisma } from '@prisma/client';
import { z } from 'zod';

import { env } from '../env.js';
import { HttpError } from '../middleware/error-handler.js';
import { companyJobId, enqueueBackgroundJob } from './background-job.service.js';
import {
  outboundEmailSchema as emailSchema,
  emailDisplayName,
  escapeEmailHtml as escapeHtml,
  ProviderFailure,
} from './email-provider.service.js';

export {
  emailConfigured,
  ProviderFailure,
  sendTransactionalEmail as sendOwnerEmail,
} from './email-provider.service.js';

export const notificationPayloadSchema = z.object({
  kind: z.enum(['NEW_LEAD', 'HUMAN_ATTENTION', 'OVERDUE_FOLLOW_UP', 'DOCUMENT_REVIEW']),
  leadId: z.string().optional(),
  taskId: z.string().optional(),
  documentId: z.string().optional(),
  recipientEmail: z.string().email(),
  preferenceToken: z.string(),
});
function enabledForKind(
  preferences: {
    newLeads: boolean;
    humanAttention: boolean;
    overdueFollowUps: boolean;
    documentReview: boolean;
  },
  kind: z.infer<typeof notificationPayloadSchema>['kind'],
) {
  return kind === 'NEW_LEAD'
    ? preferences.newLeads
    : kind === 'HUMAN_ATTENTION'
      ? preferences.humanAttention
      : kind === 'OVERDUE_FOLLOW_UP'
        ? preferences.overdueFollowUps
        : preferences.documentReview;
}

export async function enqueueOwnerNotification(
  db: Prisma.TransactionClient,
  companyId: string,
  eventKey: string,
  payload: Pick<
    z.infer<typeof notificationPayloadSchema>,
    'kind' | 'leadId' | 'taskId' | 'documentId'
  >,
): Promise<void> {
  const preferences = await db.notificationPreference.findUnique({ where: { companyId } });
  if (
    !preferences?.enabled ||
    !preferences.recipientEmail ||
    !preferences.consentedAt ||
    !enabledForKind(preferences, payload.kind)
  )
    return;
  await enqueueBackgroundJob(
    db,
    companyId,
    'OWNER_EMAIL',
    `${eventKey}:${preferences.optOutToken}`,
    {
      ...payload,
      recipientEmail: preferences.recipientEmail,
      preferenceToken: preferences.optOutToken,
    },
  );
}

export async function prepareOwnerEmail(
  job: BackgroundJob,
): Promise<z.infer<typeof emailSchema> | null> {
  const companyId = companyJobId(job);
  const parsed = notificationPayloadSchema.safeParse(job.payload);
  if (!parsed.success) throw new ProviderFailure('The notification payload is invalid.', false);
  const payload = parsed.data;
  const preferences = await prisma.notificationPreference.findUnique({
    where: { companyId },
  });
  if (
    !preferences?.enabled ||
    !preferences.consentedAt ||
    preferences.recipientEmail !== payload.recipientEmail ||
    preferences.optOutToken !== payload.preferenceToken ||
    !enabledForKind(preferences, payload.kind)
  )
    return null;
  const company = await prisma.company.findFirst({ where: { id: companyId, isActive: true } });
  if (!company) return null;
  let title: string;
  let message: string;
  let target: string;
  if (payload.kind === 'OVERDUE_FOLLOW_UP' && payload.taskId) {
    const task = await prisma.followUpTask.findFirst({
      where: { id: payload.taskId, companyId, status: 'PENDING' },
    });
    if (!task || task.dueAt.getTime() >= Date.now()) return null;
    title = 'Follow-up needs attention';
    message = `${task.title} was due ${formatBusinessTime(task.dueAt.toISOString(), company.timeZone)}.`;
    target = '/follow-ups';
  } else if (payload.kind === 'DOCUMENT_REVIEW' && payload.documentId) {
    const document = await prisma.billingDocument.findFirst({
      where: { id: payload.documentId, companyId, status: 'DRAFT' },
    });
    if (!document) return null;
    title = 'Document awaiting your review';
    message = `Your ${document.kind === 'ESTIMATE' ? 'estimate' : 'invoice'} draft is still awaiting owner approval.`;
    target = `/billing/${document.id}`;
  } else if (payload.leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: payload.leadId, companyId },
    });
    if (
      !lead ||
      (payload.kind === 'HUMAN_ATTENTION' && !lead.needsHuman && lead.status !== 'NEEDS_HUMAN')
    )
      return null;
    title =
      payload.kind === 'HUMAN_ATTENTION' ? 'A lead requires human attention' : 'New lead captured';
    message =
      payload.kind === 'HUMAN_ATTENTION'
        ? 'Review the flagged conversation in your workspace.'
        : 'A new inquiry is available for your team to review.';
    target = `/leads/${lead.id}`;
  } else {
    throw new ProviderFailure('The notification target is missing.', false);
  }
  if (job.deliveryPayload) {
    const previous = emailSchema.safeParse(job.deliveryPayload);
    if (!previous.success)
      throw new ProviderFailure('The saved delivery payload is invalid.', false);
    return previous.data;
  }
  if (!env.RESEND_FROM_EMAIL)
    throw new ProviderFailure(
      'Configure RESEND_API_KEY and a verified RESEND_FROM_EMAIL before sending owner notifications.',
      false,
      true,
    );
  const url = new URL(target, env.DASHBOARD_BASE_URL);
  url.searchParams.set('companyId', company.id);
  const unsubscribe = new URL(
    `/notifications/unsubscribe/${preferences.optOutToken}`,
    env.DASHBOARD_BASE_URL,
  ).toString();
  const displayName = emailDisplayName(company.name);
  return {
    from: `${displayName} <${env.RESEND_FROM_EMAIL}>`,
    to: payload.recipientEmail,
    subject: `${displayName}: ${title}`,
    text: `${title}\n\n${message}\n\nOpen your workspace: ${url}\n\nManage email notifications: ${unsubscribe}`,
    html: `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p><p><a href="${escapeHtml(url.toString())}">Open your workspace</a></p><p><a href="${escapeHtml(unsubscribe)}">Manage email notifications</a></p>`,
    headers: {
      'List-Unsubscribe': `<${unsubscribe}/confirm>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

export async function scheduleOwnerReminders(): Promise<void> {
  const preferences = await prisma.notificationPreference.findMany({
    where: { enabled: true, consentedAt: { not: null } },
  });
  for (const preference of preferences) {
    if (preference.overdueFollowUps) {
      let cursor: string | undefined;
      for (;;) {
        const tasks = await prisma.followUpTask.findMany({
          where: { companyId: preference.companyId, status: 'PENDING', dueAt: { lt: new Date() } },
          select: { id: true, revision: true },
          take: 200,
          orderBy: { id: 'asc' },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        for (const task of tasks)
          await enqueueOwnerNotification(
            prisma,
            preference.companyId,
            `overdue:${task.id}:${task.revision}`,
            { kind: 'OVERDUE_FOLLOW_UP', taskId: task.id },
          );
        const last = tasks.at(-1);
        if (tasks.length < 200 || !last) break;
        cursor = last.id;
      }
    }
    if (preference.documentReview) {
      let cursor: string | undefined;
      for (;;) {
        const documents = await prisma.billingDocument.findMany({
          where: {
            companyId: preference.companyId,
            status: 'DRAFT',
            updatedAt: { lt: new Date(Date.now() - preference.documentReminderHours * 3600000) },
          },
          select: { id: true, revision: true },
          take: 200,
          orderBy: { id: 'asc' },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        for (const document of documents)
          await enqueueOwnerNotification(
            prisma,
            preference.companyId,
            `document-review:${document.id}:${document.revision}`,
            { kind: 'DOCUMENT_REVIEW', documentId: document.id },
          );
        const last = documents.at(-1);
        if (documents.length < 200 || !last) break;
        cursor = last.id;
      }
    }
  }
}

export async function notificationOptOut(token: string): Promise<void> {
  const preferences = await prisma.notificationPreference.findUnique({
    where: { optOutToken: token },
  });
  if (!preferences) throw new HttpError(404, 'This notification link is invalid or was replaced.');
  await prisma.$transaction([
    prisma.notificationPreference.update({
      where: { companyId: preferences.companyId },
      data: { enabled: false },
    }),
    prisma.backgroundJob.updateMany({
      where: {
        companyId: preferences.companyId,
        kind: 'OWNER_EMAIL',
        status: { in: ['PENDING', 'BLOCKED', 'FAILED'] },
      },
      data: {
        status: 'CANCELLED',
        lastError: 'Owner opted out of notifications.',
        completedAt: new Date(),
      },
    }),
  ]);
}
