import { CustomerDirectory } from '../../components/customer-workspace';
import { DashboardShell } from '../../components/dashboard-shell';
import { ErrorNotice } from '../../components/ui';
import { getCustomers } from '../../lib/server-api';
import { workspaceHref } from '../../lib/navigation';
import { getWorkspace } from '../../lib/workspace';

export const dynamic = 'force-dynamic';

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const { companyId } = await searchParams;
  let data;
  try {
    const company = await getWorkspace(companyId);
    data = { company, customers: await getCustomers(company.id) };
  } catch (error) {
    return (
      <DashboardShell>
        <ErrorNotice
          error={error}
          href={companyId ? workspaceHref('/customers', companyId) : '/customers'}
        />
      </DashboardShell>
    );
  }
  return (
    <DashboardShell>
      <CustomerDirectory
        key={data.company.id}
        initialCustomers={data.customers}
        companyId={data.company.id}
      />
    </DashboardShell>
  );
}
