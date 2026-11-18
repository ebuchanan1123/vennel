'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { BillingDocument } from '../lib/api';
import { formatCurrency } from '../lib/format';
import { workspaceHref } from '../lib/navigation';
import { DocumentTable } from './document-table';
import { Icon } from './icon';
import { PageHeader, SearchInput } from './ui';
import { useBusinessAccess } from './business-access';

function finalizedTotal(documents: BillingDocument[]): number {
  return documents.reduce((sum, document) => {
    if (!document.totals) throw new Error('A finalized document is missing approved exact prices.');
    return sum + document.totals.total;
  }, 0);
}

export function BillingWorkspace({
  documents,
  companyId,
  kind,
  status,
}: {
  documents: BillingDocument[];
  companyId: string;
  kind?: string;
  status?: string;
}) {
  const { company } = useBusinessAccess();
  const [query, setQuery] = useState('');
  const search = query.trim().toLowerCase();
  const visible = documents.filter(
    (document) =>
      (!kind || document.kind === kind) &&
      (!status || document.status === status) &&
      [
        document.title,
        document.number,
        document.customerSnapshot?.name,
        document.customer?.name,
      ].some((value) => value?.toLowerCase().includes(search)),
  );
  const drafts = documents.filter((document) => document.status === 'DRAFT');
  const estimates = documents.filter(
    (document) => document.kind === 'ESTIMATE' && document.status === 'FINALIZED',
  );
  const invoices = documents.filter(
    (document) => document.kind === 'INVOICE' && document.status === 'FINALIZED',
  );
  const cards = [
    {
      label: 'Awaiting your review',
      value: drafts.length.toString(),
      detail: 'Draft estimates & invoices',
      icon: 'clock' as const,
    },
    {
      label: 'Finalized estimates',
      value: formatCurrency(finalizedTotal(estimates), company?.currency),
      detail: `${estimates.length} owner-approved estimates`,
      icon: 'document' as const,
    },
    {
      label: 'Finalized invoices',
      value: formatCurrency(finalizedTotal(invoices), company?.currency),
      detail: `${invoices.length} invoices; not payment receipts`,
      icon: 'money' as const,
    },
  ];
  return (
    <>
      <PageHeader
        title="Estimates & invoices"
        description="Turn opportunities into clear, professional documents. Every draft stays editable until you approve it."
        actions={
          <>
            <Link
              className="btn-secondary"
              href={workspaceHref('/billing/new', companyId, { kind: 'INVOICE' })}
            >
              New invoice
            </Link>
            <Link className="btn-primary" href={workspaceHref('/billing/new', companyId)}>
              <Icon name="plus" width={16} height={16} />
              New estimate
            </Link>
          </>
        }
      />
      <section className="mb-6 grid gap-4 md:grid-cols-3" aria-label="Document metrics">
        {cards.map((card) => (
          <article className="panel p-5" key={card.label}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-steel">{card.label}</p>
              <Icon name={card.icon} className="text-indigo-400" width={18} height={18} />
            </div>
            <p className="mt-4 text-2xl font-semibold tracking-tight tabular-nums">{card.value}</p>
            <p className="mt-2 text-[11px] text-steel">{card.detail}</p>
          </article>
        ))}
      </section>
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <nav className="flex flex-wrap gap-1" aria-label="Document type">
          {[
            { label: 'All documents', value: undefined },
            { label: 'Estimates', value: 'ESTIMATE' },
            { label: 'Invoices', value: 'INVOICE' },
          ].map((tab) => (
            <Link
              key={tab.label}
              className={`tab ${kind === tab.value ? 'tab-active' : ''}`}
              aria-current={kind === tab.value ? 'page' : undefined}
              href={workspaceHref('/billing', companyId, { kind: tab.value, status })}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <nav className="flex gap-1" aria-label="Document status">
            {[
              { label: 'All statuses', value: undefined },
              { label: 'Drafts', value: 'DRAFT' },
              { label: 'Finalized', value: 'FINALIZED' },
            ].map((tab) => (
              <Link
                key={tab.label}
                className={`tab ${status === tab.value ? 'tab-active' : ''}`}
                aria-current={status === tab.value ? 'page' : undefined}
                href={workspaceHref('/billing', companyId, { kind, status: tab.value })}
              >
                {tab.label}
              </Link>
            ))}
          </nav>
          <SearchInput value={query} onChange={setQuery} placeholder="Search documents..." />
        </div>
      </div>
      <p className="mb-4 text-xs text-steel">
        {visible.length} {visible.length === 1 ? 'document' : 'documents'} in this view
      </p>
      <DocumentTable documents={visible} companyId={companyId} />
      <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-steel">
        <Icon name="check" className="mt-0.5 shrink-0 text-indigo-400" width={15} height={15} />
        Finalizing locks the reviewed details. Sending requires a separate recipient preview and
        email approval. Print / save PDF is also available. Neither action records payment.
      </p>
    </>
  );
}
