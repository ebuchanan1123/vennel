import { emptyCallNoteExtraction } from '@lead-recovery/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    callNote: { findFirst: vi.fn(), findMany: vi.fn() },
    lead: { findFirst: vi.fn() },
    customer: { findFirst: vi.fn() },
  },
}));
vi.mock('@lead-recovery/database', () => ({ prisma: mocks.db }));
import { estimateEvidence, loadDocumentContext } from './document-context.service.js';

const date = new Date('2026-11-09T15:00:00Z');
const confirmed = emptyCallNoteExtraction();
confirmed.facts.serviceType = { value: 'AC diagnostic', evidence: 'old note quotation' };
confirmed.facts.issue = { value: 'Rejected repair request', evidence: 'unreviewed details' };
confirmed.summary = 'Rejected summary must not be sent';
confirmed.price = {
  amount: 125,
  currency: 'USD',
  state: 'PROPOSED',
  evidence: 'Quoted but not agreed',
};
const note = {
  id: 'note-a',
  companyId: 'business-a',
  customerId: 'customer-a',
  leadId: 'lead-a',
  isArchived: false,
  reviewStatus: 'REVIEWED',
  revision: 3,
  reviewedAt: date,
  confirmedData: confirmed,
  confirmedFields: ['serviceType', 'price'],
  originalText: 'Private original text',
  text: 'Private edited text',
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.callNote.findFirst.mockResolvedValue(note);
  mocks.db.callNote.findMany.mockResolvedValue([note]);
  mocks.db.customer.findFirst.mockResolvedValue({
    id: 'customer-a',
    name: 'Taylor',
    phone: null,
    email: null,
    address: 'Test area',
    updatedAt: date,
  });
  mocks.db.lead.findFirst.mockResolvedValue({
    id: 'lead-a',
    customerId: 'customer-a',
    status: 'QUALIFIED',
    needsHuman: false,
    outcome: 'UNKNOWN',
    completedAt: null,
    updatedAt: date,
    messages: [{ id: 'sms-a', body: 'Please arrange a diagnostic visit.', createdAt: date }],
  });
});
describe('scoped, confirmed document context', () => {
  it('uses selected confirmed facts plus SMS, never raw notes or rejected facts', async () => {
    const context = await loadDocumentContext('business-a', { callNoteId: note.id });
    expect(context.notes[0]?.facts).toEqual([{ field: 'serviceType', value: 'AC diagnostic' }]);
    expect(context.notes[0]?.price?.state).toBe('PROPOSED');
    expect(estimateEvidence(context)).toEqual([
      { kind: 'CALL_NOTE', id: 'note-a', text: 'AC diagnostic' },
      { kind: 'SMS', id: 'sms-a', text: 'Please arrange a diagnostic visit.' },
    ]);
    expect(JSON.stringify(context)).not.toContain('Private original');
    expect(JSON.stringify(context)).not.toContain('Rejected');
    expect(JSON.stringify(context)).not.toContain('old note quotation');
  });
  it('requires an active reviewed note from the selected business', async () => {
    mocks.db.callNote.findFirst.mockResolvedValue(null);
    await expect(loadDocumentContext('business-b', { callNoteId: note.id })).rejects.toMatchObject({
      status: 404,
    });
    expect(mocks.db.callNote.findFirst).toHaveBeenCalledWith({
      where: { id: note.id, companyId: 'business-b', isArchived: false, reviewStatus: 'REVIEWED' },
    });
  });
  it('rejects mixed customer and lead associations', async () => {
    await expect(
      loadDocumentContext('business-a', { callNoteId: note.id, customerId: 'customer-b' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      loadDocumentContext('business-a', { callNoteId: note.id, leadId: 'lead-b' }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('does not pull arbitrary old jobs when only a customer is selected', async () => {
    const context = await loadDocumentContext('business-a', { customerId: 'customer-a' });
    expect(context.notes).toEqual([]);
    expect(context.messages).toEqual([]);
    expect(mocks.db.callNote.findMany).not.toHaveBeenCalled();
    expect(mocks.db.lead.findFirst).not.toHaveBeenCalled();
  });
});
