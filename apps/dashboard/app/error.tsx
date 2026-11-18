'use client';

import { useEffect } from 'react';

import { DashboardShell } from '../components/dashboard-shell';
import { Icon } from '../components/icon';

export default function WorkspaceError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error('Dashboard render failed', error);
  }, [error]);
  return (
    <DashboardShell>
      <div className="panel p-8">
        <Icon name="alert" className="text-rose-500" />
        <h1 className="mt-4 text-lg font-semibold">Something interrupted your workspace</h1>
        <p className="mt-2 text-sm text-steel">
          Try loading this view again. Any unsaved edits may need to be re-entered.
        </p>
        <button className="btn-primary mt-5" onClick={reset}>
          Try again
        </button>
      </div>
    </DashboardShell>
  );
}
