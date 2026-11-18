import { prisma } from '@lead-recovery/database';
import type { CustomerInput, CustomerRecord } from '@lead-recovery/types';
import type { Prisma } from '@prisma/client';

import { HttpError } from '../middleware/error-handler.js';
import { customerBodySchema } from '../schemas/workspace.schema.js';

export const customerInclude = {
  _count: { select: { leads: true, documents: true } },
} satisfies Prisma.CustomerInclude;

type CustomerWithCounts = Prisma.CustomerGetPayload<{ include: typeof customerInclude }>;

export function serializeCustomer(customer: CustomerWithCounts): CustomerRecord {
  const { _count, ...record } = customer;
  return {
    ...record,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
    leadCount: _count.leads,
    documentCount: _count.documents,
  };
}

export async function listCustomers(companyId: string): Promise<CustomerRecord[]> {
  const customers = await prisma.customer.findMany({
    where: { companyId },
    include: customerInclude,
    orderBy: { updatedAt: 'desc' },
  });
  return customers.map(serializeCustomer);
}

export async function createCustomer(
  companyId: string,
  input: CustomerInput,
): Promise<CustomerRecord> {
  const customer = await prisma.customer.create({
    data: { ...customerBodySchema.parse(input), companyId },
    include: customerInclude,
  });
  return serializeCustomer(customer);
}

export async function updateCustomer(
  companyId: string,
  id: string,
  input: CustomerInput,
): Promise<CustomerRecord> {
  const existing = await prisma.customer.findFirst({ where: { id, companyId } });
  if (!existing) throw new HttpError(404, 'Customer not found in this workspace.');
  const customer = await prisma.customer.update({
    where: { id, companyId },
    data: customerBodySchema.parse(input),
    include: customerInclude,
  });
  return serializeCustomer(customer);
}

export async function linkLeadCustomer(
  companyId: string,
  input: { leadId: string; customerId?: string; name?: string },
): Promise<CustomerRecord> {
  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findFirst({ where: { id: input.leadId, companyId } });
    if (!lead) throw new HttpError(404, 'Lead not found in this workspace.');
    if (lead.customerId)
      throw new HttpError(409, 'This lead is already linked to a customer. Refresh to view it.');

    let customer;
    if (input.customerId) {
      customer = await tx.customer.findFirst({
        where: { id: input.customerId, companyId, isArchived: false },
        include: customerInclude,
      });
      if (!customer) throw new HttpError(404, 'Active customer not found in this workspace.');
    } else {
      const data = customerBodySchema.parse({
        name: input.name,
        phone: lead.phone,
        email: null,
        address: lead.location,
        notes: null,
      });
      customer = await tx.customer.create({
        data: { ...data, companyId },
        include: customerInclude,
      });
    }

    const linked = await tx.lead.updateMany({
      where: { id: lead.id, companyId, customerId: null },
      data: { customerId: customer.id },
    });
    if (linked.count !== 1)
      throw new HttpError(409, 'This lead was linked by another action. Please refresh.');
    const updated = await tx.customer.findUniqueOrThrow({
      where: { id: customer.id },
      include: customerInclude,
    });
    return serializeCustomer(updated);
  });
}
