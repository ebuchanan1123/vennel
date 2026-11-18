'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { calculateDocumentTotals, type DocumentTotals } from '@lead-recovery/types';

import {
  ApiError,
  convertEstimate,
  createDocument,
  errorMessage,
  finalizeDocument,
  saveDocument,
  type AiDraft,
  type BillingDocument,
  type CatalogService,
  type CustomerRecord,
  type DocumentInput,
  type DocumentKind,
} from '../lib/api';
import { formatDate, formatMoney, formatServicePrice } from '../lib/format';
import { workspaceHref } from '../lib/navigation';
import { DocumentStatusBadge } from './document-table';
import { Icon } from './icon';
import { EmptyState, Field, FormError, PageHeader } from './ui';
import { DocumentEmailPanel } from './document-email-panel';
import { DocumentContextView } from './document-context';
import { useBusinessAccess } from './business-access';

type EditableItem = {
  key: number;
  serviceId: string | null;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
};

function Totals({
  totals,
  currency,
  taxRate,
}: {
  totals: DocumentTotals;
  currency: string;
  taxRate: number;
}) {
  return (
    <dl className="space-y-3 text-sm">
      <div className="flex justify-between gap-4">
        <dt className="text-steel">Subtotal</dt>
        <dd className="font-medium tabular-nums">{formatMoney(totals.subtotal, currency)}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-steel">Discount</dt>
        <dd className="font-medium tabular-nums">-{formatMoney(totals.discount, currency)}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-steel">Tax ({taxRate}%)</dt>
        <dd className="font-medium tabular-nums">{formatMoney(totals.tax, currency)}</dd>
      </div>
      <div className="flex justify-between gap-4 border-t border-slate-200 pt-4">
        <dt className="font-semibold">
          Total <span className="ml-1 text-[10px] font-normal text-steel">{currency}</span>
        </dt>
        <dd className="text-xl font-semibold tracking-tight tabular-nums">
          {formatMoney(totals.total, currency)}
        </dd>
      </div>
    </dl>
  );
}

function AiReview({ draft, currency }: { draft: AiDraft; currency: string }) {
  return (
    <details className="panel no-print p-5">
      <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-indigo-700">
        <Icon name="sparkles" width={16} height={16} />
        Original AI suggestions ({draft.matches.length})
      </summary>
      <p className="mt-3 text-xs leading-relaxed text-steel">
        This original snapshot is kept even if you edit or remove the suggested line items.
      </p>
      <div className="mt-4 space-y-3">
        {draft.matches.map((match) => (
          <div
            className="rounded-lg border border-slate-100 bg-slate-50/60 p-3"
            key={match.serviceId}
          >
            <div className="flex justify-between gap-3 text-xs">
              <span className="font-semibold">{match.description}</span>
              <span className="text-right text-steel">
                {match.catalogPricing
                  ? formatServicePrice(match.catalogPricing, currency)
                  : match.unitPrice === null
                    ? 'Exact price required'
                    : formatMoney(match.unitPrice, currency)}
                {match.unit && match.catalogPricing?.pricingType !== 'QUOTE_REQUIRED'
                  ? ` / ${match.unit}`
                  : ''}{' '}
                catalog guidance
              </span>
            </div>
            <blockquote className="mt-2 border-l-2 border-indigo-200 pl-3 text-xs leading-relaxed text-steel">
              &ldquo;{match.evidence}&rdquo;
            </blockquote>
            {match.source && (
              <p className="mt-2 text-[10px] text-steel">
                Source:{' '}
                {match.source.kind === 'CALL_NOTE'
                  ? 'owner-confirmed call note'
                  : 'inbound customer message'}
              </p>
            )}
          </div>
        ))}
      </div>
      <ul className="mt-4 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-steel">
        {draft.missingDetails.map((detail, index) => (
          <li key={index}>{detail}</li>
        ))}
      </ul>
    </details>
  );
}

