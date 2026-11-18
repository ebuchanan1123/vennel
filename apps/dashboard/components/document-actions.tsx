'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

import {
  convertEstimate,
  errorMessage,
  prepareContextDocument,
  type BillingDocument,
  type CallNote,
  type Lead,
} from '../lib/api';
import { workspaceHref } from '../lib/navigation';
import { Icon } from './icon';
import { Field, FormError } from './ui';

type RelatedDocument = Pick<BillingDocument, 'id' | 'title' | 'kind' | 'status' | 'number'> & {
  invoiceId?: string | null;
};
export function DocumentActions({
  companyId,
  customerId,
  lead,
  notes = [],
  documents = [],
  leads = [],
  callNoteId,
  catalogReady = true,
}: {
  companyId: string;
  customerId?: string | null;
  lead?: Lead;
  notes?: CallNote[];
  documents?: RelatedDocument[];
  leads?: Lead[];
  callNoteId?: string;
  catalogReady?: boolean;
}) {
  const router = useRouter();
  const request = useRef<{ key: string; id: string } | null>(null);
  const [selection, setSelection] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const chosenNote = notes.find((note) => `note:${note.id}` === selection);
  const chosenLead =
    lead ??
    leads.find((entry) => `lead:${entry.id}` === selection) ??
    leads.find((entry) => entry.id === chosenNote?.leadId);
  const sourceNoteId = callNoteId ?? chosenNote?.id;
  const needsHuman = chosenLead?.needsHuman || chosenLead?.status === 'NEEDS_HUMAN';
  const hasContext = Boolean(sourceNoteId || chosenLead);
  const href = (path: string) => workspaceHref(path, companyId);

  function prepare(useAi: boolean, kind: 'ESTIMATE' | 'INVOICE' = 'ESTIMATE') {
    setError('');
    const key = `${sourceNoteId ?? ''}:${chosenLead?.id ?? ''}:${kind}:${useAi}`;
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    const requestId = request.current.id;
    startTransition(async () => {
      try {
        const document = await prepareContextDocument(companyId, {
          requestId,
          kind,
          useAi,
          ...(customerId ? { customerId } : {}),
          ...(chosenLead ? { leadId: chosenLead.id } : {}),
          ...(sourceNoteId ? { callNoteId: sourceNoteId } : {}),
        });
        router.push(href(`/billing/${document.id}`));
      } catch (cause) {
        setError(errorMessage(cause));
      }
    });
  }
  return (
    <section className="panel p-5">
      <div className="flex items-center gap-2">
        <Icon name="document" className="text-ember" width={17} height={17} />
        <h2 className="text-sm font-semibold">Next document steps</h2>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-steel">
        Use reviewed call details and the associated conversation. Pricing still comes from your
        catalog and stays editable.
      </p>
      {!lead && !callNoteId && (
        <div className="mt-4">
          <Field label="Job context">
            <select
              className="field"
              value={selection}
              onChange={(event) => {
                setSelection(event.target.value);
                setError('');
              }}
            >
              <option value="">Customer only / manual draft</option>
              {notes
                .filter((note) => note.reviewStatus === 'REVIEWED' && !note.isArchived)
                .map((note) => (
                  <option key={note.id} value={`note:${note.id}`}>
                    Reviewed note / {note.occurredAt.slice(0, 10)} /{' '}
                    {note.confirmedData?.summary?.slice(0, 60) || 'Call details'}
                  </option>
                ))}
              {leads.map((entry) => (
                <option key={entry.id} value={`lead:${entry.id}`}>
                  Lead / {entry.serviceType ?? entry.projectType ?? entry.phone}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      {needsHuman && (
        <p className="mt-3 text-xs leading-relaxed text-rose-700">
          This lead needs human attention. Review it directly before using AI estimate preparation.
        </p>
      )}
      {!catalogReady && (
        <p className="mt-3 text-xs text-amber-700">
          Add active{' '}
          <Link className="font-medium underline" href={href('/services')}>
            services and pricing
          </Link>{' '}
          before using AI.
        </p>
      )}
      <div className="mt-4 space-y-2">
        <button
          className="btn-primary w-full"
          disabled={pending || !hasContext || Boolean(needsHuman) || !catalogReady}
          onClick={() => prepare(true)}
        >
          <Icon name="sparkles" width={15} height={15} />
          {pending ? 'Preparing...' : 'Prepare estimate with AI'}
        </button>
        <button className="btn-secondary w-full" disabled={pending} onClick={() => prepare(false)}>
          Prepare estimate manually <Icon name="arrow" width={14} height={14} />
        </button>
        {chosenLead?.outcome === 'WON' && chosenLead.completedAt && (
          <button
            className="btn-secondary w-full"
            disabled={pending}
            onClick={() => prepare(false, 'INVOICE')}
          >
            Prepare invoice for completed work
          </button>
        )}
        {customerId && (
          <Link
            className="btn-secondary w-full"
            href={workspaceHref('/follow-ups', companyId, { customerId, callNoteId: sourceNoteId })}
          >
            Schedule follow-up <Icon name="calendar" width={14} height={14} />
          </Link>
        )}
      </div>
      <div className="mt-3">
        <FormError message={error} />
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-steel">
        An agreed price is not proof of completed work. Invoice suggestions appear only for
        owner-recorded won/completed jobs.
      </p>
      {documents.length > 0 && (
        <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">
          <h3 className="text-xs font-semibold">Existing documents</h3>
          {documents.slice(0, 4).map((document) => (
            <div key={document.id} className="rounded-lg bg-slate-50 p-3">
              <Link
                className="block text-xs font-medium text-ember"
                href={href(`/billing/${document.id}`)}
              >
                {document.number ??
                  `Review ${document.kind === 'ESTIMATE' ? 'estimate' : 'invoice'} draft`}
              </Link>
              <p className="mt-1 text-[10px] text-steel">{document.title}</p>
              {document.kind === 'ESTIMATE' && document.status === 'FINALIZED' && (
                <button
                  className="mt-3 text-xs font-semibold text-ember"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      try {
                        const invoice = await convertEstimate(companyId, document.id);
                        router.push(href(`/billing/${invoice.id}`));
                      } catch (cause) {
                        setError(errorMessage(cause));
                      }
                    })
                  }
                >
                  {document.invoiceId ? 'Open invoice draft' : 'Create invoice from estimate'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
