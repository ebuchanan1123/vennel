import { z } from 'zod';

export const qualificationResultSchema = z.object({
  reply: z.string().min(1),
  serviceType: z.string().nullable(),
  issue: z.string().nullable(),
  location: z.string().nullable(),
  urgency: z.enum(['LOW', 'NORMAL', 'HIGH']).nullable(),
  preferredTime: z.string().nullable(),
  projectType: z.string().nullable(),
  budgetRange: z.string().nullable(),
  timeline: z.string().nullable(),
  propertyOwner: z.boolean().nullable(),
  status: z.enum(['QUALIFYING', 'QUALIFIED', 'NEEDS_HUMAN']),
  needsHuman: z.boolean(),
  summary: z.string().nullable(),
});

export const qualificationJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reply: { type: 'string' },
    serviceType: { type: ['string', 'null'] },
    issue: { type: ['string', 'null'] },
    location: { type: ['string', 'null'] },
    urgency: { type: ['string', 'null'], enum: ['LOW', 'NORMAL', 'HIGH', null] },
    preferredTime: { type: ['string', 'null'] },
    projectType: { type: ['string', 'null'] },
    budgetRange: { type: ['string', 'null'] },
    timeline: { type: ['string', 'null'] },
    propertyOwner: { type: ['boolean', 'null'] },
    status: { type: 'string', enum: ['QUALIFYING', 'QUALIFIED', 'NEEDS_HUMAN'] },
    needsHuman: { type: 'boolean' },
    summary: { type: ['string', 'null'] },
  },
  required: [
    'reply',
    'serviceType',
    'issue',
    'location',
    'urgency',
    'preferredTime',
    'projectType',
    'budgetRange',
    'timeline',
    'propertyOwner',
    'status',
    'needsHuman',
    'summary',
  ],
} as const;

export type QualificationResult = z.infer<typeof qualificationResultSchema>;