function DocumentSheet({ document }: { document: BillingDocument }) {
  const customer = document.customerSnapshot;
  if (!document.totals) throw new Error('A finalized document is missing approved exact prices.');
  return (
    <article className="print-sheet panel mx-auto max-w-4xl p-6 sm:p-10">
      <div className="flex flex-col justify-between gap-6 border-b border-slate-100 pb-8 sm:flex-row">
        <div>
          <div className="mb-4 flex items-center gap-2 text-indigo-500">
            <Icon name="trend" width={25} height={25} />
            <span className="text-base font-semibold text-ink">{document.businessName}</span>
          </div>
          <p className="text-xs text-steel">Prepared for {customer?.name}</p>
          {document.billingProfile && (
            <div className="mt-3 space-y-1 text-xs text-steel">
              {document.billingProfile.address && (
                <p className="whitespace-pre-wrap">{document.billingProfile.address}</p>
              )}
              {document.billingProfile.email && <p>{document.billingProfile.email}</p>}
              {document.billingProfile.phone && <p>{document.billingProfile.phone}</p>}
              {document.billingProfile.taxRegistrationNumber && (
                <p>Tax registration: {document.billingProfile.taxRegistrationNumber}</p>
              )}
            </div>
          )}
        </div>
        <div className="sm:text-right">
          <p className="text-2xl font-semibold tracking-tight text-ink">
            {document.kind === 'ESTIMATE' ? 'ESTIMATE' : 'INVOICE'}
          </p>
          <p className="mt-2 text-sm font-medium text-steel">{document.number}</p>
          <p className="mt-3 text-xs text-steel">
            Finalized {formatDate(document.finalizedAt ?? document.createdAt)} (UTC)
          </p>
        </div>
      </div>
      <div className="grid gap-6 py-8 sm:grid-cols-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-steel">
            Prepared for
          </p>
          <p className="mt-3 text-sm font-semibold">{customer?.name}</p>
          {customer?.address && (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-steel">
              {customer.address}
            </p>
          )}
          {customer?.email && <p className="mt-2 text-xs text-steel">{customer.email}</p>}
          {customer?.phone && <p className="mt-1 text-xs text-steel">{customer.phone}</p>}
        </div>
        <div className="sm:text-right">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-steel">
            Document details
          </p>
          <p className="mt-3 text-sm font-medium">{document.title}</p>
          {document.dueDate && (
            <p className="mt-2 text-xs text-steel">
              {document.kind === 'ESTIMATE' ? 'Valid until' : 'Due date'}:{' '}
              {formatDate(document.dueDate)}
            </p>
          )}
          <p className="mt-2 text-xs text-steel">Currency: {document.currency}</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-left">
          <thead className="border-y border-slate-100 bg-slate-50">
            <tr>
              <th scope="col" className="py-3 pl-3 text-xs font-medium text-steel">
                Description
              </th>
              <th scope="col" className="px-3 py-3 text-right text-xs font-medium text-steel">
                Qty
              </th>
              <th scope="col" className="px-3 py-3 text-right text-xs font-medium text-steel">
                Rate
              </th>
              <th scope="col" className="py-3 pr-3 text-right text-xs font-medium text-steel">
                Amount
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {document.items.map((item) => {
              const lineTotals = calculateDocumentTotals([item]);
              if (item.unitPrice === null || lineTotals === null)
                throw new Error('A finalized line item is missing its approved exact price.');
              return (
                <tr key={item.id}>
                  <td className="py-4 pl-3 pr-4 text-sm leading-relaxed">{item.description}</td>
                  <td className="px-3 py-4 text-right text-sm tabular-nums">
                    {item.quantity}
                    {item.unit && (
                      <span className="mt-1 block whitespace-normal text-[10px] text-steel">
                        {item.unit}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-right text-sm tabular-nums">
                    {formatMoney(item.unitPrice, document.currency)}
                  </td>
                  <td className="whitespace-nowrap py-4 pr-3 text-right text-sm font-medium tabular-nums">
                    {formatMoney(lineTotals.subtotal, document.currency)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="ml-auto mt-8 max-w-sm">
        <Totals totals={document.totals} currency={document.currency} taxRate={document.taxRate} />
      </div>
      {document.notes && (
        <section className="mt-10 border-t border-slate-100 pt-6">
          <h2 className="text-xs font-semibold text-ink">Notes &amp; terms</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-steel">
            {document.notes}
          </p>
        </section>
      )}
      <footer className="mt-10 border-t border-slate-100 pt-5 text-[11px] text-steel">
        Prepared by {document.businessName} &middot; {document.number}
        {document.kind === 'ESTIMATE' && (
          <p className="mt-2">This is an estimate, not a request for payment.</p>
        )}
      </footer>
    </article>
  );
}

export function DocumentEditor({
  initialDocument,
  companyId,
  companyName,
  customers,
  services,
  defaultKind = 'ESTIMATE',
  defaultCustomerId = null,
  leadId = null,
}: {
  initialDocument?: BillingDocument;
  companyId: string;
  companyName: string;
  customers: CustomerRecord[];
  services: CatalogService[];
  defaultKind?: DocumentKind;
  defaultCustomerId?: string | null;
  leadId?: string | null;
}) {
  const { can, company } = useBusinessAccess();
  const canApprove = can('APPROVALS');
  const router = useRouter();
  const [saved, setSaved] = useState(initialDocument);
  const [kind, setKind] = useState<DocumentKind>(initialDocument?.kind ?? defaultKind);
  const [title, setTitle] = useState(
    initialDocument?.title ?? (defaultKind === 'ESTIMATE' ? 'Service estimate' : 'Service invoice'),
  );
  const [customerId, setCustomerId] = useState(
    initialDocument?.customerId ?? defaultCustomerId ?? '',
  );
  const [dueDate, setDueDate] = useState(initialDocument?.dueDate ?? '');
  const [notes, setNotes] = useState(initialDocument?.notes ?? '');
  const [discount, setDiscount] = useState(initialDocument?.discountAmount.toString() ?? '0');
  const [taxRate, setTaxRate] = useState(
    initialDocument?.taxRate.toString() ?? company?.defaultTaxRate.toString() ?? '0',
  );
  const [items, setItems] = useState<EditableItem[]>(
    () =>
      initialDocument?.items.map((item, key) => ({
        key,
        serviceId: item.serviceId ?? null,
        description: item.description,
        unit: item.unit ?? '',
        quantity: item.quantity.toString(),
        unitPrice: item.unitPrice?.toString() ?? '',
      })) ?? [],
  );
  const [nextKey, setNextKey] = useState(initialDocument?.items.length ?? 0);
  const [reviewed, setReviewed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [needsReload, setNeedsReload] = useState(false);
  const [pending, startTransition] = useTransition();
  const currency = saved?.currency ?? company?.currency ?? 'USD';
  const href = (path: string) => workspaceHref(path, companyId);

  function changed() {
    setDirty(true);
    setReviewed(false);
    setNotice('');
  }

  function addItem(service?: CatalogService) {
    if (items.length >= 100) {
      setError('A document can contain at most 100 line items.');
      return;
    }
    setItems((current) => [
      ...current,
      {
        key: nextKey,
        serviceId: service?.id ?? null,
        description: service?.name ?? '',
        unit: service?.unit ?? 'job',
        quantity: '1',
        unitPrice: service?.unitPrice?.toString() ?? '',
      },
    ]);
    setNextKey((current) => current + 1);
    changed();
  }

  function updateItem(
    key: number,
    field: 'description' | 'unit' | 'quantity' | 'unitPrice',
    value: string,
  ) {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, [field]: value } : item)),
    );
    changed();
  }

  function input(): DocumentInput {
    if (items.some((item) => item.unit.trim() === '')) {
      throw new RangeError('Confirm a pricing unit for every line item.');
    }
    if (discount.trim() === '' || taxRate.trim() === '')
      throw new RangeError('Enter a discount and tax rate; use 0 when not applicable.');
    if (items.some((item) => item.quantity.trim() === '')) {
      throw new RangeError('Enter a quantity for every line item.');
    }
    const document: DocumentInput = {
      kind,
      title,
      customerId: customerId || null,
      leadId: saved?.leadId ?? leadId,
      dueDate: dueDate || null,
      notes: notes || null,
      discountAmount: Number(discount),
      taxRate: Number(taxRate),
      items: items.map((item) => ({
        serviceId: item.serviceId,
        description: item.description,
        unit: item.unit,
        quantity: Number(item.quantity),
        unitPrice: item.unitPrice.trim() === '' ? null : Number(item.unitPrice),
      })),
    };
    calculateDocumentTotals(document.items, document.discountAmount, document.taxRate);
    return document;
  }

  let totals: DocumentTotals | null = null;
  const unpricedCount = items.filter((item) => item.unitPrice.trim() === '').length;
  let totalsError = '';
  try {
    const document = input();
    totals = calculateDocumentTotals(document.items, document.discountAmount, document.taxRate);
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;
    totalsError = cause.message;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const shouldFinalize =
      event.nativeEvent instanceof globalThis.SubmitEvent &&
      event.nativeEvent.submitter?.getAttribute('value') === 'finalize';
    if (shouldFinalize && (!saved || !reviewed)) {
      setError('Save and review this draft before finalizing.');
      return;
    }
    if (shouldFinalize && unpricedCount > 0) {
      setError('Enter an exact price for every line item before finalizing.');
      return;
    }
    setError('');
    setNotice('');
    setNeedsReload(false);
    startTransition(async () => {
      let draftSaved = false;
      try {
        const payload = input();
        let result = saved
          ? await saveDocument(companyId, saved.id, saved.revision, payload)
          : await createDocument(companyId, payload);
        setSaved(result);
        setDirty(false);
        draftSaved = true;
        if (shouldFinalize) {
          result = await finalizeDocument(companyId, result.id, result.revision);
          setSaved(result);
          globalThis.scrollTo(0, 0);
          setNotice('Document finalized. It has not been sent and no payment has been collected.');
        } else {
          setNotice('Draft saved. Nothing has been sent to the customer.');
        }
        setReviewed(false);
        if (!saved) router.replace(href(`/billing/${result.id}`));
        else router.refresh();
      } catch (cause) {
        setError(
          `${draftSaved && shouldFinalize ? 'Your draft was saved, but finalization failed. ' : ''}${errorMessage(cause)}`,
        );
        setNeedsReload(cause instanceof ApiError && cause.status === 409);
      }
    });
  }

  function convert() {
    if (!saved) return;
    setError('');
    startTransition(async () => {
      try {
        const invoice = await convertEstimate(companyId, saved.id);
        router.push(href(`/billing/${invoice.id}`));
      } catch (cause) {
        setError(errorMessage(cause));
      }
    });
  }

  if (saved?.status === 'FINALIZED') {
    return (
      <>
        <Link
          className="no-print mb-5 inline-flex items-center gap-2 text-xs font-medium text-steel"
          href={href('/billing')}
        >
          <Icon name="arrow" className="rotate-180" width={14} height={14} />
          Back to documents
        </Link>
        <PageHeader
          title={`${saved.kind === 'ESTIMATE' ? 'Estimate' : 'Invoice'} ${saved.number}`}
          description="Owner-approved and locked. Your customer details and prices are preserved as they were at finalization."
          actions={
            <>
              <button className="btn-secondary" onClick={() => globalThis.print()}>
                <Icon name="print" width={16} height={16} />
                Print / save PDF
              </button>
              {saved.kind === 'ESTIMATE' &&
                (saved.invoiceId ? (
                  <Link className="btn-primary" href={href(`/billing/${saved.invoiceId}`)}>
                    Open invoice <Icon name="arrow" width={15} height={15} />
                  </Link>
                ) : (
                  <button className="btn-primary" onClick={convert} disabled={pending}>
                    {pending ? 'Please wait...' : 'Create invoice from estimate'}
                    <Icon name="arrow" width={15} height={15} />
                  </button>
                ))}
            </>
          }
        />
        <div className="no-print mb-5 flex flex-wrap items-center gap-3">
          <DocumentStatusBadge status="FINALIZED" />
          <span className="text-xs text-steel">
            Not automatically sent &middot; Payments are not collected here
          </span>
          {saved.leadId && (
            <Link className="text-xs font-medium text-ember" href={href(`/leads/${saved.leadId}`)}>
              View original conversation
            </Link>
          )}
        </div>
        <div className="no-print mb-4">
          <FormError message={error} />
        </div>
        <DocumentSheet document={saved} />
        {canApprove && <DocumentEmailPanel key={saved.id} document={saved} companyId={companyId} />}
        {saved.context && (
          <div className="mx-auto mt-6 max-w-4xl">
            <DocumentContextView context={saved.context} companyId={companyId} />
          </div>
        )}
        {saved.aiDraft && (
          <div className="mx-auto mt-6 max-w-4xl">
            <AiReview draft={saved.aiDraft} currency={currency} />
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <Link
        className="mb-5 inline-flex items-center gap-2 text-xs font-medium text-steel"
        href={href('/billing')}
      >
        <Icon name="arrow" className="rotate-180" width={14} height={14} />
        Back to documents
      </Link>
      <PageHeader
        title={
          saved
            ? `Review ${kind === 'ESTIMATE' ? 'estimate' : 'invoice'} draft`
            : `New ${kind === 'ESTIMATE' ? 'estimate' : 'invoice'}`
        }
        description="Start with your catalog, add custom items, and make the details your own. Nothing is sent automatically."
        actions={
          <span className="flex items-center gap-3">
            <DocumentStatusBadge status="DRAFT" />
            <span className="text-xs text-steel">
              {dirty ? 'Unsaved changes' : saved ? 'Saved draft' : 'Not saved yet'}
            </span>
          </span>
        }
      />
      {saved?.aiDraft && (
        <div className="mb-5 rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
          <p className="flex items-center gap-2 text-xs font-semibold text-indigo-800">
            <Icon name="sparkles" width={17} height={17} />
            Prepared from customer messages and confirmed call details
          </p>
          <p className="mt-2 text-xs leading-relaxed text-steel">
            Services were matched to your catalog. Quantities start at 1; confirm the actual scope
            and pricing before approval.
          </p>
        </div>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-700">
          {notice}
        </p>
      )}
      {saved?.context && (
        <div className="mb-5">
          <DocumentContextView context={saved.context} companyId={companyId} />
        </div>
      )}
      <form onSubmit={submit}>
        <fieldset
          disabled={pending}
          className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]"
        >
          <div className="min-w-0 space-y-6">
            <section className="panel p-5 sm:p-6">
              <h2 className="mb-5 text-sm font-semibold">Document details</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {!saved && (
                  <Field label="Document type">
                    <select
                      className="field"
                      value={kind}
                      onChange={(event) => {
                        if (event.target.value === 'ESTIMATE' || event.target.value === 'INVOICE') {
                          setKind(event.target.value);
                          changed();
                        }
                      }}
                    >
                      <option value="ESTIMATE">Estimate</option>
                      <option value="INVOICE">Invoice</option>
                    </select>
                  </Field>
                )}
                <Field label="Document title">
                  <input
                    className="field"
                    required
                    maxLength={160}
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      changed();
                    }}
                  />
                </Field>
                <Field label="Customer" hint="A customer is required before finalization.">
                  <select
                    className="field"
                    value={customerId}
                    onChange={(event) => {
                      setCustomerId(event.target.value);
                      changed();
                    }}
                  >
                    <option value="">Choose a customer</option>
                    {customers
                      .filter((customer) => !customer.isArchived || customer.id === customerId)
                      .map((customer) => (
                        <option value={customer.id} key={customer.id}>
                          {customer.name}
                          {customer.isArchived ? ' (archived)' : ''}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field
                  label={kind === 'ESTIMATE' ? 'Valid until (optional)' : 'Due date (optional)'}
                >
                  <input
                    type="date"
                    className="field"
                    value={dueDate}
                    onChange={(event) => {
                      setDueDate(event.target.value);
                      changed();
                    }}
                  />
                </Field>
              </div>
              {customers.filter((customer) => !customer.isArchived).length === 0 && (
                <p className="mt-4 text-xs text-amber-700">
                  Add a customer in the{' '}
                  <Link
                    className="font-semibold underline underline-offset-2"
                    href={href('/customers')}
                  >
                    customer directory
                  </Link>{' '}
                  before finalizing.
                </p>
              )}
              {saved?.leadId && (
                <Link
                  className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-ember"
                  href={href(`/leads/${saved.leadId}`)}
                >
                  <Icon name="link" width={14} height={14} />
                  View linked conversation
                </Link>
              )}
              {saved?.sourceEstimateId && (
                <Link
                  className="mt-4 block text-xs font-medium text-ember"
                  href={href(`/billing/${saved.sourceEstimateId}`)}
                >
                  View source estimate
                </Link>
              )}
            </section>

            <section className="panel p-5 sm:p-6">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">Line items</h2>
                <span className="text-[11px] text-steel">
                  {items.length} / 100 items &middot; {currency}
                </span>
              </div>
              <div className="mb-5 flex flex-col gap-2 sm:flex-row">
                <select
                  className="field flex-1"
                  aria-label="Add a service from your catalog"
                  value=""
                  onChange={(event) => {
                    const service = services.find(
                      (entry) => entry.id === event.target.value && entry.isActive,
                    );
                    if (service) addItem(service);
                  }}
                >
                  <option value="">Add from service catalog...</option>
                  {services
                    .filter((service) => service.isActive)
                    .map((service) => (
                      <option value={service.id} key={service.id}>
                        {service.name} - {service.pricingType === 'RANGE' ? 'Estimated ' : ''}
                        {formatServicePrice(service, currency)}
                        {service.pricingType !== 'QUOTE_REQUIRED' ? ` / ${service.unit}` : ''}
                      </option>
                    ))}
                </select>
                <button className="btn-secondary shrink-0" type="button" onClick={() => addItem()}>
                  <Icon name="plus" width={15} height={15} />
                  Custom item
                </button>
              </div>
              {items.length === 0 ? (
                <EmptyState
                  icon="services"
                  title="What does this job include?"
                  description="Choose a service from your catalog or add a custom line item. Prices remain fully editable."
                />
              ) : (
                <div className="space-y-3">
                  {items.map((item, index) => {
                    const service = services.find((entry) => entry.id === item.serviceId);
                    return (
                      <div
                        className={`rounded-lg border p-3 ${item.unitPrice.trim() === '' ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200/80 bg-slate-50/30'}`}
                        key={item.key}
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            Item {String(index + 1).padStart(2, '0')}
                          </span>
                          <button
                            className="btn-icon h-7 w-7 hover:text-rose-600"
                            type="button"
                            aria-label={`Remove item ${index + 1}`}
                            onClick={() => {
                              setItems((current) =>
                                current.filter((entry) => entry.key !== item.key),
                              );
                              changed();
                            }}
                          >
                            <Icon name="trash" width={14} height={14} />
                          </button>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_65px_80px_100px]">
                          <Field label={`Description ${index + 1}`}>
                            <input
                              className="field"
                              required
                              maxLength={1000}
                              value={item.description}
                              onChange={(event) =>
                                updateItem(item.key, 'description', event.target.value)
                              }
                              placeholder="Describe the service or item"
                            />
                          </Field>
                          <Field label={`Quantity ${index + 1}`}>
                            <input
                              type="number"
                              className="field tabular-nums"
                              required
                              min="0.01"
                              max="10000"
                              step="0.01"
                              value={item.quantity}
                              onChange={(event) =>
                                updateItem(item.key, 'quantity', event.target.value)
                              }
                            />
                          </Field>
                          <Field label={`Pricing unit ${index + 1}`}>
                            <input
                              className="field"
                              required
                              maxLength={40}
                              value={item.unit}
                              onChange={(event) => updateItem(item.key, 'unit', event.target.value)}
                              placeholder="job, hour..."
                            />
                          </Field>
                          <Field label={`Unit price ${index + 1}`}>
                            <input
                              type="number"
                              className="field tabular-nums"
                              min="0"
                              max="1000000"
                              step="0.01"
                              value={item.unitPrice}
                              placeholder="Price required"
                              onChange={(event) =>
                                updateItem(item.key, 'unitPrice', event.target.value)
                              }
                            />
                          </Field>
                        </div>
                        {(item.unitPrice.trim() === '' ||
                          (service && service.pricingType !== 'FIXED')) && (
                          <p className="mt-2 text-[11px] leading-relaxed text-amber-700">
                            {service &&
                              service.pricingType !== 'FIXED' &&
                              `Catalog guidance: ${service.pricingType === 'RANGE' ? 'estimated ' : ''}${formatServicePrice(service, currency)}. `}
                            {item.unitPrice.trim() === ''
                              ? 'Enter an exact price before finalizing. Blank does not mean free.'
                              : 'The exact price entered applies only to this document.'}
                          </p>
                        )}
                        {saved?.aiDraft?.matches.some(
                          (match) => match.serviceId === item.serviceId,
                        ) && (
                          <p className="mt-2 flex items-center gap-1.5 text-[10px] text-indigo-500">
                            <Icon name="sparkles" width={12} height={12} />
                            AI catalog match &middot; Review and edit as needed
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="panel p-5 sm:p-6">
              <Field
                label="Customer-facing notes & terms"
                hint="Included on the finalized estimate or invoice."
              >
                <textarea
                  className="field min-h-28 resize-y"
                  maxLength={5000}
                  value={notes}
                  onChange={(event) => {
                    setNotes(event.target.value);
                    changed();
                  }}
                  placeholder="What's included, exclusions, payment terms, or other details..."
                />
              </Field>
            </section>
            {saved?.aiDraft && <AiReview draft={saved.aiDraft} currency={currency} />}
          </div>

          <aside className="panel p-5 xl:sticky xl:top-[92px]">
            <h2 className="text-sm font-semibold">Document summary</h2>
            <p className="mb-5 mt-1 text-xs text-steel">{companyName}</p>
            <div className="mb-5 grid grid-cols-2 gap-3">
              <Field label={`Discount (${currency})`}>
                <input
                  className="field"
                  type="number"
                  required
                  min={0}
                  max={1000000}
                  step="0.01"
                  value={discount}
                  onChange={(event) => {
                    setDiscount(event.target.value);
                    changed();
                  }}
                />
              </Field>
              <Field label="Tax rate (%)">
                <input
                  className="field"
                  type="number"
                  required
                  min={0}
                  max={100}
                  step="0.01"
                  value={taxRate}
                  onChange={(event) => {
                    setTaxRate(event.target.value);
                    changed();
                  }}
                />
              </Field>
            </div>
            {totals ? (
              <Totals totals={totals} currency={currency} taxRate={Number(taxRate)} />
            ) : totalsError ? (
              <FormError message={totalsError} />
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
                <p className="font-semibold">Pricing required</p>
                <p className="mt-1">
                  {unpricedCount} {unpricedCount === 1 ? 'item needs' : 'items need'} an exact
                  price. You can save this draft, but totals and final approval are unavailable
                  until all items are priced.
                </p>
              </div>
            )}
            <div className="mt-6 space-y-3 border-t border-slate-100 pt-5">
              <FormError message={error} />
              {needsReload && saved && (
                <a
                  className="block text-xs font-semibold text-ember underline"
                  href={href(`/billing/${saved.id}`)}
                >
                  Reload the latest document before editing
                </a>
              )}
              <button
                type="submit"
                value="save"
                className="btn-secondary w-full"
                disabled={pending}
              >
                {pending ? 'Saving...' : saved ? 'Save draft' : 'Create draft'}
              </button>
              {saved && canApprove ? (
                <>
                  <label className="flex items-start gap-2.5 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-indigo-600"
                      checked={reviewed}
                      disabled={unpricedCount > 0 || !totals}
                      onChange={(event) => setReviewed(event.target.checked)}
                    />
                    <span>
                      I have reviewed the customer, scope, quantities, prices, and applicable tax.
                    </span>
                  </label>
                  <button
                    type="submit"
                    value="finalize"
                    className="btn-primary w-full"
                    disabled={pending || !reviewed || items.length === 0 || !customerId || !totals}
                  >
                    {pending
                      ? 'Saving...'
                      : `Finalize ${kind === 'ESTIMATE' ? 'estimate' : 'invoice'}`}
                    <Icon name="check" width={16} height={16} />
                  </button>
                </>
              ) : (
                <p className="text-xs leading-relaxed text-steel">
                  {saved
                    ? 'This draft is ready for an owner to review. Staff cannot finalize or send financial documents.'
                    : 'Create the draft first. Then an owner can review and approve it before finalization.'}
                </p>
              )}
              <p className="text-[11px] leading-relaxed text-steel">
                Finalization locks the document and assigns its number. It does not send it to the
                customer or collect payment.
              </p>
            </div>
          </aside>
        </fieldset>
      </form>
    </>
  );
}
