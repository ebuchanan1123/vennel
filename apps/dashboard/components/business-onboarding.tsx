'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import { INDUSTRY_TEMPLATES, SUPPORTED_CURRENCIES } from '@lead-recovery/types';
import {
  checkOnboarding,
  completeOnboarding,
  createBusiness,
  errorMessage,
  getOnboarding,
  updateOnboarding,
  saveWorkspaceSettings,
  type CatalogService,
  type OnboardingCheck,
  type OnboardingProfile,
  type WorkspaceSettings,
} from '../lib/api';
import { workspaceHref } from '../lib/navigation';
import { Icon } from './icon';
import { ServiceCatalog } from './service-catalog';
import { useBusinessAccess } from './business-access';
import { Field, FormError } from './ui';
import { useClientReady } from '../lib/use-client-ready';
import { TimeZoneSelect } from './time-zone-select';

const steps = [
  'Business & industry',
  'Contact information',
  'Time zone & currency',
  'Services & pricing',
  'Business phone',
  'Notifications',
  'Billing & tax',
  'Review & finish',
];
const stepDescriptions = [
  'Tell us a little about your business.',
  'Add the contact details customers should use.',
  'Choose how dates and prices appear in your workspace.',
  'Add the work you offer, with fixed prices, estimated ranges, or quote-required pricing.',
  null,
  'Choose which business updates you want to receive.',
  'Add the details for your estimates and invoices.',
  'Check the essentials, then open your workspace.',
];

function SetupProgress({ step, businessName }: { step: number; businessName?: string }) {
  const label = steps[step - 1];
  if (!label) throw new RangeError('Unknown business setup step.');
  return (
    <header className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-4 text-xs">
        <p className="font-semibold text-indigo-600">
          Step {step} of {steps.length}
        </p>
        {businessName && <p className="truncate text-steel">{businessName}</p>}
      </div>
      <div
        role="progressbar"
        aria-label="Business setup progress"
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={step}
        aria-valuetext={`Step ${step} of ${steps.length}: ${label}`}
        className="mb-7 h-1.5 overflow-hidden rounded-full bg-slate-200"
      >
        <div
          className="h-full rounded-full bg-indigo-600 transition-all"
          style={{ width: `${(step / steps.length) * 100}%` }}
        />
      </div>
      <h1
        id="onboarding-step-title"
        tabIndex={-1}
        className="text-2xl font-semibold tracking-tight text-ink outline-none sm:text-3xl"
      >
        {step === 5 ? "What is your business' phone number?" : label}
      </h1>
      {stepDescriptions[step - 1] && (
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-steel">
          {stepDescriptions[step - 1]}
        </p>
      )}
    </header>
  );
}

function SetupBackButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button type="button" className="btn-secondary" onClick={onClick} disabled={disabled}>
      <Icon name="arrow" className="rotate-180" width={15} height={15} />
      Back
    </button>
  );
}

export function CreateBusinessForm() {
  const ready = useClientReady();
  const requestId = useRef<string | null>(null);
  const [name, setName] = useState('');
  const [niche, setNiche] = useState<'HVAC' | 'RENOVATION'>('HVAC');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    requestId.current ??= crypto.randomUUID();
    const id = requestId.current;
    startTransition(async () => {
      try {
        const result = await createBusiness({
          requestId: id,
          name,
          niche,
          timeZone: 'UTC',
          currency: 'USD',
        });
        // A new membership must load a fresh authorized workspace shell.
        globalThis.location.replace(
          workspaceHref(`/onboarding/${result.companyId}`, result.companyId),
        );
      } catch (cause) {
        setError(errorMessage(cause));
      }
    });
  }
  return (
    <div className="mx-auto max-w-2xl">
      <SetupProgress step={1} />
      <form className="panel p-6 sm:p-8" onSubmit={submit} aria-labelledby="onboarding-step-title">
        <fieldset disabled={pending || !ready} className="space-y-5">
          <Field label="Business name">
            <input
              className="field"
              required
              maxLength={120}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                requestId.current = null;
              }}
              autoFocus
            />
          </Field>
          <Field label="Industry">
            <select
              className="field"
              value={niche}
              onChange={(event) => {
                if (event.target.value === 'HVAC' || event.target.value === 'RENOVATION')
                  setNiche(event.target.value);
                requestId.current = null;
              }}
            >
              <option value="HVAC">{INDUSTRY_TEMPLATES.HVAC.label}</option>
              <option value="RENOVATION">{INDUSTRY_TEMPLATES.RENOVATION.label}</option>
            </select>
          </Field>
          <p className="text-xs leading-relaxed text-steel">
            Your business gets its own private workspace. You can invite your team after setup.
          </p>
          <FormError message={error} />
          <button className="btn-primary w-full" type="submit">
            {pending ? 'Saving...' : 'Save & continue'}
          </button>
        </fieldset>
      </form>
    </div>
  );
}

