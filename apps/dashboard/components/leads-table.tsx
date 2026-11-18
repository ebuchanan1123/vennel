import Link from 'next/link';

import type { Lead } from '../lib/api';
import {
  displayOrDash,
  formatCurrency,
  formatDate,
  formatRelativeTime,
  initials,
  maskPhone,
} from '../lib/format';
import { workspaceHref } from '../lib/navigation';
import { LeadStatusBadge } from './lead-status-badge';
import { OutcomeBadge } from './outcome-badge';
import { Icon } from './icon';
import { EmptyState } from './ui';

export function LeadsTable({ leads, companyId }: { leads: Lead[]; companyId?: string }) {
  if (leads.length === 0) {
    return (
      <div className="panel">
        <EmptyState
          title="No opportunities here yet"
          description="Missed calls and inbound conversations will appear here. If a filter is selected, try viewing all leads."
        />
      </div>
    );
  }

  return (
    <div className="panel overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left">
          <thead className="border-b border-slate-100 bg-slate-50/60">
            <tr>
              <th scope="col" className="table-heading">
                Customer
              </th>
              <th scope="col" className="table-heading">
                Service / location
              </th>
              <th scope="col" className="table-heading">
                Qualification
              </th>
              <th scope="col" className="table-heading">
                Outcome
              </th>
              <th scope="col" className="table-heading">
                Opportunity
              </th>
              <th scope="col" className="table-heading">
                Received
              </th>
              <th scope="col" className="table-heading">
                <span className="sr-only">Open lead</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm text-ink">
            {leads.map((lead) => {
              const href = workspaceHref(`/leads/${lead.id}`, companyId ?? lead.companyId);
              const name = lead.customer?.name ?? `Caller ${maskPhone(lead.phone)}`;
              return (
                <tr key={lead.id} className="transition-colors hover:bg-slate-50/70">
                  <td className="table-cell">
                    <Link href={href} className="flex items-center gap-3">
                      <span className="avatar h-9 w-9 text-[11px]">
                        {lead.customer ? (
                          initials(lead.customer.name)
                        ) : (
                          <Icon name="phone" width={15} height={15} />
                        )}
                      </span>
                      <span>
                        <span className="block whitespace-nowrap text-xs font-semibold text-ink">
                          {name}
                        </span>
                        <span className="mt-1 block text-[11px] text-steel">
                          {lead.customer ? maskPhone(lead.phone) : 'Customer not linked'}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="table-cell">
                    <p className="max-w-[190px] truncate text-xs font-medium text-ink">
                      {displayOrDash(lead.serviceType ?? lead.projectType)}
                    </p>
                    <p className="mt-1 text-[11px] text-steel">{displayOrDash(lead.location)}</p>
                  </td>
                  <td className="table-cell whitespace-nowrap">
                    <LeadStatusBadge status={lead.status} />
                  </td>
                  <td className="table-cell whitespace-nowrap">
                    <OutcomeBadge outcome={lead.outcome} />
                  </td>
                  <td className="table-cell whitespace-nowrap text-xs font-medium tabular-nums">
                    {formatCurrency(lead.estimatedValue, lead.company?.currency)}
                  </td>
                  <td className="table-cell whitespace-nowrap">
                    <p className="text-xs text-slate-600">{formatDate(lead.createdAt)}</p>
                    <p className="mt-1 text-[11px] text-steel">
                      {formatRelativeTime(lead.createdAt)}
                    </p>
                  </td>
                  <td className="table-cell">
                    <Link href={href} className="btn-icon" aria-label={`View lead for ${name}`}>
                      <Icon name="chevron" width={17} height={17} />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
