import { prisma } from '@lead-recovery/database';
import type { Company } from '@prisma/client';

export function normalizePhone(value: string): string {
  return value.replace(/[^\d+]/g, '');
}

export async function listCompanies(): Promise<Company[]> {
  return prisma.company.findMany({
    orderBy: { createdAt: 'asc' },
  });
}

export async function getCompanyById(id: string): Promise<Company | null> {
  return prisma.company.findUnique({ where: { id } });
}

export async function getCompanyBySlug(slug: string): Promise<Company | null> {
  return prisma.company.findUnique({ where: { slug } });
}

export async function getCompanyByTwilioNumber(
  phoneNumber: string,
): Promise<(Company & { twilioPhoneNumber: string }) | null> {
  const normalized = normalizePhone(phoneNumber);
  const companies = await prisma.company.findMany({
    where: { isActive: true, twilioPhoneNumber: { not: null } },
  });

  const company = companies.find(
    (entry) => entry.twilioPhoneNumber && normalizePhone(entry.twilioPhoneNumber) === normalized,
  );
  return company?.twilioPhoneNumber
    ? { ...company, twilioPhoneNumber: company.twilioPhoneNumber }
    : null;
}
