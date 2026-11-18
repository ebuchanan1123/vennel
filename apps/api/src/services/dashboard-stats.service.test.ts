import { describe, expect, it } from 'vitest';
import { LeadOutcome, LeadSource, LeadStatus } from '@prisma/client';

import { computeDashboardStats, type StatsLeadInput } from './dashboard-stats.service.js';

function lead(overrides: Partial<StatsLeadInput>): StatsLeadInput {
  return {
    source: LeadSource.SMS,
    status: LeadStatus.NEW,
    outcome: LeadOutcome.UNKNOWN,
    estimatedValue: null,
    actualValue: null,
    ...overrides,
  };
}

describe('computeDashboardStats', () => {
  it('counts MISSED_CALL and SMS leads as recovered, WEB_FORM is not recovered', () => {
    const stats = computeDashboardStats([
      lead({ source: LeadSource.MISSED_CALL }),
      lead({ source: LeadSource.SMS }),
      lead({ source: LeadSource.WEB_FORM }),
    ]);
    expect(stats.recoveredLeads).toBe(2);
  });

  it('counts QUALIFIED, NEEDS_HUMAN, and QUALIFYING statuses separately', () => {
    const stats = computeDashboardStats([
      lead({ status: LeadStatus.QUALIFIED }),
      lead({ status: LeadStatus.QUALIFIED }),
      lead({ status: LeadStatus.NEEDS_HUMAN }),
      lead({ status: LeadStatus.QUALIFYING }),
    ]);
    expect(stats.qualifiedLeads).toBe(2);
    expect(stats.needsHuman).toBe(1);
    expect(stats.inProgress).toBe(1);
  });

  it('counts BOOKED and WON outcomes', () => {
    const stats = computeDashboardStats([
      lead({ outcome: LeadOutcome.BOOKED }),
      lead({ outcome: LeadOutcome.WON, actualValue: 5000 }),
      lead({ outcome: LeadOutcome.WON, actualValue: 3000 }),
    ]);
    expect(stats.bookedJobs).toBe(1);
    expect(stats.wonJobs).toBe(2);
  });

  // 4. WON actualValue contributes to wonRevenue
  it('sums actualValue only for WON leads into wonRevenue', () => {
    const stats = computeDashboardStats([
      lead({ outcome: LeadOutcome.WON, actualValue: 7450 }),
      lead({ outcome: LeadOutcome.WON, actualValue: 2550 }),
    ]);
    expect(stats.wonRevenue).toBe(10000);
  });

  // 5. estimatedValue does NOT contribute to wonRevenue
  it('estimatedValue never contributes to wonRevenue, even on a WON lead', () => {
    const stats = computeDashboardStats([
      lead({ outcome: LeadOutcome.WON, estimatedValue: 8000, actualValue: 7200 }),
    ]);
    expect(stats.wonRevenue).toBe(7200);
    expect(stats.estimatedPipeline).toBe(8000);
  });

  it('a QUALIFIED-but-UNKNOWN-outcome lead contributes to estimatedPipeline but not wonRevenue', () => {
    const stats = computeDashboardStats([
      lead({ status: LeadStatus.QUALIFIED, outcome: LeadOutcome.UNKNOWN, estimatedValue: 8000 }),
    ]);
    expect(stats.estimatedPipeline).toBe(8000);
    expect(stats.wonRevenue).toBe(0);
  });

  it('a LOST lead does not count toward wonRevenue', () => {
    const stats = computeDashboardStats([
      lead({ outcome: LeadOutcome.LOST, estimatedValue: 5000 }),
    ]);
    expect(stats.wonRevenue).toBe(0);
    expect(stats.wonJobs).toBe(0);
  });

  it('returns all zeros for an empty lead list', () => {
    const stats = computeDashboardStats([]);
    expect(stats).toEqual({
      recoveredLeads: 0,
      qualifiedLeads: 0,
      needsHuman: 0,
      inProgress: 0,
      bookedJobs: 0,
      wonJobs: 0,
      estimatedPipeline: 0,
      wonRevenue: 0,
    });
  });
});
