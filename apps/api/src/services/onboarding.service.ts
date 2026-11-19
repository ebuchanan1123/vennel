import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@lead-recovery/database';
import {
  hasTwoDecimals,
  isBusinessTimeZone,
  NICHES,
  SUPPORTED_CURRENCIES,
  type OnboardingCheck,
  type OnboardingProfile,
} from '@lead-recovery/types';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { env } from '../env.js';
import { HttpError } from '../middleware/error-handler.js';
import { customerBodySchema } from '../schemas/workspace.schema.js';

const name = z.string().trim().min(1).max(120);
const currency = z.enum(SUPPORTED_CURRENCIES);
const timeZone = z.string().refine(isBusinessTimeZone, 'Choose a valid IANA business time zone.');
export const createBusinessSchema = z
  .object({
    requestId: z.string().uuid(),
    name,
    niche: z.enum(NICHES),
    currency,
    timeZone,
  })
  .strict();
export const onboardingSchema = z
  .object({
    step: z.number().int().min(1).max(8),
    name,
    niche: z.enum(NICHES),
    currency,
    timeZone,
    businessEmail: z.string().trim().email().nullable(),
    businessPhone: customerBodySchema.shape.phone,
    billingAddress: z.string().trim().max(1000).nullable(),
    taxRegistrationNumber: z.string().trim().max(100).nullable(),
    defaultTaxRate: z.number().min(0).max(100).refine(hasTwoDecimals),
    forwardToPhoneNumber: customerBodySchema.shape.phone,
    serviceAreas: z.array(z.string().trim().min(1).max(100)).max(100),
  })
  .strict();
function matchesCreation(
  company: { name: string; niche: string; currency: string; timeZone: string },
  input: z.infer<typeof createBusinessSchema>,
): boolean {
  return (
    company.name === input.name &&
    company.niche === input.niche &&
    company.currency === input.currency &&
    company.timeZone === input.timeZone
  );
}

export async function createBusiness(userId: string, input: z.infer<typeof createBusinessSchema>) {
  const key = createHash('sha256').update(`${userId}:${input.requestId}`).digest('hex');
  const existing = await prisma.company.findUnique({
    where: { createRequestKey: key },
    include: { memberships: { where: { userId } } },
  });
  if (existing) {
    if (!existing.memberships.some((membership) => membership.role === 'OWNER'))
      throw new HttpError(403, 'This business creation request is no longer available.');
    if (!matchesCreation(existing, input))
      throw new HttpError(
        409,
        'This business creation request was already used with different details.',
      );
    return { companyId: existing.id };
  }
  const slug = `${
    input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'business'
  }-${randomUUID().slice(0, 8)}`;
  try {
    const company = await prisma.company.create({
      data: {
        name: input.name,
        slug,
        niche: input.niche,
        currency: input.currency,
        timeZone: input.timeZone,
        serviceAreas: [],
        onboardingStep: 1,
        createRequestKey: key,
        memberships: { create: { userId, role: 'OWNER' } },
        membershipAudits: {
          create: {
            actorId: userId,
            action: 'BUSINESS_CREATED',
            details: { niche: input.niche, currency: input.currency },
          },
        },
      },
      select: { id: true },
    });
    return { companyId: company.id };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
      throw error;
    const repeated = await prisma.company.findFirst({
      where: { createRequestKey: key, memberships: { some: { userId, role: 'OWNER' } } },
      select: { id: true, name: true, niche: true, currency: true, timeZone: true },
    });
    if (!repeated) throw error;
    if (!matchesCreation(repeated, input))
      throw new HttpError(
        409,
        'This business creation request was already used with different details.',
      );
    return { companyId: repeated.id };
  }
}

