import { DashboardShell } from '../../components/dashboard-shell';
import { ErrorNotice } from '../../components/ui';
import { WorkspaceSettingsView } from '../../components/workspace-settings';
import { getBackgroundJobs, getWorkspaceSettings } from '../../lib/server-api';
import { getWorkspace } from '../../lib/workspace';
import { workspaceHref } from '../../lib/navigation';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const { companyId } = await searchParams;
  let data;
  try {
    const company = await getWorkspace(companyId);
    const [settings, jobs] = await Promise.all([
      getWorkspaceSettings(company.id),
      getBackgroundJobs(company.id),
    ]);
    data = { company, settings, jobs };
  } catch (error) {
    return (
      <DashboardShell>
        <ErrorNotice
          error={error}
          href={companyId ? workspaceHref('/settings', companyId) : '/settings'}
        />
      </DashboardShell>
    );
  }
  return (
    <DashboardShell>
      <WorkspaceSettingsView
        key={data.company.id}
        companyId={data.company.id}
        initialSettings={data.settings}
        jobs={data.jobs}
      />
    </DashboardShell>
  );
}
