import { describe, expect, it } from 'vitest';

import { isMissedDialStatus } from './dial-status.service.js';

describe('isMissedDialStatus', () => {
  it('returns true for no-answer, busy, and failed', () => {
    expect(isMissedDialStatus('no-answer')).toBe(true);
    expect(isMissedDialStatus('busy')).toBe(true);
    expect(isMissedDialStatus('failed')).toBe(true);
  });

  it('returns false for completed and empty values', () => {
    expect(isMissedDialStatus('completed')).toBe(false);
    expect(isMissedDialStatus(undefined)).toBe(false);
    expect(isMissedDialStatus('')).toBe(false);
  });
});
