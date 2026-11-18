import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { DocumentEmailApproval, FinalizedDocumentSnapshot } from '@lead-recovery/types';

const mocks = vi.hoisted(() => ({
  db: {
    company: { findFirst: vi.fn() },
    documentDelivery: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    backgroundJob: { upsert: vi.fn(), updateMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
  transaction: vi.fn(),
  document: vi.fn(),
  env: { RESEND_API_KEY: 'synthetic-key', RESEND_FROM_EMAIL: 'verified@example.test' },
}));
vi.mock('@lead-recovery/database', () => ({
  prisma: { ...mocks.db, $transaction: mocks.transaction },
}));
vi.mock('../env.js', () => ({ env: mocks.env }));
vi.mock('./billing.service.js', () => ({
  documentRecord: mocks.document,
  serializeDocument: (document: unknown) => document,
}));
import {
  approveDocumentEmail,
  deliveryInclude,
  documentDeliveryStatus,
  prepareDocumentEmail,
  previewDocumentEmail,
} from './document-delivery.service.js';
import { documentEmailApprovalSchema } from '../schemas/document-context.schema.js';

const date = new Date('2026-11-09T15:00:00Z');
const snapshot: FinalizedDocumentSnapshot = {
  kind: 'ESTIMATE',
  number: 'EST-00001',
  title: 'AC diagnostic visit',
  currency: 'USD',
  businessName: 'Original business',
  finalizedAt: date.toISOString(),
  notes: 'Repairs priced separately.',
  dueDate: null,
  discountAmount: 5,
  taxRate: 13,
  customer: {
    name: 'Taylor',
    phone: '+15555550100',
    email: 'customer@example.test',
    address: '10 Test Street',
  },
  items: [
    {
      description: 'AC diagnostic <script>alert(1)</script>',
      unit: 'visit',
      quantity: 1,
      unitPrice: 125,
    },
  ],
};
const document = {
  ...snapshot,
  id: 'document-a',
  companyId: 'business-a',
  customerSnapshot: snapshot.customer,
  status: 'FINALIZED',
  revision: 3,
  customerId: 'customer-a',
  leadId: null,
  aiDraft: { missingDetails: ['Private internal AI information'] },
  context: { notes: [{ summary: 'Never email internal call summaries' }] },
};
const delivery = {
  id: 'delivery-a',
  companyId: 'business-a',
  documentId: document.id,
  documentRevision: 3,
  requestKey: '82b31473-81f1-4268-b17a-526195f01ddf',
  recipientEmail: 'customer@example.test',
  senderName: 'Current business',
  senderEmail: 'verified@example.test',
  replyTo: 'office@example.test',
  documentSnapshot: snapshot,
  previewHash: 'a'.repeat(64),
  approvedAt: date,
  approvedBy: 'development-owner',
  jobId: 'job-a',
  providerId: null,
  acceptedAt: null,
  job: {
    id: 'job-a',
    companyId: 'business-a',
    userId: null,
    kind: 'DOCUMENT_EMAIL',
    eventKey: 'document-email:delivery-a',
    payload: { deliveryId: 'delivery-a' },
    deliveryPayload: null,
    status: 'PENDING',
    dueAt: date,
    attempts: 0,
    maxAttempts: 5,
    leaseToken: null,
    leaseUntil: null,
    firstAttemptAt: null,
    completedAt: null,
    lastError: null,
    providerId: null,
    createdAt: date,
    updatedAt: date,
    history: [],
  },
  events: [],
} satisfies Prisma.DocumentDeliveryGetPayload<{ include: typeof deliveryInclude }>;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation((callback: (db: typeof mocks.db) => unknown) =>
    callback(mocks.db),
  );
  mocks.db.$queryRaw.mockResolvedValue([{ id: document.id }]);
  mocks.document.mockResolvedValue(document);
  mocks.db.company.findFirst.mockResolvedValue({
    name: 'Current business',
    isActive: true,
    documentEmailEnabled: true,
    documentSenderName: null,
    documentReplyTo: 'office@example.test',
  });
  mocks.db.documentDelivery.findFirst.mockImplementation((args: { where: { id?: string } }) =>
    args.where.id ? delivery : null,
  );
  mocks.db.documentDelivery.create.mockResolvedValue(delivery);
  mocks.db.backgroundJob.upsert.mockResolvedValue(delivery.job);
  mocks.env.RESEND_API_KEY = 'synthetic-key';
});
async function approval(): Promise<DocumentEmailApproval> {
  const preview = await previewDocumentEmail('business-a', document.id, 3, delivery.recipientEmail);
  return {
    requestId: delivery.requestKey,
    revision: 3,
    recipientEmail: preview.recipientEmail,
    previewHash: preview.previewHash,
    approved: true,
  };
}
describe('finalized document email and owner authorization', () => {
  it('previews the approved snapshot with exact totals, safe HTML and no internal notes', async () => {
    const preview = await previewDocumentEmail(
      'business-a',
      document.id,
      3,
      delivery.recipientEmail,
    );
    expect(preview.text).toContain('$135.60');
    expect(preview.text).toContain('Original business');
    expect(preview.text).not.toContain('Private internal');
    expect(preview.text).not.toContain('Never email');
    expect(preview.html).not.toContain('<script>');
    expect(preview.html).toContain('&lt;script&gt;');
    expect(preview.replyTo).toBe('office@example.test');
    expect(mocks.db.backgroundJob.upsert).not.toHaveBeenCalled();
  });
  it('rejects draft documents, stale revisions and unapproved request shapes', async () => {
    mocks.document.mockResolvedValue({ ...document, status: 'DRAFT' });
    await expect(
      previewDocumentEmail('business-a', document.id, 3, delivery.recipientEmail),
    ).rejects.toMatchObject({ status: 409 });
    mocks.document.mockResolvedValue(document);
    await expect(
      previewDocumentEmail('business-a', document.id, 2, delivery.recipientEmail),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      documentEmailApprovalSchema.safeParse({
        requestId: delivery.requestKey,
        revision: 3,
        recipientEmail: delivery.recipientEmail,
        previewHash: delivery.previewHash,
      }).success,
    ).toBe(false);
    expect(mocks.db.backgroundJob.upsert).not.toHaveBeenCalled();
  });
  it('requires a current preview matching recipient and sender, not just a finalized document', async () => {
    const input = await approval();
    await expect(
      approveDocumentEmail('business-a', document.id, {
        ...input,
        recipientEmail: 'different@example.test',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.db.documentDelivery.create).not.toHaveBeenCalled();
  });
  it('queues an audited immutable document snapshot, not an immediate provider send', async () => {
    const input = await approval();
    await approveDocumentEmail('business-a', document.id, input);
    expect(mocks.db.documentDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          documentId: document.id,
          companyId: 'business-a',
          documentRevision: 3,
          recipientEmail: delivery.recipientEmail,
          approvedBy: 'system',
          documentSnapshot: expect.objectContaining({
            number: snapshot.number,
            customer: snapshot.customer,
          }),
        }),
      }),
    );
    expect(mocks.db.backgroundJob.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ kind: 'DOCUMENT_EMAIL', companyId: 'business-a' }),
      }),
    );
  });
  it('reuses the same approved request instead of creating duplicate delivery jobs', async () => {
    const input = await approval();
    mocks.db.documentDelivery.findFirst.mockResolvedValue({
      ...delivery,
      previewHash: input.previewHash,
    });
    expect((await approveDocumentEmail('business-a', document.id, input)).id).toBe(delivery.id);
    expect(mocks.db.documentDelivery.create).not.toHaveBeenCalled();
    expect(mocks.db.backgroundJob.upsert).not.toHaveBeenCalled();
  });
  it('does not allow approval when business sending is disabled or Resend is not configured', async () => {
    const input = await approval();
    mocks.db.company.findFirst.mockResolvedValue({
      name: 'Current business',
      documentEmailEnabled: false,
      documentSenderName: null,
      documentReplyTo: 'office@example.test',
    });
    await expect(approveDocumentEmail('business-a', document.id, input)).rejects.toMatchObject({
      status: 403,
    });
    mocks.db.company.findFirst.mockResolvedValue({
      name: 'Current business',
      documentEmailEnabled: true,
      documentSenderName: null,
      documentReplyTo: 'office@example.test',
    });
    mocks.env.RESEND_API_KEY = '';
    await expect(approveDocumentEmail('business-a', document.id, input)).rejects.toMatchObject({
      status: 503,
    });
    expect(mocks.db.documentDelivery.create).not.toHaveBeenCalled();
  });
  it('fences the document by company and does not access another business document', async () => {
    mocks.db.$queryRaw.mockResolvedValue([]);
    await expect(
      approveDocumentEmail('business-b', document.id, await approval()),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.db.documentDelivery.create).not.toHaveBeenCalled();
  });
  it('uses the approved recipient and reply-to on retry and rechecks authorization', async () => {
    const email = await prepareDocumentEmail(delivery.job);
    expect(email?.to).toBe(delivery.recipientEmail);
    expect(email?.reply_to).toBe(delivery.replyTo);
    expect(email?.text).toContain('Original business');
    mocks.db.company.findFirst.mockResolvedValue({ documentEmailEnabled: false });
    expect(await prepareDocumentEmail(delivery.job)).toBeNull();
  });
});

describe('truthful delivery status', () => {
  it('does not call provider acceptance delivered without a verified delivery event', () => {
    expect(documentDeliveryStatus({ status: 'SUCCEEDED' }, date, [])).toBe('ACCEPTED');
    expect(
      documentDeliveryStatus({ status: 'SUCCEEDED' }, date, [{ type: 'email.delivered' }]),
    ).toBe('DELIVERED');
  });
  it('preserves bounce and complaint status despite out-of-order delay or sent events', () => {
    expect(
      documentDeliveryStatus({ status: 'SUCCEEDED' }, date, [
        { type: 'email.bounced' },
        { type: 'email.sent' },
      ]),
    ).toBe('BOUNCED');
    expect(
      documentDeliveryStatus({ status: 'SUCCEEDED' }, date, [
        { type: 'email.delivered' },
        { type: 'email.delivery_delayed' },
      ]),
    ).toBe('DELIVERED');
    expect(
      documentDeliveryStatus({ status: 'SUCCEEDED' }, date, [
        { type: 'email.complained' },
        { type: 'email.delivered' },
      ]),
    ).toBe('COMPLAINED');
  });
});
