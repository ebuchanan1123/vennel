import { type Company, type Lead, type Message } from '@prisma/client';
import type { QualificationResult } from '../schemas/qualification.schema.js';

import { getMissingQualificationFields } from './qualification-config.service.js';
import { mergeLeadUpdates, type MergedLeadFields } from './lead-merge.service.js';
import { runQualificationModel } from './openai.service.js';

const QUALIFIED_HANDOFF =
  'Thanks, that gives us what we need. A team member will review this and follow up shortly.';

/**
 * Returns which required fields are still missing after applying the merged
 * update payload on top of the original lead.
 */
function missingAfterMerge(
  original: Lead,
  merged: MergedLeadFields,
  company: Company,
): Array<keyof Lead> {
  const merged_lead = { ...original, ...merged } as Lead;
  return getMissingQualificationFields(merged_lead, company);
}

export async function generateQualificationResponse(params: {
  company: Company;
  lead: Lead;
  latestCustomerMessage: string;
  recentMessages: Message[];
}): Promise<QualificationResult> {
  // Compute which fields are still needed BEFORE calling the model so we can
  // include that context in the prompt (see openai.service buildUserPrompt).
  const missingFields = getMissingQualificationFields(params.lead, params.company);

  const modelResult = await runQualificationModel({ ...params, missingFields });

  // Merge: existing non-null values are NEVER overwritten by model nulls.
  const merged = mergeLeadUpdates(params.lead, modelResult);

  // Determine which required fields are still missing AFTER the merge.
  const stillMissing = missingAfterMerge(params.lead, merged, params.company);

  // Escalation always wins.
  if (merged.needsHuman) {
    return {
      ...modelResult,
      ...merged,
      status: 'NEEDS_HUMAN',
    };
  }

  // Still collecting required fields.
  if (stillMissing.length > 0) {
    return {
      ...modelResult,
      ...merged,
      status: 'QUALIFYING',
    };
  }

  // All required fields now present.
  // If the lead was ALREADY qualified, continue the conversation without
  // re-issuing the handoff message (requirement 6: no regression, no repeat).
  if (params.lead.status === 'QUALIFIED') {
    return {
      ...modelResult,
      ...merged,
      status: 'QUALIFIED',
    };
  }

  // Transitioning to QUALIFIED for the first time: replace whatever reply the
  // model generated (which might still contain bonus questions) with the
  // canonical handoff so the customer gets a clean close-out.
  return {
    ...modelResult,
    ...merged,
    status: 'QUALIFIED',
    reply: QUALIFIED_HANDOFF,
  };
}
