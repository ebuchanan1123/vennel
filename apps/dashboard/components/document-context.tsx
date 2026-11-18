import Link from 'next/link';

import type { DocumentContext as Context } from '../lib/api';
import { workspaceHref } from '../lib/navigation';

export function DocumentContextView({
  context,
  companyId,
}: {
  context: Context;
  companyId: string;
}) {
  return (
    <details className="panel no-print p-5">
      <summary className="cursor-pointer text-xs font-semibold text-indigo-700">
        Source context / reviewed details
      </summary>
      <p className="mt-3 text-xs leading-relaxed text-steel">
        This internal snapshot is not included in customer emails. Quoted and agreed amounts do not
        replace catalog prices automatically.
      </p>
      {context.customer && (
        <p className="mt-3 text-xs text-steel">Customer at preparation: {context.customer.name}</p>
      )}
      <div className="mt-4 space-y-4">
        {context.notes.map((note) => (
          <section key={note.id} className="rounded-lg border border-slate-100 p-3">
            <Link
              className="text-xs font-semibold text-ember"
              href={workspaceHref(`/call-notes/${note.id}`, companyId)}
            >
              Reviewed call note / revision {note.revision}
            </Link>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              {note.facts.map((fact) => (
                <div key={fact.field}>
                  <dt className="text-[10px] text-steel">
                    {fact.field.replace(/([a-z])([A-Z])/g, '$1 $2')}
                  </dt>
                  <dd className="mt-1 text-xs">{String(fact.value)}</dd>
                </div>
              ))}
            </dl>
            {note.summary && (
              <p className="mt-3 whitespace-pre-wrap text-xs leading-relaxed">{note.summary}</p>
            )}
            {note.price && (
              <p className="mt-3 text-xs text-amber-800">
                Discussed price: {note.price.amount ?? 'unknown'}{' '}
                {note.price.currency ?? '(currency unknown)'} / {note.price.state.toLowerCase()}.
                Review any discrepancy manually.
              </p>
            )}
            {note.appointment && (
              <p className="mt-2 text-xs text-steel">
                Appointment: {note.appointment.text ?? 'unknown'} /{' '}
                {note.appointment.state.toLowerCase()}. No booking was created.
              </p>
            )}
            {note.materials.length > 0 && (
              <p className="mt-2 text-xs text-steel">
                Confirmed materials: {note.materials.join(', ')}
              </p>
            )}
          </section>
        ))}
      </div>
      {context.lead && (
        <p className="mt-4 text-xs text-steel">
          <Link
            href={workspaceHref(`/leads/${context.lead.id}`, companyId)}
            className="font-medium text-ember"
          >
            Associated lead
          </Link>{' '}
          / {context.messages.length} inbound messages used at preparation.
        </p>
      )}
    </details>
  );
}
