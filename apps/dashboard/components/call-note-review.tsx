'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import {
  NOTE_INFORMATION_FIELDS,
  FOLLOW_UP_TYPES,
  NOTE_FIELD_FACTS,
  businessLocalInput,
  businessLocalToUtc,
  emptyCallNoteExtraction,
  formatBusinessTime,
  type ConfirmationField,
  type NoteFactKey,
  type NoteFacts,
} from '@lead-recovery/types';

import {
  analyzeCallNote,
  errorMessage,
  reviewCallNote,
  type CallNote,
  type CallNoteExtraction,
  type CustomerRecord,
  type FollowUpTask,
  type Lead,
  type WorkspaceSettings,
  type BillingDocument,
} from '../lib/api';
import { workspaceHref } from '../lib/navigation';
import { Icon } from './icon';
import { Field, FormError, PageHeader } from './ui';
import { FollowUpHistory } from './workflow-history';
import { DocumentActions } from './document-actions';

const labels: Record<keyof NoteFacts, string> = {
  customerName: 'Customer name',
  phone: 'Phone number',
  email: 'Email',
  serviceType: 'Service requested',
  issue: 'Problem description',
  location: 'Address / service area',
  urgency: 'Urgency',
  preferredTime: 'Preferred time',
  projectType: 'Project type',
  budgetRange: 'Budget range',
  timeline: 'Timeline',
  propertyOwner: 'Property owner',
};
const targets: Record<keyof NoteFacts | 'summary', ConfirmationField[]> = {
  customerName: ['customer.name'],
  phone: ['customer.phone'],
  email: ['customer.email'],
  location: ['customer.address', 'lead.location'],
  serviceType: ['lead.serviceType'],
  issue: ['lead.issue'],
  urgency: ['lead.urgency'],
  preferredTime: ['lead.preferredTime'],
  projectType: ['lead.projectType'],
  budgetRange: ['lead.budgetRange'],
  timeline: ['lead.timeline'],
  propertyOwner: ['lead.propertyOwner'],
  summary: ['lead.summary'],
};

function toggle<T>(values: Set<T>, value: T): Set<T> {
  const result = new Set(values);
  if (result.has(value)) result.delete(value);
  else result.add(value);
  return result;
}

