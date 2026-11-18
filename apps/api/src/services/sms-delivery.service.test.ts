import { describe, expect, it } from 'vitest';

import { nextSmsDeliveryStatus } from './sms-delivery.service.js';
import { classifySmsFailure } from './twilio.service.js';

describe('monotonic SMS provider evidence', () => {
  it('distinguishes provider acceptance, sending and delivery', () => {
    expect(nextSmsDeliveryStatus('SENDING', 'queued')).toBe('ACCEPTED');
    expect(nextSmsDeliveryStatus('ACCEPTED', 'sent')).toBe('SENT');
    expect(nextSmsDeliveryStatus('SENT', 'delivered')).toBe('DELIVERED');
  });
  it('does not downgrade terminal evidence or regress on late callbacks', () => {
    expect(nextSmsDeliveryStatus('SENT', 'queued')).toBe('SENT');
    expect(nextSmsDeliveryStatus('FAILED', 'sent')).toBe('FAILED');
    expect(nextSmsDeliveryStatus('FAILED', 'delivered')).toBe('DELIVERED');
    expect(nextSmsDeliveryStatus('DELIVERED', 'failed')).toBe('DELIVERED');
    expect(nextSmsDeliveryStatus('UNKNOWN', 'queued')).toBe('ACCEPTED');
  });
  it('retries explicit rejection but not ambiguous network or server outcomes', () => {
    expect(classifySmsFailure({ status: 429 })).toMatchObject({
      retryable: true,
      uncertain: false,
    });
    expect(classifySmsFailure({ status: 401 })).toMatchObject({ retryable: false, blocked: true });
    expect(classifySmsFailure({ code: 'ECONNREFUSED' })).toMatchObject({ retryable: true });
    expect(classifySmsFailure({ code: 'ETIMEDOUT' })).toMatchObject({
      retryable: false,
      uncertain: true,
    });
    expect(classifySmsFailure({ status: 500 })).toMatchObject({
      retryable: false,
      uncertain: true,
    });
  });
});
