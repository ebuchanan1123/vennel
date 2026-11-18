import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ApiError, getCustomers, getLeadDetail, getServices } from '../../../lib/server-api';
import { displayOrDash, formatDate, formatLabel, maskPhone } from '../../../lib/format';
import { workspaceHref } from '../../../lib/navigation';
import { getWorkspace } from '../../../lib/workspace';
import { ConversationView } from '../../../components/conversation-view';
import { DashboardShell } from '../../../components/dashboard-shell';
import { LeadOutcomePanel } from '../../../components/lead-outcome-panel';
import { LeadStatusBadge } from '../../../components/lead-status-badge';
import { LeadCustomerPanel, LeadEstimatePanel } from '../../../components/lead-workspace-actions';
import { OutcomeBadge } from '../../../components/outcome-badge';
import { Icon } from '../../../components/icon';
import { ErrorNotice, PageHeader } from '../../../components/ui';
import { CallNoteHistory, FollowUpHistory } from '../../../components/workflow-history';

export const dynamic = 'force-dynamic';

type LeadDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ companyId?: string }>;
};

export default async function LeadDetailPage({ params, searchParams }: LeadDetailPageProps) {
  const [{ id }, { companyId }] = await Promise.all([params, searchParams]);
  let data;
  try {
    const company = await getWorkspace(companyId);
    const [lead, customers, services] = await Promise.all([
      getLeadDetail(id, company.id),
      getCustomers(company.id),
      getServices(company.id),
    ]);
    data = { lead, customers, services };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    return (
      <DashboardShell>
        <ErrorNotice
          error={error}
          href={companyId ? workspaceHref(`/leads/${id}`, companyId) : `/leads/${id}`}
        />
      </DashboardShell>
    );
  }
  const { lead, customers, services } = data;
  const needsHuman = lead.needsHuman || lead.status === 'NEEDS_HUMAN';

  return (
    <DashboardShell>
      <Link
        className="mb-5 inline-flex items-center gap-2 text-xs font-medium text-steel"
        href={workspaceHref('/leads', lead.companyId)}
      >
        <Icon name="arrow" className="rotate-180" width={14} height={14} />
        Back to lead inbox
      </Link>
      <PageHeader
        title={lead.customer?.name ?? `Caller ${maskPhone(lead.phone)}`}
        description={`${lead.company.name} / ${formatLabel(lead.source)} / Lead #${lead.id.slice(-8).toUpperCase()}`}
        actions={
          <>
            <Link
              className="btn-secondary"
              href={workspaceHref('/call-notes/new', lead.companyId, {
                leadId: lead.id,
                customerId: lead.customerId ?? undefined,
              })}
            >
              <Icon name="note" width={15} height={15} />
              Add call note
            </Link>
            <LeadStatusBadge status={lead.status} />
            <OutcomeBadge outcome={lead.outcome} />
          </>
        }
      />
      {needsHuman && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-5">
          <Icon name="alert" className="mt-0.5 shrink-0 text-rose-600" />
          <div>
            <p className="text-sm font-semibold text-rose-800">Human attention required</p>
            <p className="mt-1.5 text-xs leading-relaxed text-rose-700">
              {lead.summary ?? 'Review this conversation directly before continuing.'}
            </p>
          </div>
        </div>
      )}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <section className="panel p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <Icon name="sparkles" className="text-indigo-400" width={17} height={17} />
              <h2 className="text-sm font-semibold">Qualification summary</h2>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              {lead.summary ?? 'No summary has been recorded yet.'}
            </p>
            <dl className="mt-6 grid gap-x-5 gap-y-5 border-t border-slate-100 pt-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2">
              <Info label="Phone" value={maskPhone(lead.phone)} />
              <Info label="Received" value={formatDate(lead.createdAt)} />
              <Info
                label="Service Type"
                value={displayOrDash(lead.serviceType ?? lead.projectType)}
              />
              <Info label="Issue" value={displayOrDash(lead.issue)} />
              <Info label="Location" value={displayOrDash(lead.location)} />
              <Info label="Urgency" value={lead.urgency ? formatLabel(lead.urgency) : '--'} />
              <Info label="Preferred Time" value={displayOrDash(lead.preferredTime)} />
              {lead.company.niche === 'RENOVATION' && (
                <>
                  <Info label="Budget" value={displayOrDash(lead.budgetRange)} />
                  <Info label="Timeline" value={displayOrDash(lead.timeline)} />
                  <Info
                    label="Property owner"
                    value={lead.propertyOwner === null ? '--' : lead.propertyOwner ? 'Yes' : 'No'}
                  />
                </>
              )}
            </dl>
          </section>
          <ConversationView messages={lead.messages} />
          <CallNoteHistory
            notes={lead.callNotes}
            companyId={lead.companyId}
            timeZone={lead.company.timeZone}
          />
          <FollowUpHistory
            tasks={lead.followUps}
            companyId={lead.companyId}
            timeZone={lead.company.timeZone}
          />
        </div>
        <aside className="space-y-6">
          <LeadCustomerPanel key={lead.customerId ?? lead.id} lead={lead} customers={customers} />
          <LeadEstimatePanel
            lead={lead}
            activeServiceCount={services.filter((service) => service.isActive).length}
          />
          <LeadOutcomePanel key={lead.id} lead={lead} />
        </aside>
      </div>
    </DashboardShell>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-steel">{label}</dt>
      <dd className="mt-1.5 break-words text-xs font-medium leading-relaxed text-ink">{value}</dd>
    </div>
  );
}
