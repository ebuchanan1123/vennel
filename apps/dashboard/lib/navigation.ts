import type { Company } from './api';

type SetupCompany = Pick<
  Company,
  'id' | 'isActive' | 'role' | 'onboardingStep' | 'onboardingCompletedAt'
>;

export function requiresOnboarding(company: SetupCompany): boolean {
  return company.role === 'OWNER' && company.onboardingStep > 0 && !company.onboardingCompletedAt;
}

export function onboardingRedirect(companies: SetupCompany[], path: string): string | null {
  const url = new URL(path, 'http://workspace.local');
  const active = companies.filter((company) => company.isActive);
  if (active.length === 0) return url.pathname === '/onboarding/new' ? null : '/onboarding/new';
  if (url.pathname === '/onboarding' || url.pathname.startsWith('/onboarding/')) return null;
  const selectedId = url.searchParams.get('companyId');
  const company = selectedId ? active.find((entry) => entry.id === selectedId) : active[0];
  return company && requiresOnboarding(company)
    ? workspaceHref(`/onboarding/${company.id}`, company.id)
    : null;
}

export function workspaceHref(
  path: string,
  companyId: string,
  extra: Record<string, string | undefined> = {},
): string {
  const [pathname = '/', query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.set('companyId', companyId);
  for (const [key, value] of Object.entries(extra)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  return `${pathname}?${params.toString()}`;
}