export function BusinessOnboarding({
  initialProfile,
  services,
  settings,
}: {
  initialProfile: OnboardingProfile;
  services: CatalogService[];
  settings: WorkspaceSettings;
}) {
  const ready = useClientReady();
  const { account } = useBusinessAccess();
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const savedProfile = useRef(initialProfile);
  const [step, setStep] = useState(Math.min(8, Math.max(1, initialProfile.step + 1)));
  const [areas, setAreas] = useState(initialProfile.serviceAreas.join(', '));
  const [checks, setChecks] = useState<OnboardingCheck>();
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const [notifications, setNotifications] = useState({
    ...settings.notifications,
    recipientEmail: settings.notifications.recipientEmail ?? account.email,
  });
  const [notificationConsent, setNotificationConsent] = useState(
    Boolean(settings.notifications.consentedAt),
  );
  const companyId = profile.id;
  useEffect(() => {
    document.getElementById('onboarding-step-title')?.focus({ preventScroll: true });
    globalThis.scrollTo(0, 0);
  }, [step]);
  function back() {
    setProfile(savedProfile.current);
    setAreas(savedProfile.current.serviceAreas.join(', '));
    setStep((current) => Math.max(1, current - 1));
    setError('');
    setChecks(undefined);
  }
  function patch<K extends keyof OnboardingProfile>(key: K, value: OnboardingProfile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
    setChecks(undefined);
  }
  function save(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setError('');
    startTransition(async () => {
      try {
        if (step === 4 && (await getOnboarding(companyId)).catalogCount < 1)
          throw new Error('Save at least one active service before continuing.');
        if (step === 6) {
          const { consentedAt, ...preferences } = notifications;
          void consentedAt;
          await saveWorkspaceSettings(companyId, {
            timeZone: profile.timeZone,
            notifications: {
              ...preferences,
              recipientEmail: preferences.recipientEmail.trim() || null,
              consent: notificationConsent,
            },
          });
        }
        const result = await updateOnboarding(companyId, {
          step,
          name: profile.name,
          niche: profile.niche,
          currency: profile.currency,
          timeZone: profile.timeZone,
          businessEmail: profile.businessEmail || null,
          businessPhone: profile.businessPhone || null,
          billingAddress: profile.billingAddress || null,
          taxRegistrationNumber: profile.taxRegistrationNumber || null,
          defaultTaxRate: profile.defaultTaxRate,
          forwardToPhoneNumber: profile.forwardToPhoneNumber || null,
          serviceAreas: areas
            .split(',')
            .map((area) => area.trim())
            .filter(Boolean),
        });
        savedProfile.current = result;
        setProfile(result);
        setStep((current) => Math.min(8, current + 1));
        setChecks(undefined);
        router.refresh();
      } catch (cause) {
        setError(errorMessage(cause));
      }
    });
  }
  return (
    <div className={`mx-auto ${step === 4 ? 'max-w-6xl' : 'max-w-2xl'}`}>
      <SetupProgress step={step} businessName={profile.name} />
      <FormError message={error} />
      {step === 4 ? (
        <ServiceCatalog
          key={`catalog-${companyId}`}
          initialServices={services}
          companyId={companyId}
          embedded
        />
      ) : step === 8 ? (
        <section className="panel space-y-5 p-6">
          <h2 className="text-lg font-semibold">Test the initial workflow</h2>
          <p className="text-sm leading-relaxed text-steel">
            This checks configuration and runs a customer/note/follow-up/estimate transaction that
            is rolled back. It does not create test leads in your analytics, call anyone, or send
            messages.
          </p>
          <button
            type="button"
            className="btn-secondary"
            disabled={pending || !ready}
            onClick={() =>
              startTransition(async () => {
                setError('');
                try {
                  setChecks(await checkOnboarding(companyId));
                } catch (cause) {
                  setError(errorMessage(cause));
                }
              })
            }
          >
            {pending ? 'Checking...' : 'Run readiness check'}
          </button>
          {checks && (
            <div className="space-y-3">
              {checks.checks.map((check) => (
                <article
                  key={check.key}
                  className={`rounded-lg border p-4 ${check.ready ? 'border-emerald-100 bg-emerald-50/50' : check.required ? 'border-rose-100 bg-rose-50/50' : 'border-amber-100 bg-amber-50/50'}`}
                >
                  <p className="text-xs font-semibold">
                    {check.label}:{' '}
                    {check.ready
                      ? 'ready'
                      : check.required
                        ? 'required'
                        : 'optional / not configured'}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-steel">{check.detail}</p>
                </article>
              ))}
            </div>
          )}
          {checks?.manualWorkflowReady && (
            <p className="text-sm text-emerald-800">
              The manual call-note to estimate workflow is ready.
              {!checks.liveRecoveryReady && ' Live phone recovery remains unconfigured.'}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
            <SetupBackButton onClick={back} disabled={pending || !ready} />
            <button
              className="btn-primary"
              type="button"
              disabled={pending || !checks?.manualWorkflowReady}
              onClick={() =>
                startTransition(async () => {
                  setError('');
                  try {
                    await completeOnboarding(companyId);
                    globalThis.location.replace(workspaceHref('/', companyId));
                  } catch (cause) {
                    setError(errorMessage(cause));
                  }
                })
              }
            >
              <Icon name="check" width={16} height={16} />
              Finish setup
            </button>
          </div>
        </section>
      ) : (
        <form className="panel p-6 sm:p-8" onSubmit={save} aria-labelledby="onboarding-step-title">
          <fieldset className="space-y-5" disabled={pending || !ready}>
            {step === 1 && (
              <>
                <Field label="Business name">
                  <input
                    className="field"
                    required
                    maxLength={120}
                    value={profile.name}
                    onChange={(event) => patch('name', event.target.value)}
                  />
                </Field>
                <Field label="Industry">
                  <select
                    className="field"
                    value={profile.niche}
                    onChange={(event) => {
                      if (event.target.value === 'HVAC' || event.target.value === 'RENOVATION')
                        patch('niche', event.target.value);
                    }}
                  >
                    <option value="HVAC">{INDUSTRY_TEMPLATES.HVAC.label}</option>
                    <option value="RENOVATION">{INDUSTRY_TEMPLATES.RENOVATION.label}</option>
                  </select>
                </Field>
                <p className="text-xs text-steel">
                  Other industry templates remain inactive until their qualification behavior is
                  tested.
                </p>
              </>
            )}
            {step === 2 && (
              <>
                <Field label="Business contact email">
                  <input
                    className="field"
                    type="email"
                    required
                    value={profile.businessEmail ?? ''}
                    onChange={(event) => patch('businessEmail', event.target.value || null)}
                  />
                </Field>
                <Field label="Business contact phone">
                  <input
                    className="field"
                    type="tel"
                    required
                    value={profile.businessPhone ?? ''}
                    onChange={(event) => patch('businessPhone', event.target.value || null)}
                  />
                </Field>
                <Field label="Service areas" hint="Comma-separated cities or areas.">
                  <textarea
                    className="field"
                    value={areas}
                    onChange={(event) => setAreas(event.target.value)}
                  />
                </Field>
              </>
            )}
            {step === 3 && (
              <>
                <Field label="Business time zone">
                  <TimeZoneSelect
                    value={profile.timeZone}
                    onChange={(value) => patch('timeZone', value)}
                  />
                </Field>
                <Field label="Business currency">
                  <select
                    className="field"
                    value={profile.currency}
                    disabled={profile.catalogCount > 0 || services.length > 0}
                    onChange={(event) => {
                      const value = SUPPORTED_CURRENCIES.find(
                        (code) => code === event.target.value,
                      );
                      if (value) patch('currency', value);
                    }}
                  >
                    {SUPPORTED_CURRENCIES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </Field>
                <p className="text-xs text-steel">
                  Currency changes are rejected once priced records exist. No automatic currency
                  conversion is performed.
                </p>
              </>
            )}
            {step === 5 && (
              <>
                <div>
                  <input
                    className="field"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    aria-labelledby="onboarding-step-title"
                    aria-describedby="onboarding-phone-hint"
                    placeholder="e.g. +1 555 555 0123"
                    value={profile.forwardToPhoneNumber ?? ''}
                    onChange={(event) => patch('forwardToPhoneNumber', event.target.value || null)}
                  />
                  <p id="onboarding-phone-hint" className="mt-2 text-xs text-steel">
                    Use the number you answer customer calls on.
                  </p>
                </div>
                <details className="text-xs text-steel">
                  <summary className="cursor-pointer font-medium">Phone connection details</summary>
                  <div className="mt-3 space-y-3 rounded-lg bg-slate-50 p-4 leading-relaxed">
                    <section aria-label="Your LeadRecovery number">
                      <h3 className="font-semibold">Your LeadRecovery number</h3>
                      <p className="mt-1">{profile.twilioPhoneNumber ?? 'Not connected yet'}</p>
                      {profile.twilioPhoneNumber && (
                        <p className="mt-1">
                          Number added. Test your phone connection before relying on automatic
                          texts.
                        </p>
                      )}
                    </section>
                    <p>
                      We use the number above as the phone that should ring. Choose a mobile or
                      direct office line that does not forward back to LeadRecovery.
                    </p>
                    <p>
                      To keep your existing public business number, your phone provider can help
                      route calls through LeadRecovery once a recovery number is connected. Saving
                      this screen does not change forwarding settings with your phone provider.
                    </p>
                    <p>
                      Saving does not place calls or send texts. You can connect calls later and use
                      the rest of your workspace in the meantime.
                    </p>
                  </div>
                </details>
              </>
            )}
            {step === 6 && (
              <>
                <label className="flex items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 accent-indigo-600"
                    checked={notifications.enabled}
                    onChange={(event) =>
                      setNotifications((current) => ({ ...current, enabled: event.target.checked }))
                    }
                  />
                  <span>Enable transactional owner reminders</span>
                </label>
                <Field label="Owner notification email">
                  <input
                    className="field"
                    type="email"
                    required={notifications.enabled}
                    value={notifications.recipientEmail ?? ''}
                    onChange={(event) => {
                      setNotifications((current) => ({
                        ...current,
                        recipientEmail: event.target.value,
                      }));
                      setNotificationConsent(false);
                    }}
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    { key: 'newLeads' as const, label: 'New leads' },
                    { key: 'humanAttention' as const, label: 'Human-attention alerts' },
                    { key: 'overdueFollowUps' as const, label: 'Overdue follow-ups' },
                    { key: 'documentReview' as const, label: 'Draft review reminders' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 text-xs text-steel">
                      <input
                        type="checkbox"
                        className="accent-indigo-600"
                        checked={notifications[key]}
                        onChange={(event) =>
                          setNotifications((current) => ({
                            ...current,
                            [key]: event.target.checked,
                          }))
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <label className="flex items-start gap-2.5 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-indigo-600"
                    checked={notificationConsent}
                    onChange={(event) => setNotificationConsent(event.target.checked)}
                  />
                  <span>
                    I control this recipient email and consent to business-owner notifications. I
                    can opt out later.
                  </span>
                </label>
                {!settings.emailProviderConfigured && (
                  <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                    Resend is not configured. You can leave reminders off and finish the manual
                    workflow; no emails are sent by this setup step.
                  </p>
                )}
              </>
            )}
            {step === 7 && (
              <>
                <Field label="Business billing address">
                  <textarea
                    className="field min-h-24"
                    required
                    maxLength={1000}
                    value={profile.billingAddress ?? ''}
                    onChange={(event) => patch('billingAddress', event.target.value || null)}
                  />
                </Field>
                <Field label="Tax registration number (if applicable)">
                  <input
                    className="field"
                    maxLength={100}
                    value={profile.taxRegistrationNumber ?? ''}
                    onChange={(event) => patch('taxRegistrationNumber', event.target.value || null)}
                  />
                </Field>
                <Field label="Default tax rate (%)">
                  <input
                    className="field"
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    required
                    value={profile.defaultTaxRate}
                    onChange={(event) => patch('defaultTaxRate', Number(event.target.value))}
                  />
                </Field>
                <p className="text-xs leading-relaxed text-steel">
                  Confirm applicable taxes for your jurisdiction. The default is a starting point
                  for new drafts, not tax advice. Finalized documents preserve the billing profile
                  approved at finalization.
                </p>
              </>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
              {step > 1 && <SetupBackButton onClick={back} disabled={pending || !ready} />}
              <button className="btn-primary ml-auto" type="submit">
                {pending
                  ? 'Saving...'
                  : step === 5
                    ? profile.forwardToPhoneNumber?.trim()
                      ? 'Continue'
                      : 'Skip for now'
                    : 'Save & continue'}
                <Icon name="arrow" width={15} height={15} />
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {step === 4 && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <SetupBackButton onClick={back} disabled={pending || !ready} />
          <button
            className="btn-primary"
            type="button"
            disabled={pending || !ready}
            onClick={() => save()}
          >
            {pending ? 'Saving...' : 'Save & continue'}
            <Icon name="arrow" width={15} height={15} />
          </button>
        </div>
      )}
    </div>
  );
}
