import { describe, expect, it } from 'vitest';

import { hasRecentDuplicateMissedCall } from './missed-call-duplicate.service.js';

describe('hasRecentDuplicateMissedCall', () => {
  const body = 'Hi! Sorry we missed your call to NorthStar Heating. What can we help you with today?';

  it('returns true for matching message inside 30 minutes', () => {
    const now = new Date('2026-01-01T00:30:00.000Z');
    const previous = new Date('2026-01-01T00:10:00.000Z');

    expect(hasRecentDuplicateMissedCall(body, body, previous, now)).toBe(true);
  });

  it('returns false for different body or stale timestamp', () => {
    const now = new Date('2026-01-01T01:00:00.000Z');
    const old = new Date('2026-01-01T00:00:00.000Z');

    expect(hasRecentDuplicateMissedCall('Different', body, old, now)).toBe(false);
    expect(hasRecentDuplicateMissedCall(body, body, old, now)).toBe(false);
  });
});
