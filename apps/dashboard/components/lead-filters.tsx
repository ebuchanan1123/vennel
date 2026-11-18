import Link from 'next/link';
import { workspaceHref } from '../lib/navigation';

type LeadFiltersProps = {
  active: string;
  companyId: string;
};

const FILTERS: Array<{ key: string; label: string; status?: string; outcome?: string }> = [
  { key: 'all', label: 'All leads' },
  { key: 'needs_human', label: 'Needs attention', status: 'NEEDS_HUMAN' },
  { key: 'qualified', label: 'Qualified', status: 'QUALIFIED' },
  { key: 'booked', label: 'Booked', outcome: 'BOOKED' },
  { key: 'won', label: 'Won', outcome: 'WON' },
  { key: 'lost', label: 'Lost', outcome: 'LOST' },
];

export function LeadFilters({ active, companyId }: LeadFiltersProps) {
  return (
    <nav className="flex flex-wrap gap-1" aria-label="Lead filters">
      {FILTERS.map((filter) => {
        const isActive = filter.key === active;
        const href = workspaceHref('/leads', companyId, {
          filter: filter.key === 'all' ? undefined : filter.key,
        });

        return (
          <Link
            key={filter.key}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className={`tab ${isActive ? 'tab-active' : ''}`}
          >
            {filter.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function resolveFilter(key: string | undefined): { status?: string; outcome?: string } {
  const match = FILTERS.find((filter) => filter.key === key);
  if (!match) return {};
  return { status: match.status, outcome: match.outcome };
}
