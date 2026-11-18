import type { Company, Lead } from '@prisma/client';
import { INDUSTRY_TEMPLATES, type Niche } from '@lead-recovery/types';

export type QualificationConfig = {
  niche: Niche;
  requiredFields: ReadonlyArray<keyof Lead>;
};

export function getQualificationConfig(company: Company): QualificationConfig {
  return { niche: company.niche, requiredFields: INDUSTRY_TEMPLATES[company.niche].requiredFields };
}

/**
 * Returns the list of required fields that are not yet populated on this lead.
 * Only checks fields relevant to the company's niche — e.g. propertyOwner is
 * never flagged as missing for HVAC leads.
 */
export function getMissingQualificationFields(lead: Lead, company: Company): Array<keyof Lead> {
  const { requiredFields } = getQualificationConfig(company);
  return requiredFields.filter((field) => {
    const value = lead[field];
    return value === null || value === undefined || value === '';
  });
}
