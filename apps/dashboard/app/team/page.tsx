import { DashboardShell } from '../../components/dashboard-shell';
import { TeamWorkspace } from '../../components/team-workspace';
import { ErrorNotice } from '../../components/ui';
import { getTeam } from '../../lib/server-api';
import { getWorkspace } from '../../lib/workspace';
import { workspaceHref } from '../../lib/navigation';

export const dynamic = 'force-dynamic';
export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const { companyId } = await searchParams;
  let data;
  try {
    const company = await getWorkspace(companyId);
    data = { company, team: await getTeam(company.id) };
  } catch (error) {
    return (
      <DashboardShell>
        <ErrorNotice error={error} href={companyId ? workspaceHref('/', companyId) : '/'} />
      </DashboardShell>
    );
  }
  return (
    <DashboardShell>
      <TeamWorkspace key={data.company.id} companyId={data.company.id} initialTeam={data.team} />
    </DashboardShell>
  );
}
