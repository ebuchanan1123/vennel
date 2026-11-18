export * from './billing.js';
export * from './workflows.js';
export * from './time.js';
export * from './accounts.js';

export const NICHES = ['HVAC', 'RENOVATION'] as const;
export type Niche = (typeof NICHES)[number];

export const LEAD_SOURCES = ['MISSED_CALL', 'SMS', 'WEB_FORM'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_STATUSES = [
  'NEW',
  'QUALIFYING',
  'QUALIFIED',
  'NEEDS_HUMAN',
  'BOOKED',
  'CLOSED',
  'DISQUALIFIED',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const MESSAGE_DIRECTIONS = ['INBOUND', 'OUTBOUND'] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const URGENCY_LEVELS = ['LOW', 'NORMAL', 'HIGH'] as const;
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

export const LEAD_OUTCOMES = [
  'UNKNOWN',
  'CONTACTED',
  'ESTIMATE_SENT',
  'BOOKED',
  'WON',
  'LOST',
] as const;
export type LeadOutcome = (typeof LEAD_OUTCOMES)[number];

export const LOST_REASONS = [
  'Price',
  'No response',
  'Went with competitor',
  'Outside service area',
  'Not ready',
  'Other',
] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export type QualificationResult = {
  reply: string;
  serviceType: string | null;
  issue: string | null;
  location: string | null;
  urgency: UrgencyLevel | null;
  preferredTime: string | null;
  projectType: string | null;
  budgetRange: string | null;
  timeline: string | null;
  propertyOwner: boolean | null;
  status: 'QUALIFYING' | 'QUALIFIED' | 'NEEDS_HUMAN';
  needsHuman: boolean;
  summary: string | null;
};