export async function getOnboarding(companyId: string): Promise<OnboardingProfile> {
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    include: {
      _count: { select: { services: { where: { isActive: true } } } },
      notificationPreferences: true,
    },
  });
  const code = currency.parse(company.currency);
  return {
    id: company.id,
    name: company.name,
    slug: company.slug,
    niche: company.niche,
    timeZone: company.timeZone,
    currency: code,
    businessEmail: company.businessEmail,
    businessPhone: company.businessPhone,
    billingAddress: company.billingAddress,
    taxRegistrationNumber: company.taxRegistrationNumber,
    defaultTaxRate: Number(company.defaultTaxRate),
    forwardToPhoneNumber: company.forwardToPhoneNumber,
    twilioPhoneNumber: company.twilioPhoneNumber,
    serviceAreas: company.serviceAreas,
    step: company.onboardingStep,
    completedAt: company.onboardingCompletedAt?.toISOString() ?? null,
    testedAt: company.onboardingTestedAt?.toISOString() ?? null,
    catalogCount: company._count.services,
    notificationsEnabled: company.notificationPreferences?.enabled ?? false,
    providerConfigured: Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL),
  };
}
export async function updateOnboarding(
  companyId: string,
  userId: string,
  input: z.infer<typeof onboardingSchema>,
): Promise<OnboardingProfile> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${companyId} FOR UPDATE`;
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
    if (company.niche !== input.niche && (await tx.lead.count({ where: { companyId } })) > 0)
      throw new HttpError(
        409,
        'Industry cannot be changed after lead conversations exist. Existing qualification rules have been preserved.',
      );
    if (company.currency !== input.currency) {
      const [services, documents, values] = await Promise.all([
        tx.catalogService.count({ where: { companyId } }),
        tx.billingDocument.count({ where: { companyId } }),
        tx.lead.count({
          where: {
            companyId,
            OR: [{ estimatedValue: { not: null } }, { actualValue: { not: null } }],
          },
        }),
      ]);
      if (services || documents || values)
        throw new HttpError(
          409,
          'Currency cannot be relabelled after prices or documents exist. No amounts have been converted.',
        );
    }
    if (input.step >= 2 && (!input.businessEmail || !input.businessPhone))
      throw new HttpError(400, 'Add a business contact email and phone number.');
    if (input.step >= 7 && !input.billingAddress?.trim())
      throw new HttpError(400, 'Add the business billing address before completing setup.');
    const { step, ...profile } = input;
    await tx.company.update({
      where: { id: companyId },
      data: {
        ...profile,
        businessEmail: input.businessEmail?.toLowerCase() ?? null,
        onboardingStep: Math.max(step, company.onboardingStep),
        onboardingTestedAt: null,
      },
    });
    await tx.businessMembershipAudit.create({
      data: {
        companyId,
        actorId: userId,
        action: 'BUSINESS_PROFILE_UPDATED',
        details: {
          step,
          previousCurrency: company.currency,
          currency: input.currency,
          niche: input.niche,
        },
      },
    });
  });
  return getOnboarding(companyId);
}

class OnboardingDryRun extends Error {}
export async function checkOnboarding(companyId: string): Promise<OnboardingCheck> {
  const profile = await getOnboarding(companyId);
  const worker = await prisma.workerHeartbeat.findFirst({ orderBy: { lastSeenAt: 'desc' } });
  const workerHealthy = Boolean(worker && Date.now() - worker.lastSeenAt.getTime() < 120000);
  const checks: OnboardingCheck['checks'] = [
    {
      key: 'contact',
      label: 'Business contact information',
      ready: Boolean(profile.businessEmail && profile.businessPhone),
      required: true,
      detail: 'Customer-facing contact email and phone are required.',
    },
    {
      key: 'catalog',
      label: 'Business-specific service catalog',
      ready: profile.catalogCount > 0,
      required: true,
      detail:
        'Add at least one active service with a fixed price, an estimated range, or quote-required pricing.',
    },
    {
      key: 'billing',
      label: 'Billing profile',
      ready: Boolean(profile.billingAddress),
      required: true,
      detail: 'Confirm the business address, applicable tax rate and registration details.',
    },
    {
      key: 'phone',
      label: 'Automatic missed-call follow-up',
      ready:
        Boolean(
          profile.twilioPhoneNumber &&
          profile.forwardToPhoneNumber &&
          env.TWILIO_ACCOUNT_SID &&
          env.TWILIO_AUTH_TOKEN,
        ) && workerHealthy,
      required: false,
      detail:
        'Optional: connect a recovery number, choose an answering phone, and keep a durable worker online. This configuration check does not place calls, send texts, or verify live delivery.',
    },
    {
      key: 'email',
      label: 'Owner email notifications',
      ready: profile.providerConfigured && profile.notificationsEnabled,
      required: false,
      detail: 'Optional: configure Resend and explicitly opt in to owner notifications.',
    },
  ];
  try {
    await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: { companyId, name: 'Temporary onboarding dry-run customer' },
      });
      const note = await tx.callNote.create({
        data: {
          companyId,
          customerId: customer.id,
          text: 'Onboarding dry run',
          originalText: 'Onboarding dry run',
          occurredAt: new Date(),
          confirmedFields: [],
        },
      });
      await tx.followUpTask.create({
        data: {
          companyId,
          customerId: customer.id,
          callNoteId: note.id,
          type: 'CUSTOM',
          title: 'Onboarding dry run',
          dueAt: new Date(),
        },
      });
      await tx.billingDocument.create({
        data: {
          companyId,
          customerId: customer.id,
          kind: 'ESTIMATE',
          title: 'Onboarding dry run',
          currency: profile.currency,
        },
      });
      throw new OnboardingDryRun();
    });
  } catch (error) {
    if (!(error instanceof OnboardingDryRun)) throw error;
  }
  checks.push({
    key: 'workflow',
    label: 'Customer / note / follow-up / estimate data flow',
    ready: true,
    required: true,
    detail:
      'A transaction dry run passed and was rolled back. No customer data, messages or documents were retained or sent.',
  });
  const manualWorkflowReady = checks.every((check) => !check.required || check.ready);
  if (manualWorkflowReady)
    await prisma.company.update({
      where: { id: companyId },
      data: { onboardingTestedAt: new Date() },
    });
  return {
    manualWorkflowReady,
    liveRecoveryReady: checks.find((check) => check.key === 'phone')?.ready ?? false,
    checks,
  };
}
export async function completeOnboarding(
  companyId: string,
  userId: string,
): Promise<OnboardingProfile> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  if (!company.onboardingTestedAt)
    throw new HttpError(400, 'Run the workflow readiness check before finishing setup.');
  const checks = await checkOnboarding(companyId);
  if (!checks.manualWorkflowReady)
    throw new HttpError(400, 'Complete the required business, catalog and billing steps first.');
  await prisma.$transaction([
    prisma.company.update({
      where: { id: companyId },
      data: { onboardingStep: 8, onboardingCompletedAt: new Date() },
    }),
    prisma.businessMembershipAudit.create({
      data: {
        companyId,
        actorId: userId,
        action: 'ONBOARDING_COMPLETED',
        details: { liveRecoveryReady: checks.liveRecoveryReady },
      },
    }),
  ]);
  return getOnboarding(companyId);
}
