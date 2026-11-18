import { CallNoteList } from '../../components/call-note-list';
import { DashboardShell } from '../../components/dashboard-shell';
import { ErrorNotice } from '../../components/ui';
import { getCallNotes } from '../../lib/server-api';
import { getWorkspace } from '../../lib/workspace';
import { workspaceHref } from '../../lib/navigation';

export const dynamic = 'force-dynamic';

export default async function CallNotesPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const { companyId } = await searchParams;
  let data;
  try {
    const company = await getWorkspace(companyId);
    data = { company, notes: await getCallNotes(company.id) };
  } catch (error) {
    return (
      <DashboardShell>
        <ErrorNotice
          error={error}
          href={companyId ? workspaceHref('/call-notes', companyId) : '/call-notes'}
        />
      </DashboardShell>
    );
  }
  return (
    <DashboardShell>
      <CallNoteList
        key={data.company.id}
        initialNotes={data.notes}
        companyId={data.company.id}
        timeZone={data.company.timeZone}
      />
    </DashboardShell>
  );
}
