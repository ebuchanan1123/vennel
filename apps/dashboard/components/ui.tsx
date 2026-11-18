import type { ReactNode } from 'react';

import { errorMessage } from '../lib/api';
import { Icon, type IconName } from './icon';

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  headingLevel = 1,
}: {
  title: string;
  description: string;
  eyebrow?: string;
  actions?: ReactNode;
  headingLevel?: 1 | 2;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h1';
  return (
    <header className="page-header no-print">
      <div>
        {eyebrow && (
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-ember">
            {eyebrow}
          </p>
        )}
        <Heading className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{title}</Heading>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-steel">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  title,
  description,
  icon = 'leads',
  action,
}: {
  title: string;
  description: string;
  icon?: IconName;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-ember">
        <Icon name={icon} width={24} height={24} />
      </div>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-steel">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorNotice({ error, href = '/' }: { error: unknown; href?: string }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-6" role="alert">
      <div className="flex gap-3">
        <Icon name="alert" className="mt-0.5 shrink-0 text-rose-600" />
        <div>
          <h2 className="text-sm font-semibold text-rose-800">
            We couldn&apos;t load this workspace
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-rose-700">{errorMessage(error)}</p>
          <a
            href={href}
            className="mt-4 inline-flex text-sm font-semibold text-rose-800 underline underline-offset-4"
          >
            Try again
          </a>
        </div>
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-relaxed text-steel">{hint}</span>}
    </label>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full sm:max-w-xs">
      <Icon
        name="search"
        className="pointer-events-none absolute left-3 top-3 text-slate-400"
        width={18}
        height={18}
      />
      <input
        type="search"
        className="field pl-10"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </div>
  );
}

export function FormError({ message }: { message: string }) {
  return message ? (
    <p
      role="alert"
      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm leading-relaxed text-rose-700"
    >
      {message}
    </p>
  ) : null;
}
