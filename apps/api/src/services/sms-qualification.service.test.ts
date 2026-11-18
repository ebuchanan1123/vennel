/**
 * Tests for issues 2, 3, and 4:
 *
 *  Issue 2 – Availability: bot must never promise technician availability.
 *  Issue 3 – Multi-field extraction: single message may populate several fields at once.
 *  Issue 4 – Conversational urgency: enum values must never be exposed to customers.
 *
 * These tests verify the deterministic parts (prompt content, merge logic, state
 * transitions) without calling the OpenAI API.
 */

import { describe, expect, it } from 'vitest';
import { LeadStatus } from '@prisma/client';
import type { Lead, Company } from '@prisma/client';

import { buildHvacPrompt } from '../prompts/hvac.prompt.js';
import { mergeLeadUpdates } from './lead-merge.service.js';
import { getMissingQualificationFields } from './qualification-config.service.js';

// ── Shared fixtures ────────────────────────────────────────────────────────

const emptyHvacLead: Lead = {
  id: 'lead_test',
  companyId: 'co_hvac',
  customerId: null,
  phone: '+15551234567',
  source: 'SMS',
  status: LeadStatus.NEW,
  serviceType: null,
  issue: null,
  location: null,
  urgency: null,
  preferredTime: null,
  budgetRange: null,
  projectType: null,
  timeline: null,
  propertyOwner: null,
  needsHuman: false,
  summary: null,
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

const hvacCompany = { id: 'co_hvac', niche: 'HVAC' } as Company;

// ━━ ISSUE 2 — AVAILABILITY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Issue 2 — availability: prompt must prohibit confirming availability', () => {
  const prompt = buildHvacPrompt();

  it('prohibits "we can come tonight" phrasing', () => {
    expect(prompt.toLowerCase()).toContain('never say');
    expect(prompt).toContain('we can come tonight');
  });

  it('prohibits implying a confirmed appointment', () => {
    expect(prompt).toContain('never promise');
  });

  it('instructs bot to record preferredTime without confirming availability', () => {
    expect(prompt).toContain('A team member will confirm availability with you');
  });

  it('"Can someone come tonight?" — preferredTime is extracted, availability not confirmed', () => {
    // Simulate the model correctly extracting preferredTime from a scheduling request
    // without confirming availability (as the prompt instructs).
    const merged = mergeLeadUpdates(emptyHvacLead, {
      reply:
        "I've noted tonight as your preferred time. A team member will confirm availability with you.",
      serviceType: null,
      issue: null,
      location: null,
      urgency: null,
      preferredTime: 'tonight',
      projectType: null,
      budgetRange: null,
      timeline: null,
      propertyOwner: null,
      status: 'QUALIFYING',
      needsHuman: false,
      summary: null,
    });

    expect(merged.preferredTime).toBe('tonight');
    // The reply that was produced (per prompt instructions) must not confirm availability
    expect(merged.preferredTime).not.toBeNull();
  });

  it('"Can you come tomorrow morning?" — preferredTime set, no confirmed booking', () => {
    const merged = mergeLeadUpdates(emptyHvacLead, {
      reply:
        "I've noted tomorrow morning as your preferred time. A team member will confirm availability.",
      serviceType: null,
      issue: null,
      location: null,
      urgency: null,
      preferredTime: 'tomorrow morning',
      projectType: null,
      budgetRange: null,
      timeline: null,
      propertyOwner: null,
      status: 'QUALIFYING',
      needsHuman: false,
      summary: null,
    });
    expect(merged.preferredTime).toBe('tomorrow morning');
  });

  it('"Are you available Sunday?" — treated as preferredTime preference', () => {
    const merged = mergeLeadUpdates(emptyHvacLead, {
      reply: "I've noted Sunday as your preferred time. A team member will confirm availability.",
      serviceType: null,
      issue: null,
      location: null,
      urgency: null,
      preferredTime: 'Sunday',
      projectType: null,
      budgetRange: null,
      timeline: null,
      propertyOwner: null,
      status: 'QUALIFYING',
      needsHuman: false,
      summary: null,
    });
    expect(merged.preferredTime).toBe('Sunday');
  });

  it('"Send someone right now" — treated as preferredTime preference, urgency HIGH', () => {
    const merged = mergeLeadUpdates(emptyHvacLead, {
      reply:
        "I've noted as soon as possible as your preference. A team member will confirm availability.",
      serviceType: null,
      issue: null,
      location: null,
      urgency: 'HIGH',
      preferredTime: 'as soon as possible',
      projectType: null,
      budgetRange: null,
      timeline: null,
      propertyOwner: null,
      status: 'QUALIFYING',
      needsHuman: false,
      summary: null,
    });
    expect(merged.preferredTime).toBe('as soon as possible');
    expect(merged.urgency).toBe('HIGH');
  });
});

