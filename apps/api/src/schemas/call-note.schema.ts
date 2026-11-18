import {
  CONFIRMATION_FIELDS,
  FOLLOW_UP_TYPES,
  NOTE_FACT_KEYS,
  hasTwoDecimals,
  type CallNoteExtraction,
} from '@lead-recovery/types';
import { z } from 'zod';

import { customerBodySchema } from './workspace.schema.js';

const nullableText = z.string().trim().min(1).max(4000).nullable();
const fact = <T extends z.ZodTypeAny>(value: T) =>
  z.object({ value: value.nullable(), evidence: nullableText }).strict();
const timestamp = z.string().datetime({ offset: true });
const priority = z.enum(['LOW', 'NORMAL', 'HIGH']);

export const extractedFactsSchema = z
  .object({
    customerName: fact(z.string().trim().min(1).max(120)),
    phone: fact(z.string().trim().min(1).max(40)),
    email: fact(z.string().trim().email()),
    serviceType: fact(z.string().trim().min(1).max(500)),
    issue: fact(z.string().trim().min(1).max(2000)),
    location: fact(z.string().trim().min(1).max(500)),
    urgency: fact(priority),
    preferredTime: fact(z.string().trim().min(1).max(500)),
    projectType: fact(z.string().trim().min(1).max(500)),
    budgetRange: fact(z.string().trim().min(1).max(500)),
    timeline: fact(z.string().trim().min(1).max(500)),
    propertyOwner: fact(z.boolean()),
  })
  .strict();

export const suggestedFollowUpSchema = z
  .object({
    type: z.enum(FOLLOW_UP_TYPES),
    title: z.string().trim().min(1).max(160),
    dueAt: timestamp.nullable(),
    dueText: z.string().trim().min(1).max(500).nullable(),
    priority,
    evidence: nullableText,
  })
  .strict();

export const noteExtractionSchema: z.ZodType<CallNoteExtraction> = z
  .object({
    facts: extractedFactsSchema,
    price: z
      .object({
        amount: z.number().min(0).max(99999999.99).refine(hasTwoDecimals).nullable(),
        currency: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .nullable(),
        state: z.enum(['UNKNOWN', 'PROPOSED', 'AGREED']),
        evidence: nullableText,
      })
      .strict(),
    appointment: z
      .object({
        text: nullableText,
        startsAt: timestamp.nullable(),
        state: z.enum(['UNKNOWN', 'TENTATIVE', 'CONFIRMED']),
        evidence: nullableText,
      })
      .strict(),
    materials: z
      .array(
        z
          .object({
            text: z.string().trim().min(1).max(500),
            evidence: z.string().trim().min(1).max(4000),
          })
          .strict(),
      )
      .max(30),
    actions: z.array(suggestedFollowUpSchema).max(10),
    missingInformation: z.array(z.string().trim().min(1).max(500)).max(30),
    summary: z.string().trim().max(4000),
  })
  .strict();

export const callNoteBodySchema = z
  .object({
    customerId: z.string().min(1).nullable(),
    newCustomer: customerBodySchema.optional(),
    leadId: z.string().min(1).nullable(),
    text: z.string().trim().min(1).max(12000),
    direction: z.enum(['INBOUND', 'OUTBOUND']),
    occurredAt: timestamp,
    phone: customerBodySchema.shape.phone,
  })
  .strict()
  .refine(
    (body) => !(body.customerId && body.newCustomer),
    'Select an existing customer or create one, not both.',
  );

export const callNoteUpdateSchema = z
  .object({
    revision: z.number().int().positive(),
    note: callNoteBodySchema,
  })
  .strict();
export const noteRevisionSchema = z.object({ revision: z.number().int().positive() }).strict();
export const archiveNoteSchema = noteRevisionSchema.extend({ isArchived: z.boolean() }).strict();

export const reviewNoteSchema = z
  .object({
    revision: z.number().int().positive(),
    customerId: z.string().min(1).nullable(),
    newCustomer: customerBodySchema.optional(),
    leadId: z.string().min(1).nullable(),
    confirmed: noteExtractionSchema,
    acceptFacts: z.array(z.enum(NOTE_FACT_KEYS)).max(NOTE_FACT_KEYS.length),
    applyFields: z.array(z.enum(CONFIRMATION_FIELDS)).max(CONFIRMATION_FIELDS.length),
    replaceFields: z.array(z.enum(CONFIRMATION_FIELDS)).max(CONFIRMATION_FIELDS.length),
    expectedCustomerUpdatedAt: timestamp.nullable(),
    expectedLeadUpdatedAt: timestamp.nullable(),
    acceptedActions: z
      .array(z.object({ index: z.number().int().min(0).max(9), dueAt: timestamp }).strict())
      .max(10),
  })
  .strict()
  .superRefine((value, context) => {
    if ((!value.customerId && !value.newCustomer) || (value.customerId && value.newCustomer)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customerId'],
        message: 'Choose exactly one customer for the reviewed note.',
      });
    }
    const selections: readonly (readonly (string | number)[])[] = [
      value.acceptFacts,
      value.applyFields,
      value.replaceFields,
      value.acceptedActions.map((action) => action.index),
    ];
    for (const values of selections) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Selections must not contain duplicates.',
        });
      }
    }
  });

export const followUpBodySchema = z
  .object({
    customerId: z.string().min(1),
    leadId: z.string().min(1).nullable(),
    callNoteId: z.string().min(1).nullable().optional(),
    type: z.enum(FOLLOW_UP_TYPES),
    title: z.string().trim().min(1).max(160),
    dueAt: timestamp,
    priority,
    notes: z.string().trim().max(3000).nullable(),
    assignedUserId: z.string().min(1).nullable().optional(),
  })
  .strict();
export const followUpUpdateSchema = z
  .object({
    revision: z.number().int().positive(),
    task: followUpBodySchema,
  })
  .strict();
export const followUpStatusSchema = z
  .object({
    revision: z.number().int().positive(),
    status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED']),
  })
  .strict();
export const acceptSuggestionSchema = z
  .object({
    customerId: z.string().min(1),
    dueAt: timestamp,
    title: z.string().trim().min(1).max(160),
    priority,
    notes: z.string().trim().max(3000).nullable(),
    assignedUserId: z.string().min(1).nullable().optional(),
  })
  .strict();
