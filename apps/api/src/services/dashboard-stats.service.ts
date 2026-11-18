import { prisma } from '@lead-recovery/database';
import { LeadOutcome, LeadSource, LeadStatus } from '@prisma/client';

export type DashboardStats = {
  recoveredLeads: number;
  qualifiedLeads: number;
  needsHuman: number;
  inProgress: number;
  bookedJobs: number;
  wonJobs: number;
  estimatedPipeline: number;
  wonRevenue: number;
};

export type StatsLeadInput = {
  source: LeadSource;
  status: LeadStatus;
  outcome: LeadOutcome;
  estimatedValue: unknown;
  actualValue: unknown;
};

function toNumber(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

/**
 * Pure aggregation — exported for unit tests.
 * estimatedPipeline sums estimatedValue across all leads that have one (a projection).
 * wonRevenue sums actualValue ONLY for leads whose outcome is WON — never estimated values.
 */
export function computeDashboardStats(leads: StatsLeadInput[]): DashboardStats {
  let recoveredLeads = 0;
  let qualifiedLeads = 0;
  let needsHuman = 0;
  let inProgress = 0;
  let bookedJobs = 0;
  let wonJobs = 0;
  let estimatedPipeline = 0;
  let wonRevenue = 0;

  for (const lead of leads) {
    if (lead.source === LeadSource.MISSED_CALL || lead.source === LeadSource.SMS) {
      recoveredLeads += 1;
    }
    if (lead.status === LeadStatus.QUALIFIED) qualifiedLeads += 1;
    if (lead.status === LeadStatus.NEEDS_HUMAN) needsHuman += 1;
    if (lead.status === LeadStatus.QUALIFYING) inProgress += 1;
    if (lead.outcome === LeadOutcome.BOOKED) bookedJobs += 1;
    if (lead.outcome === LeadOutcome.WON) {
      wonJobs += 1;
      wonRevenue += toNumber(lead.actualValue);
    }
    estimatedPipeline += toNumber(lead.estimatedValue);
  }

  return {
    recoveredLeads,
    qualifiedLeads,
    needsHuman,
    inProgress,
    bookedJobs,
    wonJobs,
    estimatedPipeline,
    wonRevenue,
  };
}

export async function getDashboardStats(companyId: string): Promise<DashboardStats> {
  const leads = await prisma.lead.findMany({
    where: { companyId },
    select: {
      source: true,
      status: true,
      outcome: true,
      estimatedValue: true,
      actualValue: true,
    },
  });

  return computeDashboardStats(leads);
}
