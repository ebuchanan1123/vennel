import { calculateDocumentTotals, hasTwoDecimals, type ServicePricing } from '@lead-recovery/types';
import { z } from 'zod';

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable();
const money = z
  .number()
  .min(0)
  .max(1000000)
  .refine(hasTwoDecimals, 'Use at most two decimal places.');

export const workspaceParamsSchema = z.object({ companyId: z.string().min(1) });
export const recordParamsSchema = workspaceParamsSchema.extend({ id: z.string().min(1) });

export function normalizeCustomerPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits ? `+${digits}` : '';
}

export const customerBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    phone: nullableText(40)
      .refine(
        (value) => value === null || /^\+?[\d().\-\s]+$/.test(value),
        'Enter a valid phone number.',
      )
      .transform((value) => (value ? normalizeCustomerPhone(value) : null))
      .refine(
        (value) => value === null || /^\+?\d{7,15}$/.test(value),
        'Enter a valid phone number.',
      ),
    email: nullableText(254)
      .transform((value) => value?.toLowerCase() ?? null)
      .refine(
        (value) => value === null || z.string().email().safeParse(value).success,
        'Enter a valid email address.',
      ),
    address: nullableText(500),
    notes: nullableText(3000),
    isArchived: z.boolean().optional(),
  })
  .strict();

export const linkCustomerBodySchema = z
  .object({
    leadId: z.string().min(1),
    customerId: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .refine((value) => value.customerId || value.name, 'Choose a customer or enter a customer name.');

const servicePricingFields = {
  pricingType: z.enum(['FIXED', 'RANGE', 'QUOTE_REQUIRED']).default('FIXED'),
  unitPrice: money.nullable(),
  minPrice: money.nullable().default(null),
  maxPrice: money.nullable().default(null),
};

function validateServicePricing(value: ServicePricing, context: z.RefinementCtx): void {
  const issue = (path: keyof ServicePricing, message: string) =>
    context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (value.pricingType === 'FIXED') {
    if (value.unitPrice === null) issue('unitPrice', 'Enter a fixed price.');
    if (value.minPrice !== null || value.maxPrice !== null)
      issue('pricingType', 'Fixed-price services cannot also contain a price range.');
  } else if (value.pricingType === 'RANGE') {
    if (value.unitPrice !== null)
      issue('unitPrice', 'An estimated range cannot also contain a fixed price.');
    if (value.minPrice === null) issue('minPrice', 'Enter the minimum estimated price.');
    if (value.maxPrice === null) issue('maxPrice', 'Enter the maximum estimated price.');
    if (value.minPrice !== null && value.maxPrice !== null && value.maxPrice < value.minPrice)
      issue('maxPrice', 'The maximum price cannot be less than the minimum price.');
  } else if (value.unitPrice !== null || value.minPrice !== null || value.maxPrice !== null) {
    issue('pricingType', 'Quote-required services must not contain a price.');
  }
}

export const servicePricingSchema = z
  .object(servicePricingFields)
  .strict()
  .superRefine(validateServicePricing);

export const serviceBodySchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: nullableText(2000),
    category: z.string().trim().min(1).max(80),
    unit: z.string().trim().min(1).max(40),
    ...servicePricingFields,
    keywords: z.array(z.string().trim().min(1).max(80)).max(30),
    isActive: z.boolean(),
  })
  .strict()
  .superRefine(validateServicePricing);

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Enter a valid date.');

export const documentBodySchema = z
  .object({
    kind: z.enum(['ESTIMATE', 'INVOICE']),
    title: z.string().trim().min(1).max(160),
    customerId: z.string().min(1).nullable(),
    leadId: z.string().min(1).nullable().optional(),
    notes: nullableText(5000),
    dueDate: dateOnly.nullable(),
    discountAmount: money,
    taxRate: z.number().min(0).max(100).refine(hasTwoDecimals, 'Use at most two decimal places.'),
    items: z
      .array(
        z
          .object({
            serviceId: z.string().min(1).nullable().optional(),
            description: z.string().trim().min(1).max(1000),
            unit: z.string().trim().min(1).max(40).default('job'),
            quantity: z
              .number()
              .min(0.01)
              .max(10000)
              .refine(hasTwoDecimals, 'Use at most two decimal places.'),
            unitPrice: money.nullable(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .superRefine((value, context) => {
    try {
      calculateDocumentTotals(value.items, value.discountAmount, value.taxRate);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      context.addIssue({ code: z.ZodIssueCode.custom, message: error.message, path: ['items'] });
    }
  });

export const documentUpdateSchema = z
  .object({
    revision: z.number().int().positive(),
    document: documentBodySchema,
  })
  .strict();

export const finalizeBodySchema = z
  .object({
    revision: z.number().int().positive(),
    approved: z.literal(true),
  })
  .strict();

export const conversationDraftSchema = z.object({ leadId: z.string().min(1) }).strict();
