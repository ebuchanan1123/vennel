import { Prisma } from '@prisma/client';
import type { DocumentInput } from '@lead-recovery/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const db = {
    $queryRaw: vi.fn(),
    billingDocument: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    customer: { findFirst: vi.fn() },
    catalogService: { findMany: vi.fn() },
    callNote: { findFirst: vi.fn(), findMany: vi.fn() },
    lead: { findFirst: vi.fn() },
    company: { update: vi.fn(), findUniqueOrThrow: vi.fn() },
    documentItem: { deleteMany: vi.fn(), createMany: vi.fn() },
  };
  return { db, transaction: vi.fn(), suggest: vi.fn() };
});
vi.mock('@lead-recovery/database', () => ({
  prisma: { ...mocks.db, $transaction: mocks.transaction },
}));
vi.mock('./billing-suggestion.service.js', () => ({ suggestConversationServices: mocks.suggest }));

import {
  convertEstimate,
  createConversationEstimate,
  createDocument,
  documentInclude,
  finalizeDocument,
  updateDocument,
} from './billing.service.js';

const date = new Date('2026-11-08T12:00:00Z');
const customer = {
  id: 'customer-a',
  companyId: 'business-a',
  name: 'Alex Morgan',
  phone: '+15551234567',
  email: 'alex@example.com',
  address: '10 Main Street',
  notes: null,
  isArchived: false,
  createdAt: date,
  updatedAt: date,
  _count: { leads: 1, documents: 1 },
};
const reviewedItem = {
  id: 'item-a',
  documentId: 'draft-a',
  serviceId: null,
  description: 'Diagnostic visit',
  unit: 'visit',
  quantity: new Prisma.Decimal(1),
  unitPrice: new Prisma.Decimal(125),
  suggestionReason: null,
  position: 0,
};
const draft = {
  id: 'draft-a',
  companyId: 'business-a',
  customerId: customer.id,
  leadId: null,
  kind: 'ESTIMATE',
  status: 'DRAFT',
  number: null,
  revision: 1,
  title: 'AC service',
  currency: 'USD',
  notes: null,
  dueDate: null,
  discountAmount: new Prisma.Decimal(0),
  taxRate: new Prisma.Decimal(13),
  aiDraft: null,
  customerSnapshot: null,
  businessName: null,
  billingProfile: null,
  finalizedAt: null,
  finalizedBy: null,
  sourceEstimateId: null,
  callNoteId: null,
  contextSnapshot: null,
  preparationKey: null,
  preparationHash: null,
  createdAt: date,
  updatedAt: date,
  company: { name: 'Demo business' },
  customer,
  invoice: null,
  items: [reviewedItem],
} satisfies Prisma.BillingDocumentGetPayload<{ include: typeof documentInclude }>;
const input: DocumentInput = {
  kind: 'ESTIMATE',
  title: 'AC service',
  customerId: customer.id,
  leadId: null,
  notes: null,
  dueDate: null,
  discountAmount: 0,
  taxRate: 13,
  items: [{ description: 'Diagnostic visit', unit: 'visit', quantity: 1, unitPrice: 125 }],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation((callback: (db: typeof mocks.db) => unknown) =>
    callback(mocks.db),
  );
  mocks.db.billingDocument.findFirst.mockImplementation(
    (args: { where: { preparationKey?: string } }) => (args.where.preparationKey ? null : draft),
  );
  mocks.db.billingDocument.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.customer.findFirst.mockResolvedValue(customer);
  mocks.db.company.update.mockResolvedValue({ name: 'Demo business', nextDocumentNumber: 42 });
  mocks.db.company.findUniqueOrThrow.mockResolvedValue({
    currency: 'USD',
    defaultTaxRate: new Prisma.Decimal(0),
  });
  mocks.db.callNote.findMany.mockResolvedValue([]);
  mocks.db.$queryRaw.mockResolvedValue([{ id: draft.id }]);
});

