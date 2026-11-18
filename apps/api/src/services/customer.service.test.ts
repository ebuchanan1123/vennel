import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  lead: { findFirst: vi.fn(), updateMany: vi.fn() },
  customer: { findFirst: vi.fn(), create: vi.fn(), findUniqueOrThrow: vi.fn() },
  transaction: vi.fn(),
}));
vi.mock('@lead-recovery/database', () => ({
  prisma: { lead: mocks.lead, customer: mocks.customer, $transaction: mocks.transaction },
}));

import { linkLeadCustomer } from './customer.service.js';

const customer = {
  id: 'customer-a',
  companyId: 'business-a',
  name: 'Alex',
  phone: '+15551234567',
  email: null,
  address: 'Burlington',
  notes: null,
  isArchived: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  _count: { leads: 1, documents: 0 },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(
    (callback: (db: { lead: typeof mocks.lead; customer: typeof mocks.customer }) => unknown) =>
      callback({ lead: mocks.lead, customer: mocks.customer }),
  );
  mocks.lead.findFirst.mockResolvedValue({
    id: 'lead-a',
    companyId: 'business-a',
    customerId: null,
    phone: '+1 (555) 123-4567',
    location: 'Burlington',
  });
  mocks.lead.updateMany.mockResolvedValue({ count: 1 });
  mocks.customer.findFirst.mockResolvedValue(customer);
  mocks.customer.create.mockResolvedValue(customer);
  mocks.customer.findUniqueOrThrow.mockResolvedValue(customer);
});

describe('owner-confirmed customer links', () => {
  it('requires the lead and customer to be in the selected workspace', async () => {
    mocks.customer.findFirst.mockResolvedValue(null);
    await expect(
      linkLeadCustomer('business-a', { leadId: 'lead-a', customerId: 'customer-b' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'customer-b', companyId: 'business-a', isArchived: false },
      }),
    );
    expect(mocks.lead.updateMany).not.toHaveBeenCalled();
  });

  it('does not silently relink or merge an already-linked lead', async () => {
    mocks.lead.findFirst.mockResolvedValue({ id: 'lead-a', customerId: customer.id });
    await expect(
      linkLeadCustomer('business-a', { leadId: 'lead-a', name: 'New customer' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.customer.create).not.toHaveBeenCalled();
  });

  it('creates a normalized contact only when the owner requests a new customer', async () => {
    const result = await linkLeadCustomer('business-a', { leadId: 'lead-a', name: customer.name });
    expect(result.leadCount).toBe(1);
    expect(mocks.customer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'business-a',
          name: customer.name,
          phone: '+15551234567',
        }),
      }),
    );
  });

  it('checks the unlinked state atomically to prevent conflicting link actions', async () => {
    mocks.lead.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      linkLeadCustomer('business-a', { leadId: 'lead-a', customerId: customer.id }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.lead.updateMany).toHaveBeenCalledWith({
      where: { id: 'lead-a', companyId: 'business-a', customerId: null },
      data: { customerId: customer.id },
    });
  });
});
