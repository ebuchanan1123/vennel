import { BusinessOnboarding } from '../../../components/business-onboarding';
import { ErrorNotice } from '../../../components/ui';
import { getOnboarding, getServices, getWorkspaceSettings } from '../../../lib/server-api';
import { getWorkspace } from '../../../lib/workspace';
import { workspaceHref } from '../../../lib/navigation';

export const dynamic = 'force-dynamic';
export default async function OnboardingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let data;
  try {
    const company = await getWorkspace(id);
    const [profile, services, settings] = await Promise.all([
      getOnboarding(company.id),
      getServices(company.id),
      getWorkspaceSettings(company.id),
    ]);
    data = { profile, services, settings };
  } catch (error) {
    return <ErrorNotice error={error} href={workspaceHref(`/onboarding/${id}`, id)} />;
  }
  return (
    <BusinessOnboarding
      key={id}
      initialProfile={data.profile}
      services={data.services}
      settings={data.settings}
    />
  );
}
