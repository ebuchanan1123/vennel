import { Webhook } from 'svix';
import { describe, expect, it } from 'vitest';

import { verifyResendEvent } from './document-delivery-events.service.js';

const secret = `whsec_${Buffer.from('synthetic-webhook-secret-for-tests').toString('base64')}`;
const payload = JSON.stringify({
  type: 'email.delivered',
  created_at: new Date().toISOString(),
  data: { email_id: 'email-a' },
});
describe('verified email delivery callbacks', () => {
  it('verifies a provider-signed original body', () => {
    const now = new Date();
    const id = 'msg_signed_test';
    const signature = new Webhook(secret).sign(id, now, payload);
    expect(
      verifyResendEvent(
        Buffer.from(payload),
        { id, timestamp: String(Math.floor(now.getTime() / 1000)), signature },
        secret,
      ),
    ).toMatchObject({ type: 'email.delivered' });
  });
  it('rejects altered, unsigned or stale webhook bodies', () => {
    const now = new Date();
    const id = 'msg_signed_test';
    const signature = new Webhook(secret).sign(id, now, payload);
    expect(() =>
      verifyResendEvent(
        Buffer.from(`${payload} `),
        { id, timestamp: String(Math.floor(now.getTime() / 1000)), signature },
        secret,
      ),
    ).toThrow('signature');
    expect(() =>
      verifyResendEvent(Buffer.from(payload), { id, timestamp: '1', signature }, secret),
    ).toThrow('signature');
  });
});
