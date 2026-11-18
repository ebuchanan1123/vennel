'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { businessLocalInput, businessLocalToUtc } from '@lead-recovery/types';

import {
  analyzeCallNote,
  errorMessage,
  saveCallNote,
  type CallNote,
  type CustomerRecord,
  type Lead,
  type WorkspaceSettings,
} from '../lib/api';
import { workspaceHref } from '../lib/navigation';
import { Icon } from './icon';
import { Field, FormError, PageHeader } from './ui';
import { VoiceNoteCapture } from './voice-note-capture';

export function CallNoteCapture({
  companyId,
  customers,
  leads,
  settings,
  initialCustomerId,
  initialLeadId,
  initialNote,
}: {
  companyId: string;
  customers: CustomerRecord[];
  leads: Lead[];
  settings: Pick<WorkspaceSettings, 'now' | 'timeZone'>;
  initialCustomerId?: string;
  initialLeadId?: string;
  initialNote?: CallNote;
}) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(initialNote?.customerId ?? initialCustomerId ?? '');
  const [leadId, setLeadId] = useState(initialNote?.leadId ?? initialLeadId ?? '');
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [name, setName] = useState('');
  const [text, setText] = useState(initialNote?.text ?? '');
  const [direction, setDirection] = useState<'INBOUND' | 'OUTBOUND'>(
    initialNote?.direction ?? 'INBOUND',
  );
  const [occurredAt, setOccurredAt] = useState(
    businessLocalInput(initialNote?.occurredAt ?? settings.now, settings.timeZone),
  );
  const [phone, setPhone] = useState(
    initialNote?.phone ??
      leads.find((lead) => lead.id === initialLeadId)?.phone ??
      customers.find((customer) => customer.id === initialCustomerId)?.phone ??
      '',
  );
  const [saved, setSaved] = useState<CallNote | undefined>(initialNote);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const href = (path: string) => workspaceHref(path, companyId);

  function metadata() {
    return {
      customerId: creatingCustomer ? null : customerId || null,
      leadId: leadId || null,
      direction,
      occurredAt: businessLocalToUtc(occurredAt, settings.timeZone),
      phone: phone || null,
    };
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const analyze =
      event.nativeEvent instanceof globalThis.SubmitEvent &&
      event.nativeEvent.submitter?.getAttribute('value') === 'analyze';
    setError('');
    startTransition(async () => {
      let result = saved;
      try {
        result = await saveCallNote(
          companyId,
          {
            ...metadata(),
            text,
            ...(creatingCustomer
              ? {
                  newCustomer: {
                    name,
                    phone: phone || null,
                    email: null,
                    address: null,
                    notes: null,
                  },
                }
              : {}),
          },
          saved,
        );
        setSaved(result);
        setCustomerId(result.customerId ?? '');
        setCreatingCustomer(false);
        if (analyze) result = await analyzeCallNote(companyId, result.id, result.revision);
        router.push(href(`/call-notes/${result.id}`));
      } catch (cause) {
        setError(`${result ? 'Your note is saved. ' : ''}${errorMessage(cause)}`);
      }
    });
  }
  const matching = customers.filter(
    (customer) =>
      !customer.isArchived &&
      customer.phone &&
      phone &&
      customer.phone.replace(/\D/g, '') === phone.replace(/\D/g, ''),
  );
  return (
    <>
      <PageHeader
        title={initialNote ? 'Edit call note' : 'Add call note'}
        description="Finished a call? Capture the important details now. The original summary stays separate from SMS history."
      />
      <form onSubmit={submit} className="mx-auto max-w-3xl space-y-5">
        <section className="panel p-5 sm:p-6">
          {saved?.source !== 'VOICE' && !pending && (
            <VoiceNoteCapture
              companyId={companyId}
              metadata={metadata}
              onTranscribed={(note) => {
                setSaved(note);
                setText((current) =>
                  current.trim() ? `${current.trim()}\n\n${note.text}` : note.text,
                );
                setError('');
              }}
            />
          )}
          <div className="mt-5">
            <Field
              label="What happened on the call?"
              hint="Include requested work, prices discussed, appointments, materials, and the next step."
            >
              <textarea
                className="field min-h-44 resize-y"
                disabled={pending}
                required
                maxLength={12000}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Spoke with the customer about..."
                autoFocus
              />
            </Field>
          </div>
          {saved?.source === 'VOICE' && (
            <p role="status" className="mt-3 text-xs text-indigo-700">
              Transcription draft saved. Review and edit the text before applying any information.
            </p>
          )}
        </section>
        <fieldset disabled={pending} className="panel space-y-4 p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Customer (optional until review)">
              <select
                className="field"
                value={creatingCustomer ? 'new' : customerId}
                onChange={(event) => {
                  setCreatingCustomer(event.target.value === 'new');
                  setCustomerId(event.target.value === 'new' ? '' : event.target.value);
                }}
              >
                <option value="">Choose during review</option>
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
            {creatingCustomer && (
              <Field label="New customer name">
                <input
                  className="field"
                  required
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
            )}
            <Field label="Associated lead (optional)">
              <select
                className="field"
                value={leadId}
                onChange={(event) => setLeadId(event.target.value)}
              >
                <option value="">No associated lead</option>
                {leads
                  .filter(
                    (lead) => !customerId || !lead.customerId || lead.customerId === customerId,
                  )
                  .map((lead) => (
                    <option key={lead.id} value={lead.id}>
                      {lead.customer?.name ?? lead.phone} -{' '}
                      {lead.serviceType ?? lead.projectType ?? 'Inquiry'}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Call direction">
              <select
                className="field"
                value={direction}
                onChange={(event) => {
                  if (event.target.value === 'INBOUND' || event.target.value === 'OUTBOUND')
                    setDirection(event.target.value);
                }}
              >
                <option value="INBOUND">Customer called us</option>
                <option value="OUTBOUND">We called the customer</option>
              </select>
            </Field>
            <Field label="Approximate call time" hint={settings.timeZone}>
              <input
                className="field"
                type="datetime-local"
                required
                value={occurredAt}
                onChange={(event) => setOccurredAt(event.target.value)}
              />
            </Field>
            <Field label="Phone number (optional)">
              <input
                className="field"
                type="tel"
                maxLength={40}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </Field>
          </div>
          {matching.length > 0 && !customerId && (
            <p className="rounded-lg bg-indigo-50 p-3 text-xs text-indigo-700">
              Matching phone: {matching.map((customer) => customer.name).join(', ')}. Confirm the
              correct customer instead of creating a duplicate.
            </p>
          )}
          <FormError message={error} />
          {saved && error && (
            <Link
              className="block text-sm font-medium text-ember"
              href={href(`/call-notes/${saved.id}`)}
            >
              Open the saved note and review manually
            </Link>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button type="submit" value="save" className="btn-secondary" disabled={pending}>
              Save &amp; review manually
            </button>
            <button type="submit" value="analyze" className="btn-primary" disabled={pending}>
              <Icon name="sparkles" width={16} height={16} />
              {pending ? 'Saving...' : 'Save & analyze'}
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-steel">
            Analysis creates suggestions only. Prices, bookings, customer records, and follow-ups
            require your confirmation.
          </p>
        </fieldset>
      </form>
    </>
  );
}
