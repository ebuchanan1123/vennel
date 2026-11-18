import { DashboardShell } from '../../components/dashboard-shell';
import { LeadInbox } from '../../components/lead-inbox';
import { resolveFilter } from '../../components/lead-filters';
import { ErrorNotice, PageHeader } from '../../components/ui';
import { getLeads } from '../../lib/server-api';
import { getWorkspace } from '../../lib/workspace';
import { workspaceHref } from '../../lib/navigation';

export const dynamic = 'force-dynamic';

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string; filter?: string }>;
}) {
  const { companyId, filter } = await searchParams;
  let data;
  try {
    const company = await getWorkspace(companyId);
    const leads = await getLeads({ companyId: company.id, ...resolveFilter(filter) });
    data = { company, leads };
  } catch (error) {
    return (
      <DashboardShell>
        <ErrorNotice
          error={error}
          href={companyId ? workspaceHref('/leads', companyId) : '/leads'}
        />
      </DashboardShell>
    );
  }
  return (
    <DashboardShell>
      <PageHeader
        title="Lead inbox"
        description="Every opportunity, its conversation, and a clear next step. Qualification and business outcomes stay separate."
      />
      <LeadInbox leads={data.leads} companyId={data.company.id} filter={filter ?? 'all'} />
    </DashboardShell>
  );
}
