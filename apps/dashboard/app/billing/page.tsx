import { BillingWorkspace } from '../../components/billing-workspace';
import { DashboardShell } from '../../components/dashboard-shell';
import { ErrorNotice } from '../../components/ui';
import { ApiError, getDocuments } from '../../lib/server-api';
import { workspaceHref } from '../../lib/navigation';
import { getWorkspace } from '../../lib/workspace';

export const dynamic = 'force-dynamic';

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string; kind?: string; status?: string }>;
}) {
  const { companyId, kind, status } = await searchParams;
  let data;
  try {
    if (kind && kind !== 'ESTIMATE' && kind !== 'INVOICE')
      throw new ApiError('Choose a valid document type.', 400);
    if (status && status !== 'DRAFT' && status !== 'FINALIZED')
      throw new ApiError('Choose a valid document status.', 400);
    const company = await getWorkspace(companyId);
    data = { company, documents: await getDocuments(company.id) };
  } catch (error) {
    return (
      <DashboardShell>
        <ErrorNotice
          error={error}
          href={companyId ? workspaceHref('/billing', companyId) : '/billing'}
        />
      </DashboardShell>
    );
  }
  return (
    <DashboardShell>
      <BillingWorkspace
        key={`${data.company.id}-${kind}-${status}`}
        documents={data.documents}
        companyId={data.company.id}
        kind={kind}
        status={status}
      />
    </DashboardShell>
  );
}
