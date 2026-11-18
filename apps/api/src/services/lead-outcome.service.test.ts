import { describe, expect, it } from 'vitest';
import { LeadOutcome } from '@prisma/client';
import type { Lead } from '@prisma/client';

import { computeOutcomePatch } from './lead.service.js';

const noTimestamps: Pick<Lead, 'contactedAt' | 'bookedAt' | 'completedAt'> = {
  contactedAt: null,
  bookedAt: null,
  completedAt: null,
};

describe('computeOutcomePatch', () => {
  // 1. outcome update validation (shape of the patch)
  it('sets outcome on the patch', () => {
    const patch = computeOutcomePatch(noTimestamps, { outcome: LeadOutcome.CONTACTED });
    expect(patch.outcome).toBe(LeadOutcome.CONTACTED);
  });

  // 2. CONTACTED sets contactedAt
  it('sets contactedAt when transitioning to CONTACTED for the first time', () => {
    const patch = computeOutcomePatch(noTimestamps, { outcome: LeadOutcome.CONTACTED });
    expect(patch.contactedAt).toBeInstanceOf(Date);
  });

  it('does not overwrite contactedAt if already set', () => {
    const existing = { ...noTimestamps, contactedAt: new Date('2026-01-01T00:00:00Z') };
    const patch = computeOutcomePatch(existing, { outcome: LeadOutcome.CONTACTED });
    expect(patch.contactedAt).toBeUndefined();
  });

  // 3. BOOKED sets bookedAt
  it('sets bookedAt when transitioning to BOOKED for the first time', () => {
    const patch = computeOutcomePatch(noTimestamps, { outcome: LeadOutcome.BOOKED });
    expect(patch.bookedAt).toBeInstanceOf(Date);
  });

  it('does not overwrite bookedAt if already set', () => {
    const existing = { ...noTimestamps, bookedAt: new Date('2026-01-01T00:00:00Z') };
    const patch = computeOutcomePatch(existing, { outcome: LeadOutcome.BOOKED });
    expect(patch.bookedAt).toBeUndefined();
  });

  // WON sets completedAt, actualValue is optional but allowed
  it('sets completedAt and accepts actualValue when transitioning to WON', () => {
    const patch = computeOutcomePatch(noTimestamps, { outcome: LeadOutcome.WON, actualValue: 7200 });
    expect(patch.completedAt).toBeInstanceOf(Date);
    expect(patch.actualValue).toBe(7200);
  });

  it('does not require actualValue for WON', () => {
    const patch = computeOutcomePatch(noTimestamps, { outcome: LeadOutcome.WON });
    expect(patch.outcome).toBe(LeadOutcome.WON);
    expect(patch.actualValue).toBeUndefined();
  });

  // 6. LOST stores lostReason
  it('stores lostReason when outcome is LOST', () => {
    const patch = computeOutcomePatch(noTimestamps, { outcome: LeadOutcome.LOST, lostReason: 'Price' });
    expect(patch.outcome).toBe(LeadOutcome.LOST);
    expect(patch.lostReason).toBe('Price');
  });

  // 7. Omitted fields do not erase existing values
  it('omitting estimatedValue/actualValue/lostReason leaves them out of the patch entirely', () => {
    const patch = computeOutcomePatch(noTimestamps, { outcome: LeadOutcome.CONTACTED });
    expect(patch).not.toHaveProperty('estimatedValue');
    expect(patch).not.toHaveProperty('actualValue');
    expect(patch).not.toHaveProperty('lostReason');
  });

  it('explicit null clears a field (distinct from omission)', () => {
    const patch = computeOutcomePatch(noTimestamps, { outcome: LeadOutcome.LOST, lostReason: null });
    expect(patch.lostReason).toBeNull();
  });
});
