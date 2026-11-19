import { emptyCallNoteExtraction } from '@lead-recovery/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const provider = vi.hoisted(() => ({
  responses: { create: vi.fn() },
  audio: { transcriptions: { create: vi.fn() } },
}));
vi.mock('./openai.service.js', () => ({ openai: provider }));
vi.mock('./provider-usage.service.js', () => ({ reserveProviderUsage: vi.fn() }));
import { transcribeCallSummary, validateNoteExtraction } from './note-extraction.service.js';

beforeEach(() => vi.clearAllMocks());
const text =
  'Taylor requested an AC diagnostic. I quoted $125, but it was not agreed. They prefer tomorrow afternoon.';

describe('call-note extraction validation', () => {
  it('preserves proposed pricing and tentative appointment uncertainty with evidence', () => {
    const extraction = emptyCallNoteExtraction();
    extraction.facts.customerName = { value: 'Taylor', evidence: 'Taylor' };
    extraction.facts.serviceType = { value: 'AC diagnostic', evidence: 'AC diagnostic' };
    extraction.price = {
      amount: 125,
      currency: null,
      state: 'PROPOSED',
      evidence: 'I quoted $125, but it was not agreed.',
    };
    extraction.appointment = {
      text: 'tomorrow afternoon',
      startsAt: null,
      state: 'TENTATIVE',
      evidence: 'They prefer tomorrow afternoon.',
    };
    const result = validateNoteExtraction(extraction, text);
    expect(result.price.state).toBe('PROPOSED');
    expect(result.price.currency).toBeNull();
    expect(result.appointment.state).toBe('TENTATIVE');
    expect(result.appointment.startsAt).toBeNull();
  });

  it('rejects unsupported facts, malformed outputs and unsubstantiated actions', () => {
    const extraction = emptyCallNoteExtraction();
    extraction.facts.customerName = { value: 'Someone else', evidence: 'Invented quote' };
    expect(() => validateNoteExtraction(extraction, text)).toThrow('substantiate');
    expect(() => validateNoteExtraction({ facts: {} }, text)).toThrow('invalid');
    extraction.facts.customerName = { value: null, evidence: null };
    extraction.actions = [
      {
        type: 'CALL_CUSTOMER',
        title: 'Callback',
        dueAt: null,
        dueText: 'tomorrow',
        priority: 'NORMAL',
        evidence: 'Not in the note',
      },
    ];
    expect(() => validateNoteExtraction(extraction, text)).toThrow('evidence');
  });

  it('does not allow a claimed agreed price without an amount', () => {
    const extraction = emptyCallNoteExtraction();
    extraction.price.state = 'AGREED';
    expect(() => validateNoteExtraction(extraction, text)).toThrow('incomplete');
  });
});

describe('transient voice transcription', () => {
  it('returns text and clears the source audio buffer', async () => {
    provider.audio.transcriptions.create.mockResolvedValue({ text: 'Reviewed call summary.' });
    const buffer = Buffer.from('synthetic audio');
    expect(await transcribeCallSummary('business-a', buffer, 'audio/webm', 'summary.webm')).toBe(
      'Reviewed call summary.',
    );
    expect(buffer.every((byte) => byte === 0)).toBe(true);
  });

  it('reports provider failures, preserves no audio and offers text fallback', async () => {
    provider.audio.transcriptions.create.mockRejectedValue(new Error('Synthetic provider failure'));
    const buffer = Buffer.from('synthetic audio');
    await expect(
      transcribeCallSummary('business-a', buffer, 'audio/webm', 'summary.webm'),
    ).rejects.toMatchObject({ status: 502 });
    expect(buffer.every((byte) => byte === 0)).toBe(true);
  });

  it('rejects empty transcriptions without reporting successful capture', async () => {
    provider.audio.transcriptions.create.mockResolvedValue({ text: '   ' });
    await expect(
      transcribeCallSummary('business-a', Buffer.from('audio'), 'audio/webm', 'summary.webm'),
    ).rejects.toMatchObject({ status: 502 });
  });
});
