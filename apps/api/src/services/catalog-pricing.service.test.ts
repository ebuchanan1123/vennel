import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  catalogService: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  transaction: vi.fn(),
}));
vi.mock('@lead-recovery/database', () => ({
  prisma: {
    $transaction: mocks.transaction,
    catalogService: mocks.catalogService,
  },
}));

import { serviceBodySchema } from '../schemas/workspace.schema.js';
import { createService, serializeService, updateService } from './catalog.service.js';

const input = {
  name: 'Inspection',
  description: null,
  category: 'Diagnostics',
  unit: 'visit',
  unitPrice: 125,
  keywords: [],
  isActive: true,
};
const date = new Date('2026-11-17T00:00:00Z');
const stored = {
  ...serviceBodySchema.parse(input),
  id: 'service-a',
  companyId: 'business-a',
  unitPrice: new Prisma.Decimal(125),
  minPrice: null,
  maxPrice: null,
  createdAt: date,
  updatedAt: date,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation((callback: (db: typeof mocks) => unknown) =>
    callback(mocks),
  );
});

describe('catalog pricing modes', () => {
  it('keeps legacy fixed-price requests and explicitly free services unchanged', () => {
    expect(serviceBodySchema.parse(input)).toMatchObject({
      pricingType: 'FIXED',
      unitPrice: 125,
      minPrice: null,
      maxPrice: null,
    });
    expect(serializeService(stored).unitPrice).toBe(125);
    expect(serializeService({ ...stored, unitPrice: new Prisma.Decimal(0) }).unitPrice).toBe(0);
  });

  it('stores ranges and quote-required prices as null rather than zero', async () => {
    const range = serviceBodySchema.parse({
      ...input,
      pricingType: 'RANGE',
      unitPrice: null,
      minPrice: 500,
      maxPrice: 1500,
    });
    mocks.catalogService.create.mockResolvedValue({
      ...stored,
      ...range,
      minPrice: new Prisma.Decimal(500),
      maxPrice: new Prisma.Decimal(1500),
    });
    expect(await createService('business-a', range)).toMatchObject(range);
    expect(mocks.catalogService.create).toHaveBeenCalledWith({
      data: { ...range, companyId: 'business-a' },
    });

    const quote = serviceBodySchema.parse({
      ...input,
      pricingType: 'QUOTE_REQUIRED',
      unitPrice: null,
    });
    mocks.catalogService.findFirst.mockResolvedValue(stored);
    mocks.catalogService.update.mockResolvedValue({ ...stored, ...quote });
    expect(await updateService('business-a', stored.id, quote)).toMatchObject({
      pricingType: 'QUOTE_REQUIRED',
      unitPrice: null,
      minPrice: null,
      maxPrice: null,
    });
    expect(mocks.catalogService.update).toHaveBeenCalledWith({
      where: { id: stored.id, companyId: 'business-a' },
      data: quote,
    });
  });

  it.each([
    { pricingType: 'FIXED', unitPrice: null },
    { pricingType: 'FIXED', unitPrice: -1 },
    { pricingType: 'FIXED', unitPrice: 0.001 },
    { pricingType: 'FIXED', minPrice: 50, maxPrice: 100 },
    { pricingType: 'RANGE', unitPrice: null, minPrice: 100, maxPrice: 50 },
    { pricingType: 'RANGE', unitPrice: null, minPrice: null, maxPrice: 100 },
    { pricingType: 'RANGE', unitPrice: null, minPrice: 50, maxPrice: null },
    { pricingType: 'RANGE', unitPrice: null, minPrice: -1, maxPrice: 100 },
    { pricingType: 'RANGE', unitPrice: null, minPrice: 50, maxPrice: 1000001 },
    { pricingType: 'RANGE', unitPrice: null, minPrice: 0.001, maxPrice: 100 },
    { pricingType: 'RANGE', unitPrice: 75, minPrice: 50, maxPrice: 100 },
    { pricingType: 'QUOTE_REQUIRED', unitPrice: 0 },
    { pricingType: 'QUOTE_REQUIRED', unitPrice: null, minPrice: 50, maxPrice: 100 },
    { pricingType: 'N/A', unitPrice: null },
  ])('rejects invalid or mixed pricing fields: %j', (pricing) => {
    expect(serviceBodySchema.safeParse({ ...input, ...pricing }).success).toBe(false);
  });

  it('does not edit services outside the selected business', async () => {
    mocks.catalogService.findFirst.mockResolvedValue(null);
    await expect(
      updateService('business-b', stored.id, serviceBodySchema.parse(input)),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.catalogService.update).not.toHaveBeenCalled();
  });
});
