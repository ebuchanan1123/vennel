import { CallNoteCapture } from '../../../components/call-note-capture';
import { DashboardShell } from '../../../components/dashboard-shell';
import { ErrorNotice } from '../../../components/ui';
import {
  ApiError,
  getCallNote,
  getCustomers,
  getLeads,
  getWorkflowClock,
} from '../../../lib/server-api';
import { getWorkspace } from '../../../lib/workspace';
import { workspaceHref } from '../../../lib/navigation';

export const dynamic = 'force-dynamic';

export default async function NewCallNotePage({
  searchParams,
}: {
  searchParams: Promise<{
    companyId?: string;
    customerId?: string;
    leadId?: string;
    noteId?: string;
  }>;
}) {
  const { companyId, customerId, leadId, noteId } = await searchParams;
  let data;
  try {
    const company = await getWorkspace(companyId);
    const [customers, leads, settings, note] = await Promise.all([
      getCustomers(company.id),
      getLeads({ companyId: company.id }),
      getWorkflowClock(company.id),
      noteId ? getCallNote(company.id, noteId) : Promise.resolve(undefined),
    ]);
    if (
      customerId &&
      !customers.some((customer) => customer.id === customerId && !customer.isArchived)
    )
      throw new ApiError('Customer not available in this business.', 404);
    if (leadId && !leads.some((lead) => lead.id === leadId))
      throw new ApiError('Lead not available in this business.', 404);
    data = { company, customers, leads, settings, note };
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
      <CallNoteCapture
        key={`${data.company.id}-${noteId ?? 'new'}`}
        companyId={data.company.id}
        customers={data.customers}
        leads={data.leads}
        settings={data.settings}
        initialCustomerId={customerId}
        initialLeadId={leadId}
        initialNote={data.note}
      />
    </DashboardShell>
  );
}
