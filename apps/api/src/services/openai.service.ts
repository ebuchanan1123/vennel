import OpenAI from 'openai';
import type { Company, Lead, Message } from '@prisma/client';

import { env } from '../env.js';
import { buildHvacPrompt } from '../prompts/hvac.prompt.js';
import { buildRenovationPrompt } from '../prompts/renovation.prompt.js';
import {
  qualificationJsonSchema,
  qualificationResultSchema,
  type QualificationResult,
} from '../schemas/qualification.schema.js';

export const openai = env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      timeout: env.OPENAI_TIMEOUT_MS,
      maxRetries: 0,
    })
  : null;

type RequestParams = {
  company: Company;
  lead: Lead;
  recentMessages: Message[];
  latestCustomerMessage: string;
  missingFields: Array<keyof Lead>;
};

function buildSystemPrompt(company: Company): string {
  const basePrompt = company.niche === 'RENOVATION' ? buildRenovationPrompt() : buildHvacPrompt();

  return [
    basePrompt,
    `Company name: ${company.name}`,
    `Company niche: ${company.niche}`,
    `Service areas: ${company.serviceAreas.join(', ')}`,
    'Respond using the JSON schema exactly.',
  ].join('\n');
}

function buildUserPrompt(params: RequestParams): string {
  const { lead, recentMessages, latestCustomerMessage, missingFields } = params;

  const conversation = recentMessages
    .slice(0, 8)
    .reverse()
    .map((message) => `${message.direction}: ${message.body}`)
    .join('\n');

  // Build the collected-field snapshot — only list non-null values so the
  // model can see exactly what is already known without inferring from nulls.
  const collected: Record<string, unknown> = {};
  const allFields = [
    'serviceType',
    'issue',
    'location',
    'urgency',
    'preferredTime',
    'projectType',
    'budgetRange',
    'timeline',
    'propertyOwner',
  ] as const;
  for (const field of allFields) {
    const v = lead[field as keyof Lead];
    if (v !== null && v !== undefined && v !== '') {
      collected[field] = v;
    }
  }

  const isAlreadyQualified = lead.status === 'QUALIFIED';

  const lines: string[] = [
    `Lead status: ${lead.status}`,
    '',
    'Already collected (DO NOT re-ask for these):',
    Object.keys(collected).length > 0 ? JSON.stringify(collected, null, 2) : '  (none yet)',
    '',
  ];

  if (isAlreadyQualified) {
    lines.push(
      'This lead is FULLY QUALIFIED. All required fields have been collected.',
      "Answer the customer's question helpfully. Do NOT ask for qualification fields again.",
      'Maintain status=QUALIFIED in your response.',
    );
  } else if (missingFields.length === 0) {
    lines.push(
      'All required fields are now present. Set status=QUALIFIED.',
      'Reply with a brief confirmation that a team member will follow up.',
    );
  } else {
    lines.push(
      `Still missing (ask for the NEXT ONE only): ${missingFields.join(', ')}`,
      'Do NOT ask for any field not in the missing list above.',
      'Do NOT ask for fields already in the "Already collected" section.',
    );
  }

  lines.push(
    '',
    'Recent conversation (oldest first):',
    conversation || '  (none)',
    '',
    `Latest customer message: ${latestCustomerMessage}`,
    '',
    'Extract any newly provided field values. Never return null for a field that is already collected.',
  );

  return lines.join('\n');
}

export async function runQualificationModel(params: RequestParams): Promise<QualificationResult> {
  if (!openai) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const response = await openai.responses.create({
    model: env.OPENAI_MODEL,
    max_output_tokens: 1200,
    input: [
      {
        role: 'system',
        content: buildSystemPrompt(params.company),
      },
      {
        role: 'user',
        content: buildUserPrompt(params),
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'lead_qualification_response',
        schema: qualificationJsonSchema,
        strict: true,
      },
    },
  });

  const outputText = response.output_text;
  if (!outputText) {
    throw new Error('OpenAI response did not include output_text');
  }

  const parsed = JSON.parse(outputText) as unknown;
  return qualificationResultSchema.parse(parsed);
}
