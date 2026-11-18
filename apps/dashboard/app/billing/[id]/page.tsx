import { notFound } from 'next/navigation';

import { DashboardShell } from '../../../components/dashboard-shell';
import { DocumentEditor } from '../../../components/document-editor';
import { ErrorNotice } from '../../../components/ui';
import { ApiError, getCustomers, getDocument, getServices } from '../../../lib/server-api';
import { workspaceHref } from '../../../lib/navigation';
import { getWorkspace } from '../../../lib/workspace';

export const dynamic = 'force-dynamic';

export default async function DocumentPage({
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
    const [document, customers, services] = await Promise.all([
      getDocument(company.id, id),
      getCustomers(company.id),
      getServices(company.id),
    ]);
    data = { company, document, customers, services };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return (
      <DashboardShell>
        <ErrorNotice
          error={error}
          href={companyId ? workspaceHref(`/billing/${id}`, companyId) : `/billing/${id}`}
        />
      </DashboardShell>
    );
  }
  return (
    <DashboardShell>
      <DocumentEditor
        key={data.document.id}
        initialDocument={data.document}
        companyId={data.company.id}
        companyName={data.company.name}
        customers={data.customers}
        services={data.services}
      />
    </DashboardShell>
  );
}
