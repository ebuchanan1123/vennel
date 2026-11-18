import type { ReactNode } from 'react';

export function DashboardShell({ children }: { children: ReactNode }) {
  return (
    <main id="main-content" className="page-content" tabIndex={-1}>
      {children}
    </main>
  );
}
