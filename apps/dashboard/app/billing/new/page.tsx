import { DashboardShell } from '../../../components/dashboard-shell';
import { DocumentEditor } from '../../../components/document-editor';
import { ErrorNotice } from '../../../components/ui';
import { ApiError, getCustomers, getLeadDetail, getServices } from '../../../lib/server-api';
import { workspaceHref } from '../../../lib/navigation';
import { getWorkspace } from '../../../lib/workspace';

export const dynamic = 'force-dynamic';

export default async function NewDocumentPage({
  searchParams,
}: {
  searchParams: Promise<{
    companyId?: string;
    kind?: string;
    customerId?: string;
    leadId?: string;
  }>;
}) {
  const { companyId, kind, customerId, leadId } = await searchParams;
  let data;
  try {
    if (kind && kind !== 'ESTIMATE' && kind !== 'INVOICE')
      throw new ApiError('Choose estimate or invoice as the document type.', 400);
    const company = await getWorkspace(companyId);
    const [customers, services, lead] = await Promise.all([
      getCustomers(company.id),
      getServices(company.id),
      leadId ? getLeadDetail(leadId, company.id) : Promise.resolve(null),
    ]);
    if (
      customerId &&
      !customers.some((customer) => customer.id === customerId && !customer.isArchived)
    ) {
      throw new ApiError('The selected active customer does not belong to this workspace.', 400);
    }
    if (customerId && lead?.customerId && customerId !== lead.customerId) {
      throw new ApiError('Choose the customer linked to this lead.', 400);
    }
    data = { company, customers, services, customerId: customerId ?? lead?.customerId ?? null };
  } catch (error) {
    return (
      <DashboardShell>
        <ErrorNotice
          error={error}
          href={companyId ? workspaceHref('/billing/new', companyId) : '/billing/new'}
        />
      </DashboardShell>
    );
  }
  return (
    <DashboardShell>
      <DocumentEditor
        key={`${data.company.id}-${kind}-${data.customerId}-${leadId}`}
        companyId={data.company.id}
        companyName={data.company.name}
        customers={data.customers}
        services={data.services}
        defaultKind={kind === 'INVOICE' ? 'INVOICE' : 'ESTIMATE'}
        defaultCustomerId={data.customerId}
        leadId={leadId}
      />
    </DashboardShell>
  );
}
