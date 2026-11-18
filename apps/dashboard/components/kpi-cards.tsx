import { formatCurrency } from '../lib/format';
import type { DashboardStats } from '../lib/api';
import { Icon, type IconName } from './icon';

type KpiCardsProps = {
  stats: DashboardStats;
  currency?: string;
};

export function KpiCards({ stats, currency }: KpiCardsProps) {
  const cards: { label: string; value: string; detail: string; icon: IconName; color: string }[] = [
    {
      label: 'Recovered leads',
      value: stats.recoveredLeads.toString(),
      detail: 'Missed calls & inbound SMS',
      icon: 'leads',
      color: 'bg-indigo-50 text-indigo-600',
    },
    {
      label: 'Booked jobs',
      value: stats.bookedJobs.toString(),
      detail: 'Opportunities marked booked',
      icon: 'check',
      color: 'bg-sky-50 text-sky-600',
    },
    {
      label: 'Estimated pipeline',
      value: formatCurrency(stats.estimatedPipeline, currency),
      detail: 'Owner-tracked opportunity value',
      icon: 'trend',
      color: 'bg-violet-50 text-violet-600',
    },
    {
      label: 'Won revenue',
      value: formatCurrency(stats.wonRevenue, currency),
      detail: 'Actual value of jobs marked won',
      icon: 'money',
      color: 'bg-emerald-50 text-emerald-600',
    },
  ];

  return (
    <section
      className="grid grid-cols-1 gap-4 min-[440px]:grid-cols-2 xl:grid-cols-4"
      aria-label="All-time business metrics"
    >
      {cards.map((card) => (
        <article key={card.label} className="panel p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-steel">{card.label}</p>
            <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${card.color}`}>
              <Icon name={card.icon} width={17} height={17} />
            </span>
          </div>
          <p className="mt-3 text-[30px] font-semibold tracking-tight tabular-nums text-ink">
            {card.value}
          </p>
          <p className="mt-2 text-[11px] text-steel">{card.detail}</p>
        </article>
      ))}
    </section>
  );
}
