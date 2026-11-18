import { describe, expect, it } from 'vitest';

import { isEmergencyMessage } from './emergency.service.js';

describe('isEmergencyMessage', () => {
  it('detects emergency phrases deterministically', () => {
    expect(isEmergencyMessage('I smell gas near the furnace')).toBe(true);
    expect(isEmergencyMessage('Our CO alarm is going off')).toBe(true);
    expect(isEmergencyMessage('There is smoke from the unit')).toBe(true);
  });

  it('does not flag normal service requests', () => {
    expect(isEmergencyMessage("My AC isn't cooling")).toBe(false);
    expect(isEmergencyMessage('Need maintenance next week')).toBe(false);
  });
});
