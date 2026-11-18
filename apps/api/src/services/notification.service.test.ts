import type { BackgroundJob } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    notificationPreference: { findUnique: vi.fn() },
    company: { findFirst: vi.fn() },
    lead: { findFirst: vi.fn() },
  },
  env: {
    RESEND_API_KEY: 'test-key-not-a-credential',
    RESEND_FROM_EMAIL: 'notifications@example.test',
    DASHBOARD_BASE_URL: 'http://localhost:3000',
  },
}));
vi.mock('@lead-recovery/database', () => ({ prisma: mocks.db }));
vi.mock('../env.js', () => ({ env: mocks.env }));
import { prepareOwnerEmail, sendOwnerEmail } from './notification.service.js';

const now = new Date('2026-11-08T15:00:00Z');
const preference = {
  companyId: 'business-a',
  enabled: true,
  recipientEmail: 'owner@example.test',
  consentedAt: now,
  optOutToken: '82b31473-81f1-4268-b17a-526195f01ddf',
  newLeads: true,
  humanAttention: true,
  overdueFollowUps: true,
  documentReview: true,
};
const job: BackgroundJob = {
  id: 'job-a',
  companyId: 'business-a',
  userId: null,
  kind: 'OWNER_EMAIL',
  eventKey: 'new-lead:lead-a',
  status: 'RUNNING',
  payload: {
    kind: 'NEW_LEAD',
    leadId: 'lead-a',
    recipientEmail: preference.recipientEmail,
    preferenceToken: preference.optOutToken,
  },
  deliveryPayload: null,
  dueAt: now,
  attempts: 1,
  maxAttempts: 5,
  leaseToken: 'lease-a',
  leaseUntil: now,
  firstAttemptAt: now,
  completedAt: null,
  lastError: null,
  providerId: null,
  createdAt: now,
  updatedAt: now,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  mocks.db.notificationPreference.findUnique.mockResolvedValue(preference);
  mocks.db.company.findFirst.mockResolvedValue({
    id: 'business-a',
    name: 'Example business',
    timeZone: 'UTC',
  });
  mocks.db.lead.findFirst.mockResolvedValue({ id: 'lead-a', status: 'NEW', needsHuman: false });
  mocks.env.RESEND_API_KEY = 'test-key-not-a-credential';
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('authorized transactional owner notifications', () => {
  it('targets only the opted-in owner and includes a confirmation-based opt-out link', async () => {
    const email = await prepareOwnerEmail(job);
    expect(email?.to).toBe(preference.recipientEmail);
    expect(email?.text).toContain('/notifications/unsubscribe/');
    expect(email?.headers['List-Unsubscribe']).toContain('/confirm>');
    expect(email?.text).not.toContain('customer@example.test');
    expect(mocks.db.lead.findFirst).toHaveBeenCalledWith({
      where: { id: 'lead-a', companyId: 'business-a' },
    });
  });
  it('does not send after opt-out or a recipient/consent change', async () => {
    mocks.db.notificationPreference.findUnique.mockResolvedValue({ ...preference, enabled: false });
    expect(await prepareOwnerEmail(job)).toBeNull();
    mocks.db.notificationPreference.findUnique.mockResolvedValue({
      ...preference,
      recipientEmail: 'different@example.test',
    });
    expect(await prepareOwnerEmail(job)).toBeNull();
  });
  it('reuses the same idempotency key and payload across safe retries', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(
        async () => new Response(JSON.stringify({ id: 'email-a' }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetch);
    const email = await prepareOwnerEmail(job);
    if (!email) throw new Error('Expected authorized test email.');
    expect(await sendOwnerEmail(job, email)).toBe('email-a');
    expect(await sendOwnerEmail({ ...job, attempts: 2 }, email)).toBe('email-a');
    expect(fetch.mock.calls[0]?.[1].headers['Idempotency-Key']).toBe(
      fetch.mock.calls[1]?.[1].headers['Idempotency-Key'],
    );
    expect(fetch.mock.calls[0]?.[1].body).toBe(fetch.mock.calls[1]?.[1].body);
  });
  it('blocks missing provider configuration and retries outside the safe window', async () => {
    const email = await prepareOwnerEmail(job);
    if (!email) throw new Error('Expected authorized email.');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    mocks.env.RESEND_API_KEY = '';
    await expect(sendOwnerEmail(job, email)).rejects.toMatchObject({ blocked: true });
    mocks.env.RESEND_API_KEY = 'test-key-not-a-credential';
    await expect(
      sendOwnerEmail({ ...job, firstAttemptAt: new Date(now.getTime() - 24 * 3600000) }, email),
    ).rejects.toMatchObject({ retryable: false });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not report provider failures as successful deliveries', async () => {
    const email = await prepareOwnerEmail(job);
    if (!email) throw new Error('Expected authorized email.');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429 })));
    await expect(sendOwnerEmail(job, email)).rejects.toMatchObject({ retryable: true });
  });
});
