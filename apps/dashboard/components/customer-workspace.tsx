'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';

import { errorMessage, saveCustomer, type CustomerDetail, type CustomerRecord } from '../lib/api';
import { formatDate, initials } from '../lib/format';
import { workspaceHref } from '../lib/navigation';
import { DocumentTable } from './document-table';
import { Icon } from './icon';
import { LeadsTable } from './leads-table';
import { EmptyState, Field, FormError, PageHeader, SearchInput } from './ui';
import { CallNoteHistory, FollowUpHistory } from './workflow-history';
import { DocumentActions } from './document-actions';

function CustomerForm({
  companyId,
  customer,
  onSaved,
  onCancel,
}: {
  companyId: string;
  customer?: CustomerRecord;
  onSaved: (record: CustomerRecord) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [email, setEmail] = useState(customer?.email ?? '');
  const [address, setAddress] = useState(customer?.address ?? '');
  const [notes, setNotes] = useState(customer?.notes ?? '');
  const [isArchived, setArchived] = useState(customer?.isArchived ?? false);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    startTransition(async () => {
      try {
        const saved = await saveCustomer(
          companyId,
          {
            name,
            phone: phone || null,
            email: email || null,
            address: address || null,
            notes: notes || null,
            isArchived,
          },
          customer?.id,
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
        <h2 className="text-sm font-semibold text-ink">
          {customer ? 'Edit customer' : 'New customer'}
        </h2>
        <button
          type="button"
          className="btn-icon"
          onClick={onCancel}
          disabled={pending}
          aria-label="Close customer form"
        >
          <Icon name="close" width={18} height={18} />
        </button>
      </div>
      <fieldset disabled={pending} className="space-y-4">
        <Field label="Customer name">
          <input
            className="field"
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Full name or business name"
            autoFocus
          />
        </Field>
        <Field label="Phone number">
          <input
            type="tel"
            className="field"
            maxLength={40}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+1 555 123 4567"
          />
        </Field>
        <Field label="Email address">
          <input
            type="email"
            className="field"
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="customer@example.com"
          />
        </Field>
        <Field label="Service address / area">
          <textarea
            className="field min-h-20 resize-y"
            maxLength={500}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Street address and service area"
          />
        </Field>
        <Field
          label="Internal notes"
          hint="Only for your workspace. Not included on customer documents."
        >
          <textarea
            className="field min-h-24 resize-y"
            maxLength={3000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Useful context for your team..."
          />
        </Field>
        {customer && (
          <label className="flex items-start gap-2.5 text-xs text-steel">
            <input
              type="checkbox"
              className="mt-0.5 accent-indigo-600"
              checked={isArchived}
              onChange={(event) => setArchived(event.target.checked)}
            />
            <span>
              Archive this customer{' '}
              <span className="mt-1 block text-[11px]">
                Keeps conversations and documents intact.
              </span>
            </span>
          </label>
        )}
        <FormError message={error} />
        <button className="btn-primary w-full" type="submit" disabled={pending}>
          {pending ? 'Saving customer...' : 'Save customer'}
        </button>
      </fieldset>
    </form>
  );
}

export function CustomerDirectory({
  initialCustomers,
  companyId,
}: {
  initialCustomers: CustomerRecord[];
  companyId: string;
}) {
  const router = useRouter();
  const [customers, setCustomers] = useState(initialCustomers);
  const [editing, setEditing] = useState<CustomerRecord | 'new' | null>(null);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [notice, setNotice] = useState('');
  const search = query.trim().toLowerCase();
  const visible = customers.filter(
    (customer) =>
      (showArchived || !customer.isArchived) &&
      [customer.name, customer.phone, customer.email, customer.address].some((value) =>
        value?.toLowerCase().includes(search),
      ),
  );

  function saved(record: CustomerRecord) {
    setCustomers((current) => [record, ...current.filter((customer) => customer.id !== record.id)]);
    setEditing(null);
    setNotice('Customer saved. Their history stays connected to this workspace.');
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Customers"
        description="One place for your customer relationships, contact details, conversations, and documents."
        actions={
          <button
            className="btn-primary"
            onClick={() => {
              setEditing('new');
              setNotice('');
            }}
          >
            <Icon name="plus" width={16} height={16} />
            Add customer
          </button>
        }
      />
      {notice && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-700"
        >
          {notice}
        </p>
      )}
      <div
        className={`grid items-start gap-6 ${editing ? 'xl:grid-cols-[minmax(0,1fr)_340px]' : ''}`}
      >
        <section className="min-w-0 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SearchInput value={query} onChange={setQuery} placeholder="Search customers..." />
            <label className="flex items-center gap-2 text-xs text-steel">
              <input
                type="checkbox"
                className="accent-indigo-600"
                checked={showArchived}
                onChange={(event) => setShowArchived(event.target.checked)}
              />
              Include archived
            </label>
          </div>
          <div className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-xs font-semibold text-ink">Customer directory</h2>
              <span className="text-xs text-steel">
                {visible.length} {visible.length === 1 ? 'customer' : 'customers'}
              </span>
            </div>
            {visible.length === 0 ? (
              <EmptyState
                icon="users"
                title={
                  search
                    ? 'No customers match your search'
                    : 'Your customer relationships start here'
                }
                description={
                  search
                    ? 'Try a different name, phone number, or email address.'
                    : 'Add a customer here, or link a recovered lead to a customer from its conversation.'
                }
                action={
                  !search && (
                    <button className="btn-secondary" onClick={() => setEditing('new')}>
                      <Icon name="plus" width={15} height={15} />
                      Add your first customer
                    </button>
                  )
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[650px] text-left">
                  <thead className="bg-slate-50/60">
                    <tr>
                      {['Customer', 'Contact details', 'History', 'Added'].map((label) => (
                        <th scope="col" key={label} className="table-heading">
                          {label}
                        </th>
                      ))}
                      <th scope="col" className="table-heading">
                        <span className="sr-only">Edit customer</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visible.map((customer) => (
                      <tr key={customer.id} className="hover:bg-slate-50/70">
                        <td className="table-cell">
                          <Link
                            href={workspaceHref(`/customers/${customer.id}`, companyId)}
                            className="flex items-center gap-3"
                          >
                            <span className="avatar h-10 w-10 text-xs">
                              {initials(customer.name)}
                            </span>
                            <span>
                              <span className="block text-sm font-semibold text-ink">
                                {customer.name}
                              </span>
                              <span className="mt-1 block text-[11px] text-steel">
                                {customer.isArchived
                                  ? 'Archived customer'
                                  : (customer.address ?? 'No address added')}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td className="table-cell">
                          <p className="whitespace-nowrap text-xs text-slate-600">
                            {customer.email ?? 'No email added'}
                          </p>
                          <p className="mt-1 text-xs text-steel">
                            {customer.phone ?? 'No phone added'}
                          </p>
                        </td>
                        <td className="table-cell whitespace-nowrap">
                          <p className="text-xs font-medium text-slate-600">
                            {customer.leadCount} {customer.leadCount === 1 ? 'lead' : 'leads'}
                          </p>
                          <p className="mt-1 text-[11px] text-steel">
                            {customer.documentCount} documents
                          </p>
                        </td>
                        <td className="table-cell whitespace-nowrap text-xs text-steel">
                          {formatDate(customer.createdAt)}
                        </td>
                        <td className="table-cell">
                          <button
                            className="btn-icon"
                            aria-label={`Edit ${customer.name}`}
                            onClick={() => {
                              setEditing(customer);
                              setNotice('');
                            }}
                          >
                            <Icon name="edit" width={16} height={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
        {editing && (
          <aside className="order-first xl:order-last">
            <CustomerForm
              key={editing === 'new' ? 'new' : editing.id}
              companyId={companyId}
              customer={editing === 'new' ? undefined : editing}
              onSaved={saved}
              onCancel={() => setEditing(null)}
            />
          </aside>
        )}
      </div>
    </>
  );
}

export function CustomerProfile({
  customer,
  companyId,
  timeZone,
}: {
  customer: CustomerDetail;
  companyId: string;
  timeZone: string;
}) {
  const router = useRouter();
  const [record, setRecord] = useState<CustomerRecord>(customer);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');
  const href = (path: string) => workspaceHref(path, companyId);
  return (
    <>
      <Link
        href={href('/customers')}
        className="mb-5 inline-flex items-center gap-2 text-xs font-medium text-steel"
      >
        <Icon name="arrow" className="rotate-180" width={14} height={14} />
        Back to customers
      </Link>
      <PageHeader
        title={record.name}
        description="A connected history of conversations, opportunities, estimates, and invoices."
        actions={
          <>
            <button className="btn-secondary" onClick={() => setEditing(true)}>
              <Icon name="edit" width={15} height={15} />
              Edit customer
            </button>
            {!record.isArchived && (
              <Link
                className="btn-secondary"
                href={workspaceHref('/call-notes/new', companyId, { customerId: record.id })}
              >
                <Icon name="note" width={15} height={15} />
                Add call note
              </Link>
            )}
            {!record.isArchived && (
              <Link
                className="btn-primary"
                href={workspaceHref('/billing/new', companyId, { customerId: record.id })}
              >
                <Icon name="plus" width={16} height={16} />
                New estimate
              </Link>
            )}
          </>
        }
      />
      {notice && (
        <p role="status" className="mb-5 text-xs font-medium text-emerald-700">
          {notice}
        </p>
      )}
      <div className="grid items-start gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside>
          {editing ? (
            <CustomerForm
              key={record.updatedAt}
              companyId={companyId}
              customer={record}
              onCancel={() => setEditing(false)}
              onSaved={(saved) => {
                setRecord(saved);
                setEditing(false);
                setNotice('Customer updated.');
                router.refresh();
              }}
            />
          ) : (
            <section className="panel p-6">
              <span className="avatar h-14 w-14 text-lg">{initials(record.name)}</span>
              <h2 className="mt-4 text-base font-semibold text-ink">{record.name}</h2>
              <p className="mt-1 text-xs text-steel">
                {record.isArchived
                  ? 'Archived customer'
                  : `Customer since ${formatDate(record.createdAt)}`}
              </p>
              <dl className="mt-6 space-y-5 text-sm">
                <div>
                  <dt className="text-[11px] font-medium text-steel">Phone number</dt>
                  <dd className="mt-1.5 break-all text-xs font-medium">
                    {record.phone ? (
                      <a href={`tel:${record.phone}`} className="hover:text-ember">
                        {record.phone}
                      </a>
                    ) : (
                      'Not added'
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-steel">Email address</dt>
                  <dd className="mt-1.5 break-all text-xs font-medium">
                    {record.email ? (
                      <a href={`mailto:${record.email}`} className="hover:text-ember">
                        {record.email}
                      </a>
                    ) : (
                      'Not added'
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-steel">Service address / area</dt>
                  <dd className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed">
                    {record.address ?? 'Not added'}
                  </dd>
                </div>
              </dl>
              <div className="mt-6 border-t border-slate-100 pt-5">
                <h3 className="text-xs font-semibold text-ink">Internal notes</h3>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-steel">
                  {record.notes ?? 'No internal notes yet.'}
                </p>
              </div>
            </section>
          )}
        </aside>
        <div className="min-w-0 space-y-7">
          {!record.isArchived && (
            <DocumentActions
              companyId={companyId}
              customerId={record.id}
              notes={customer.callNotes}
              leads={customer.leads}
              documents={customer.documents}
            />
          )}
          <CallNoteHistory notes={customer.callNotes} companyId={companyId} timeZone={timeZone} />
          <FollowUpHistory tasks={customer.followUps} companyId={companyId} timeZone={timeZone} />
          <section>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Estimates &amp; invoices</h2>
              <span className="text-xs text-steel">{customer.documents.length} documents</span>
            </div>
            <DocumentTable documents={customer.documents} companyId={companyId} />
          </section>
          <section>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Lead &amp; conversation history</h2>
              <span className="text-xs text-steel">{customer.leads.length} leads</span>
            </div>
            <LeadsTable leads={customer.leads} companyId={companyId} />
          </section>
        </div>
      </div>
    </>
  );
}
