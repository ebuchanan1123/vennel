import { DashboardShell } from '../../components/dashboard-shell';
import { FollowUpWorkspace } from '../../components/follow-up-workspace';
import { ErrorNotice } from '../../components/ui';
import {
  getCustomers,
  getFollowUps,
  getFollowUpSuggestions,
  getLeads,
  getWorkflowClock,
  getMembers,
} from '../../lib/server-api';
import { getWorkspace } from '../../lib/workspace';
import { workspaceHref } from '../../lib/navigation';

export const dynamic = 'force-dynamic';

export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string; customerId?: string; callNoteId?: string }>;
}) {
  const { companyId, customerId, callNoteId } = await searchParams;
  let data;
  try {
    const company = await getWorkspace(companyId);
    const [tasks, suggestions, customers, leads, settings, members] = await Promise.all([
      getFollowUps(company.id),
      getFollowUpSuggestions(company.id),
      getCustomers(company.id),
      getLeads({ companyId: company.id }),
      getWorkflowClock(company.id),
      getMembers(company.id),
    ]);
    data = { company, tasks, suggestions, customers, leads, settings, members };
  } catch (error) {
    return (
      <DashboardShell>
        <ErrorNotice
          error={error}
          href={companyId ? workspaceHref('/follow-ups', companyId) : '/follow-ups'}
        />
      </DashboardShell>
    );
  }
  return (
    <DashboardShell>
      <FollowUpWorkspace
        key={`${data.company.id}-${customerId}-${callNoteId}`}
        companyId={data.company.id}
        initialTasks={data.tasks}
        initialSuggestions={data.suggestions}
        customers={data.customers}
        leads={data.leads}
        settings={data.settings}
        members={data.members}
        initialCustomerId={customerId}
        callNoteId={callNoteId}
      />
    </DashboardShell>
  );
}
