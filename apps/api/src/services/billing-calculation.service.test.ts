import { calculateDocumentTotals } from '@lead-recovery/types';
import { describe, expect, it } from 'vitest';

import {
  customerBodySchema,
  documentBodySchema,
  finalizeBodySchema,
} from '../schemas/workspace.schema.js';

describe('document amounts', () => {
  it('applies discount before tax and returns exact monetary fields', () => {
    expect(
      calculateDocumentTotals(
        [
          { quantity: 2, unitPrice: 125.5 },
          { quantity: 1.5, unitPrice: 80 },
        ],
        21,
        13,
      ),
    ).toEqual({ subtotal: 371, discount: 21, tax: 45.5, total: 395.5 });
  });

  it('rounds each extended line to cents rather than rounding the combined subtotal', () => {
    expect(
      calculateDocumentTotals([
        { quantity: 1.5, unitPrice: 0.01 },
        { quantity: 1.5, unitPrice: 0.01 },
      ]),
    ).toEqual({ subtotal: 0.04, discount: 0, tax: 0, total: 0.04 });
  });

  it('does not lose cents at the maximum supported item count and amounts', () => {
    const items = Array.from({ length: 99 }, () => ({ quantity: 10000, unitPrice: 1000000 }));
    items.push({ quantity: 1, unitPrice: 0.01 });
    expect(calculateDocumentTotals(items, 0, 9.99)).toEqual({
      subtotal: 990000000000.01,
      discount: 0,
      tax: 98901000000,
      total: 1088901000000.01,
    });
  });

  it('allows an empty, zero-value draft', () => {
    expect(calculateDocumentTotals([]).total).toBe(0);
  });

  it('withholds totals for unpriced items but preserves explicitly entered free prices', () => {
    expect(
      calculateDocumentTotals(
        [
          { quantity: 1, unitPrice: 125 },
          { quantity: 1, unitPrice: null },
        ],
        10,
        13,
      ),
    ).toBeNull();
    expect(calculateDocumentTotals([{ quantity: 1, unitPrice: 0 }])).toEqual({
      subtotal: 0,
      discount: 0,
      tax: 0,
      total: 0,
    });
    expect(() => calculateDocumentTotals([{ quantity: 0, unitPrice: null }])).toThrow('Quantities');
    expect(() => calculateDocumentTotals([{ quantity: 1, unitPrice: null }], -1)).toThrow(
      'discount',
    );
    expect(() => calculateDocumentTotals([{ quantity: 1, unitPrice: null }], 0, 101)).toThrow(
      'Tax',
    );
  });

  it.each([
    { quantity: 0, unitPrice: 1 },
    { quantity: 10000.01, unitPrice: 1 },
    { quantity: 1.001, unitPrice: 1 },
    { quantity: 1, unitPrice: 0.001 },
    { quantity: 1, unitPrice: -1 },
    { quantity: 1, unitPrice: Infinity },
    { quantity: NaN, unitPrice: 1 },
  ])('rejects invalid line values: %j', (item) => {
    expect(() => calculateDocumentTotals([item])).toThrow(RangeError);
  });

  it('rejects discounts above subtotal, invalid tax and more than 100 items', () => {
    expect(() => calculateDocumentTotals([{ quantity: 1, unitPrice: 5 }], 5.01)).toThrow(
      'discount cannot exceed',
    );
    expect(() => calculateDocumentTotals([], 0, 100.01)).toThrow('Tax must');
    expect(() =>
      calculateDocumentTotals(Array.from({ length: 101 }, () => ({ quantity: 1, unitPrice: 1 }))),
    ).toThrow('at most 100');
  });
});

describe('workspace input validation', () => {
  const customer = {
    name: ' Alex Morgan ',
    phone: '+1 (555) 123-4567',
    email: 'Alex@Example.com',
    address: '',
    notes: null,
  };
  const document = {
    kind: 'ESTIMATE',
    title: 'Service estimate',
    customerId: null,
    notes: null,
    dueDate: null,
    discountAmount: 0,
    taxRate: 0,
    items: [{ description: 'Diagnostic visit', quantity: 1, unitPrice: 125 }],
  };

  it('normalizes phone and email for workspace-specific duplicate prevention', () => {
    const parsed = customerBodySchema.parse(customer);
    expect(parsed).toMatchObject({
      name: 'Alex Morgan',
      phone: '+15551234567',
      email: 'alex@example.com',
      address: null,
    });
    expect(customerBodySchema.parse({ ...customer, phone: '15551234567' }).phone).toBe(
      parsed.phone,
    );
  });

  it('does not silently strip letters from an invalid phone number', () => {
    expect(customerBodySchema.safeParse({ ...customer, phone: 'abc15551234567' }).success).toBe(
      false,
    );
  });

  it('rejects invalid calendar dates and sub-cent prices', () => {
    expect(documentBodySchema.safeParse({ ...document, dueDate: '2026-02-30' }).success).toBe(
      false,
    );
    expect(
      documentBodySchema.safeParse({
        ...document,
        items: [{ description: 'Service', quantity: 1, unitPrice: 0.001 }],
      }).success,
    ).toBe(false);
    expect(documentBodySchema.safeParse({ ...document, discountAmount: 126 }).success).toBe(false);
  });

  it('requires explicit approval and a revision to finalize', () => {
    expect(finalizeBodySchema.safeParse({ revision: 1, approved: true }).success).toBe(true);
    expect(finalizeBodySchema.safeParse({ revision: 1, approved: false }).success).toBe(false);
    expect(finalizeBodySchema.safeParse({ revision: 1 }).success).toBe(false);
    expect(finalizeBodySchema.safeParse({ revision: 0, approved: true }).success).toBe(false);
  });

  it('allows an explicit missing draft price, not missing fields or non-numeric price text', () => {
    const item = { description: 'Custom work', quantity: 1, unitPrice: null };
    expect(documentBodySchema.parse({ ...document, items: [item] }).items[0]?.unitPrice).toBeNull();
    expect(
      documentBodySchema.safeParse({
        ...document,
        items: [{ description: 'Custom work', quantity: 1 }],
      }).success,
    ).toBe(false);
    expect(
      documentBodySchema.safeParse({ ...document, items: [{ ...item, unitPrice: 'N/A' }] }).success,
    ).toBe(false);
  });
});
