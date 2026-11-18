import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  getCustomers,
  getDashboardStats,
  getDocuments,
  getLeads,
  getServices,
} from '../lib/server-api';
import { workspaceHref } from '../lib/navigation';
import { getWorkspace } from '../lib/workspace';
import { DashboardShell } from '../components/dashboard-shell';
import { KpiCards } from '../components/kpi-cards';
import { LeadsTable } from '../components/leads-table';
import { Icon } from '../components/icon';
import { ErrorNotice, PageHeader } from '../components/ui';

export const dynamic = 'force-dynamic';
type HomePageProps = {
  searchParams: Promise<{ companyId?: string; filter?: string }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const { companyId, filter } = await searchParams;
  let data;
  try {
    const company = await getWorkspace(companyId);
    const [stats, leads, customers, services, documents] = await Promise.all([
      getDashboardStats(company.id),
      getLeads({ companyId: company.id }),
      getCustomers(company.id),
      getServices(company.id),
      getDocuments(company.id),
    ]);
    data = { company, stats, leads, customers, services, documents };
  } catch (error) {
    return (
      <DashboardShell>
        <ErrorNotice error={error} href={companyId ? workspaceHref('/', companyId) : '/'} />
      </DashboardShell>
    );
  }
  const { company, stats, leads, customers, services, documents } = data;
  if (filter) redirect(workspaceHref('/leads', company.id, { filter }));
  const href = (path: string) => workspaceHref(path, company.id);
  const draftCount = documents.filter((document) => document.status === 'DRAFT').length;
  const activeServices = services.filter((service) => service.isActive).length;
  const stages = [
    { label: 'New opportunities', outcomes: ['UNKNOWN', 'CONTACTED'], color: 'bg-indigo-500' },
    { label: 'Estimate sent', outcomes: ['ESTIMATE_SENT'], color: 'bg-sky-500' },
    { label: 'Booked jobs', outcomes: ['BOOKED'], color: 'bg-violet-500' },
    { label: 'Won jobs', outcomes: ['WON'], color: 'bg-emerald-500' },
    { label: 'Lost opportunities', outcomes: ['LOST'], color: 'bg-slate-300' },
  ].map((stage) => ({
    ...stage,
    count: leads.filter((lead) => stage.outcomes.includes(lead.outcome)).length,
  }));

  return (
    <DashboardShell>
      <PageHeader
        eyebrow={company.name}
        title="Your business at a glance"
        description="A clear view of your opportunities, customer relationships, and next steps."
        actions={
          <Link href={href('/leads')} className="btn-primary">
            Open lead inbox <Icon name="arrow" width={16} height={16} />
          </Link>
        }
      />
      <div className="space-y-6">
        <KpiCards stats={stats} currency={company.currency} />
        {activeServices === 0 && (
          <section className="flex flex-col gap-4 rounded-xl border border-indigo-100 bg-indigo-50/60 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-ember sm:flex">
                <Icon name="sparkles" width={22} height={22} />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-ink">Ready for smarter estimates?</h2>
                <p className="mt-1 text-xs leading-relaxed text-steel">
                  Add your services and prices. AI can suggest line items from customer
                  conversations.
                </p>
              </div>
            </div>
            <Link
              className="btn-secondary shrink-0 border-indigo-200 text-ember"
              href={href('/services')}
            >
              Set up service catalog <Icon name="arrow" width={15} height={15} />
            </Link>
          </section>
        )}

        <div className="grid gap-6 xl:grid-cols-3">
          <section className="panel p-6 xl:col-span-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-ink">Opportunity pipeline</h2>
                <p className="mt-1 text-xs text-steel">Commercial outcomes across all your leads</p>
              </div>
              <span className="rounded-md bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-steel">
                All time
              </span>
            </div>
            <div className="mt-7 space-y-5">
              {stages.map((stage) => (
                <div
                  key={stage.label}
                  className="grid grid-cols-[130px_1fr_28px] items-center gap-3 sm:grid-cols-[160px_1fr_30px]"
                >
                  <span className="text-xs text-slate-600">{stage.label}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                    <div
                      className={`h-full rounded-full ${stage.color}`}
                      style={{ width: `${leads.length ? (stage.count / leads.length) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-right text-xs font-semibold tabular-nums text-ink">
                    {stage.count}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 pt-4 text-xs text-steel">
              <span>
                <strong className="font-semibold text-ink">{stats.qualifiedLeads}</strong> qualified
              </span>
              <span>
                <strong className="font-semibold text-ink">{stats.inProgress}</strong> in
                conversation
              </span>
              <span>
                <strong className="font-semibold text-ink">{stats.wonJobs}</strong> jobs won
              </span>
            </div>
          </section>

          <section className="panel p-6">
            <h2 className="text-sm font-semibold text-ink">Needs your attention</h2>
            <p className="mt-1 text-xs text-steel">Keep the right opportunities moving</p>
            <Link
              href={workspaceHref('/leads', company.id, { filter: 'needs_human' })}
              className="mt-5 flex items-center gap-3 rounded-lg border border-slate-100 p-3.5 transition-colors hover:bg-slate-50"
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${stats.needsHuman ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}
              >
                <Icon name={stats.needsHuman ? 'alert' : 'check'} width={18} height={18} />
              </span>
              <div className="flex-1">
                <p className="text-xs font-semibold text-ink">
                  {stats.needsHuman} leads need a human
                </p>
                <p className="mt-1 text-[11px] text-steel">Review flagged conversations</p>
              </div>
              <Icon name="chevron" width={15} height={15} className="text-slate-400" />
            </Link>
            <Link
              href={workspaceHref('/billing', company.id, { status: 'DRAFT' })}
              className="mt-3 flex items-center gap-3 rounded-lg border border-slate-100 p-3.5 transition-colors hover:bg-slate-50"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                <Icon name="document" width={18} height={18} />
              </span>
              <div className="flex-1">
                <p className="text-xs font-semibold text-ink">{draftCount} drafts to review</p>
                <p className="mt-1 text-[11px] text-steel">
                  Estimates &amp; invoices awaiting approval
                </p>
              </div>
              <Icon name="chevron" width={15} height={15} className="text-slate-400" />
            </Link>
            <p className="mt-5 flex items-start gap-2 text-[11px] leading-relaxed text-steel">
              <Icon
                name="sparkles"
                className="mt-0.5 shrink-0 text-indigo-400"
                width={14}
                height={14}
              />
              AI prepares suggestions. You make the final call on scope and pricing.
            </p>
          </section>
        </div>

        <section>
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-ink">Recent opportunities</h2>
              <p className="mt-1 text-xs text-steel">
                The latest conversations captured for your business
              </p>
            </div>
            <Link
              className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-ember"
              href={href('/leads')}
            >
              View all leads <Icon name="arrow" width={14} height={14} />
            </Link>
          </div>
          <LeadsTable leads={leads.slice(0, 5)} companyId={company.id} />
        </section>

        <section className="grid gap-4 md:grid-cols-3" aria-label="Connected workspace">
          {[
            {
              path: '/customers',
              icon: 'users' as const,
              label: 'Customer relationships',
              count: customers.filter((customer) => !customer.isArchived).length,
              detail: 'Contact details and a complete history',
            },
            {
              path: '/services',
              icon: 'services' as const,
              label: 'Your service catalog',
              count: activeServices,
              detail: 'Your services. Your pricing. One source of truth.',
            },
            {
              path: '/billing',
              icon: 'document' as const,
              label: 'Estimates & invoices',
              count: documents.length,
              detail: 'From first conversation to reviewed paperwork',
            },
          ].map((item) => (
            <Link
              key={item.path}
              href={href(item.path)}
              className="panel flex items-start gap-3 p-5 transition-colors hover:border-indigo-200"
            >
              <Icon name={item.icon} className="mt-0.5 text-indigo-400" width={19} height={19} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center justify-between gap-2 text-xs font-semibold text-ink">
                  {item.label}
                  <span className="text-base tabular-nums">{item.count}</span>
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-steel">{item.detail}</p>
              </div>
            </Link>
          ))}
        </section>
      </div>
    </DashboardShell>
  );
}