describe('document ownership and editing', () => {
  it('scopes document lookups to the chosen business and rejects missing records', async () => {
    mocks.db.billingDocument.findFirst.mockResolvedValue(null);
    await expect(updateDocument('business-b', draft.id, 1, input)).rejects.toMatchObject({
      status: 404,
    });
    expect(mocks.db.billingDocument.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: draft.id, companyId: 'business-b' } }),
    );
    expect(mocks.db.documentItem.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects a stale revision before changing items', async () => {
    mocks.db.billingDocument.findFirst.mockResolvedValue({ ...draft, revision: 2 });
    await expect(updateDocument('business-a', draft.id, 1, input)).rejects.toMatchObject({
      status: 409,
    });
    expect(mocks.db.documentItem.deleteMany).not.toHaveBeenCalled();
  });

  it('never edits finalized documents', async () => {
    mocks.db.billingDocument.findFirst.mockResolvedValue({ ...draft, status: 'FINALIZED' });
    await expect(updateDocument('business-a', draft.id, 1, input)).rejects.toMatchObject({
      status: 409,
    });
    expect(mocks.db.billingDocument.updateMany).not.toHaveBeenCalled();
  });

  it('uses an atomic revision check before replacing draft items', async () => {
    mocks.db.billingDocument.updateMany.mockResolvedValue({ count: 0 });
    await expect(updateDocument('business-a', draft.id, 1, input)).rejects.toMatchObject({
      status: 409,
    });
    expect(mocks.db.billingDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: draft.id, companyId: 'business-a', status: 'DRAFT', revision: 1 },
      }),
    );
    expect(mocks.db.documentItem.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects customers and services from another workspace', async () => {
    mocks.db.customer.findFirst.mockResolvedValue(null);
    await expect(createDocument('business-a', input)).rejects.toMatchObject({ status: 400 });
    expect(mocks.db.customer.findFirst).toHaveBeenCalledWith({
      where: { id: customer.id, companyId: 'business-a' },
    });
    mocks.db.customer.findFirst.mockResolvedValue(customer);
    mocks.db.catalogService.findMany.mockResolvedValue([]);
    await expect(
      createDocument('business-a', {
        ...input,
        items: [{ ...input.items[0]!, serviceId: 'foreign-service' }],
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.db.billingDocument.create).not.toHaveBeenCalled();
  });
});

describe('owner-approved finalization and invoice preparation', () => {
  it('rechecks the linked customer before approval if a lead was linked after draft creation', async () => {
    mocks.db.billingDocument.findFirst.mockResolvedValue({ ...draft, leadId: 'lead-a' });
    mocks.db.lead.findFirst.mockResolvedValue({ id: 'lead-a', customerId: 'customer-b' });
    await expect(finalizeDocument('business-a', draft.id, 1)).rejects.toMatchObject({
      status: 400,
    });
    expect(mocks.db.company.update).not.toHaveBeenCalled();
  });

  it('requires confirmation of unknown legacy pricing units before finalizing', async () => {
    mocks.db.billingDocument.findFirst.mockResolvedValue({
      ...draft,
      items: [{ ...reviewedItem, unit: null }],
    });

    await expect(finalizeDocument('business-a', draft.id, 1)).rejects.toMatchObject({
      status: 400,
    });
    expect(mocks.db.company.update).not.toHaveBeenCalled();
  });

  it.each(['ESTIMATE', 'INVOICE'])(
    'refuses to finalize unpriced %s items before allocating a document number',
    async (kind) => {
      mocks.db.billingDocument.findFirst.mockResolvedValue({
        ...draft,
        kind,
        items: [{ ...reviewedItem, unitPrice: null }],
      });
      await expect(finalizeDocument('business-a', draft.id, 1)).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('exact price'),
      });
      expect(mocks.db.company.update).not.toHaveBeenCalled();
      expect(mocks.db.billingDocument.updateMany).not.toHaveBeenCalled();
    },
  );

  it('requires a customer and at least one line item', async () => {
    mocks.db.billingDocument.findFirst.mockResolvedValue({ ...draft, customer: null });
    await expect(finalizeDocument('business-a', draft.id, 1)).rejects.toMatchObject({
      status: 400,
    });
    mocks.db.billingDocument.findFirst.mockResolvedValue({ ...draft, items: [] });
    await expect(finalizeDocument('business-a', draft.id, 1)).rejects.toMatchObject({
      status: 400,
    });
    expect(mocks.db.company.update).not.toHaveBeenCalled();
  });

  it('assigns a workspace number and snapshots the approved customer details', async () => {
    await finalizeDocument('business-a', draft.id, 1);
    expect(mocks.db.billingDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: draft.id, companyId: 'business-a', status: 'DRAFT', revision: 1 },
        data: expect.objectContaining({
          number: 'EST-00041',
          status: 'FINALIZED',
          businessName: 'Demo business',
          customerSnapshot: {
            name: customer.name,
            phone: customer.phone,
            email: customer.email,
            address: customer.address,
          },
        }),
      }),
    );
  });

  it('rejects a second finalization and a revision changed during approval', async () => {
    mocks.db.billingDocument.findFirst.mockResolvedValue({ ...draft, status: 'FINALIZED' });
    await expect(finalizeDocument('business-a', draft.id, 1)).rejects.toMatchObject({
      status: 409,
    });
    mocks.db.billingDocument.findFirst.mockResolvedValue(draft);
    mocks.db.billingDocument.updateMany.mockResolvedValue({ count: 0 });
    await expect(finalizeDocument('business-a', draft.id, 1)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('only converts finalized estimates and reopens an existing invoice without duplication', async () => {
    await expect(convertEstimate('business-a', draft.id)).rejects.toMatchObject({ status: 400 });
    const invoice = { ...draft, id: 'invoice-a', kind: 'INVOICE', sourceEstimateId: draft.id };
    mocks.db.billingDocument.findFirst
      .mockResolvedValueOnce({ ...draft, status: 'FINALIZED', invoice: { id: invoice.id } })
      .mockResolvedValueOnce(invoice);
    expect((await convertEstimate('business-a', draft.id)).id).toBe(invoice.id);
    expect(mocks.db.billingDocument.create).not.toHaveBeenCalled();
  });

  it('copies reviewed prices into a new invoice draft without repricing the catalog', async () => {
    mocks.db.billingDocument.findFirst.mockResolvedValue({ ...draft, status: 'FINALIZED' });
    mocks.db.billingDocument.create.mockResolvedValue({
      ...draft,
      kind: 'INVOICE',
      sourceEstimateId: draft.id,
    });
    await convertEstimate('business-a', draft.id);
    expect(mocks.db.billingDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'INVOICE',
          sourceEstimateId: draft.id,
          items: {
            create: [
              expect.objectContaining({
                quantity: reviewedItem.quantity,
                unitPrice: reviewedItem.unitPrice,
                unit: reviewedItem.unit,
              }),
            ],
          },
        }),
      }),
    );
    expect(mocks.db.catalogService.findMany).not.toHaveBeenCalled();
  });
});

