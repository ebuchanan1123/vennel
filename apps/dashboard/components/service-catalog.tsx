'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';

import { errorMessage, saveService, type CatalogService } from '../lib/api';
import { formatServicePrice } from '../lib/format';
import { Icon } from './icon';
import { EmptyState, Field, FormError, PageHeader, SearchInput } from './ui';
import { useBusinessAccess } from './business-access';

function ServiceForm({
  companyId,
  service,
  onSaved,
  onCancel,
}: {
  companyId: string;
  service?: CatalogService;
  onSaved: (service: CatalogService) => void;
  onCancel: () => void;
}) {
  const { company } = useBusinessAccess();
  const [name, setName] = useState(service?.name ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [category, setCategory] = useState(service?.category ?? 'General');
  const [unit, setUnit] = useState(service?.unit ?? 'job');
  const [pricingType, setPricingType] = useState<CatalogService['pricingType']>(
    service?.pricingType ?? 'FIXED',
  );
  const [price, setPrice] = useState(service?.unitPrice?.toString() ?? '');
  const [minPrice, setMinPrice] = useState(service?.minPrice?.toString() ?? '');
  const [maxPrice, setMaxPrice] = useState(service?.maxPrice?.toString() ?? '');
  const [keywords, setKeywords] = useState(service?.keywords.join(', ') ?? '');
  const [isActive, setActive] = useState(service?.isActive ?? true);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    startTransition(async () => {
      try {
        const saved = await saveService(
          companyId,
          {
            name,
            description: description || null,
            category,
            unit,
            pricingType,
            unitPrice: pricingType === 'FIXED' && price.trim() !== '' ? Number(price) : null,
            minPrice: pricingType === 'RANGE' && minPrice.trim() !== '' ? Number(minPrice) : null,
            maxPrice: pricingType === 'RANGE' && maxPrice.trim() !== '' ? Number(maxPrice) : null,
            keywords: keywords
              .split(',')
              .map((keyword) => keyword.trim())
              .filter(Boolean),
            isActive,
          },
          service?.id,
        );
        onSaved(saved);
      } catch (cause) {
        setError(errorMessage(cause));
      }
    });
  }

  return (
    <form onSubmit={submit} className="panel p-5">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{service ? 'Edit service' : 'Add a service'}</h2>
        <button
          className="btn-icon"
          type="button"
          onClick={onCancel}
          disabled={pending}
          aria-label="Close service form"
        >
          <Icon name="close" width={18} height={18} />
        </button>
      </div>
      <fieldset className="space-y-4" disabled={pending}>
        <Field label="Service name">
          <input
            className="field"
            required
            maxLength={160}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. AC diagnostic visit"
            autoFocus
          />
        </Field>
        <Field label="Category">
          <input
            className="field"
            required
            maxLength={80}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            placeholder="e.g. Repairs"
          />
        </Field>
        <Field
          label="Description"
          hint="Explain the scope, exclusions, or what affects the final price."
        >
          <textarea
            className="field min-h-24 resize-y"
            maxLength={2000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this service covers..."
          />
        </Field>
        <Field
          label="Pricing type"
          hint={
            pricingType === 'FIXED'
              ? 'A defined price for a clearly scoped service.'
              : pricingType === 'RANGE'
                ? 'Guidance only. An exact price is required before finalizing a document.'
                : 'No price is suggested. Confirm an exact amount during owner review.'
          }
        >
          <select
            className="field"
            value={pricingType}
            onChange={(event) => {
              const value = event.target.value;
              if (value === 'FIXED' || value === 'RANGE' || value === 'QUOTE_REQUIRED')
                setPricingType(value);
            }}
          >
            <option value="FIXED">Fixed price</option>
            <option value="RANGE">Estimated range</option>
            <option value="QUOTE_REQUIRED">Quote required</option>
          </select>
        </Field>
        <div className={pricingType === 'QUOTE_REQUIRED' ? '' : 'grid grid-cols-2 gap-3'}>
          {pricingType === 'FIXED' && (
            <Field label={`Price (${company?.currency ?? 'USD'})`}>
              <input
                className="field"
                type="number"
                required
                min={0}
                max={1000000}
                step="0.01"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                placeholder="0.00"
              />
            </Field>
          )}
          {pricingType === 'RANGE' && (
            <>
              <Field label={`Minimum price (${company?.currency ?? 'USD'})`}>
                <input
                  className="field"
                  type="number"
                  required
                  min={0}
                  max={1000000}
                  step="0.01"
                  value={minPrice}
                  onChange={(event) => setMinPrice(event.target.value)}
                  placeholder="500.00"
                />
              </Field>
              <Field label={`Maximum price (${company?.currency ?? 'USD'})`}>
                <input
                  className="field"
                  type="number"
                  required
                  min={minPrice.trim() === '' ? 0 : Number(minPrice)}
                  max={1000000}
                  step="0.01"
                  value={maxPrice}
                  onChange={(event) => setMaxPrice(event.target.value)}
                  placeholder="1500.00"
                />
              </Field>
            </>
          )}
          <div className={pricingType === 'RANGE' ? 'col-span-2' : undefined}>
            <Field label="Per unit">
              <input
                className="field"
                required
                maxLength={40}
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                placeholder="job, hour, visit..."
              />
            </Field>
          </div>
        </div>
        <Field
          label="Matching keywords"
          hint="Comma-separated phrases customers use. These help AI identify the right service."
        >
          <textarea
            className="field min-h-20 resize-y"
            value={keywords}
            onChange={(event) => setKeywords(event.target.value)}
            placeholder="not cooling, warm air, AC repair"
          />
        </Field>
        <label className="flex items-start gap-2.5 text-xs leading-relaxed text-steel">
          <input
            className="mt-0.5 accent-indigo-600"
            type="checkbox"
            checked={isActive}
            onChange={(event) => setActive(event.target.checked)}
          />
          <span>
            Available to AI &amp; new documents
            <span className="mt-1 block text-[11px]">
              Turn off to archive. Existing prices on documents stay unchanged.
            </span>
          </span>
        </label>
        <FormError message={error} />
        <button className="btn-primary w-full" type="submit" disabled={pending}>
          {pending ? 'Saving service...' : 'Save service'}
        </button>
      </fieldset>
    </form>
  );
}

export function ServiceCatalog({
  initialServices,
  companyId,
  embedded = false,
}: {
  initialServices: CatalogService[];
  companyId: string;
  embedded?: boolean;
}) {
  const { can, company } = useBusinessAccess();
  const canEdit = can('CATALOG');
  const router = useRouter();
  const [services, setServices] = useState(initialServices);
  const [editing, setEditing] = useState<CatalogService | 'new' | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All services');
  const [showArchived, setShowArchived] = useState(false);
  const [notice, setNotice] = useState('');
  const search = query.trim().toLowerCase();
  const categories = [
    ...new Set(
      services
        .filter((service) => service.isActive || showArchived)
        .map((service) => service.category),
    ),
  ].sort();
  const visible = services.filter(
    (service) =>
      (showArchived || service.isActive) &&
      (category === 'All services' || service.category === category) &&
      [service.name, service.description, service.category, ...service.keywords].some((value) =>
        value?.toLowerCase().includes(search),
      ),
  );
  const addServiceButton = canEdit && (
    <button
      className="btn-primary"
      onClick={() => {
        setEditing('new');
        setNotice('');
      }}
    >
      <Icon name="plus" width={16} height={16} />
      Add service
    </button>
  );

  return (
    <>
      {embedded ? (
        <div className="mb-5 flex justify-end">{addServiceButton}</div>
      ) : (
        <PageHeader
          title="Services & pricing"
          description="Your business's service catalog is the source of truth for AI-assisted estimates. You set the prices and scope."
          actions={addServiceButton}
        />
      )}
      {!embedded && (
        <section className="mb-6 rounded-xl border border-indigo-100 bg-indigo-50/50 p-5">
          <div className="flex items-center gap-2">
            <Icon name="sparkles" className="text-ember" width={17} height={17} />
            <h2 className="text-xs font-semibold text-indigo-900">
              A smarter starting point. Never an unreviewed price.
            </h2>
          </div>
          <div className="mt-4 grid gap-4 text-xs leading-relaxed text-steel md:grid-cols-3">
            <p>
              <span className="mr-2 font-semibold text-indigo-500">01</span>Add your services,
              prices, and the terms customers use.
            </p>
            <p>
              <span className="mr-2 font-semibold text-indigo-500">02</span>AI matches requested
              services using the actual conversation.
            </p>
            <p>
              <span className="mr-2 font-semibold text-indigo-500">03</span>Review quantities, add
              items, and approve the final document.
            </p>
          </div>
        </section>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-700">
          {notice}
        </p>
      )}
      <div
        className={`grid items-start gap-6 ${editing ? 'xl:grid-cols-[minmax(0,1fr)_340px]' : ''}`}
      >
        <section className="min-w-0">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SearchInput value={query} onChange={setQuery} placeholder="Search services..." />
            <label className="flex items-center gap-2 text-xs text-steel">
              <input
                type="checkbox"
                className="accent-indigo-600"
                checked={showArchived}
                onChange={(event) => {
                  setShowArchived(event.target.checked);
                  setCategory('All services');
                }}
              />
              Include archived
            </label>
          </div>
          <nav aria-label="Service categories" className="mb-5 flex flex-wrap gap-1">
            {['All services', ...categories].map((label) => (
              <button
                key={label}
                className={`tab ${label === category ? 'tab-active' : ''}`}
                aria-pressed={label === category}
                onClick={() => setCategory(label)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="mb-4 flex items-center justify-between text-xs text-steel">
            <span>
              {visible.length} {visible.length === 1 ? 'service' : 'services'}
            </span>
            <span>All catalog prices in {company?.currency ?? 'USD'}</span>
          </div>
          {visible.length === 0 ? (
            <div className="panel">
              <EmptyState
                icon="services"
                title={
                  services.length === 0
                    ? 'Start with the services you know best'
                    : 'No services in this view'
                }
                description={
                  services.length === 0
                    ? 'Add a few common services and their prices. Your catalog belongs only to this business workspace.'
                    : 'Try another category or search, or include archived services.'
                }
                action={
                  services.length === 0 &&
                  canEdit && (
                    <button className="btn-secondary" onClick={() => setEditing('new')}>
                      <Icon name="plus" width={15} height={15} />
                      Add your first service
                    </button>
                  )
                }
              />
            </div>
          ) : (
            <div className={`grid gap-4 md:grid-cols-2 ${editing ? '' : '2xl:grid-cols-3'}`}>
              {visible.map((service) => (
                <article key={service.id} className="panel flex flex-col p-5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-md bg-slate-50 px-2 py-1 text-[10px] font-medium text-steel">
                      {service.category}
                    </span>
                    <span
                      className={`text-[10px] font-medium ${service.isActive ? 'text-emerald-600' : 'text-slate-400'}`}
                    >
                      {service.isActive ? 'Active' : 'Archived'}
                    </span>
                  </div>
                  <h3 className="mt-4 text-sm font-semibold leading-relaxed text-ink">
                    {service.name}
                  </h3>
                  <p className="mt-2 min-h-10 text-xs leading-relaxed text-steel">
                    {service.description ?? 'No description added.'}
                  </p>
                  <p className="mt-5 text-xl font-semibold tracking-tight tabular-nums">
                    {formatServicePrice(service, company?.currency)}
                    {service.pricingType !== 'QUOTE_REQUIRED' && (
                      <span className="ml-1.5 text-xs font-normal text-steel">
                        / {service.unit}
                      </span>
                    )}
                  </p>
                  {service.pricingType !== 'FIXED' && (
                    <p className="mt-1 text-[11px] leading-relaxed text-amber-700">
                      {service.pricingType === 'RANGE'
                        ? 'Estimated range. Confirm the final price after reviewing the scope.'
                        : 'Price confirmed after assessing the work.'}
                    </p>
                  )}
                  <div className="mb-5 mt-4 flex min-h-6 flex-wrap gap-1.5">
                    {service.keywords.slice(0, 3).map((keyword, index) => (
                      <span
                        key={`${keyword}-${index}`}
                        className="rounded border border-slate-100 px-2 py-1 text-[10px] text-steel"
                      >
                        {keyword}
                      </span>
                    ))}
                    {service.keywords.length > 3 && (
                      <span className="py-1 text-[10px] text-steel">
                        +{service.keywords.length - 3} more
                      </span>
                    )}
                  </div>
                  {canEdit && (
                    <button
                      className="mt-auto flex items-center justify-between border-t border-slate-100 pt-4 text-xs font-medium text-ember"
                      aria-label={`Edit ${service.name}`}
                      onClick={() => {
                        setEditing(service);
                        setNotice('');
                      }}
                    >
                      <span>Edit service</span>
                      <Icon name="edit" width={14} height={14} />
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
        {editing && canEdit && (
          <aside className="order-first xl:order-last">
            <ServiceForm
              key={editing === 'new' ? 'new' : editing.id}
              companyId={companyId}
              service={editing === 'new' ? undefined : editing}
              onCancel={() => setEditing(null)}
              onSaved={(service) => {
                setServices((current) => [
                  service,
                  ...current.filter((entry) => entry.id !== service.id),
                ]);
                setEditing(null);
                setCategory('All services');
                setNotice('Service saved. Existing document prices have not changed.');
                router.refresh();
              }}
            />
          </aside>
        )}
      </div>
    </>
  );
}
