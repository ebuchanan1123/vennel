import Link from 'next/link';
import { formatBusinessTime } from '@lead-recovery/types';

import type { CallNote, FollowUpTask } from '../lib/api';
import { workspaceHref } from '../lib/navigation';
import { Icon } from './icon';

export function CallNoteHistory({
  notes,
  companyId,
  timeZone,
}: {
  notes: CallNote[];
  companyId: string;
  timeZone: string;
}) {
  return (
    <section className="panel p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Call notes</h2>
        <span className="text-xs text-steel">{notes.length}</span>
      </div>
      {notes.length === 0 ? (
        <p className="text-xs text-steel">
          Post-call summaries will appear here, separately from SMS messages.
        </p>
      ) : (
        <div className="space-y-3">
          {notes.slice(0, 8).map((note) => (
            <Link
              key={note.id}
              href={workspaceHref(`/call-notes/${note.id}`, companyId)}
              className="flex items-start gap-3 rounded-lg border border-slate-100 p-3 hover:bg-slate-50"
            >
              <Icon
                name="note"
                width={17}
                height={17}
                className="mt-0.5 shrink-0 text-indigo-400"
              />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-xs leading-relaxed">
                  {note.confirmedData?.summary || note.text}
                </p>
                <p className="mt-2 text-[10px] text-steel">
                  {formatBusinessTime(note.occurredAt, timeZone)} &middot;{' '}
                  {note.reviewStatus === 'REVIEWED' ? 'Reviewed' : 'Awaiting review'}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

export function FollowUpHistory({
  tasks,
  companyId,
  timeZone,
}: {
  tasks: FollowUpTask[];
  companyId: string;
  timeZone: string;
}) {
  return (
    <section className="panel p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Follow-ups</h2>
        <Link
          className="text-xs font-medium text-ember"
          href={workspaceHref('/follow-ups', companyId)}
        >
          Manage tasks
        </Link>
      </div>
      {tasks.length === 0 ? (
        <p className="text-xs text-steel">No follow-ups are associated with this history yet.</p>
      ) : (
        <ul className="space-y-3">
          {tasks.slice(0, 8).map((task) => (
            <li key={task.id} className="flex items-start gap-3 rounded-lg bg-slate-50 p-3">
              <Icon
                name={task.status === 'COMPLETED' ? 'check' : 'clock'}
                className="mt-0.5 shrink-0 text-indigo-400"
                width={17}
                height={17}
              />
              <div>
                <p className="text-xs font-medium">{task.title}</p>
                <p className="mt-1 text-[10px] text-steel">
                  {formatBusinessTime(task.dueAt, timeZone)} &middot; {task.status.toLowerCase()}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
