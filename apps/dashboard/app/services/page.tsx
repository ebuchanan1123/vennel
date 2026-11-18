import { DashboardShell } from '../../components/dashboard-shell';
import { ServiceCatalog } from '../../components/service-catalog';
import { ErrorNotice } from '../../components/ui';
import { getServices } from '../../lib/server-api';
import { workspaceHref } from '../../lib/navigation';
import { getWorkspace } from '../../lib/workspace';

export const dynamic = 'force-dynamic';

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const { companyId } = await searchParams;
  let data;
  try {
    const company = await getWorkspace(companyId);
    data = { company, services: await getServices(company.id) };
  } catch (error) {
    return (
      <DashboardShell>
        <ErrorNotice
          error={error}
          href={companyId ? workspaceHref('/services', companyId) : '/services'}
        />
      </DashboardShell>
    );
  }
  return (
    <DashboardShell>
      <ServiceCatalog
        key={data.company.id}
        initialServices={data.services}
        companyId={data.company.id}
      />
    </DashboardShell>
  );
}
