import { type Company, type Lead, type Message } from '@prisma/client';
import type { QualificationResult } from '../schemas/qualification.schema.js';

import { getMissingQualificationFields } from './qualification-config.service.js';
import { mergeLeadUpdates, type MergedLeadFields } from './lead-merge.service.js';
import { runQualificationModel } from './openai.service.js';
import { HttpError } from '../middleware/error-handler.js';

const QUALIFIED_HANDOFF =
  'Thanks, that gives us what we need. A team member will review this and follow up shortly.';
const HUMAN_HANDOFF = "Thanks - I've added your message for the team to review.";
const qualificationQuestions: Partial<Record<keyof Lead, string>> = {
  serviceType: 'What kind of heating or cooling service do you need?',
  issue: 'What problem are you noticing?',
  location: 'What city or area is the property in?',
  urgency: 'How urgent is this for you?',
  projectType: 'What renovation project are you planning?',
  budgetRange: 'What approximate budget range do you have in mind?',
  timeline: 'When are you hoping to start the project?',
  propertyOwner: 'Do you own the property or have authorization to approve the work?',
};

function qualificationReply(field: keyof Lead, company: Company, latestMessage: string): string {
  const question =
    field === 'preferredTime'
      ? 'When is a good time for a team member to follow up?'
      : qualificationQuestions[field];
  if (!question)
    throw new HttpError(500, `No intake question is configured for ${company.niche}:${field}.`);
  const needsConfirmation =
    /\b(pric[ei]|cost|quote|estimate|available|availability|appointment|book|schedule)\b/i.test(
      latestMessage,
    );
  return `${needsConfirmation ? 'A team member must confirm pricing and availability. ' : ''}${question}`;
}

/**
 * Returns which required fields are still missing after applying the merged
 * update payload on top of the original lead.
 */
function missingAfterMerge(
  original: Lead,
  merged: MergedLeadFields,
  company: Company,
): Array<keyof Lead> {
  const merged_lead = { ...original, ...merged };
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
  merged.needsHuman = params.lead.needsHuman || merged.needsHuman;

  // Determine which required fields are still missing AFTER the merge.
  const stillMissing = missingAfterMerge(params.lead, merged, params.company);

  // Escalation always wins.
  if (merged.needsHuman) {
    return {
      ...modelResult,
      ...merged,
      status: 'NEEDS_HUMAN',
      reply: HUMAN_HANDOFF,
    };
  }

  // Still collecting required fields.
  const nextField = stillMissing[0];
  if (nextField !== undefined) {
    return {
      ...modelResult,
      ...merged,
      status: 'QUALIFYING',
      // Only server-owned text can reach customers; model prose cannot authorize prices or bookings.
      reply: qualificationReply(nextField, params.company, params.latestCustomerMessage),
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
      reply: HUMAN_HANDOFF,
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
