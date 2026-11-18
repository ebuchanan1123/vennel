import { notFound } from 'next/navigation';

import { CustomerProfile } from '../../../components/customer-workspace';
import { DashboardShell } from '../../../components/dashboard-shell';
import { ErrorNotice } from '../../../components/ui';
import { ApiError, getCustomer } from '../../../lib/server-api';
import { workspaceHref } from '../../../lib/navigation';
import { getWorkspace } from '../../../lib/workspace';

export const dynamic = 'force-dynamic';

export default async function CustomerPage({
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
    data = { company, customer: await getCustomer(company.id, id) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return (
      <DashboardShell>
        <ErrorNotice
          error={error}
          href={companyId ? workspaceHref(`/customers/${id}`, companyId) : `/customers/${id}`}
        />
      </DashboardShell>
    );
  }
  return (
    <DashboardShell>
      <CustomerProfile
        key={data.customer.updatedAt}
        customer={data.customer}
        companyId={data.company.id}
        timeZone={data.company.timeZone}
      />
    </DashboardShell>
  );
}
