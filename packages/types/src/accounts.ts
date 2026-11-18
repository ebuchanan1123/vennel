export type BusinessRole = 'OWNER' | 'STAFF';
export type BusinessPermission =
  'READ' | 'OPERATIONS' | 'DRAFTS' | 'APPROVALS' | 'CATALOG' | 'SETTINGS' | 'TEAM' | 'INTEGRATIONS';

export function hasBusinessPermission(role: BusinessRole, permission: BusinessPermission): boolean {
  return (
    role === 'OWNER' ||
    permission === 'READ' ||
    permission === 'OPERATIONS' ||
    permission === 'DRAFTS'
  );
}

export type AccountProfile = { id: string; name: string; email: string; emailVerified: boolean };
export type TeamMember = {
  id: string;
  userId: string;
  role: BusinessRole;
  name: string;
  email: string;
  createdAt: string;
};
export type TeamInvitation = {
  id: string;
  email: string;
  role: BusinessRole;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
};
export type TeamWorkspace = { members: TeamMember[]; invitations: TeamInvitation[] };
export const SUPPORTED_CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD'] as const;
export type BusinessCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const INDUSTRY_TEMPLATES = {
  HVAC: {
    label: 'Heating & air conditioning',
    requiredFields: ['serviceType', 'issue', 'location', 'urgency', 'preferredTime'],
    categories: ['Diagnostics', 'Repairs', 'Installation', 'Maintenance'],
  },
  RENOVATION: {
    label: 'Renovation & remodeling',
    requiredFields: [
      'projectType',
      'location',
      'budgetRange',
      'timeline',
      'propertyOwner',
      'preferredTime',
    ],
    categories: ['Consultation', 'Labor', 'Materials', 'Project work'],
  },
} as const;

export type BusinessBillingProfile = {
  email: string | null;
  phone: string | null;
  address: string | null;
  taxRegistrationNumber: string | null;
};

export type OnboardingProfile = {
  id: string;
  name: string;
  slug: string;
  niche: 'HVAC' | 'RENOVATION';
  timeZone: string;
  currency: BusinessCurrency;
  businessEmail: string | null;
  businessPhone: string | null;
  billingAddress: string | null;
  taxRegistrationNumber: string | null;
  defaultTaxRate: number;
  forwardToPhoneNumber: string | null;
  twilioPhoneNumber: string | null;
  serviceAreas: string[];
  step: number;
  completedAt: string | null;
  testedAt: string | null;
  catalogCount: number;
  notificationsEnabled: boolean;
  providerConfigured: boolean;
};

export type OnboardingInput = {
  step: number;
  name: string;
  niche: 'HVAC' | 'RENOVATION';
  timeZone: string;
  currency: BusinessCurrency;
  businessEmail: string | null;
  businessPhone: string | null;
  billingAddress: string | null;
  taxRegistrationNumber: string | null;
  defaultTaxRate: number;
  forwardToPhoneNumber: string | null;
  serviceAreas: string[];
};
export type OnboardingCheck = {
  manualWorkflowReady: boolean;
  liveRecoveryReady: boolean;
  checks: { key: string; label: string; ready: boolean; required: boolean; detail: string }[];
};