describe('conversation estimate preparation', () => {
  it('persists a draft with catalog prices, quantity one and the original AI evidence', async () => {
    mocks.db.lead.findFirst.mockResolvedValue({
      id: 'lead-a',
      companyId: 'business-a',
      customerId: null,
      needsHuman: false,
      status: 'QUALIFIED',
      updatedAt: date,
      outcome: 'UNKNOWN',
      completedAt: null,
      messages: [{ id: 'message-a', body: 'My AC stopped cooling.', createdAt: date }],
    });
    const service = {
      id: 'service-a',
      name: 'Diagnostic visit',
      unit: 'visit',
      unitPrice: new Prisma.Decimal(125),
      updatedAt: date,
    };
    mocks.db.catalogService.findMany.mockResolvedValue([service]);
    const aiDraft = {
      createdAt: date.toISOString(),
      matches: [
        {
          serviceId: service.id,
          description: service.name,
          unit: service.unit,
          unitPrice: 125,
          evidence: 'My AC stopped cooling.',
        },
      ],
      missingDetails: ['Confirm the required quantity.'],
    };
    mocks.suggest.mockResolvedValue(aiDraft);
    const sourcedDraft = {
      ...aiDraft,
      matches: aiDraft.matches.map((match) => ({
        ...match,
        source: { kind: 'SMS', id: 'message-a' },
      })),
    };
    mocks.db.billingDocument.create.mockResolvedValue({
      ...draft,
      leadId: 'lead-a',
      customerId: null,
      customer: null,
      aiDraft: sourcedDraft,
    });
    const result = await createConversationEstimate('business-a', 'lead-a');
    expect(result.status).toBe('DRAFT');
    expect(result.aiDraft).toEqual(sourcedDraft);
    expect(mocks.db.billingDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'business-a',
          leadId: 'lead-a',
          kind: 'ESTIMATE',
          aiDraft: sourcedDraft,
          items: {
            create: [
              {
                serviceId: service.id,
                description: service.name,
                unit: service.unit,
                quantity: 1,
                unitPrice: 125,
                suggestionReason: 'My AC stopped cooling.',
                position: 0,
              },
            ],
          },
        }),
      }),
    );
  });

  it('blocks urgent leads before asking AI for service suggestions', async () => {
    mocks.db.lead.findFirst.mockResolvedValue({
      id: 'lead-a',
      needsHuman: true,
      status: 'NEEDS_HUMAN',
      updatedAt: date,
      outcome: 'UNKNOWN',
      completedAt: null,
      messages: [],
    });
    await expect(createConversationEstimate('business-a', 'lead-a')).rejects.toMatchObject({
      status: 400,
    });
    expect(mocks.suggest).not.toHaveBeenCalled();
  });

  it('rejects catalog changes during AI preparation instead of using stale prices', async () => {
    mocks.db.lead.findFirst.mockResolvedValue({
      id: 'lead-a',
      companyId: 'business-a',
      customerId: null,
      needsHuman: false,
      status: 'QUALIFIED',
      updatedAt: date,
      outcome: 'UNKNOWN',
      completedAt: null,
      messages: [{ id: 'message-a', body: 'My AC stopped cooling.', createdAt: date }],
    });
    const service = { id: 'service-a', updatedAt: date };
    mocks.db.catalogService.findMany
      .mockResolvedValueOnce([service])
      .mockResolvedValueOnce([{ ...service, updatedAt: new Date(date.getTime() + 1000) }]);
    mocks.suggest.mockResolvedValue({
      matches: [
        {
          serviceId: service.id,
          description: 'Diagnostic visit',
          unit: 'visit',
          unitPrice: 125,
          evidence: 'My AC stopped cooling.',
        },
      ],
      missingDetails: [],
      createdAt: date.toISOString(),
    });
    await expect(createConversationEstimate('business-a', 'lead-a')).rejects.toMatchObject({
      status: 409,
    });
    expect(mocks.db.billingDocument.create).not.toHaveBeenCalled();
    expect(mocks.db.lead.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lead-a', companyId: 'business-a' },
        include: {
          messages: {
            where: { direction: 'INBOUND' },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 30,
          },
        },
      }),
    );
  });
});
