import type { Lead } from '@prisma/client';
import type { QualificationResult } from '../schemas/qualification.schema.js';

export type MergedLeadFields = {
  status: QualificationResult['status'];
  needsHuman: boolean;
  serviceType: string | null;
  issue: string | null;
  location: string | null;
  urgency: Lead['urgency'];
  preferredTime: string | null;
  projectType: string | null;
  budgetRange: string | null;
  timeline: string | null;
  propertyOwner: boolean | null;
  summary: string | null;
};

/**
 * Returns the incoming value when it is non-null/non-undefined;
 * otherwise keeps the existing value.
 *
 * This ensures model outputs that return null for a field (because the
 * customer didn't re-state it in this turn) never erase data that was
 * already captured in a previous turn.
 */
function keepExistingIfNull<T>(existing: T, incoming: T): T {
  return incoming ?? existing;
}

/**
 * Merges model-extracted field values onto the current persisted lead.
 *
 * Rule: a non-null value from the model wins; a null/undefined value from
 * the model keeps whatever was already stored.
 *
 * Example:
 *   existing:  serviceType="Furnace repair", location="Burlington"
 *   incoming:  serviceType=null, location=null, urgency="HIGH"
 *   result:    serviceType="Furnace repair", location="Burlington", urgency="HIGH"
 */
export function mergeLeadUpdates(current: Lead, incoming: QualificationResult): MergedLeadFields {
  return {
    status: incoming.status,
    needsHuman: incoming.needsHuman,
    serviceType:   keepExistingIfNull(current.serviceType,   incoming.serviceType),
    issue:         keepExistingIfNull(current.issue,         incoming.issue),
    location:      keepExistingIfNull(current.location,      incoming.location),
    urgency:       keepExistingIfNull(current.urgency,       incoming.urgency),
    preferredTime: keepExistingIfNull(current.preferredTime, incoming.preferredTime),
    projectType:   keepExistingIfNull(current.projectType,   incoming.projectType),
    budgetRange:   keepExistingIfNull(current.budgetRange,   incoming.budgetRange),
    timeline:      keepExistingIfNull(current.timeline,      incoming.timeline),
    propertyOwner: keepExistingIfNull(current.propertyOwner, incoming.propertyOwner),
    summary:       keepExistingIfNull(current.summary,       incoming.summary),
  };
}

/** @deprecated Use mergeLeadUpdates instead. */
export const mergeLeadQualification = mergeLeadUpdates;
