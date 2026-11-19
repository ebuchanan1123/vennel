'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { Company } from '../lib/api';
import { initials } from '../lib/format';
import { onboardingRedirect, requiresOnboarding, workspaceHref } from '../lib/navigation';
import { Icon, type IconName } from './icon';
import type { AccountProfile } from '@lead-recovery/types';
import { authClient } from '../lib/auth-client';
import { BusinessAccessProvider } from './business-access';
import { OnboardingShell } from './onboarding-shell';

const navigation: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Overview', icon: 'grid' },
  { href: '/leads', label: 'Lead inbox', icon: 'leads' },
  { href: '/call-notes', label: 'Call notes', icon: 'note' },
  { href: '/follow-ups', label: 'Follow-ups', icon: 'calendar' },
  { href: '/customers', label: 'Customers', icon: 'users' },
  { href: '/services', label: 'Services & pricing', icon: 'services' },
  { href: '/billing', label: 'Estimates & invoices', icon: 'document' },
];

export function AppShell({
  children,
  companies,
  connectionError,
  account,
}: {
  children: ReactNode;
  companies: Company[];
  connectionError?: string;
  account: AccountProfile;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const { data: session, isPending: checkingSession } = authClient.useSession();
  useEffect(() => {
    if (!checkingSession && !session)
      globalThis.location.replace(
        `/login?returnTo=${encodeURIComponent(`${globalThis.location.pathname}${globalThis.location.search}`)}`,
      );
  }, [checkingSession, session]);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const activeCompanies = companies.filter((company) => company.isActive);
  const inOnboarding = pathname === '/onboarding' || pathname.startsWith('/onboarding/');
  const setupCompanyId = inOnboarding ? pathname.split('/')[2] : undefined;
  const selectedId =
    setupCompanyId && setupCompanyId !== 'new' ? setupCompanyId : searchParams.get('companyId');
  const company =
    setupCompanyId === 'new'
      ? undefined
      : selectedId
        ? activeCompanies.find((entry) => entry.id === selectedId)
        : activeCompanies[0];
  const activePage = navigation.find((item) =>
    item.href === '/' ? pathname === '/' : pathname.startsWith(item.href),
  );
  const href = (path: string) => (company ? workspaceHref(path, company.id) : path);
  const setupRedirect = connectionError
    ? null
    : onboardingRedirect(companies, `${pathname}?${searchParams.toString()}`);
  useEffect(() => {
    if (setupRedirect) globalThis.location.replace(setupRedirect);
  }, [setupRedirect]);

  useEffect(() => {
    if (!menuOpen) return;
    closeButtonRef.current?.focus();
    const previousOverflow = globalThis.document.body.style.overflow;
    globalThis.document.body.style.overflow = 'hidden';
    const desktop = globalThis.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setMenuOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = sidebarRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), select:not([disabled])',
      );
      const first = controls?.item(0);
      const last = controls?.item(controls.length - 1);
      const active = globalThis.document.activeElement;
      if (event.shiftKey && active === first && last) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last && first) {
        event.preventDefault();
        first.focus();
      }
    };
    globalThis.addEventListener('keydown', handleKey);
    desktop.addEventListener('change', closeOnDesktop);
    return () => {
      globalThis.document.body.style.overflow = previousOverflow;
      globalThis.removeEventListener('keydown', handleKey);
      desktop.removeEventListener('change', closeOnDesktop);
      menuButtonRef.current?.focus();
    };
  }, [menuOpen]);

  async function signOut() {
    setSigningOut(true);
    setSignOutError('');
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message ?? 'Sign-out failed.');
      globalThis.location.assign('/login');
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'Sign-out failed.');
      setSigningOut(false);
    }
  }

  if (setupRedirect)
    return (
      <p role="status" className="min-h-screen bg-slate-50 p-8 text-sm text-steel">
        Resuming your business setup...
      </p>
    );

  if (inOnboarding) {
    const workspace = activeCompanies.find((entry) => !requiresOnboarding(entry));
    return (
      <BusinessAccessProvider account={account} company={company}>
        <OnboardingShell
          accountName={account.name}
          exitHref={workspace ? workspaceHref('/', workspace.id) : undefined}
          connectionError={connectionError}
          signingOut={signingOut}
          signOutError={signOutError}
          onSignOut={signOut}
        >
          {children}
        </OnboardingShell>
      </BusinessAccessProvider>
    );
  }

  return (
    <BusinessAccessProvider account={account} company={company}>
      <div className="workspace-frame">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        {menuOpen && (
          <button
            className="mobile-backdrop"
            onClick={() => setMenuOpen(false)}
            aria-label="Close navigation"
          />
        )}
        <aside
          ref={sidebarRef}
          id="workspace-navigation"
          role={menuOpen ? 'dialog' : undefined}
          aria-modal={menuOpen ? true : undefined}
          aria-label={menuOpen ? 'Workspace navigation' : undefined}
          className={`app-sidebar ${menuOpen ? 'is-open' : ''}`}
        >
          <div className="flex items-center justify-between px-6 pb-7 pt-7">
            <Link
              href={href('/')}
              className="flex items-center gap-3"
              onClick={() => setMenuOpen(false)}
              aria-label="Lead Recovery overview"
            >
              <div className="brand-mark">
                <Icon name="trend" width={23} height={23} />
              </div>
              <span className="text-lg font-semibold tracking-tight text-ink">
                Lead<span className="text-ember">Recovery</span>
              </span>
            </Link>
            <button
              ref={closeButtonRef}
              className="btn-icon lg:hidden"
              onClick={() => setMenuOpen(false)}
              aria-label="Close navigation"
            >
              <Icon name="close" />
            </button>
          </div>

          <div className="mx-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <label
              htmlFor="workspace-selector"
              className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-steel"
            >
              Business workspace
            </label>
            <select
              id="workspace-selector"
              value={company?.id ?? ''}
              disabled={activeCompanies.length === 0}
              onChange={(event) => {
                // Discard cached client state and permissions from the previous workspace.
                globalThis.location.assign(workspaceHref('/', event.target.value));
                setMenuOpen(false);
              }}
              className="w-full min-w-0 cursor-pointer bg-transparent text-sm font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {!company && <option value="">No workspace selected</option>}
              {activeCompanies.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </div>

          <p className="mb-2 mt-7 px-7 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Workspace
          </p>
          <nav aria-label="Main navigation" className="space-y-1 px-4">
            {navigation.map((item) => {
              const active = item === activePage;
              return (
                <Link
                  key={item.href}
                  href={href(item.href)}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setMenuOpen(false)}
                  className={`sidebar-link ${active ? 'is-active' : ''}`}
                >
                  <Icon name={item.icon} width={19} height={19} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
          {company?.role === 'OWNER' && (
            <nav aria-label="Owner navigation" className="mt-4 space-y-1 px-4">
              <Link
                className={`sidebar-link ${pathname.startsWith('/team') ? 'is-active' : ''}`}
                href={href('/team')}
                onClick={() => setMenuOpen(false)}
              >
                <Icon name="users" width={19} height={19} />
                Team &amp; access
              </Link>
              <Link
                className="sidebar-link"
                href={href(`/onboarding/${company.id}`)}
                onClick={() => setMenuOpen(false)}
              >
                <Icon name="services" width={19} height={19} />
                Business setup
              </Link>
            </nav>
          )}
          <Link
            className="mx-7 mt-4 text-xs font-medium text-ember"
            href="/onboarding/new"
            onClick={() => setMenuOpen(false)}
          >
            + Create business
          </Link>

          <div className="mt-auto px-4 pb-5 pt-8">
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
              <Icon name="sparkles" className="text-ember" width={20} height={20} />
              <p className="mt-3 text-xs font-semibold text-ink">Your expertise. Less admin.</p>
              <p className="mt-1.5 text-xs leading-relaxed text-steel">
                Add your services. Turn customer conversations into reviewed estimates.
              </p>
              <Link
                href={href('/services')}
                className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-ember"
                onClick={() => setMenuOpen(false)}
              >
                {company?.role === 'OWNER' ? 'Manage catalog' : 'View catalog'}{' '}
                <Icon name="arrow" width={14} height={14} />
              </Link>
            </div>
            <div className="mt-5 flex items-center gap-3 px-2">
              <span className="avatar h-9 w-9 text-xs">{initials(account.name)}</span>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-ink">{account.name}</p>
                <p className="mt-0.5 text-[11px] text-steel">
                  {company?.role === 'OWNER'
                    ? 'Business owner'
                    : company
                      ? 'Staff member'
                      : 'Verified account'}
                </p>
                {company?.role === 'OWNER' && (
                  <Link
                    href={href('/settings')}
                    className="mt-1 block text-[11px] font-medium text-ember"
                    onClick={() => setMenuOpen(false)}
                  >
                    Workspace settings
                  </Link>
                )}
                <button
                  type="button"
                  className="mt-2 text-[11px] font-medium text-steel"
                  disabled={signingOut}
                  onClick={signOut}
                >
                  {signingOut ? 'Signing out...' : 'Sign out'}
                </button>
                {signOutError && (
                  <p role="alert" className="mt-2 text-[10px] text-rose-700">
                    {signOutError}
                  </p>
                )}
              </div>
            </div>
          </div>
        </aside>

        <div className="workspace-main">
          <header className="app-topbar no-print">
            <div className="flex items-center gap-3">
              <button
                ref={menuButtonRef}
                type="button"
                className="btn-icon lg:hidden"
                aria-label="Open navigation"
                aria-expanded={menuOpen}
                aria-controls="workspace-navigation"
                onClick={() => setMenuOpen(true)}
              >
                <Icon name="menu" />
              </button>
              <span className="hidden text-sm text-slate-400 sm:inline">Workspace</span>
              <span className="hidden text-slate-300 sm:inline">/</span>
              <span className="min-w-0 truncate text-sm font-medium text-slate-600">
                {activePage?.label ?? (pathname.startsWith('/settings') ? 'Settings' : 'Workspace')}
              </span>
            </div>
            <div className="flex items-center gap-4">
              {company && (
                <Link
                  href={href('/call-notes/new')}
                  className="btn-primary min-h-9 px-3 py-2 text-xs"
                >
                  <Icon name="plus" width={14} height={14} />
                  <span>Add call note</span>
                </Link>
              )}
              <span
                className={`hidden items-center gap-2 text-xs font-medium sm:inline-flex ${connectionError ? 'text-rose-600' : 'text-steel'}`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${connectionError ? 'bg-rose-500' : 'bg-emerald-500'}`}
                />
                {connectionError ? 'API unavailable' : 'Connected'}
              </span>
              <span className="hidden rounded-full border border-slate-200 px-3 py-1.5 text-[11px] font-medium text-steel xl:inline-flex">
                Owner-reviewed AI
              </span>
            </div>
          </header>
          {connectionError && (
            <div
              className="mx-5 mt-5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
              role="alert"
            >
              {connectionError}
            </div>
          )}
          {company?.role === 'OWNER' &&
            !company.onboardingCompletedAt &&
            !pathname.startsWith('/onboarding') && (
              <div className="mx-5 mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-indigo-100 bg-indigo-50/60 p-4 text-xs text-indigo-900">
                <span>
                  Finish your business setup to confirm contact details, pricing, phone forwarding
                  and billing.
                </span>
                <Link
                  className="font-semibold underline underline-offset-2"
                  href={href(`/onboarding/${company.id}`)}
                >
                  Continue setup
                </Link>
              </div>
            )}
          {children}
        </div>
      </div>
    </BusinessAccessProvider>
  );
}
