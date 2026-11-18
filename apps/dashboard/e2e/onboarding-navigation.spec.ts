import { expect, test } from '@playwright/test';

import { onboardingRedirect, requiresOnboarding } from '../lib/navigation';

const pending = {
  id: 'pending-business',
  isActive: true,
  role: 'OWNER' as const,
  onboardingStep: 2,
  onboardingCompletedAt: null,
};

test('new accounts start setup and unfinished owners resume their own saved business', () => {
  expect(onboardingRedirect([], '/')).toBe('/onboarding/new');
  expect(onboardingRedirect([], '/onboarding/new')).toBeNull();
  expect(onboardingRedirect([pending], '/')).toBe(
    '/onboarding/pending-business?companyId=pending-business',
  );
  expect(onboardingRedirect([pending], '/services?companyId=pending-business')).toBe(
    '/onboarding/pending-business?companyId=pending-business',
  );
  expect(onboardingRedirect([pending], '/onboarding/pending-business')).toBeNull();
});

test('completed workspaces, invited staff and legacy businesses keep dashboard access', () => {
  expect(requiresOnboarding({ ...pending, onboardingCompletedAt: '2026-11-17T00:00:00Z' })).toBe(
    false,
  );
  expect(
    onboardingRedirect([{ ...pending, onboardingCompletedAt: '2026-11-17T00:00:00Z' }], '/'),
  ).toBeNull();
  expect(onboardingRedirect([{ ...pending, role: 'STAFF' }], '/')).toBeNull();
  expect(onboardingRedirect([{ ...pending, onboardingStep: 0 }], '/')).toBeNull();
});

test('setup routing respects the selected membership and never substitutes another business', () => {
  const staff = { ...pending, id: 'staff-business', role: 'STAFF' as const };
  expect(onboardingRedirect([staff, pending], '/?companyId=pending-business')).toBe(
    '/onboarding/pending-business?companyId=pending-business',
  );
  expect(onboardingRedirect([pending, staff], '/?companyId=staff-business')).toBeNull();
  expect(onboardingRedirect([pending], '/?companyId=foreign-business')).toBeNull();
  expect(onboardingRedirect([{ ...pending, isActive: false }], '/')).toBe('/onboarding/new');
});
