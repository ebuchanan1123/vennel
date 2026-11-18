'use client';

import { useState, useTransition, type FormEvent } from 'react';

import {
  errorMessage,
  retryBackgroundJob,
  saveWorkspaceSettings,
  type BackgroundJobRecord,
  type WorkspaceSettings,
} from '../lib/api';
import { Icon } from './icon';
import { Field, FormError, PageHeader } from './ui';
import { TimeZoneSelect } from './time-zone-select';

export function WorkspaceSettingsView({
  companyId,
  initialSettings,
  jobs,
}: {
  companyId: string;
  initialSettings: WorkspaceSettings;
  jobs: BackgroundJobRecord[];
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [timeZone, setTimeZone] = useState(initialSettings.timeZone);
  const [notifications, setNotifications] = useState(initialSettings.notifications);
  const [consent, setConsent] = useState(Boolean(initialSettings.notifications.consentedAt));
  const [documentEmail, setDocumentEmail] = useState(initialSettings.documentEmail);
  const [documentAuthorization, setDocumentAuthorization] = useState(
    initialSettings.documentEmail.enabled,
  );
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, startTransition] = useTransition();
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    startTransition(async () => {
      try {
        const { consentedAt: _consentedAt, ...preferences } = notifications;
        void _consentedAt;
        const updated = await saveWorkspaceSettings(companyId, {
          timeZone,
          notifications: { ...preferences, consent },
          documentEmail: {
            enabled: documentEmail.enabled,
            senderName: documentEmail.senderName,
            replyTo: documentEmail.replyTo,
            authorized: documentAuthorization,
          },
        });
        setSettings(updated);
        setNotifications(updated.notifications);
        setDocumentEmail(updated.documentEmail);
        setNotice('Business settings saved.');
      } catch (cause) {
        setError(errorMessage(cause));
      }
    });
  }
  return (
    <>
      <PageHeader
        title="Workspace settings"
        description="Business-local scheduling and opt-in transactional owner notifications. Customer messages remain owner-controlled."
      />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <form className="panel space-y-5 p-6" onSubmit={save}>
          <fieldset disabled={pending} className="space-y-5">
            <Field
              label="Business time zone"
              hint="IANA time zone. Existing task instants stay unchanged when the display time zone changes."
            >
              <TimeZoneSelect value={timeZone} onChange={setTimeZone} />
            </Field>
            <div className="border-t border-slate-100 pt-5">
              <h2 className="text-sm font-semibold">Owner email notifications</h2>
              <p className="mt-2 text-xs leading-relaxed text-steel">
                Sent through Resend using a verified platform sender and your business display name.
                These are internal reminders, not customer-facing messages.
              </p>
            </div>
            <Field label="Owner recipient email">
              <input
                className="field"
                type="email"
                value={notifications.recipientEmail ?? ''}
                onChange={(event) => {
                  setNotifications((current) => ({
                    ...current,
                    recipientEmail: event.target.value || null,
                  }));
                  setConsent(false);
                }}
              />
            </Field>
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-1 accent-indigo-600"
                checked={notifications.enabled}
                onChange={(event) =>
                  setNotifications((current) => ({ ...current, enabled: event.target.checked }))
                }
              />
              <span>Enable owner emails</span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ['newLeads', 'New lead alerts'],
                ['humanAttention', 'Human-attention alerts'],
                ['overdueFollowUps', 'Overdue follow-up reminders'],
                ['documentReview', 'Draft document review reminders'],
              ].map(([key, label]) => {
                const preference =
                  key === 'newLeads'
                    ? 'newLeads'
                    : key === 'humanAttention'
                      ? 'humanAttention'
                      : key === 'overdueFollowUps'
                        ? 'overdueFollowUps'
                        : 'documentReview';
                return (
                  <label className="flex items-start gap-2 text-xs text-steel" key={key}>
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-indigo-600"
                      checked={notifications[preference]}
                      onChange={(event) =>
                        setNotifications((current) => ({
                          ...current,
                          [preference]: event.target.checked,
                        }))
                      }
                    />
                    {label}
                  </label>
                );
              })}
            </div>
            <Field label="Draft review reminder delay (hours)">
              <input
                className="field"
                type="number"
                required
                min={1}
                max={168}
                value={notifications.documentReminderHours}
                onChange={(event) =>
                  setNotifications((current) => ({
                    ...current,
                    documentReminderHours: Number(event.target.value),
                  }))
                }
              />
            </Field>
            <label className="flex items-start gap-2.5 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed">
              <input
                type="checkbox"
                className="mt-0.5 accent-indigo-600"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              <span>
                I control this recipient address and consent to these business notifications. I can
                disable them here or use the opt-out link in an email.
              </span>
            </label>
            <div className="border-t border-slate-100 pt-5">
              <h2 className="text-sm font-semibold">Customer document delivery</h2>
              <p className="mt-2 text-xs leading-relaxed text-steel">
                Estimates and invoices require a separate preview and recipient approval on each
                finalized document. Enabling this does not send anything.
              </p>
            </div>
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-1 accent-indigo-600"
                checked={documentEmail.enabled}
                onChange={(event) =>
                  setDocumentEmail((current) => ({ ...current, enabled: event.target.checked }))
                }
              />
              <span>Enable owner-approved customer document emails</span>
            </label>
            <Field label="Document email display name">
              <input
                className="field"
                required
                maxLength={120}
                value={documentEmail.senderName}
                onChange={(event) => {
                  setDocumentEmail((current) => ({ ...current, senderName: event.target.value }));
                  setDocumentAuthorization(false);
                }}
              />
            </Field>
            <Field label="Business reply-to email (optional)">
              <input
                className="field"
                type="email"
                value={documentEmail.replyTo ?? ''}
                onChange={(event) => {
                  setDocumentEmail((current) => ({
                    ...current,
                    replyTo: event.target.value || null,
                  }));
                  setDocumentAuthorization(false);
                }}
              />
            </Field>
            <p className="text-xs text-steel">
              Verified platform sender: {documentEmail.senderEmail ?? 'Not configured locally'}
            </p>
            <label className="flex items-start gap-2.5 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed">
              <input
                type="checkbox"
                className="mt-0.5 accent-indigo-600"
                checked={documentAuthorization}
                onChange={(event) => setDocumentAuthorization(event.target.checked)}
              />
              <span>
                I authorize this business to send requested transactional documents using this
                display name and reply-to address. Each recipient and email must still be approved
                separately.
              </span>
            </label>
            <FormError message={error} />
            {notice && (
              <p role="status" className="text-xs text-emerald-700">
                {notice}
              </p>
            )}
            <button className="btn-primary" type="submit">
              {pending ? 'Saving...' : 'Save settings'}
            </button>
          </fieldset>
        </form>
        <aside className="panel space-y-4 p-5">
          <h2 className="text-sm font-semibold">Delivery readiness</h2>
          <p
            className={`text-xs ${settings.emailProviderConfigured ? 'text-emerald-700' : 'text-amber-700'}`}
          >
            Resend: {settings.emailProviderConfigured ? 'configured' : 'not configured'}
          </p>
          <p className={`text-xs ${settings.workerHealthy ? 'text-emerald-700' : 'text-rose-700'}`}>
            Durable worker: {settings.workerHealthy ? 'online' : 'offline or stale'}
          </p>
          <p className="text-xs text-steel">
            {settings.failedJobs} failed jobs &middot; {settings.blockedJobs} blocked jobs
          </p>
          <p
            className={`text-xs ${documentEmail.webhookConfigured ? 'text-emerald-700' : 'text-amber-700'}`}
          >
            Verified delivery callbacks:{' '}
            {documentEmail.webhookConfigured
              ? 'configured'
              : 'not configured; only provider acceptance can be confirmed'}
          </p>
          {!settings.emailProviderConfigured && (
            <p className="rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
              Configure RESEND_API_KEY and a verified RESEND_FROM_EMAIL locally. Pending owner
              notifications are visibly blocked, not marked sent.
            </p>
          )}
          <p className="text-[11px] leading-relaxed text-steel">
            Jobs are durable in PostgreSQL. Retries reuse a fixed provider idempotency key and stop
            before its 24-hour retention window expires.
          </p>
          <p className="text-[11px] leading-relaxed text-steel">
            Local developer access is not production account authentication. No real-customer pilot
            until business memberships and authorization are implemented.
          </p>
        </aside>
      </div>
      <section className="panel mt-6 p-5">
        <h2 className="mb-4 text-sm font-semibold">Background processing &amp; attempt history</h2>
        {jobs.length === 0 ? (
          <p className="text-xs text-steel">No background jobs for this business yet.</p>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => (
              <details className="rounded-lg border border-slate-100 p-4" key={job.id}>
                <summary className="cursor-pointer text-xs font-medium">
                  {job.kind === 'OWNER_EMAIL'
                    ? 'Owner notification'
                    : job.kind === 'DOCUMENT_EMAIL'
                      ? 'Approved customer document email'
                      : 'AI follow-up suggestions'}{' '}
                  &middot; {job.status.toLowerCase()} &middot; {job.attempts} attempts
                </summary>
                {job.lastError && <p className="mt-3 text-xs text-rose-700">{job.lastError}</p>}
                <ul className="mt-3 space-y-1.5 text-[11px] text-steel">
                  {job.history.map((attempt) => (
                    <li key={attempt.attempt}>
                      Attempt {attempt.attempt}: {attempt.outcome ?? 'running'}
                      {attempt.error ? ` / ${attempt.error}` : ''}
                    </li>
                  ))}
                </ul>
                {(job.status === 'FAILED' || job.status === 'BLOCKED') && (
                  <button
                    className="btn-secondary mt-3 min-h-8 px-3 py-2 text-xs"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        try {
                          await retryBackgroundJob(companyId, job.id);
                          setNotice(
                            'Job queued for a safe retry. Refresh this view for its new status.',
                          );
                        } catch (cause) {
                          setError(errorMessage(cause));
                        }
                      })
                    }
                  >
                    <Icon name="clock" width={14} height={14} />
                    Retry safely
                  </button>
                )}
              </details>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
