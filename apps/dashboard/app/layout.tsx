import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';

import './globals.css';
import { AppShell } from '../components/app-shell';
import { ApiError, errorMessage, getAccount, type Company } from '../lib/server-api';
import { redirect } from 'next/navigation';
import { getWorkspaceCompanies } from '../lib/workspace';
import { headers } from 'next/headers';
import { onboardingRedirect } from '../lib/navigation';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Lead Recovery | Business workspace', template: '%s | Lead Recovery' },
  description: 'Turn conversations into customers, reviewed estimates, and invoices.',
};

type RootLayoutProps = {
  children: ReactNode;
};

export default async function RootLayout({ children }: RootLayoutProps) {
  const requestHeaders = await headers();
  if (['notifications', 'account'].includes(requestHeaders.get('x-workspace-public-view') ?? '')) {
    return (
      <html lang="en">
        <body className="font-sans antialiased">{children}</body>
      </html>
    );
  }
  let account;
  try {
    account = await getAccount();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect(
        `/login?returnTo=${encodeURIComponent(requestHeaders.get('x-workspace-path') ?? '/')}`,
      );
    if (error instanceof ApiError && error.status === 403) redirect('/verify-email');
    throw error;
  }
  let companies: Company[] = [];
  let connectionError: string | undefined;
  try {
    companies = await getWorkspaceCompanies();
  } catch (error) {
    console.error('Workspace navigation could not connect to the API', error);
    connectionError = errorMessage(error);
  }
  const setupRedirect = connectionError
    ? null
    : onboardingRedirect(companies, requestHeaders.get('x-workspace-path') ?? '/');
  if (setupRedirect) redirect(setupRedirect);
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <Suspense
          fallback={
            <div className="min-h-screen bg-slate-50 p-8 text-sm text-steel">Loading...</div>
          }
        >
          <AppShell companies={companies} connectionError={connectionError} account={account}>
            {children}
          </AppShell>
        </Suspense>
      </body>
    </html>
  );
}