export function CallNoteReview({
  note,
  companyId,
  customers,
  leads,
  settings,
  tasks,
  documents,
}: {
  note: CallNote;
  companyId: string;
  customers: CustomerRecord[];
  leads: Lead[];
  settings: Pick<WorkspaceSettings, 'now' | 'timeZone'>;
  tasks: FollowUpTask[];
  documents: BillingDocument[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<CallNoteExtraction>(() =>
    structuredClone(
      note.confirmedData ??
        note.extraction ?? { ...emptyCallNoteExtraction(), summary: note.text.slice(0, 4000) },
    ),
  );
  const [customerId, setCustomerId] = useState(note.customerId ?? '');
  const [leadId, setLeadId] = useState(note.leadId ?? '');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState(note.extraction?.facts.customerName.value ?? '');
  const [newPhone, setNewPhone] = useState(note.extraction?.facts.phone.value ?? note.phone ?? '');
  const [newEmail, setNewEmail] = useState(note.extraction?.facts.email.value ?? '');
  const [accepted, setAccepted] = useState(new Set<NoteFactKey>());
  const [applied, setApplied] = useState(new Set<ConfirmationField>());
  const [replacements, setReplacements] = useState(new Set<ConfirmationField>());
  const [acceptedActions, setAcceptedActions] = useState(new Set<number>());
  const [actionTimes, setActionTimes] = useState(() =>
    draft.actions.map((action) =>
      action.dueAt ? businessLocalInput(action.dueAt, settings.timeZone) : '',
    ),
  );
  const [appointmentTime, setAppointmentTime] = useState(
    draft.appointment.startsAt
      ? businessLocalInput(draft.appointment.startsAt, settings.timeZone)
      : '',
  );
  const [showMissing, setShowMissing] = useState(!note.extraction);
  const [confirmedReview, setConfirmedReview] = useState(false);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const selectedCustomer = customers.find((customer) => customer.id === customerId);
  const selectedLead = leads.find((lead) => lead.id === leadId);
  const href = (path: string) => workspaceHref(path, companyId);

  function setFact<K extends keyof NoteFacts>(key: K, value: NoteFacts[K]['value']) {
    setDraft((current) => ({
      ...current,
      facts: { ...current.facts, [key]: { ...current.facts[key], value } },
    }));
    setConfirmedReview(false);
    setReplacements(
      (current) => new Set([...current].filter((field) => !targets[key].includes(field))),
    );
  }
  function currentValue(target: ConfirmationField): string | boolean | null {
    switch (target) {
      case 'customer.name':
        return selectedCustomer?.name ?? null;
      case 'customer.phone':
        return selectedCustomer?.phone ?? null;
      case 'customer.email':
        return selectedCustomer?.email ?? null;
      case 'customer.address':
        return selectedCustomer?.address ?? null;
      case 'lead.serviceType':
        return selectedLead?.serviceType ?? null;
      case 'lead.issue':
        return selectedLead?.issue ?? null;
      case 'lead.location':
        return selectedLead?.location ?? null;
      case 'lead.urgency':
        return selectedLead?.urgency ?? null;
      case 'lead.preferredTime':
        return selectedLead?.preferredTime ?? null;
      case 'lead.projectType':
        return selectedLead?.projectType ?? null;
      case 'lead.budgetRange':
        return selectedLead?.budgetRange ?? null;
      case 'lead.timeline':
        return selectedLead?.timeline ?? null;
      case 'lead.propertyOwner':
        return selectedLead?.propertyOwner ?? null;
      case 'lead.summary':
        return selectedLead?.summary ?? null;
    }
  }
  function recordChoices(key: keyof NoteFacts | 'summary', value: string | boolean | null) {
    if (!accepted.has(key)) return null;
    return (
      <div className="mt-2 space-y-2">
        {targets[key]
          .filter((target) =>
            target.startsWith('customer.')
              ? Boolean(selectedCustomer && !creating)
              : Boolean(selectedLead),
          )
          .map((target) => {
            const old = currentValue(target);
            const different = old !== null && old !== '' && old !== value;
            return (
              <div key={target} className="text-[11px] leading-relaxed">
                <label className="flex items-start gap-2 text-steel">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-indigo-600"
                    checked={applied.has(target)}
                    onChange={() => {
                      setApplied((current) => toggle(current, target));
                      setConfirmedReview(false);
                    }}
                  />
                  <span>
                    Update {target}{' '}
                    {old !== null && (
                      <span className="block text-slate-400">Current: {String(old)}</span>
                    )}
                  </span>
                </label>
                {applied.has(target) && different && (
                  <label className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-amber-800">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-amber-600"
                      checked={replacements.has(target)}
                      onChange={() => {
                        setReplacements((current) => toggle(current, target));
                        setConfirmedReview(false);
                      }}
                    />
                    <span>Explicitly replace this existing confirmed value.</span>
                  </label>
                )}
              </div>
            );
          })}
      </div>
    );
  }
  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!confirmedReview) {
      setError('Confirm that you reviewed the selected changes.');
      return;
    }
    startTransition(async () => {
      try {
        const information = {
          ...draft,
          appointment: {
            ...draft.appointment,
            startsAt: appointmentTime
              ? businessLocalToUtc(appointmentTime, settings.timeZone)
              : null,
          },
        };
        const selectedApply = [...applied].filter((field) => accepted.has(NOTE_FIELD_FACTS[field]));
        await reviewCallNote(companyId, note.id, {
          revision: note.revision,
          customerId: creating ? null : customerId || null,
          ...(creating
            ? {
                newCustomer: {
                  name: newName,
                  phone: newPhone || null,
                  email: newEmail || null,
                  address: null,
                  notes: null,
                },
              }
            : {}),
          leadId: leadId || null,
          confirmed: information,
          acceptFacts: [...accepted],
          applyFields: selectedApply,
          replaceFields: [...replacements].filter((field) => selectedApply.includes(field)),
          expectedCustomerUpdatedAt: creating ? null : (selectedCustomer?.updatedAt ?? null),
          expectedLeadUpdatedAt: selectedLead?.updatedAt ?? null,
          acceptedActions: [...acceptedActions].map((index) => ({
            index,
            dueAt: businessLocalToUtc(actionTimes[index] ?? '', settings.timeZone),
          })),
        });
        router.refresh();
        globalThis.scrollTo(0, 0);
      } catch (cause) {
        setError(errorMessage(cause));
      }
    });
  }
  function analyze() {
    setError('');
    startTransition(async () => {
      try {
        await analyzeCallNote(companyId, note.id, note.revision);
        router.refresh();
      } catch (cause) {
        setError(errorMessage(cause));
      }
    });
  }
  if (note.reviewStatus === 'REVIEWED') {
    return (
      <>
        <PageHeader
          title="Reviewed call note"
          description={`${formatBusinessTime(note.occurredAt, settings.timeZone)} / ${note.customer?.name ?? 'Customer'}`}
          actions={
            <>
              <Link className="btn-secondary" href={href(`/call-notes/new?noteId=${note.id}`)}>
                Edit note
              </Link>
              <Link
                className="btn-primary"
                href={workspaceHref('/follow-ups', companyId, {
                  customerId: note.customerId ?? undefined,
                  callNoteId: note.id,
                })}
              >
                Add follow-up
              </Link>
            </>
          }
        />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            <section className="panel p-6">
              <h2 className="text-sm font-semibold">Call summary</h2>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{note.text}</p>
              <p className="mt-5 text-xs text-emerald-700">
                Reviewed by the local business owner. Only explicitly selected record changes were
                applied.
              </p>
            </section>
            {note.confirmedData && (
              <section className="panel p-6">
                <h2 className="text-sm font-semibold">Confirmed information</h2>
                <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                  {NOTE_INFORMATION_FIELDS.filter(
                    (key) => note.confirmedData?.facts[key].value !== null,
                  ).map((key) => (
                    <div key={key}>
                      <dt className="text-xs text-steel">{labels[key]}</dt>
                      <dd className="mt-1 text-sm">
                        {String(note.confirmedData?.facts[key].value)}
                      </dd>
                    </div>
                  ))}
                </dl>
                {note.confirmedFields.includes('price') && (
                  <p className="mt-5 text-sm">
                    Price: {note.confirmedData.price.amount ?? 'Unknown'}{' '}
                    {note.confirmedData.price.currency ?? '(currency not specified)'} &middot;{' '}
                    {note.confirmedData.price.state.toLowerCase()}
                  </p>
                )}
                {note.confirmedFields.includes('appointment') && (
                  <p className="mt-3 text-sm">
                    Appointment: {note.confirmedData.appointment.text ?? 'Unknown'} &middot;{' '}
                    {note.confirmedData.appointment.state.toLowerCase()}
                  </p>
                )}
              </section>
            )}
            <Audit note={note} />
          </div>
          <aside className="space-y-5">
            <DocumentActions
              companyId={companyId}
              customerId={note.customerId}
              callNoteId={note.id}
              lead={leads.find((lead) => lead.id === note.leadId)}
              documents={documents}
            />
            <FollowUpHistory tasks={tasks} companyId={companyId} timeZone={settings.timeZone} />
            {note.customerId && (
              <Link className="btn-secondary w-full" href={href(`/customers/${note.customerId}`)}>
                View customer history
              </Link>
            )}
            {note.leadId && (
              <Link className="btn-secondary w-full" href={href(`/leads/${note.leadId}`)}>
                View associated lead
              </Link>
            )}
          </aside>
        </div>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title={note.extraction ? 'Review call-note suggestions' : 'Review call note manually'}
        description="Confirm what is known, keep uncertainty visible, and choose exactly which customer or lead fields to update."
        actions={
          <button className="btn-secondary" onClick={analyze} disabled={pending}>
            <Icon name="sparkles" width={15} height={15} />
            {pending ? 'Analyzing...' : 'Analyze with AI'}
          </button>
        }
      />
      <form
        onSubmit={confirm}
        onChange={(event) => {
          if (
            !(event.target instanceof HTMLInputElement) ||
            event.target.name !== 'review-approval'
          )
            setConfirmedReview(false);
        }}
      >
        <fieldset
          disabled={pending}
          className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]"
        >
          <div className="min-w-0 space-y-5">
            <section className="panel p-5">
              <h2 className="text-sm font-semibold">
                Source note {note.source === 'VOICE' ? '/ reviewed transcription' : ''}
              </h2>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{note.text}</p>
              <p className="mt-3 text-xs text-steel">
                {formatBusinessTime(note.occurredAt, settings.timeZone)} &middot; Revision{' '}
                {note.revision}
              </p>
            </section>
            <section className="panel p-5">
              <h2 className="mb-4 text-sm font-semibold">Customer &amp; history</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Customer">
                  <select
                    className="field"
                    value={creating ? 'new' : customerId}
                    required
                    onChange={(event) => {
                      setCreating(event.target.value === 'new');
                      setCustomerId(event.target.value === 'new' ? '' : event.target.value);
                      setApplied(new Set());
                      setReplacements(new Set());
                      setConfirmedReview(false);
                    }}
                  >
                    <option value="">Choose a customer</option>
                    <option value="new">Create a new customer</option>
                    {customers
                      .filter((customer) => !customer.isArchived)
                      .map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Associated lead">
                  <select
                    className="field"
                    value={leadId}
                    onChange={(event) => {
                      setLeadId(event.target.value);
                      setApplied(new Set());
                      setReplacements(new Set());
                      setConfirmedReview(false);
                    }}
                  >
                    <option value="">No associated lead</option>
                    {leads
                      .filter(
                        (lead) => !customerId || !lead.customerId || lead.customerId === customerId,
                      )
                      .map((lead) => (
                        <option value={lead.id} key={lead.id}>
                          {lead.customer?.name ?? lead.phone} /{' '}
                          {lead.serviceType ?? lead.projectType ?? 'Inquiry'}
                        </option>
                      ))}
                  </select>
                </Field>
                {creating && (
                  <>
                    <Field label="New customer name">
                      <input
                        className="field"
                        required
                        value={newName}
                        onChange={(event) => setNewName(event.target.value)}
                        maxLength={120}
                      />
                    </Field>
                    <Field label="New customer phone">
                      <input
                        className="field"
                        type="tel"
                        value={newPhone}
                        onChange={(event) => setNewPhone(event.target.value)}
                      />
                    </Field>
                    <Field label="New customer email">
                      <input
                        className="field"
                        type="email"
                        value={newEmail}
                        onChange={(event) => setNewEmail(event.target.value)}
                      />
                    </Field>
                  </>
                )}
              </div>
            </section>
            <section className="panel p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Information to review</h2>
                <button
                  type="button"
                  className="text-xs font-medium text-ember"
                  onClick={() => setShowMissing(!showMissing)}
                >
                  {showMissing ? 'Hide unknown fields' : 'Show unknown fields'}
                </button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {NOTE_INFORMATION_FIELDS.filter(
                  (key) => showMissing || draft.facts[key].value !== null,
                ).map((key) => (
                  <div key={key} className="rounded-lg border border-slate-100 p-3">
                    <label className="mb-2 flex items-center gap-2 text-xs font-semibold">
                      <input
                        type="checkbox"
                        className="accent-indigo-600"
                        checked={accepted.has(key)}
                        onChange={() => {
                          setAccepted((current) => toggle(current, key));
                          setConfirmedReview(false);
                        }}
                      />
                      Confirm {labels[key].toLowerCase()}
                    </label>
                    {key === 'urgency' ? (
                      <select
                        aria-label={labels[key]}
                        className="field"
                        value={draft.facts.urgency.value ?? ''}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (
                            value === '' ||
                            value === 'LOW' ||
                            value === 'NORMAL' ||
                            value === 'HIGH'
                          )
                            setFact('urgency', value || null);
                        }}
                      >
                        <option value="">Unknown</option>
                        <option value="LOW">Low</option>
                        <option value="NORMAL">Normal</option>
                        <option value="HIGH">High</option>
                      </select>
                    ) : key === 'propertyOwner' ? (
                      <select
                        aria-label={labels[key]}
                        className="field"
                        value={
                          draft.facts.propertyOwner.value === null
                            ? ''
                            : draft.facts.propertyOwner.value
                              ? 'yes'
                              : 'no'
                        }
                        onChange={(event) =>
                          setFact(
                            'propertyOwner',
                            event.target.value === '' ? null : event.target.value === 'yes',
                          )
                        }
                      >
                        <option value="">Unknown</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    ) : (
                      <input
                        aria-label={labels[key]}
                        className="field"
                        value={draft.facts[key].value ?? ''}
                        onChange={(event) => setFact(key, event.target.value || null)}
                      />
                    )}
                    {draft.facts[key].evidence && (
                      <blockquote className="mt-2 border-l-2 border-indigo-100 pl-2 text-[10px] leading-relaxed text-steel">
                        &ldquo;{draft.facts[key].evidence}&rdquo;
                      </blockquote>
                    )}
                    {recordChoices(key, draft.facts[key].value)}
                  </div>
                ))}
              </div>
            </section>
            <section className="panel p-5">
              <label className="mb-3 flex items-center gap-2 text-xs font-semibold">
                <input
                  type="checkbox"
                  className="accent-indigo-600"
                  checked={accepted.has('summary')}
                  onChange={() => setAccepted((current) => toggle(current, 'summary'))}
                />
                Confirm summary
              </label>
              <textarea
                className="field min-h-24"
                value={draft.summary}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, summary: event.target.value }));
                  setConfirmedReview(false);
                }}
              />
              {recordChoices('summary', draft.summary)}
            </section>
            <section className="panel p-5">
              <label className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  className="accent-indigo-600"
                  checked={accepted.has('price')}
                  onChange={() => setAccepted((current) => toggle(current, 'price'))}
                />
                Confirm price information
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Amount">
                  <input
                    className="field"
                    type="number"
                    min={0}
                    step="0.01"
                    value={draft.price.amount ?? ''}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        price: {
                          ...current.price,
                          amount: event.target.value === '' ? null : Number(event.target.value),
                        },
                      }))
                    }
                  />
                </Field>
                <Field label="Currency">
                  <input
                    className="field"
                    maxLength={3}
                    value={draft.price.currency ?? ''}
                    placeholder="Unknown"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        price: {
                          ...current.price,
                          currency: event.target.value.toUpperCase() || null,
                        },
                      }))
                    }
                  />
                </Field>
                <Field label="Price state">
                  <select
                    className="field"
                    value={draft.price.state}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === 'UNKNOWN' || value === 'PROPOSED' || value === 'AGREED')
                        setDraft((current) => ({
                          ...current,
                          price: { ...current.price, state: value },
                        }));
                    }}
                  >
                    <option value="UNKNOWN">Unknown</option>
                    <option value="PROPOSED">Proposed / quoted</option>
                    <option value="AGREED">Explicitly agreed</option>
                  </select>
                </Field>
              </div>
              <p className="mt-3 text-xs text-steel">
                This records the discussion only. It does not issue an invoice, mark a job
                completed, or record payment.
              </p>
              {draft.price.evidence && (
                <blockquote className="mt-3 border-l-2 border-indigo-100 pl-3 text-xs text-steel">
                  Original evidence: &ldquo;{draft.price.evidence}&rdquo;
                </blockquote>
              )}
            </section>
            <section className="panel p-5">
              <label className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  className="accent-indigo-600"
                  checked={accepted.has('appointment')}
                  onChange={() => setAccepted((current) => toggle(current, 'appointment'))}
                />
                Confirm appointment information
              </label>
              <div className="space-y-3">
                <Field label="Appointment description">
                  <input
                    className="field"
                    value={draft.appointment.text ?? ''}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        appointment: { ...current.appointment, text: event.target.value || null },
                      }))
                    }
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Exact time (only if known)" hint={settings.timeZone}>
                    <input
                      type="datetime-local"
                      className="field"
                      value={appointmentTime}
                      onChange={(event) => setAppointmentTime(event.target.value)}
                    />
                  </Field>
                  <Field label="Appointment state">
                    <select
                      className="field"
                      value={draft.appointment.state}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value === 'UNKNOWN' || value === 'TENTATIVE' || value === 'CONFIRMED')
                          setDraft((current) => ({
                            ...current,
                            appointment: { ...current.appointment, state: value },
                          }));
                      }}
                    >
                      <option value="UNKNOWN">Unknown</option>
                      <option value="TENTATIVE">Tentative / preferred</option>
                      <option value="CONFIRMED">Explicitly confirmed</option>
                    </select>
                  </Field>
                </div>
                <p className="text-xs text-steel">No calendar booking is created automatically.</p>
                {draft.appointment.evidence && (
                  <blockquote className="border-l-2 border-indigo-100 pl-3 text-xs text-steel">
                    Original evidence: &ldquo;{draft.appointment.evidence}&rdquo;
                  </blockquote>
                )}
              </div>
            </section>
            {draft.materials.length > 0 && (
              <section className="panel p-5">
                <label className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <input
                    type="checkbox"
                    className="accent-indigo-600"
                    checked={accepted.has('materials')}
                    onChange={() => setAccepted((current) => toggle(current, 'materials'))}
                  />
                  Confirm materials
                </label>
                <ul className="list-disc space-y-2 pl-4 text-sm">
                  {draft.materials.map((material, index) => (
                    <li key={index}>
                      <input
                        aria-label={`Material ${index + 1}`}
                        className="field"
                        value={material.text}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            materials: current.materials.map((entry, itemIndex) =>
                              itemIndex === index ? { ...entry, text: event.target.value } : entry,
                            ),
                          }))
                        }
                      />
                      <p className="text-[10px] text-steel">&ldquo;{material.evidence}&rdquo;</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <Audit note={note} />
          </div>
          <aside className="space-y-5 xl:sticky xl:top-[92px]">
            <section className="panel p-5">
              <h2 className="text-sm font-semibold">Missing or uncertain</h2>
              {draft.missingInformation.length ? (
                <ul className="mt-3 list-disc space-y-2 pl-4 text-xs leading-relaxed text-steel">
                  {draft.missingInformation.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-steel">
                  Review the source carefully; an empty list is not a guarantee of complete
                  information.
                </p>
              )}
            </section>
            <section className="panel p-5">
              <h2 className="mb-4 text-sm font-semibold">Suggested next actions</h2>
              {draft.actions.length === 0 ? (
                <p className="text-xs text-steel">
                  Create a follow-up manually after confirming this note.
                </p>
              ) : (
                <div className="space-y-4">
                  {draft.actions.map((action, index) => (
                    <div key={index} className="rounded-lg border border-slate-100 p-3">
                      <label className="flex items-start gap-2 text-xs font-medium">
                        <input
                          type="checkbox"
                          className="mt-0.5 accent-indigo-600"
                          checked={acceptedActions.has(index)}
                          onChange={() => {
                            setAcceptedActions((current) => toggle(current, index));
                            setConfirmedReview(false);
                          }}
                        />
                        <span>Create: {action.title}</span>
                      </label>
                      <details className="mt-3">
                        <summary className="cursor-pointer text-[11px] font-medium text-ember">
                          Edit suggested action
                        </summary>
                        <div className="mt-3 space-y-3">
                          <Field label={`Action title ${index + 1}`}>
                            <input
                              className="field"
                              maxLength={160}
                              value={action.title}
                              onChange={(event) =>
                                setDraft((current) => ({
                                  ...current,
                                  actions: current.actions.map((entry, itemIndex) =>
                                    itemIndex === index
                                      ? { ...entry, title: event.target.value }
                                      : entry,
                                  ),
                                }))
                              }
                            />
                          </Field>
                          <Field label={`Action type ${index + 1}`}>
                            <select
                              className="field"
                              value={action.type}
                              onChange={(event) => {
                                const type = FOLLOW_UP_TYPES.find(
                                  (value) => value === event.target.value,
                                );
                                if (type)
                                  setDraft((current) => ({
                                    ...current,
                                    actions: current.actions.map((entry, itemIndex) =>
                                      itemIndex === index ? { ...entry, type } : entry,
                                    ),
                                  }));
                              }}
                            >
                              {FOLLOW_UP_TYPES.map((type) => (
                                <option key={type} value={type}>
                                  {type.toLowerCase().replaceAll('_', ' ')}
                                </option>
                              ))}
                            </select>
                          </Field>
                        </div>
                      </details>
                      <p className="mt-2 text-[11px] text-steel">
                        {action.dueText ?? 'Confirm the due time.'}
                      </p>
                      <input
                        aria-label={`Due time for action ${index + 1}`}
                        className="field mt-3"
                        type="datetime-local"
                        required={acceptedActions.has(index)}
                        value={actionTimes[index] ?? ''}
                        onChange={(event) =>
                          setActionTimes((current) =>
                            current.map((value, itemIndex) =>
                              itemIndex === index ? event.target.value : value,
                            ),
                          )
                        }
                      />
                      <p className="mt-1 text-[10px] text-steel">{settings.timeZone}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="panel space-y-4 p-5">
              <FormError message={error} />
              <label className="flex items-start gap-2.5 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-indigo-600"
                  name="review-approval"
                  checked={confirmedReview}
                  onChange={(event) => setConfirmedReview(event.target.checked)}
                />
                <span>
                  I reviewed the selected facts, record changes, and follow-up dates. Unselected
                  facts will not update canonical records.
                </span>
              </label>
              <button
                type="submit"
                className="btn-primary w-full"
                disabled={pending || !confirmedReview}
              >
                {pending ? 'Confirming...' : 'Confirm reviewed note'}
                <Icon name="check" width={16} height={16} />
              </button>
              <p className="text-[11px] text-steel">
                No customer messages, bookings, invoices, or payments are triggered by this review.
              </p>
            </section>
          </aside>
        </fieldset>
      </form>
    </>
  );
}

function Audit({ note }: { note: CallNote }) {
  return (
    <details className="panel p-5">
      <summary className="cursor-pointer text-xs font-semibold">
        Original text &amp; audit history
      </summary>
      <p className="mt-4 whitespace-pre-wrap text-xs leading-relaxed text-steel">
        {note.originalText}
      </p>
      <ul className="mt-4 space-y-2 border-t border-slate-100 pt-4">
        {note.audits.map((audit) => (
          <li className="text-[11px] text-steel" key={audit.id}>
            Revision {audit.revision} &middot; {audit.action.toLowerCase().replaceAll('_', ' ')}{' '}
            &middot; {audit.actor}
          </li>
        ))}
      </ul>
    </details>
  );
}
