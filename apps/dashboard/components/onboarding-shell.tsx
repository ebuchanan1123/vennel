'use client';

import type { ReactNode } from 'react';

import { Icon } from './icon';

export function OnboardingShell({
  children,
  accountName,
  exitHref,
  connectionError,
  signingOut,
  signOutError,
  onSignOut,
}: {
  children: ReactNode;
  accountName: string;
  exitHref?: string;
  connectionError?: string;
  signingOut: boolean;
  signOutError: string;
  onSignOut: () => Promise<void>;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <a href="#main-content" className="skip-link">
        Skip to setup
      </a>
      <header className="border-b border-slate-200/80 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <div className="flex items-center gap-3">
            <span className="brand-mark">
              <Icon name="trend" width={23} height={23} />
            </span>
            <span className="text-lg font-semibold tracking-tight text-ink">
              Lead<span className="text-ember">Recovery</span>
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs">
            {exitHref && (
              <a href={exitHref} className="font-medium text-ember">
                Back to workspace
              </a>
            )}
            <span className="hidden max-w-40 truncate text-steel sm:block">{accountName}</span>
            <button
              type="button"
              className="font-medium text-steel"
              onClick={onSignOut}
              disabled={signingOut}
            >
              {signingOut ? 'Signing out...' : 'Sign out'}
            </button>
          </div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="flex-1 px-5 py-8 sm:px-8 sm:py-12">
        {connectionError && (
          <p
            role="alert"
            className="mx-auto mb-6 max-w-3xl rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
          >
            {connectionError}
          </p>
        )}
        {signOutError && (
          <p
            role="alert"
            className="mx-auto mb-6 max-w-3xl rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
          >
            {signOutError}
          </p>
        )}
        {children}
      </main>
    </div>
  );
}
