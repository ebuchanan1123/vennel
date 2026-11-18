type OutcomeBadgeProps = {
  outcome: string;
};

const outcomeStyles: Record<string, string> = {
  UNKNOWN: 'bg-slate-100 text-slate-500 ring-slate-200',
  CONTACTED: 'bg-blue-50 text-blue-700 ring-blue-200',
  ESTIMATE_SENT: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  BOOKED: 'bg-sky-50 text-sky-700 ring-sky-200',
  WON: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  LOST: 'bg-rose-50 text-rose-700 ring-rose-200',
};

const outcomeLabels: Record<string, string> = {
  UNKNOWN: 'Not set',
  CONTACTED: 'Contacted',
  ESTIMATE_SENT: 'Estimate sent',
  BOOKED: 'Booked',
  WON: 'Won',
  LOST: 'Lost',
};

export function OutcomeBadge({ outcome }: OutcomeBadgeProps) {
  const className = outcomeStyles[outcome] ?? outcomeStyles.UNKNOWN;
  const label = outcomeLabels[outcome] ?? outcome;

  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-1 text-[10px] font-medium ring-1 ring-inset ${className}`}
    >
      {label}
    </span>
  );
}
