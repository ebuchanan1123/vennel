'use client';

import { useState } from 'react';

import type { Lead } from '../lib/api';
import { LeadFilters } from './lead-filters';
import { LeadsTable } from './leads-table';
import { SearchInput } from './ui';

export function LeadInbox({
  leads,
  companyId,
  filter,
}: {
  leads: Lead[];
  companyId: string;
  filter: string;
}) {
  const [query, setQuery] = useState('');
  const search = query.trim().toLowerCase();
  const visible = leads.filter((lead) =>
    [
      lead.phone,
      lead.customer?.name,
      lead.serviceType,
      lead.projectType,
      lead.issue,
      lead.location,
    ].some((value) => value?.toLowerCase().includes(search)),
  );
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <LeadFilters active={filter} companyId={companyId} />
        <SearchInput value={query} onChange={setQuery} placeholder="Search leads..." />
      </div>
      <p className="text-xs text-steel">
        {visible.length} {visible.length === 1 ? 'opportunity' : 'opportunities'}
        {search ? ' matching your search' : ' in this view'}
      </p>
      <LeadsTable leads={visible} companyId={companyId} />
    </section>
  );
}
