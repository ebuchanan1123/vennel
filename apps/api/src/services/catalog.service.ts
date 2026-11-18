import { prisma } from '@lead-recovery/database';
import type {
  CatalogService as ServiceRecord,
  ServiceInput,
  ServicePricing,
} from '@lead-recovery/types';
import type { CatalogService } from '@prisma/client';

import { HttpError } from '../middleware/error-handler.js';
import { servicePricingSchema } from '../schemas/workspace.schema.js';

export function serializeServicePricing(
  service: Pick<CatalogService, 'pricingType' | 'unitPrice' | 'minPrice' | 'maxPrice'>,
): ServicePricing {
  return servicePricingSchema.parse({
    pricingType: service.pricingType,
    unitPrice: service.unitPrice === null ? null : Number(service.unitPrice),
    minPrice: service.minPrice === null ? null : Number(service.minPrice),
    maxPrice: service.maxPrice === null ? null : Number(service.maxPrice),
  });
}

export function serializeService(service: CatalogService): ServiceRecord {
  return {
    ...service,
    ...serializeServicePricing(service),
    createdAt: service.createdAt.toISOString(),
    updatedAt: service.updatedAt.toISOString(),
  };
}

export async function listServices(companyId: string): Promise<ServiceRecord[]> {
  const services = await prisma.catalogService.findMany({
    where: { companyId },
    orderBy: [{ isActive: 'desc' }, { category: 'asc' }, { name: 'asc' }],
  });
  return services.map(serializeService);
}

export async function createService(
  companyId: string,
  input: ServiceInput,
): Promise<ServiceRecord> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${companyId} FOR UPDATE`;
    return serializeService(await tx.catalogService.create({ data: { ...input, companyId } }));
  });
}

export async function updateService(
  companyId: string,
  id: string,
  input: ServiceInput,
): Promise<ServiceRecord> {
  const existing = await prisma.catalogService.findFirst({ where: { id, companyId } });
  if (!existing) throw new HttpError(404, 'Service not found in this workspace.');
  return serializeService(
    await prisma.catalogService.update({ where: { id, companyId }, data: input }),
  );
}
