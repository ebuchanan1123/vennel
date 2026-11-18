import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { emptyCallNoteExtraction, type CallNoteInput } from '@lead-recovery/types';

const mocks = vi.hoisted(() => {
  const db = {
    callNote: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    callNoteAudit: { create: vi.fn() },
    customer: { findFirst: vi.fn(), create: vi.fn() },
    lead: { findFirst: vi.fn() },
    followUpTask: { count: vi.fn() },
    followUpSuggestion: { updateMany: vi.fn() },
    company: { findUniqueOrThrow: vi.fn() },
  };
  return { db, transaction: vi.fn(), extract: vi.fn() };
});
vi.mock('@lead-recovery/database', () => ({
  prisma: { ...mocks.db, $transaction: mocks.transaction },
}));
vi.mock('./note-extraction.service.js', () => ({ extractCallNote: mocks.extract }));
import {
  analyzeCallNote,
  callNoteInclude,
  createCallNote,
  getCallNote,
  updateCallNote,
} from './call-note.service.js';

const date = new Date('2026-11-08T15:00:00Z');
const customer = {
  id: 'customer-a',
  companyId: 'business-a',
  name: 'Taylor',
  phone: '+15555550100',
  email: null,
  address: null,
  notes: null,
  isArchived: false,
  createdAt: date,
  updatedAt: date,
};
const note = {
  id: 'note-a',
  companyId: 'business-a',
  customerId: customer.id,
  leadId: null,
  originalText: 'Original owner summary.',
  text: 'Original owner summary.',
  source: 'TEXT',
  direction: 'INBOUND',
  occurredAt: date,
  phone: null,
  revision: 1,
  reviewStatus: 'DRAFT',
  extraction: null,
  extractionRevision: null,
  confirmedData: null,
  confirmedFields: [],
  reviewedAt: null,
  isArchived: false,
  createdAt: date,
  updatedAt: date,
  customer,
  lead: null,
  audits: [],
} satisfies Prisma.CallNoteGetPayload<{ include: typeof callNoteInclude }>;
const input: CallNoteInput = {
  customerId: customer.id,
  leadId: null,
  text: note.text,
  direction: 'INBOUND',
  occurredAt: date.toISOString(),
  phone: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation((callback: (db: typeof mocks.db) => unknown) =>
    callback(mocks.db),
  );
  mocks.db.callNote.findFirst.mockResolvedValue(note);
  mocks.db.callNote.create.mockResolvedValue(note);
  mocks.db.callNote.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.customer.findFirst.mockResolvedValue(customer);
  mocks.db.followUpTask.count.mockResolvedValue(0);
  mocks.db.company.findUniqueOrThrow.mockResolvedValue({
    id: 'business-a',
    niche: 'HVAC',
    timeZone: 'UTC',
  });
  mocks.extract.mockResolvedValue(emptyCallNoteExtraction());
});

describe('structured call-note CRUD', () => {
  it('creates structured notes and immutable original text, not SMS messages', async () => {
    const result = await createCallNote('business-a', input);
    expect(result.originalText).toBe(input.text);
    expect(mocks.db.callNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'business-a',
          originalText: input.text,
          text: input.text,
          source: 'TEXT',
        }),
      }),
    );
  });

  it('preserves original text and resets stale extraction when note text is edited', async () => {
    await updateCallNote('business-a', note.id, 1, { ...input, text: 'Clarified owner summary.' });
    const call = mocks.db.callNote.updateMany.mock.calls[0];
    expect(call?.[0].data).not.toHaveProperty('originalText');
    expect(call?.[0].data).toMatchObject({
      text: 'Clarified owner summary.',
      reviewStatus: 'DRAFT',
      extractionRevision: null,
    });
    expect(mocks.db.callNoteAudit.create).toHaveBeenCalled();
  });

  it('rejects cross-business access and stale revisions', async () => {
    mocks.db.callNote.findFirst.mockResolvedValueOnce(null);
    await expect(getCallNote('business-b', note.id)).rejects.toMatchObject({ status: 404 });
    expect(mocks.db.callNote.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: note.id, companyId: 'business-b' } }),
    );
    await expect(updateCallNote('business-a', note.id, 99, input)).rejects.toMatchObject({
      status: 409,
    });
    expect(mocks.db.callNote.updateMany).not.toHaveBeenCalled();
  });

  it('does not save AI results if the note changes during extraction', async () => {
    mocks.db.callNote.updateMany.mockResolvedValue({ count: 0 });
    await expect(analyzeCallNote('business-a', note.id, 1)).rejects.toMatchObject({ status: 409 });
    expect(mocks.db.callNoteAudit.create).not.toHaveBeenCalled();
  });

  it('does not move reviewed history to another customer', async () => {
    mocks.db.callNote.findFirst.mockResolvedValue({ ...note, reviewStatus: 'REVIEWED' });
    await expect(
      updateCallNote('business-a', note.id, 1, { ...input, customerId: 'customer-b' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.db.callNote.updateMany).not.toHaveBeenCalled();
  });
});
