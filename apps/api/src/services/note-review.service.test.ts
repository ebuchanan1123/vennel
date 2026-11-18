import { emptyCallNoteExtraction, type CallNoteReviewInput } from '@lead-recovery/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    customer: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    lead: { findFirst: vi.fn(), updateMany: vi.fn() },
    callNote: { updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    callNoteAudit: { create: vi.fn() },
    followUpSuggestion: { upsert: vi.fn() },
  },
  transaction: vi.fn(),
  note: vi.fn(),
  task: vi.fn(),
}));
vi.mock('@lead-recovery/database', () => ({
  prisma: { ...mocks.db, $transaction: mocks.transaction },
}));
vi.mock('./call-note.service.js', () => ({
  callNoteRecord: mocks.note,
  callNoteInclude: {},
  serializeCallNote: (value: unknown) => value,
}));
vi.mock('./follow-up.service.js', () => ({ createFollowUp: mocks.task }));
import { confirmedExtraction, reviewCallNote } from './note-review.service.js';

const date = new Date('2026-11-08T15:00:00Z');
const customer = {
  id: 'customer-a',
  companyId: 'business-a',
  name: 'Confirmed name',
  phone: null,
  email: null,
  address: null,
  isArchived: false,
  updatedAt: date,
};
const note = {
  id: 'note-a',
  companyId: 'business-a',
  customerId: customer.id,
  leadId: null,
  revision: 2,
  isArchived: false,
  reviewStatus: 'EXTRACTED',
  extraction: {},
  extractionRevision: 2,
};
function input(): CallNoteReviewInput {
  const confirmed = emptyCallNoteExtraction();
  confirmed.facts.customerName = { value: 'AI proposed name', evidence: 'AI proposed name' };
  confirmed.price = { amount: 125, currency: 'USD', state: 'PROPOSED', evidence: 'quoted 125' };
  return {
    revision: 2,
    customerId: customer.id,
    leadId: null,
    confirmed,
    acceptFacts: ['customerName', 'price'],
    applyFields: [],
    replaceFields: [],
    expectedCustomerUpdatedAt: date.toISOString(),
    expectedLeadUpdatedAt: null,
    acceptedActions: [],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation((callback: (db: typeof mocks.db) => unknown) =>
    callback(mocks.db),
  );
  mocks.note.mockResolvedValue(note);
  mocks.db.customer.findFirst.mockResolvedValue(customer);
  mocks.db.customer.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.callNote.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.callNote.findUniqueOrThrow.mockResolvedValue(note);
});

describe('explicit owner review', () => {
  it('does not update canonical customer records without selected updates', async () => {
    await reviewCallNote('business-a', note.id, input());
    expect(mocks.db.customer.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.lead.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.callNote.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reviewStatus: 'REVIEWED',
          confirmedData: expect.objectContaining({
            price: expect.objectContaining({ state: 'PROPOSED' }),
          }),
        }),
      }),
    );
  });

  it('requires separate confirmation to replace existing information', async () => {
    await expect(
      reviewCallNote('business-a', note.id, { ...input(), applyFields: ['customer.name'] }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.db.customer.updateMany).not.toHaveBeenCalled();
  });

  it('writes owner-approved replacements with a timestamp concurrency guard and audit', async () => {
    await reviewCallNote('business-a', note.id, {
      ...input(),
      applyFields: ['customer.name'],
      replaceFields: ['customer.name'],
    });
    expect(mocks.db.customer.updateMany).toHaveBeenCalledWith({
      where: { id: customer.id, companyId: 'business-a', updatedAt: date },
      data: { name: 'AI proposed name' },
    });
    expect(mocks.db.callNoteAudit.create).toHaveBeenCalled();
  });

  it('rejects stale customer data and cross-business associations', async () => {
    await expect(
      reviewCallNote('business-a', note.id, {
        ...input(),
        applyFields: ['customer.name'],
        replaceFields: ['customer.name'],
        expectedCustomerUpdatedAt: '2020-01-01T00:00:00Z',
      }),
    ).rejects.toMatchObject({ status: 409 });
    mocks.db.customer.findFirst.mockResolvedValue(null);
    await expect(reviewCallNote('business-a', note.id, input())).rejects.toMatchObject({
      status: 404,
    });
    expect(mocks.db.callNote.updateMany).not.toHaveBeenCalled();
  });

  it('does not create tasks or reapply a repeated review', async () => {
    const request = input();
    request.confirmed.actions = [
      {
        type: 'CALL_CUSTOMER',
        title: 'Callback',
        dueAt: null,
        dueText: 'tomorrow',
        priority: 'NORMAL',
        evidence: 'callback',
      },
    ];
    mocks.db.followUpSuggestion.upsert.mockResolvedValue({ id: 'suggestion-a' });
    await reviewCallNote('business-a', note.id, request);
    expect(mocks.task).not.toHaveBeenCalled();
    mocks.note.mockResolvedValue({ ...note, revision: 3, reviewStatus: 'REVIEWED' });
    await expect(
      reviewCallNote('business-a', note.id, {
        ...request,
        acceptedActions: [{ index: 0, dueAt: '2030-01-01T12:00:00Z' }],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.task).not.toHaveBeenCalled();
  });

  it('removes rejected facts instead of storing them as confirmed', () => {
    const extraction = input().confirmed;
    const confirmed = confirmedExtraction(extraction, ['price']);
    expect(confirmed.facts.customerName.value).toBeNull();
    expect(confirmed.price.state).toBe('PROPOSED');
  });
});
