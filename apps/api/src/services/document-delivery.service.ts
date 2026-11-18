import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@lead-recovery/database';
import type {
  DocumentDelivery,
  DocumentEmailApproval,
  DocumentEmailPreview,
  FinalizedDocumentSnapshot,
} from '@lead-recovery/types';
import { Prisma, type BackgroundJob } from '@prisma/client';
import { z } from 'zod';

import { env } from '../env.js';
import { HttpError } from '../middleware/error-handler.js';
import { finalizedSnapshotSchema } from '../schemas/document-context.schema.js';
import {
  EMAIL_RETRY_WINDOW_MS,
  companyJobId,
  enqueueBackgroundJob,
  retryBackgroundJob,
} from './background-job.service.js';
import { documentRecord, serializeDocument } from './billing.service.js';
import { renderDocumentEmail } from './document-email-template.js';
import {
  emailConfigured,
  emailDisplayName,
  outboundEmailSchema,
  ProviderFailure,
  type OutboundEmail,
} from './email-provider.service.js';

export const deliveryInclude = {
  job: { include: { history: { orderBy: { attempt: 'asc' } } } },
  events: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.DocumentDeliveryInclude;
type DeliveryRecord = Prisma.DocumentDeliveryGetPayload<{ include: typeof deliveryInclude }>;

export function documentDeliveryStatus(
  job: Pick<BackgroundJob, 'status'>,
  acceptedAt: Date | null,
  events: { type: string }[],
): DocumentDelivery['status'] {
  const types = new Set(events.map((event) => event.type));
  if (types.has('email.complained')) return 'COMPLAINED';
  if (types.has('email.bounced')) return 'BOUNCED';
  if (types.has('email.delivered')) return 'DELIVERED';
  if (types.has('email.failed') || types.has('email.suppressed')) return 'FAILED';
  if (types.has('email.delivery_delayed')) return 'DELAYED';
  if (acceptedAt) return 'ACCEPTED';
  return job.status === 'PENDING'
    ? 'QUEUED'
    : job.status === 'RUNNING'
      ? 'SENDING'
      : job.status === 'SUCCEEDED'
        ? 'ACCEPTED'
        : job.status;
}

export function serializeDelivery(delivery: DeliveryRecord): DocumentDelivery {
  const job = delivery.job;
  const inWindow =
    !job.firstAttemptAt || Date.now() - job.firstAttemptAt.getTime() < EMAIL_RETRY_WINDOW_MS;
  const status = documentDeliveryStatus(job, delivery.acceptedAt, delivery.events);
  return {
    id: delivery.id,
    documentId: delivery.documentId,
    documentRevision: delivery.documentRevision,
    recipientEmail: delivery.recipientEmail,
    senderName: delivery.senderName,
    senderEmail: delivery.senderEmail,
    replyTo: delivery.replyTo,
    approvedAt: delivery.approvedAt.toISOString(),
    approvedBy: delivery.approvedBy,
    status,
    acceptedAt: delivery.acceptedAt?.toISOString() ?? null,
    providerId: delivery.providerId,
    job: {
      id: job.id,
      status: job.status,
      attempts: job.attempts,
      lastError: job.lastError,
      canRetry:
        (job.status === 'FAILED' || job.status === 'BLOCKED') &&
        inWindow &&
        !delivery.acceptedAt &&
        delivery.events.length === 0,
      canCancel: !job.firstAttemptAt && ['PENDING', 'BLOCKED', 'FAILED'].includes(job.status),
    },
    attempts: job.history.map((attempt) => ({
      attempt: attempt.attempt,
      startedAt: attempt.startedAt.toISOString(),
      finishedAt: attempt.finishedAt?.toISOString() ?? null,
      outcome: attempt.outcome,
      error: attempt.error,
      providerId: attempt.providerId,
    })),
    events: delivery.events.map((event) => ({
      type: event.type,
      occurredAt: event.occurredAt.toISOString(),
    })),
  };
}

async function finalizedDocument(
  companyId: string,
  id: string,
  revision: number,
  db: Prisma.TransactionClient,
) {
  const record = await documentRecord(companyId, id, db);
  if (record.status !== 'FINALIZED')
    throw new HttpError(409, 'Finalize and approve the document before preparing customer email.');
  if (record.revision !== revision)
    throw new HttpError(409, 'The document revision changed. Refresh and review it again.');
  const document = serializeDocument(record);
  if (!document.customerSnapshot || !document.number)
    throw new HttpError(
      409,
      'The finalized document is missing approved customer details or its number.',
    );
  const snapshot: FinalizedDocumentSnapshot = {
    kind: document.kind,
    title: document.title,
    number: document.number,
    currency: document.currency,
    businessName: document.businessName,
    customer: document.customerSnapshot,
    finalizedAt: document.finalizedAt,
    billingProfile: document.billingProfile,
    notes: document.notes,
    dueDate: document.dueDate,
    discountAmount: document.discountAmount,
    taxRate: document.taxRate,
    items: document.items.map((item) => {
      if (item.unitPrice === null)
        throw new HttpError(409, 'The finalized document is missing an approved exact price.');
      return {
        description: item.description,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      };
    }),
  };
  return snapshot;
}

async function emailPreview(
  companyId: string,
  id: string,
  revision: number,
  recipientEmail: string,
  db: Prisma.TransactionClient,
) {
  const document = await finalizedDocument(companyId, id, revision, db);
  const company = await db.company.findFirst({ where: { id: companyId, isActive: true } });
  if (!company) throw new HttpError(404, 'Active business not found.');
  const senderName = emailDisplayName(company.documentSenderName ?? company.name);
  if (!senderName) throw new HttpError(400, 'Configure a valid business document sender name.');
  const senderEmail = env.RESEND_FROM_EMAIL ?? null;
  const rendered = renderDocumentEmail(document);
  const previewHash = createHash('sha256')
    .update(
      JSON.stringify({
        document,
        revision,
        recipientEmail,
        senderName,
        senderEmail,
        replyTo: company.documentReplyTo,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      }),
    )
    .digest('hex');
  const preview: DocumentEmailPreview = {
    ...rendered,
    recipientEmail,
    senderName,
    senderEmail,
    replyTo: company.documentReplyTo,
    previewHash,
    revision,
    enabled: company.documentEmailEnabled,
    providerConfigured: emailConfigured(),
  };
  return { preview, document };
}

export async function previewDocumentEmail(
  companyId: string,
  id: string,
  revision: number,
  recipientEmail: string,
): Promise<DocumentEmailPreview> {
  return (await emailPreview(companyId, id, revision, recipientEmail, prisma)).preview;
}

async function deliveryRecord(
  companyId: string,
  documentId: string,
  id: string,
  db: Prisma.TransactionClient = prisma,
): Promise<DeliveryRecord> {
  const delivery = await db.documentDelivery.findFirst({
    where: { id, companyId, documentId },
    include: deliveryInclude,
  });
  if (!delivery) throw new HttpError(404, 'Document delivery not found in this business.');
  return delivery;
}

export async function listDocumentDeliveries(
  companyId: string,
  documentId: string,
): Promise<DocumentDelivery[]> {
  await documentRecord(companyId, documentId);
  return (
    await prisma.documentDelivery.findMany({
      where: { companyId, documentId },
      include: deliveryInclude,
      orderBy: { approvedAt: 'desc' },
    })
  ).map(serializeDelivery);
}

export async function approveDocumentEmail(
  companyId: string,
  documentId: string,
  input: DocumentEmailApproval,
  actorId = 'system',
): Promise<DocumentDelivery> {
  if (input.approved !== true)
    throw new HttpError(
      400,
      'Explicit owner approval is required before queuing a customer email.',
    );
  return prisma.$transaction(async (tx) => {
    // Serialize approvals for one finalized document, including concurrent double-clicks.
    const locked = await tx.$queryRaw<
      { id: string }[]
    >`SELECT "id" FROM "BillingDocument" WHERE "id" = ${documentId} AND "companyId" = ${companyId} FOR UPDATE`;
    if (!locked.length) throw new HttpError(404, 'Document not found in this business.');
    const previous = await tx.documentDelivery.findFirst({
      where: { companyId, requestKey: input.requestId },
      include: deliveryInclude,
    });
    if (previous) {
      if (
        previous.documentId !== documentId ||
        previous.documentRevision !== input.revision ||
        previous.recipientEmail !== input.recipientEmail ||
        previous.previewHash !== input.previewHash
      ) {
        throw new HttpError(409, 'This approval request was already used with different details.');
      }
      return serializeDelivery(previous);
    }
    const { preview, document } = await emailPreview(
      companyId,
      documentId,
      input.revision,
      input.recipientEmail,
      tx,
    );
    if (preview.previewHash !== input.previewHash)
      throw new HttpError(
        409,
        'The email content or sender settings changed. Preview and approve the current email again.',
      );
    if (!preview.enabled)
      throw new HttpError(
        403,
        'Enable owner-approved customer document emails in workspace settings first.',
      );
    if (!preview.providerConfigured || !preview.senderEmail)
      throw new HttpError(
        503,
        'Configure Resend and a verified sender locally before authorizing a live customer email.',
      );
    const earlier = await tx.documentDelivery.findFirst({
      where: {
        companyId,
        documentId,
        documentRevision: input.revision,
        recipientEmail: input.recipientEmail,
        job: { status: { not: 'CANCELLED' } },
      },
      include: deliveryInclude,
      orderBy: { approvedAt: 'desc' },
    });
    if (earlier) {
      if (!input.resendApproved) return serializeDelivery(earlier);
      if (['PENDING', 'RUNNING', 'BLOCKED'].includes(earlier.job.status))
        throw new HttpError(
          409,
          'An email is already queued or blocked. Manage that delivery instead of creating another.',
        );
      if (earlier.job.status === 'FAILED' && earlier.job.firstAttemptAt && !earlier.acceptedAt) {
        throw new HttpError(
          409,
          'The previous delivery may be ambiguous. Verify it with the provider before approving another copy.',
        );
      }
      if (
        earlier.events.some((event) =>
          ['email.complained', 'email.bounced', 'email.suppressed'].includes(event.type),
        )
      )
        throw new HttpError(
          409,
          'This recipient rejected or suppressed the previous email. Confirm a corrected recipient before sending again.',
        );
    }
    const id = randomUUID();
    const job = await enqueueBackgroundJob(
      tx,
      companyId,
      'DOCUMENT_EMAIL',
      `document-email:${id}`,
      { deliveryId: id },
    );
    const delivery = await tx.documentDelivery.create({
      data: {
        id,
        companyId,
        documentId,
        documentRevision: input.revision,
        requestKey: input.requestId,
        recipientEmail: input.recipientEmail,
        senderName: preview.senderName,
        senderEmail: preview.senderEmail,
        replyTo: preview.replyTo,
        documentSnapshot: document,
        previewHash: preview.previewHash,
        approvedBy: actorId,
        jobId: job.id,
      },
      include: deliveryInclude,
    });
    return serializeDelivery(delivery);
  });
}

export async function prepareDocumentEmail(job: BackgroundJob): Promise<OutboundEmail | null> {
  const companyId = companyJobId(job);
  const payload = z
    .object({ deliveryId: z.string().min(1) })
    .strict()
    .safeParse(job.payload);
  if (!payload.success)
    throw new ProviderFailure('The approved document-delivery payload is invalid.', false);
  const delivery = await prisma.documentDelivery.findFirst({
    where: { id: payload.data.deliveryId, companyId, jobId: job.id },
    include: deliveryInclude,
  });
  if (!delivery)
    throw new ProviderFailure('This delivery is not associated with the leased job.', false);
  const company = await prisma.company.findFirst({ where: { id: companyId, isActive: true } });
  if (!company?.documentEmailEnabled) return null;
  await finalizedDocument(companyId, delivery.documentId, delivery.documentRevision, prisma);
  const snapshot = finalizedSnapshotSchema.safeParse(delivery.documentSnapshot);
  if (!snapshot.success)
    throw new ProviderFailure('The approved document snapshot is invalid.', false);
  if (job.deliveryPayload) {
    const saved = outboundEmailSchema.safeParse(job.deliveryPayload);
    if (!saved.success || saved.data.to !== delivery.recipientEmail)
      throw new ProviderFailure('The saved email does not match the approved recipient.', false);
    return saved.data;
  }
  return {
    ...renderDocumentEmail(snapshot.data),
    from: `${delivery.senderName} <${delivery.senderEmail}>`,
    to: delivery.recipientEmail,
    ...(delivery.replyTo ? { reply_to: delivery.replyTo } : {}),
    headers: {},
  };
}

export async function recordDocumentEmailAcceptance(
  job: BackgroundJob,
  providerId: string,
): Promise<void> {
  const companyId = companyJobId(job);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`resend-document:${providerId}`}))`;
    const record = await tx.documentDelivery.findFirst({
      where: { companyId, jobId: job.id },
    });
    if (!record)
      throw new Error(
        'Approved document delivery disappeared before its provider receipt was stored.',
      );
    if (record.providerId && record.providerId !== providerId)
      throw new Error('The provider returned a different ID for the same approved delivery.');
    await tx.documentDelivery.update({
      where: { id: record.id },
      data: { providerId, acceptedAt: record.acceptedAt ?? new Date() },
    });
    await tx.documentDeliveryEvent.updateMany({
      where: { providerId, deliveryId: null },
      data: { deliveryId: record.id },
    });
  });
}

export async function cancelDocumentEmail(
  companyId: string,
  documentId: string,
  id: string,
): Promise<DocumentDelivery> {
  const delivery = await deliveryRecord(companyId, documentId, id);
  const changed = await prisma.backgroundJob.updateMany({
    where: {
      id: delivery.jobId,
      companyId,
      kind: 'DOCUMENT_EMAIL',
      firstAttemptAt: null,
      status: { in: ['PENDING', 'FAILED', 'BLOCKED'] },
    },
    data: {
      status: 'CANCELLED',
      completedAt: new Date(),
      lastError: 'The owner cancelled before the first provider attempt.',
    },
  });
  if (!changed.count)
    throw new HttpError(
      409,
      'This delivery started processing or already reached the provider. It cannot safely be cancelled.',
    );
  return serializeDelivery(await deliveryRecord(companyId, documentId, id));
}

export async function retryDocumentEmail(
  companyId: string,
  documentId: string,
  id: string,
): Promise<DocumentDelivery> {
  const delivery = await deliveryRecord(companyId, documentId, id);
  if (!serializeDelivery(delivery).job.canRetry)
    throw new HttpError(
      409,
      'This delivery cannot safely be retried. Review its attempt and provider history.',
    );
  await retryBackgroundJob(companyId, delivery.jobId);
  return serializeDelivery(await deliveryRecord(companyId, documentId, id));
}
