import type { DocumentContext, FinalizedDocumentSnapshot } from '@lead-recovery/types';
import { z } from 'zod';

const text = z.string();
const nullableText = text.nullable();
const price = z.object({
  amount: z.number().nullable(),
  currency: nullableText,
  state: z.enum(['UNKNOWN', 'PROPOSED', 'AGREED']),
});
const appointment = z.object({
  text: nullableText,
  startsAt: nullableText,
  state: z.enum(['UNKNOWN', 'TENTATIVE', 'CONFIRMED']),
});
export const businessBillingProfileSchema = z.object({
  email: nullableText, phone: nullableText, address: nullableText, taxRegistrationNumber: nullableText,
});

export const documentContextSchema: z.ZodType<DocumentContext> = z.object({
  version: z.literal(1),
  customer: z
    .object({
      id: text,
      updatedAt: text,
      name: text,
      phone: nullableText,
      email: nullableText,
      address: nullableText,
    })
    .nullable(),
  lead: z
    .object({
      id: text,
      updatedAt: text,
      status: text,
      needsHuman: z.boolean(),
      outcome: text,
      completedAt: nullableText,
    })
    .nullable(),
  notes: z.array(
    z.object({
      id: text,
      revision: z.number().int().positive(),
      reviewedAt: text,
      facts: z.array(z.object({ field: text, value: z.union([text, z.boolean()]) })),
      summary: nullableText,
      price: price.nullable(),
      appointment: appointment.nullable(),
      materials: z.array(text),
    }),
  ),
  messages: z.array(z.object({ id: text, body: text, createdAt: text })),
});

export const finalizedSnapshotSchema: z.ZodType<FinalizedDocumentSnapshot> = z.object({
  billingProfile: businessBillingProfileSchema.nullable().optional(),
  kind: z.enum(['ESTIMATE', 'INVOICE']),
  title: text,
  currency: text,
  notes: nullableText,
  dueDate: nullableText,
  discountAmount: z.number(),
  taxRate: z.number(),
  businessName: text,
  finalizedAt: nullableText,
  number: text.min(1),
  customer: z.object({
    name: text,
    phone: nullableText,
    email: nullableText,
    address: nullableText,
  }),
  items: z
    .array(
      z.object({
        description: text,
        unit: nullableText,
        quantity: z.number(),
        unitPrice: z.number(),
      }),
    )
    .min(1),
});

export const documentPreparationSchema = z
  .object({
    requestId: z.string().uuid(),
    customerId: text.min(1).optional(),
    leadId: text.min(1).optional(),
    callNoteId: text.min(1).optional(),
    kind: z.enum(['ESTIMATE', 'INVOICE']),
    useAi: z.boolean(),
  })
  .strict()
  .superRefine((input, context) => {
    if (!input.customerId && !input.leadId && !input.callNoteId)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Choose a customer, lead, or reviewed call note.',
      });
    if (input.kind === 'INVOICE' && (input.useAi || !input.leadId))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Invoice preparation requires owner-recorded completed work and does not use AI to confirm completion.',
      });
  });

export const documentEmailPreviewSchema = z
  .object({
    revision: z.number().int().positive(),
    recipientEmail: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
  })
  .strict();
export const documentEmailApprovalSchema = documentEmailPreviewSchema
  .extend({
    requestId: z.string().uuid(),
    previewHash: z.string().regex(/^[a-f0-9]{64}$/),
    approved: z.literal(true),
    resendApproved: z.boolean().optional(),
  })
  .strict();
