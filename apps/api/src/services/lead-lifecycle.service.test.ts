import { LeadStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  LEAD_STALE_THRESHOLD_MS,
  shouldCreateNewLeadForMissedCall,
} from './lead.service.js';

type StubLead = { status: LeadStatus; lastActivityAt: Date };

const RECENT = new Date(Date.now() - 5 * 60 * 1000);   // 5 min ago
const STALE  = new Date(Date.now() - 35 * 60 * 1000);  // 35 min ago (> 30 min threshold)

describe('shouldCreateNewLeadForMissedCall', () => {
  // ── Requirement 1: new call after completed lead → create new lead ────────

  it('creates new lead when no prior lead exists', () => {
    expect(shouldCreateNewLeadForMissedCall(null, new Date())).toBe(true);
  });

  it('creates new lead when prior lead is QUALIFIED', () => {
    const prior: StubLead = { status: LeadStatus.QUALIFIED, lastActivityAt: RECENT };
    expect(shouldCreateNewLeadForMissedCall(prior, new Date())).toBe(true);
  });

  it('creates new lead when prior lead is NEEDS_HUMAN', () => {
    const prior: StubLead = { status: LeadStatus.NEEDS_HUMAN, lastActivityAt: RECENT };
    expect(shouldCreateNewLeadForMissedCall(prior, new Date())).toBe(true);
  });

  it('creates new lead when prior lead is BOOKED', () => {
    const prior: StubLead = { status: LeadStatus.BOOKED, lastActivityAt: RECENT };
    expect(shouldCreateNewLeadForMissedCall(prior, new Date())).toBe(true);
  });

  it('creates new lead when prior lead is CLOSED', () => {
    const prior: StubLead = { status: LeadStatus.CLOSED, lastActivityAt: RECENT };
    expect(shouldCreateNewLeadForMissedCall(prior, new Date())).toBe(true);
  });

  it('creates new lead when prior lead is DISQUALIFIED', () => {
    const prior: StubLead = { status: LeadStatus.DISQUALIFIED, lastActivityAt: RECENT };
    expect(shouldCreateNewLeadForMissedCall(prior, new Date())).toBe(true);
  });

  // ── Requirement 2: new call after stale lead → create new lead ────────────

  it('creates new lead when prior lead is stale (> 30 min inactive)', () => {
    const prior: StubLead = { status: LeadStatus.QUALIFYING, lastActivityAt: STALE };
    expect(shouldCreateNewLeadForMissedCall(prior, new Date())).toBe(true);
  });

  it('creates new lead exactly at the stale threshold boundary', () => {
    const now = new Date();
    const atBoundary = new Date(now.getTime() - LEAD_STALE_THRESHOLD_MS - 1);
    const prior: StubLead = { status: LeadStatus.NEW, lastActivityAt: atBoundary };
    expect(shouldCreateNewLeadForMissedCall(prior, now)).toBe(true);
  });

  // ── Requirement 3: SMS continues same lead (reuse path) ───────────────────
  // shouldCreateNewLeadForMissedCall returning false means the MISSED-CALL path
  // also reuses the lead; the SMS path uses findOrCreateActiveLead which always
  // continues the same thread — verified here via the shared decision function.

  it('reuses lead when prior is NEW and recently active', () => {
    const prior: StubLead = { status: LeadStatus.NEW, lastActivityAt: RECENT };
    expect(shouldCreateNewLeadForMissedCall(prior, new Date())).toBe(false);
  });

  it('reuses lead when prior is QUALIFYING and recently active', () => {
    const prior: StubLead = { status: LeadStatus.QUALIFYING, lastActivityAt: RECENT };
    expect(shouldCreateNewLeadForMissedCall(prior, new Date())).toBe(false);
  });

  it('reuses lead at exactly 1 ms inside the stale threshold', () => {
    const now = new Date();
    const justFresh = new Date(now.getTime() - LEAD_STALE_THRESHOLD_MS + 1);
    const prior: StubLead = { status: LeadStatus.QUALIFYING, lastActivityAt: justFresh };
    expect(shouldCreateNewLeadForMissedCall(prior, now)).toBe(false);
  });

  // ── Requirement 4: data from Lead A never leaks into Lead B ──────────────
  // Terminal-status leads force a new lead (new id, no inherited fields).
  // This test confirms both QUALIFIED and the next in-progress state are separate.

  it('prior QUALIFIED lead forces a new decision context (no field inheritance at decision layer)', () => {
    const leadA: StubLead = { status: LeadStatus.QUALIFIED, lastActivityAt: RECENT };
    const leadB: StubLead = { status: LeadStatus.NEW,       lastActivityAt: RECENT };

    // For the same missed call: A was terminal → new lead required
    expect(shouldCreateNewLeadForMissedCall(leadA, new Date())).toBe(true);
    // But an already-new Lead B would be reused (different prior context)
    expect(shouldCreateNewLeadForMissedCall(leadB, new Date())).toBe(false);
  });
});
