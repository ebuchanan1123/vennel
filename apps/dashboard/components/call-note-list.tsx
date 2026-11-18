'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { formatBusinessTime } from '@lead-recovery/types';

import { archiveCallNote, errorMessage, type CallNote } from '../lib/api';
import { workspaceHref } from '../lib/navigation';
import { Icon } from './icon';
import { EmptyState, FormError, PageHeader, SearchInput } from './ui';

export function CallNoteList({
  initialNotes,
  companyId,
  timeZone,
}: {
  initialNotes: CallNote[];
  companyId: string;
  timeZone: string;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const search = query.trim().toLowerCase();
  const visible = notes.filter((note) =>
    [note.text, note.customer?.name, note.phone].some((value) =>
      value?.toLowerCase().includes(search),
    ),
  );
  return (
    <>
      <PageHeader
        title="Call notes"
        description="Answered calls matter too. Keep original summaries, reviewed information, and the next step together."
        actions={
          <Link className="btn-primary" href={workspaceHref('/call-notes/new', companyId)}>
            <Icon name="plus" width={16} height={16} />
            Add call note
          </Link>
        }
      />
      <div className="mb-4">
        <SearchInput value={query} onChange={setQuery} placeholder="Search call notes..." />
      </div>
      <FormError message={error} />
      <div className="panel overflow-hidden">
        {visible.length === 0 ? (
          <EmptyState
            icon="note"
            title="Capture the next answered call"
            description="Enter or dictate a short summary, review the information, and create a follow-up without pretending the call was an SMS."
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {visible.map((note) => (
              <article className="flex items-start justify-between gap-4 p-5" key={note.id}>
                <Link
                  className="min-w-0 flex-1"
                  href={workspaceHref(`/call-notes/${note.id}`, companyId)}
                >
                  <p className="text-sm font-semibold">
                    {note.customer?.name ?? 'Customer to be confirmed'}
                  </p>
                  <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-600">
                    {note.confirmedData?.summary || note.text}
                  </p>
                  <p className="mt-3 text-[11px] text-steel">
                    {formatBusinessTime(note.occurredAt, timeZone)} &middot;{' '}
                    {note.source === 'VOICE' ? 'Voice summary' : 'Text summary'} &middot;{' '}
                    {note.reviewStatus.toLowerCase()}
                  </p>
                </Link>
                <button
                  className="btn-icon"
                  disabled={pending}
                  aria-label={`Archive call note ${note.id}`}
                  onClick={() =>
                    startTransition(async () => {
                      try {
                        await archiveCallNote(companyId, note.id, note.revision, true);
                        setNotes((current) => current.filter((entry) => entry.id !== note.id));
                      } catch (cause) {
                        setError(errorMessage(cause));
                      }
                    })
                  }
                >
                  <Icon name="trash" width={16} height={16} />
                </button>
              </article>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
