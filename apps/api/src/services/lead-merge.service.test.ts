import { describe, expect, it } from 'vitest';
import { LeadStatus } from '@prisma/client';
import type { Lead } from '@prisma/client';

import { mergeLeadQualification, mergeLeadUpdates } from './lead-merge.service.js';
import { getMissingQualificationFields } from './qualification-config.service.js';
import type { Company } from '@prisma/client';

// ── Shared fixtures ────────────────────────────────────────────────────────

const baseLead: Lead = {
  id: 'lead_1',
  companyId: 'company_1',
  customerId: null,
  phone: '+15555550100',
  source: 'SMS',
  status: LeadStatus.QUALIFYING,
  serviceType: 'AC repair',
  issue: 'Warm air',
  location: null,
  urgency: null,
  preferredTime: null,
  budgetRange: null,
  projectType: null,
  timeline: null,
  propertyOwner: null,
  needsHuman: false,
  summary: 'Existing summary',
  outcome: 'UNKNOWN',
  estimatedValue: null,
  actualValue: null,
  lostReason: null,
  contactedAt: null,
  bookedAt: null,
  completedAt: null,
  crmExternalId: null,
  lastActivityAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const hvacCompany = {
  id: 'co_hvac',
  niche: 'HVAC',
} as Company;

const renovationCompany = {
  id: 'co_reno',
  niche: 'RENOVATION',
} as Company;

// ── E: null model output never erases known fields ─────────────────────────

describe('mergeLeadQualification (backward-compat alias)', () => {
  it('fills missing fields without erasing existing values', () => {
    const merged = mergeLeadQualification(baseLead, {
      reply: 'What city are you located in?',
      serviceType: null,
      issue: null,
      location: 'Burlington',
      urgency: 'NORMAL',
      preferredTime: null,
      projectType: null,
      budgetRange: null,
      timeline: null,
      propertyOwner: null,
      status: 'QUALIFYING',
      needsHuman: false,
      summary: null,
    });

    expect(merged.serviceType).toBe('AC repair');
    expect(merged.issue).toBe('Warm air');
    expect(merged.location).toBe('Burlington');
    expect(merged.urgency).toBe('NORMAL');
    expect(merged.summary).toBe('Existing summary');
  });
});

describe('mergeLeadUpdates — requirement E: null model output never erases known fields', () => {
  it('keeps all previously known fields when model returns nulls', () => {
    const existingLead: Lead = {
      ...baseLead,
      serviceType: 'Furnace repair',
      location: 'Burlington',
      urgency: 'HIGH',
      preferredTime: 'Tomorrow afternoon',
    };

    const merged = mergeLeadUpdates(existingLead, {
      reply: 'What kind of HVAC service do you need?',
      serviceType: null,
      issue: null,
      location: null,
      urgency: null,
      preferredTime: null,
      projectType: null,
      budgetRange: null,
      timeline: null,
      propertyOwner: null,
      status: 'QUALIFYING',
      needsHuman: false,
      summary: null,
    });

    expect(merged.serviceType).toBe('Furnace repair');
    expect(merged.location).toBe('Burlington');
    expect(merged.urgency).toBe('HIGH');
    expect(merged.preferredTime).toBe('Tomorrow afternoon');
  });

  it('updates only newly provided fields', () => {
    const existingLead: Lead = {
      ...baseLead,
      serviceType: 'Furnace repair',
      location: 'Burlington',
    };

    const merged = mergeLeadUpdates(existingLead, {
      reply: 'How urgent is this?',
      serviceType: null,
      issue: null,
      location: null,
      urgency: 'HIGH', // newly extracted
      preferredTime: null,
      projectType: null,
      budgetRange: null,
      timeline: null,
      propertyOwner: null,
      status: 'QUALIFYING',
      needsHuman: false,
      summary: 'Furnace not heating.',
    });

    // Pre-existing values preserved
    expect(merged.serviceType).toBe('Furnace repair');
    expect(merged.location).toBe('Burlington');
    // Newly extracted value applied
    expect(merged.urgency).toBe('HIGH');
    expect(merged.summary).toBe('Furnace not heating.');
  });
});

// ── A: Furnace full flow — all fields collected → QUALIFIED, no regression ─

describe('getMissingQualificationFields — requirement A: furnace full flow', () => {
  it('returns empty when all 5 HVAC fields are present', () => {
    const fullyQualifiedLead: Lead = {
      ...baseLead,
      serviceType: 'Furnace repair',
      issue: 'Not heating',
      location: 'Burlington',
      urgency: 'HIGH',
      preferredTime: 'Tomorrow afternoon',
    };

    const missing = getMissingQualificationFields(fullyQualifiedLead, hvacCompany);
    expect(missing).toHaveLength(0);
  });

  it('correctly identifies which single HVAC field is still missing', () => {
    const leadMissingPreferredTime: Lead = {
      ...baseLead,
      serviceType: 'Furnace repair',
      issue: 'Not heating',
      location: 'Burlington',
      urgency: 'HIGH',
      preferredTime: null,
    };

    const missing = getMissingQualificationFields(leadMissingPreferredTime, hvacCompany);
    expect(missing).toEqual(['preferredTime']);
  });
});

// ── B: Side question midway — previously collected fields preserved ─────────

describe('mergeLeadUpdates — requirement B: side question mid-conversation', () => {
  it('preserves serviceType and location when customer asks a side question', () => {
    const midConversationLead: Lead = {
      ...baseLead,
      serviceType: 'AC repair',
      location: 'Hamilton',
      // urgency and preferredTime still missing
    };

    // Model extracts nothing useful from "How much will this cost?"
    const merged = mergeLeadUpdates(midConversationLead, {
      reply: 'A team member will confirm pricing. How urgent is the issue?',
      serviceType: null,
      issue: null,
      location: null,
      urgency: null,
      preferredTime: null,
      projectType: null,
      budgetRange: null,
      timeline: null,
      propertyOwner: null,
      status: 'QUALIFYING',
      needsHuman: false,
      summary: null,
    });

    expect(merged.serviceType).toBe('AC repair');
    expect(merged.location).toBe('Hamilton');
    expect(merged.urgency).toBeNull(); // still missing → correct
    expect(merged.preferredTime).toBeNull();
  });
});

// ── C: propertyOwner is NEVER required for HVAC ────────────────────────────

describe('getMissingQualificationFields — requirement C: no propertyOwner for HVAC', () => {
  it('does not list propertyOwner as missing for an HVAC lead', () => {
    const hvacLeadWithNoOwnerInfo: Lead = {
      ...baseLead,
      propertyOwner: null,
      serviceType: 'Furnace repair',
      issue: 'Not heating',
      location: 'Burlington',
      urgency: 'HIGH',
      preferredTime: 'Tomorrow',
    };

    const missing = getMissingQualificationFields(hvacLeadWithNoOwnerInfo, hvacCompany);
    expect(missing).not.toContain('propertyOwner');
    expect(missing).toHaveLength(0); // fully qualified for HVAC
  });

  it('still treats all 5 HVAC fields as complete regardless of propertyOwner', () => {
    const hvacLead: Lead = {
      ...baseLead,
      serviceType: 'AC repair',
      issue: 'Not cooling',
      location: 'Oakville',
      urgency: 'NORMAL',
      preferredTime: 'Any weekday',
      propertyOwner: null, // not required for HVAC
    };

    expect(getMissingQualificationFields(hvacLead, hvacCompany)).toHaveLength(0);
  });
});

// ── D: propertyOwner IS required for RENOVATION ────────────────────────────

describe('getMissingQualificationFields — requirement D: propertyOwner required for RENOVATION', () => {
  it('lists propertyOwner as missing for a renovation lead without it', () => {
    const renoLeadNoOwner: Lead = {
      ...baseLead,
      projectType: 'Kitchen remodel',
      location: 'Hamilton',
      budgetRange: '$30k-$50k',
      timeline: '3 months',
      preferredTime: 'Weekday evenings',
      propertyOwner: null, // missing for RENOVATION
    };

    const missing = getMissingQualificationFields(renoLeadNoOwner, renovationCompany);
    expect(missing).toContain('propertyOwner');
  });

  it('returns empty when all 6 RENOVATION fields are present', () => {
    const fullRenoLead: Lead = {
      ...baseLead,
      projectType: 'Kitchen remodel',
      location: 'Hamilton',
      budgetRange: '$30k-$50k',
      timeline: '3 months',
      preferredTime: 'Weekday evenings',
      propertyOwner: true,
    };

    expect(getMissingQualificationFields(fullRenoLead, renovationCompany)).toHaveLength(0);
  });
});

// ── F: QUALIFIED lead does not regress to QUALIFYING ──────────────────────
// (qualification.service.ts logic is tested via the pure helper functions
//  that drive it — the actual status decision is tested at the service level
//  with integration tests; here we verify the field state that drives it)

describe('getMissingQualificationFields — requirement F: QUALIFIED state is stable', () => {
  it('returns 0 missing fields for a fully qualified HVAC lead regardless of current status', () => {
    const qualifiedLead: Lead = {
      ...baseLead,
      status: LeadStatus.QUALIFIED,
      serviceType: 'Furnace repair',
      issue: 'Not heating',
      location: 'Burlington',
      urgency: 'HIGH',
      preferredTime: 'Tomorrow afternoon',
    };

    // Even if the model were to return nulls, after merge no fields are missing
    const merged = mergeLeadUpdates(qualifiedLead, {
      reply: 'All good.',
      serviceType: null,
      issue: null,
      location: null,
      urgency: null,
      preferredTime: null,
      projectType: null,
      budgetRange: null,
      timeline: null,
      propertyOwner: null,
      status: 'QUALIFYING', // model incorrectly returns QUALIFYING
      needsHuman: false,
      summary: null,
    });

    const mergedLead = { ...qualifiedLead, ...merged } as Lead;
    const missing = getMissingQualificationFields(mergedLead, hvacCompany);

    // All 5 fields still present → qualification.service will set QUALIFIED
    expect(missing).toHaveLength(0);
    // Existing field values preserved
    expect(mergedLead.serviceType).toBe('Furnace repair');
    expect(mergedLead.location).toBe('Burlington');
    expect(mergedLead.urgency).toBe('HIGH');
    expect(mergedLead.preferredTime).toBe('Tomorrow afternoon');
  });
});
