import Link from 'next/link';

import { DashboardShell } from '../components/dashboard-shell';
import { EmptyState } from '../components/ui';

export default function NotFound() {
  return (
    <DashboardShell>
      <div className="panel">
        <EmptyState
          icon="search"
          title="This record isn't in your workspace"
          description="It may have been removed, or it may belong to a different business. Return to your overview and select the correct workspace."
          action={
            <Link className="btn-primary" href="/">
              Return to overview
            </Link>
          }
        />
      </div>
    </DashboardShell>
  );
}
