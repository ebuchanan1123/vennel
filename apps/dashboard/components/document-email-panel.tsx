'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';

import {
  approveDocumentEmail,
  cancelDocumentEmail,
  errorMessage,
  getDocumentDeliveries,
  previewDocumentEmail,
  retryDocumentEmail,
  type BillingDocument,
  type DocumentDelivery,
  type DocumentEmailPreview,
} from '../lib/api';
import { workspaceHref } from '../lib/navigation';
import { Icon } from './icon';
import { Field, FormError } from './ui';

const statusLabels: Record<DocumentDelivery['status'], string> = {
  QUEUED: 'Queued',
  SENDING: 'Sending',
  ACCEPTED: 'Accepted by email provider',
  DELIVERED: 'Delivered to recipient mail server',
  DELAYED: 'Delivery delayed',
  BOUNCED: 'Bounced',
  COMPLAINED: 'Recipient marked as spam',
  FAILED: 'Failed / review required',
  BLOCKED: 'Blocked / configuration required',
  CANCELLED: 'Cancelled',
};

export function DocumentEmailPanel({
  document,
  companyId,
}: {
  document: BillingDocument;
  companyId: string;
}) {
  const [recipient, setRecipient] = useState(document.customerSnapshot?.email ?? '');
  const [preview, setPreview] = useState<DocumentEmailPreview>();
  const [approved, setApproved] = useState(false);
  const [resendApproved, setResendApproved] = useState(false);
  const [deliveries, setDeliveries] = useState<DocumentDelivery[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const request = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    let active = true;
    getDocumentDeliveries(companyId, document.id)
      .then((history) => {
        if (active) setDeliveries(history);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [companyId, document.id]);

  function preparePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setApproved(false);
    startTransition(async () => {
      try {
        const result = await previewDocumentEmail(companyId, document, recipient);
        setPreview(result);
        setRecipient(result.recipientEmail);
        request.current = null;
      } catch (cause) {
        setPreview(undefined);
        setError(errorMessage(cause));
      }
    });
  }
  function send() {
    if (!preview || !approved) {
      setError('Preview and explicitly approve the recipient and document first.');
      return;
    }
    const key = `${preview.previewHash}:${resendApproved}`;
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    const requestId = request.current.id;
    setError('');
    setNotice('');
    startTransition(async () => {
      try {
        const delivery = await approveDocumentEmail(companyId, document.id, {
          requestId,
          revision: preview.revision,
          recipientEmail: preview.recipientEmail,
          previewHash: preview.previewHash,
          approved: true,
          resendApproved,
        });
        setDeliveries((history) => [
          delivery,
          ...history.filter((entry) => entry.id !== delivery.id),
        ]);
        setApproved(false);
        setResendApproved(false);
        setNotice(
          'The approved delivery is listed below. Check its history for provider acceptance or delivery status; an existing delivery is reused unless you explicitly approve another copy.',
        );
      } catch (cause) {
        setError(errorMessage(cause));
      }
    });
  }
  function update(delivery: DocumentDelivery, action: 'cancel' | 'retry') {
    setError('');
    startTransition(async () => {
      try {
        const updated = await (action === 'cancel' ? cancelDocumentEmail : retryDocumentEmail)(
          companyId,
          document.id,
          delivery.id,
        );
        setDeliveries((history) =>
          history.map((entry) => (entry.id === updated.id ? updated : entry)),
        );
      } catch (cause) {
        setError(errorMessage(cause));
      }
    });
  }
  return (
    <section className="panel no-print mx-auto mt-6 max-w-4xl p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <Icon name="leads" className="text-ember" width={18} height={18} />
        <h2 className="text-sm font-semibold">
          Email this finalized {document.kind === 'ESTIMATE' ? 'estimate' : 'invoice'}
        </h2>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-steel">
        The full approved document is included in the email. Internal call notes, AI suggestions,
        and follow-ups are excluded. This does not mark a lead won or an invoice paid.
      </p>
      <form className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={preparePreview}>
        <div className="min-w-0 flex-1">
          <Field label="Confirm recipient email">
            <input
              type="email"
              className="field"
              required
              maxLength={254}
              value={recipient}
              disabled={pending}
              onChange={(event) => {
                setRecipient(event.target.value);
                setPreview(undefined);
                setApproved(false);
                setResendApproved(false);
                setNotice('');
              }}
            />
          </Field>
        </div>
        <button className="btn-secondary shrink-0" type="submit" disabled={pending}>
          {pending ? 'Preparing...' : 'Preview customer email'}
        </button>
      </form>
      {preview && (
        <div className="mt-5 space-y-4">
          <dl className="grid gap-3 rounded-lg bg-slate-50 p-4 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-steel">From</dt>
              <dd className="mt-1 break-words font-medium">
                {preview.senderName} &lt;{preview.senderEmail ?? 'sender not configured'}&gt;
              </dd>
            </div>
            <div>
              <dt className="text-steel">To</dt>
              <dd className="mt-1 break-all font-medium">{preview.recipientEmail}</dd>
            </div>
            <div>
              <dt className="text-steel">Reply to</dt>
              <dd className="mt-1 break-all">
                {preview.replyTo ?? preview.senderEmail ?? 'Not configured'}
              </dd>
            </div>
            <div>
              <dt className="text-steel">Subject</dt>
              <dd className="mt-1">{preview.subject}</dd>
            </div>
          </dl>
          <iframe
            title="Customer document email preview"
            className="h-[460px] w-full rounded-lg border border-slate-200 bg-white"
            srcDoc={preview.html}
            sandbox=""
            referrerPolicy="no-referrer"
          />
          <details>
            <summary className="cursor-pointer text-xs font-medium text-ember">
              Plain-text email alternative
            </summary>
            <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-4 font-sans text-xs leading-relaxed">
              {preview.text}
            </pre>
          </details>
          {(!preview.enabled || !preview.providerConfigured) && (
            <p className="rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
              Sending is unavailable until customer document email is enabled and Resend has a
              verified sender/API key. You can still review the email without sending it.{' '}
              <Link
                className="font-semibold underline"
                href={workspaceHref('/settings', companyId)}
              >
                Open workspace settings
              </Link>
              .
            </p>
          )}
          <label className="flex items-start gap-2.5 rounded-lg bg-indigo-50/60 p-3 text-xs leading-relaxed">
            <input
              type="checkbox"
              className="mt-0.5 accent-indigo-600"
              checked={approved}
              disabled={pending}
              onChange={(event) => setApproved(event.target.checked)}
            />
            <span>
              I reviewed this exact email and recipient, and authorize sending the finalized
              document to {preview.recipientEmail}.
            </span>
          </label>
          {deliveries.some(
            (delivery) =>
              delivery.recipientEmail === preview.recipientEmail && delivery.status !== 'CANCELLED',
          ) && (
            <label className="flex items-start gap-2.5 text-xs leading-relaxed text-steel">
              <input
                type="checkbox"
                className="mt-0.5 accent-indigo-600"
                checked={resendApproved}
                disabled={pending}
                onChange={(event) => {
                  setResendApproved(event.target.checked);
                  setApproved(false);
                }}
              />
              <span>
                I intentionally want to send another copy. Active or ambiguous deliveries cannot be
                duplicated; use safe retry for a failed attempt.
              </span>
            </label>
          )}
          <button
            className="btn-primary"
            type="button"
            disabled={pending || !approved || !preview.enabled || !preview.providerConfigured}
            onClick={send}
          >
            <Icon name="check" width={15} height={15} />
            {pending ? 'Queuing...' : 'Approve & queue email'}
          </button>
        </div>
      )}
      <div className="mt-4">
        <FormError message={error} />
      </div>
      {notice && (
        <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-700">
          {notice}
        </p>
      )}
      <div className="mt-6 border-t border-slate-100 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xs font-semibold">Delivery history &amp; approval audit</h3>
          <button
            className="text-xs font-medium text-ember"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  setDeliveries(await getDocumentDeliveries(companyId, document.id));
                  setError('');
                } catch (cause) {
                  setError(errorMessage(cause));
                }
              })
            }
          >
            Refresh delivery status
          </button>
        </div>
        {loading ? (
          <p className="mt-4 text-xs text-steel">Loading delivery history...</p>
        ) : deliveries.length === 0 ? (
          <p className="mt-4 text-xs text-steel">
            No email approvals have been recorded for this document.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {deliveries.map((delivery) => (
              <article key={delivery.id} className="rounded-lg border border-slate-100 p-4">
                <p className="text-xs font-semibold">{statusLabels[delivery.status]}</p>
                <p className="mt-2 break-all text-xs text-steel">To {delivery.recipientEmail}</p>
                <p className="mt-1 text-[11px] text-steel">
                  Approved {new Date(delivery.approvedAt).toLocaleString()} by {delivery.approvedBy}{' '}
                  / document revision {delivery.documentRevision}
                </p>
                {delivery.status === 'ACCEPTED' && (
                  <p className="mt-2 text-[11px] text-steel">
                    Provider acceptance is not a delivery guarantee. Verified webhooks are required
                    for delivered/bounced status.
                  </p>
                )}
                {delivery.job.lastError && (
                  <p className="mt-3 text-xs text-rose-700">{delivery.job.lastError}</p>
                )}
                <details className="mt-3">
                  <summary className="cursor-pointer text-[11px] font-medium text-ember">
                    View attempts and provider events ({delivery.attempts.length})
                  </summary>
                  <ul className="mt-3 space-y-2 text-[11px] text-steel">
                    {delivery.attempts.map((attempt) => (
                      <li key={attempt.attempt}>
                        Attempt {attempt.attempt}: {attempt.outcome?.toLowerCase() ?? 'processing'}
                        {attempt.error ? ` / ${attempt.error}` : ''}
                      </li>
                    ))}
                    {delivery.events.map((event, index) => (
                      <li key={`${event.type}-${index}`}>
                        {event.type} / {new Date(event.occurredAt).toLocaleString()}
                      </li>
                    ))}
                  </ul>
                  {delivery.providerId && (
                    <p className="mt-2 break-all text-[10px] text-slate-400">
                      Provider receipt: {delivery.providerId}
                    </p>
                  )}
                </details>
                <div className="mt-3 flex flex-wrap gap-2">
                  {delivery.job.canRetry && (
                    <button
                      className="btn-secondary min-h-8 px-3 py-2 text-xs"
                      disabled={pending}
                      onClick={() => update(delivery, 'retry')}
                    >
                      Retry same approved email
                    </button>
                  )}
                  {delivery.job.canCancel && (
                    <button
                      className="btn-secondary min-h-8 px-3 py-2 text-xs"
                      disabled={pending}
                      onClick={() => update(delivery, 'cancel')}
                    >
                      Cancel before sending
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
