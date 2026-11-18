import { describe, expect, it } from 'vitest';
import type { Company } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { getQualificationConfig } from './qualification-config.service.js';

const baseCompany = {
  id: 'company_1',
  name: 'Demo',
  slug: 'demo',
  twilioPhoneNumber: '+15550000001',
  forwardToPhoneNumber: '+15550000011',
  serviceAreas: ['Boston'],
  isActive: true,
  nextDocumentNumber: 1,
  timeZone: 'UTC',
  documentEmailEnabled: false,
  documentSenderName: null,
  documentReplyTo: null,
  businessEmail: null,
  businessPhone: null,
  billingAddress: null,
  taxRegistrationNumber: null,
  currency: 'USD',
  defaultTaxRate: new Prisma.Decimal(0),
  onboardingStep: 0,
  onboardingCompletedAt: null,
  onboardingTestedAt: null,
  createRequestKey: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies Omit<Company, 'niche'>;

describe('getQualificationConfig', () => {
  it('returns hvac config for hvac companies', () => {
    const config = getQualificationConfig({ ...baseCompany, niche: 'HVAC' });
    expect(config.requiredFields).toEqual([
      'serviceType',
      'issue',
      'location',
      'urgency',
      'preferredTime',
    ]);
  });

  it('returns renovation config for renovation companies', () => {
    const config = getQualificationConfig({ ...baseCompany, niche: 'RENOVATION' });
    expect(config.requiredFields).toEqual([
      'projectType',
      'location',
      'budgetRange',
      'timeline',
      'propertyOwner',
      'preferredTime',
    ]);
  });
});
