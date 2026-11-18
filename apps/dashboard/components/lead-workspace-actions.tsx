'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';

import { errorMessage, linkCustomer, type CustomerRecord, type LeadDetail } from '../lib/api';
import { initials } from '../lib/format';
import { workspaceHref } from '../lib/navigation';
import { Icon } from './icon';
import { Field, FormError } from './ui';
import { DocumentActions } from './document-actions';

export function LeadCustomerPanel({
  lead,
  customers,
}: {
  lead: LeadDetail;
  customers: CustomerRecord[];
}) {
  const router = useRouter();
  const activeCustomers = customers.filter((customer) => !customer.isArchived);
  const matchingIds = new Set(
    activeCustomers
      .filter(
        (customer) =>
          customer.phone && customer.phone.replace(/\D/g, '') === lead.phone.replace(/\D/g, ''),
      )
      .map((customer) => customer.id),
  );
  const [mode, setMode] = useState<'existing' | 'new'>(matchingIds.size ? 'existing' : 'new');
  const [customerId, setCustomerId] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const href = (path: string) => workspaceHref(path, lead.companyId);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    startTransition(async () => {
      try {
        await linkCustomer(
          lead.companyId,
          mode === 'existing' ? { leadId: lead.id, customerId } : { leadId: lead.id, name },
        );
        router.refresh();
      } catch (cause) {
        setError(errorMessage(cause));
      }
    });
  }

  if (lead.customer) {
    return (
      <section className="panel p-5">
        <p className="mb-4 text-xs font-semibold text-ink">Customer relationship</p>
        <div className="flex items-center gap-3">
          <span className="avatar h-10 w-10 text-xs">{initials(lead.customer.name)}</span>
          <div>
            <h2 className="text-sm font-semibold">{lead.customer.name}</h2>
            <p className="mt-1 text-[11px] text-steel">Linked to this conversation</p>
          </div>
        </div>
        <Link
          href={href(`/customers/${lead.customer.id}`)}
          className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-xs font-semibold text-ember"
        >
          View customer history <Icon name="arrow" width={14} height={14} />
        </Link>
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="panel p-5">
      <h2 className="text-sm font-semibold">Connect a customer</h2>
      <p className="mt-2 text-xs leading-relaxed text-steel">
        Keep future conversations and documents together. You confirm the match; nothing is merged
        automatically.
      </p>
      {matchingIds.size > 0 && (
        <p className="mt-3 rounded-lg bg-indigo-50 p-3 text-xs leading-relaxed text-indigo-700">
          An existing customer has a matching phone number. Review the match below.
        </p>
      )}
      <fieldset disabled={pending} className="mt-4 space-y-4">
        <div className="flex gap-1 rounded-lg bg-slate-50 p-1">
          <button
            className={`tab flex-1 justify-center ${mode === 'new' ? 'bg-white text-indigo-700 shadow-card' : ''}`}
            type="button"
            aria-pressed={mode === 'new'}
            onClick={() => {
              setMode('new');
              setError('');
            }}
          >
            New customer
          </button>
          <button
            className={`tab flex-1 justify-center ${mode === 'existing' ? 'bg-white text-indigo-700 shadow-card' : ''}`}
            type="button"
            aria-pressed={mode === 'existing'}
            onClick={() => {
              setMode('existing');
              setError('');
            }}
          >
            Link existing
          </button>
        </div>
        {mode === 'new' ? (
          <Field label="Customer name">
            <input
              required
              className="field"
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Full name or business name"
            />
          </Field>
        ) : (
          <Field label="Choose the correct customer">
            <select
              className="field"
              required
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
            >
              <option value="">Select a customer</option>
              {activeCustomers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                  {matchingIds.has(customer.id) ? ' (matching phone)' : ''}
                </option>
              ))}
            </select>
          </Field>
        )}
        <FormError message={error} />
        <button className="btn-secondary w-full" type="submit" disabled={pending}>
          {pending
            ? 'Connecting customer...'
            : mode === 'new'
              ? 'Create & link customer'
              : 'Confirm & link customer'}
          <Icon name="link" width={14} height={14} />
        </button>
      </fieldset>
    </form>
  );
}

export function LeadEstimatePanel({
  lead,
  activeServiceCount,
}: {
  lead: LeadDetail;
  activeServiceCount: number;
}) {
  return (
    <DocumentActions
      companyId={lead.companyId}
      customerId={lead.customerId}
      lead={lead}
      documents={lead.documents}
      catalogReady={activeServiceCount > 0}
    />
  );
}
