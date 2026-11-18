import Link from 'next/link';

import type { BillingDocument } from '../lib/api';
import { formatDate, formatMoney } from '../lib/format';
import { workspaceHref } from '../lib/navigation';
import { Icon } from './icon';
import { EmptyState } from './ui';

export function DocumentStatusBadge({ status }: { status: BillingDocument['status'] }) {
  return (
    <span
      className={`inline-flex rounded-md px-2 py-1 text-[11px] font-medium ${status === 'DRAFT' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}
    >
      {status === 'DRAFT' ? 'Draft' : 'Finalized'}
    </span>
  );
}

export function DocumentTable({
  documents,
  companyId,
}: {
  documents: BillingDocument[];
  companyId: string;
}) {
  if (documents.length === 0)
    return (
      <div className="panel">
        <EmptyState
          icon="document"
          title="No documents in this view"
          description="Prepare an estimate from a lead conversation or create a document manually. Everything starts as a draft."
        />
      </div>
    );
  return (
    <div className="panel overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] text-left">
          <thead className="border-b border-slate-100 bg-slate-50/60">
            <tr>
              {['Document', 'Customer', 'Status', 'Total', 'Updated'].map((label) => (
                <th key={label} scope="col" className="table-heading">
                  {label}
                </th>
              ))}
              <th scope="col" className="table-heading">
                <span className="sr-only">Open document</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {documents.map((document) => (
              <tr key={document.id} className="hover:bg-slate-50/70">
                <td className="table-cell">
                  <Link
                    className="flex items-center gap-3"
                    href={workspaceHref(`/billing/${document.id}`, companyId)}
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${document.kind === 'ESTIMATE' ? 'bg-indigo-50 text-indigo-500' : 'bg-sky-50 text-sky-600'}`}
                    >
                      <Icon name="document" width={17} height={17} />
                    </span>
                    <span>
                      <span className="flex items-center gap-2 text-xs font-semibold text-ink">
                        {document.number ??
                          (document.kind === 'ESTIMATE' ? 'Draft estimate' : 'Draft invoice')}
                        {document.aiDraft && (
                          <Icon
                            name="sparkles"
                            width={13}
                            height={13}
                            className="text-indigo-400"
                          />
                        )}
                      </span>
                      <span className="mt-1 block max-w-[200px] truncate text-[11px] text-steel">
                        {document.title}
                      </span>
                    </span>
                  </Link>
                </td>
                <td className="table-cell text-xs">
                  {document.customerSnapshot?.name ?? document.customer?.name ?? (
                    <span className="text-amber-600">Customer needed</span>
                  )}
                </td>
                <td className="table-cell">
                  <DocumentStatusBadge status={document.status} />
                </td>
                <td className="table-cell whitespace-nowrap text-xs font-semibold tabular-nums">
                  {document.totals ? (
                    formatMoney(document.totals.total, document.currency)
                  ) : (
                    <span className="text-amber-700">Pricing required</span>
                  )}
                </td>
                <td className="table-cell whitespace-nowrap text-xs text-steel">
                  {formatDate(document.updatedAt)}
                </td>
                <td className="table-cell">
                  <Link
                    className="btn-icon"
                    href={workspaceHref(`/billing/${document.id}`, companyId)}
                    aria-label={`Open ${document.number ?? document.title}`}
                  >
                    <Icon name="chevron" width={17} height={17} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
