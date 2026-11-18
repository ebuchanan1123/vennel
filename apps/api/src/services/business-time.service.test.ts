import { businessLocalInput, businessLocalToUtc, followUpBucket } from '@lead-recovery/types';
import { describe, expect, it } from 'vitest';

describe('business-local scheduling', () => {
  it('converts explicit local appointment times to UTC and back', () => {
    const utc = businessLocalToUtc('2030-02-15T11:30', 'America/Toronto');
    expect(utc).toBe('2030-02-15T16:30:00.000Z');
    expect(businessLocalInput(utc, 'America/Toronto')).toBe('2030-02-15T11:30');
  });
  it('rejects nonexistent and ambiguous daylight-saving times instead of guessing', () => {
    expect(() => businessLocalToUtc('2026-03-08T02:30', 'America/Toronto')).toThrow(
      'does not exist',
    );
    expect(() => businessLocalToUtc('2026-11-01T01:30', 'America/Toronto')).toThrow('occurs twice');
  });
  it('groups today using the business date, not the UTC calendar day', () => {
    expect(followUpBucket('2026-11-09T00:30:00Z', 'America/Toronto', '2026-11-08T23:30:00Z')).toBe(
      'today',
    );
    expect(followUpBucket('2026-11-08T22:30:00Z', 'America/Toronto', '2026-11-08T23:30:00Z')).toBe(
      'overdue',
    );
  });
});
