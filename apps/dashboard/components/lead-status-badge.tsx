type LeadStatusBadgeProps = {
  status: string;
};

const labels: Record<string, string> = {
  NEW: 'New',
  QUALIFYING: 'In conversation',
  QUALIFIED: 'Qualified',
  NEEDS_HUMAN: 'Needs attention',
  BOOKED: 'Booked',
  CLOSED: 'Closed',
  DISQUALIFIED: 'Disqualified',
};

const statusStyles: Record<string, string> = {
  NEW: 'bg-slate-100 text-slate-700 ring-slate-200',
  QUALIFYING: 'bg-amber-50 text-amber-700 ring-amber-200',
  QUALIFIED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  NEEDS_HUMAN: 'bg-rose-50 text-rose-700 ring-rose-200',
  BOOKED: 'bg-sky-50 text-sky-700 ring-sky-200',
  CLOSED: 'bg-slate-100 text-slate-500 ring-slate-200',
  DISQUALIFIED: 'bg-slate-100 text-slate-400 ring-slate-200',
};

export function LeadStatusBadge({ status }: LeadStatusBadgeProps) {
  const label = labels[status] ?? status.replace(/_/g, ' ');
  const className = statusStyles[status] ?? 'bg-slate-100 text-slate-700 ring-slate-200';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium ring-1 ring-inset ${className}`}
    >
      <span className="h-1 w-1 rounded-full bg-current" aria-hidden="true" />
      {label}
    </span>
  );
}
