import { notFound } from 'next/navigation';

import { CallNoteReview } from '../../../components/call-note-review';
import { DashboardShell } from '../../../components/dashboard-shell';
import { ErrorNotice } from '../../../components/ui';
import {
  ApiError,
  getCallNote,
  getCustomers,
  getFollowUps,
  getLeads,
  getWorkflowClock,
  getDocuments,
} from '../../../lib/server-api';
import { getWorkspace } from '../../../lib/workspace';
import { workspaceHref } from '../../../lib/navigation';

export const dynamic = 'force-dynamic';

export default async function CallNotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ companyId?: string }>;
}) {
  const [{ id }, { companyId }] = await Promise.all([params, searchParams]);
  let data;
  try {
    const company = await getWorkspace(companyId);
    const [note, customers, leads, tasks, settings, documents] = await Promise.all([
      getCallNote(company.id, id),
      getCustomers(company.id),
      getLeads({ companyId: company.id }),
      getFollowUps(company.id),
      getWorkflowClock(company.id),
      getDocuments(company.id),
    ]);
    data = {
      company,
      note,
      customers,
      leads,
      tasks: tasks.filter((task) => task.callNoteId === id),
      settings,
      documents: documents.filter((document) => document.callNoteId === id),
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
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
      <CallNoteReview
        key={`${id}-${data.note.revision}`}
        note={data.note}
        companyId={data.company.id}
        customers={data.customers}
        leads={data.leads}
        tasks={data.tasks}
        settings={data.settings}
        documents={data.documents}
      />
    </DashboardShell>
  );
}