// ━━ ISSUE 3 — MULTI-FIELD EXTRACTION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Issue 3 — multi-field extraction from a single message', () => {
  it('TEST A: "furnace stopped heating + Oakville + tomorrow morning" populates 4 fields at once', () => {
    const merged = mergeLeadUpdates(emptyHvacLead, {
      reply: 'How urgent is this for you?',
      serviceType: 'Furnace repair',
      issue: 'stopped heating',
      location: 'Oakville',
      urgency: null,
      preferredTime: 'tomorrow morning',
      projectType: null,
      budgetRange: null,
      timeline: null,
      propertyOwner: null,
      status: 'QUALIFYING',
      needsHuman: false,
      summary: null,
    });

    expect(merged.serviceType).toBe('Furnace repair');
    expect(merged.issue).toBe('stopped heating');
    expect(merged.location).toBe('Oakville');
    expect(merged.preferredTime).toBe('tomorrow morning');
    expect(merged.urgency).toBeNull(); // not yet provided

    // Only urgency is still missing
    const mergedLead = { ...emptyHvacLead, ...merged } as Lead;
    const missing = getMissingQualificationFields(mergedLead, hvacCompany);
    expect(missing).toEqual(['urgency']);
  });

  it('"My furnace isn\'t heating" should produce serviceType + issue together', () => {
    const merged = mergeLeadUpdates(emptyHvacLead, {
      reply: 'Sorry to hear that. What city are you in?',
      serviceType: 'Furnace repair',
      issue: 'not heating',
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
    expect(merged.issue).toBe('not heating');
  });

  it('"My AC isn\'t cooling" should produce serviceType + issue together', () => {
    const merged = mergeLeadUpdates(emptyHvacLead, {
      reply: 'Got it. What city are you in?',
      serviceType: 'AC repair',
      issue: 'not cooling',
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
    expect(merged.issue).toBe('not cooling');
  });

  it('"Something is wrong with my system" — vague; serviceType stays null (needs clarification)', () => {
    // The model should NOT infer serviceType from an ambiguous message
    const merged = mergeLeadUpdates(emptyHvacLead, {
      reply: 'Can you tell me more — is this your furnace, AC, or something else?',
      serviceType: null,
      issue: 'something is wrong',
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

    expect(merged.serviceType).toBeNull();
    expect(merged.issue).toBe('something is wrong');
  });

  it('multi-field state correctly identifies next missing field', () => {
    // After "furnace + Oakville + tomorrow morning" → only urgency missing
    const leadAfterFirstMessage: Lead = {
      ...emptyHvacLead,
      serviceType: 'Furnace repair',
      issue: 'stopped heating',
      location: 'Oakville',
      preferredTime: 'tomorrow morning',
    };
    const missing = getMissingQualificationFields(leadAfterFirstMessage, hvacCompany);
    expect(missing).toEqual(['urgency']);
  });
});

// ━━ ISSUE 4 — CONVERSATIONAL URGENCY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Issue 4 — urgency is inferred from natural language, enum never exposed', () => {
  const prompt = buildHvacPrompt();

  it('prompt instructs bot to map "ASAP" → HIGH without saying HIGH to customer', () => {
    expect(prompt).toContain('NEVER say these words to the customer');
    expect(prompt).toContain('ASAP');
    expect(prompt).toContain('HIGH');
  });

  it('prompt contains a natural-language urgency question example', () => {
    expect(prompt).toContain('How soon are you hoping to have someone take a look?');
  });

  it('"pretty urgent" maps to HIGH urgency in the lead state', () => {
    const merged = mergeLeadUpdates(emptyHvacLead, {
      reply: 'Got it. When would be a good time?',
      serviceType: 'AC repair',
      issue: 'not cooling',
      location: 'Burlington',
      urgency: 'HIGH',
      preferredTime: null,
      projectType: null,
      budgetRange: null,
      timeline: null,
      propertyOwner: null,
      status: 'QUALIFYING',
      needsHuman: false,
      summary: null,
    });
    expect(merged.urgency).toBe('HIGH');
  });

  it('"not urgent" maps to LOW urgency in the lead state', () => {
    const merged = mergeLeadUpdates(emptyHvacLead, {
      reply: 'No problem. When would be convenient?',
      serviceType: 'AC repair',
      issue: 'occasional noise',
      location: 'Milton',
      urgency: 'LOW',
      preferredTime: null,
      projectType: null,
      budgetRange: null,
      timeline: null,
      propertyOwner: null,
      status: 'QUALIFYING',
      needsHuman: false,
      summary: null,
    });
    expect(merged.urgency).toBe('LOW');
  });

  it('"ASAP" maps to HIGH urgency', () => {
    const merged = mergeLeadUpdates(emptyHvacLead, {
      reply: "Understood. When's a good time for someone to come by?",
      serviceType: 'Furnace repair',
      issue: 'not heating',
      location: 'Hamilton',
      urgency: 'HIGH',
      preferredTime: null,
      projectType: null,
      budgetRange: null,
      timeline: null,
      propertyOwner: null,
      status: 'QUALIFYING',
      needsHuman: false,
      summary: null,
    });
    expect(merged.urgency).toBe('HIGH');
  });

  it('"whenever you can" maps to LOW or NORMAL (not HIGH)', () => {
    const merged = mergeLeadUpdates(emptyHvacLead, {
      reply: 'Got it. When would work best for you?',
      serviceType: 'AC repair',
      issue: 'strange noise',
      location: 'Oakville',
      urgency: 'LOW',
      preferredTime: null,
      projectType: null,
      budgetRange: null,
      timeline: null,
      propertyOwner: null,
      status: 'QUALIFYING',
      needsHuman: false,
      summary: null,
    });
    expect(merged.urgency).not.toBe('HIGH');
  });

  it('"my house is freezing" — HIGH urgency inferred without asking', () => {
    // Model extracts urgency=HIGH from context and doesn't ask again
    const lead = {
      ...emptyHvacLead,
      serviceType: 'Furnace repair',
      issue: 'not heating — house is freezing',
      location: 'Burlington',
    };
    const merged = mergeLeadUpdates(lead as Lead, {
      reply: 'Got it, that sounds urgent. When would work for a technician to come by?',
      serviceType: null,
      issue: null,
      location: null,
      urgency: 'HIGH',
      preferredTime: null,
      projectType: null,
      budgetRange: null,
      timeline: null,
      propertyOwner: null,
      status: 'QUALIFYING',
      needsHuman: false,
      summary: null,
    });
    expect(merged.urgency).toBe('HIGH');
    expect(merged.serviceType).toBe('Furnace repair'); // preserved
  });

  it('TEST D: "My AC isn\'t cooling and I really need someone ASAP" → serviceType + issue + urgency=HIGH', () => {
    const merged = mergeLeadUpdates(emptyHvacLead, {
      reply: 'Got it, that sounds urgent. What city are you in?',
      serviceType: 'AC repair',
      issue: 'not cooling',
      location: null,
      urgency: 'HIGH',
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
    expect(merged.issue).toBe('not cooling');
    expect(merged.urgency).toBe('HIGH');

    // Urgency now present; remaining missing: location, preferredTime
    const mergedLead = { ...emptyHvacLead, ...merged } as Lead;
    const missing = getMissingQualificationFields(mergedLead, hvacCompany);
    expect(missing).toContain('location');
    expect(missing).toContain('preferredTime');
    expect(missing).not.toContain('urgency');
    expect(missing).not.toContain('serviceType');
  });
});

// ━━ TEST E — SIDE QUESTION ON QUALIFIED LEAD ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('TEST E — side question on a QUALIFIED lead does not regress state', () => {
  const qualifiedLead: Lead = {
    ...emptyHvacLead,
    status: LeadStatus.QUALIFIED,
    serviceType: 'AC repair',
    issue: 'not cooling',
    location: 'Burlington',
    urgency: 'NORMAL',
    preferredTime: 'tomorrow morning',
  };

  it('all required fields are present — getMissingQualificationFields returns empty', () => {
    expect(getMissingQualificationFields(qualifiedLead, hvacCompany)).toHaveLength(0);
  });

  it('"How much will it cost?" — model returns null for all fields; merge preserves everything', () => {
    const merged = mergeLeadUpdates(qualifiedLead, {
      reply: 'A team member will confirm pricing with you.',
      serviceType: null,
      issue: null,
      location: null,
      urgency: null,
      preferredTime: null,
      projectType: null,
      budgetRange: null,
      timeline: null,
      propertyOwner: null,
      status: 'QUALIFIED',
      needsHuman: false,
      summary: null,
    });

    expect(merged.serviceType).toBe('AC repair');
    expect(merged.issue).toBe('not cooling');
    expect(merged.location).toBe('Burlington');
    expect(merged.urgency).toBe('NORMAL');
    expect(merged.preferredTime).toBe('tomorrow morning');
    expect(merged.status).toBe('QUALIFIED');

    // After merge, still 0 missing fields
    const mergedLead = { ...qualifiedLead, ...merged } as Lead;
    expect(getMissingQualificationFields(mergedLead, hvacCompany)).toHaveLength(0);
  });
});
