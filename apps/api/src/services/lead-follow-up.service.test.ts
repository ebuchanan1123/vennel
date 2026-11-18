import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Lead } from '@prisma/client';
import { prisma } from '@lead-recovery/database';

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), notify: vi.fn() }));
vi.mock('./background-job.service.js', () => ({ enqueueBackgroundJob: mocks.enqueue }));
vi.mock('./notification.service.js', () => ({ enqueueOwnerNotification: mocks.notify }));
import { recordLeadCreated, recordLeadMilestone } from './lead-follow-up.service.js';

const date = new Date('2026-11-08T15:00:00Z');
const lead: Lead = {
  id: 'lead-a',
  companyId: 'business-a',
  customerId: null,
  phone: '+15555550100',
  source: 'SMS',
  status: 'QUALIFYING',
  serviceType: null,
  issue: null,
  location: null,
  urgency: null,
  preferredTime: null,
  projectType: null,
  budgetRange: null,
  timeline: null,
  propertyOwner: null,
  needsHuman: false,
  summary: null,
  lastActivityAt: date,
  outcome: 'UNKNOWN',
  estimatedValue: null,
  actualValue: null,
  lostReason: null,
  contactedAt: null,
  bookedAt: null,
  completedAt: null,
  crmExternalId: null,
  createdAt: date,
  updatedAt: date,
};
beforeEach(() => vi.clearAllMocks());
describe('lead milestone side effects', () => {
  it('creates only an owner-notification event for a newly captured lead', async () => {
    await recordLeadCreated(prisma, lead);
    expect(mocks.notify.mock.calls[0]?.slice(1)).toEqual([
      'business-a',
      'new-lead:lead-a',
      {
        kind: 'NEW_LEAD',
        leadId: lead.id,
      },
    ]);
  });
  it('persists follow-up suggestion work for a new qualification milestone', async () => {
    await recordLeadMilestone(prisma, lead, { ...lead, status: 'QUALIFIED' });
    expect(mocks.enqueue.mock.calls[0]?.slice(1)).toEqual([
      'business-a',
      'LEAD_FOLLOW_UP_SUGGESTIONS',
      expect.stringContaining('lead-milestone:lead-a:QUALIFIED:'),
      { leadId: lead.id, milestone: 'QUALIFIED' },
    ]);
  });
  it('does not requeue suggestions for repeated fully-qualified replies', async () => {
    await recordLeadMilestone(
      prisma,
      { ...lead, status: 'QUALIFIED' },
      { ...lead, status: 'QUALIFIED', summary: 'Updated summary.' },
    );
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('records human-attention alerts without sending a customer-facing message', async () => {
    await recordLeadMilestone(prisma, lead, { ...lead, status: 'NEEDS_HUMAN', needsHuman: true });
    expect(mocks.notify.mock.calls[0]?.slice(1)).toEqual([
      'business-a',
      expect.stringContaining('human-attention:lead-a:'),
      { kind: 'HUMAN_ATTENTION', leadId: lead.id },
    ]);
  });
});
