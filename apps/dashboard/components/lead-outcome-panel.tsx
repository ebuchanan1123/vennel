'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { hasTwoDecimals } from '@lead-recovery/types';

import { errorMessage as describeError, updateLeadOutcome, type Lead } from '../lib/api';
import { FormError } from './ui';
import { useBusinessAccess } from './business-access';

const OUTCOMES = [
  { value: 'UNKNOWN', label: 'Unknown' },
  { value: 'CONTACTED', label: 'Contacted' },
  { value: 'ESTIMATE_SENT', label: 'Estimate Sent' },
  { value: 'BOOKED', label: 'Booked' },
  { value: 'WON', label: 'Won' },
  { value: 'LOST', label: 'Lost' },
] as const;

const LOST_REASONS = [
  'Price',
  'No response',
  'Went with competitor',
  'Outside service area',
  'Not ready',
  'Other',
] as const;

export function LeadOutcomePanel({ lead }: { lead: Lead }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState(lead.outcome);
  const [estimatedValue, setEstimatedValue] = useState(lead.estimatedValue?.toString() ?? '');
  const [actualValue, setActualValue] = useState(lead.actualValue?.toString() ?? '');
  const [lostReason, setLostReason] = useState(lead.lostReason ?? '');
  const [customLostReason, setCustomLostReason] = useState(
    LOST_REASONS.includes(lead.lostReason as (typeof LOST_REASONS)[number])
      ? ''
      : (lead.lostReason ?? ''),
  );
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [isPending, startTransition] = useTransition();

  function parseMoney(value: string): number | null {
    if (value.trim() === '') return null;
    const parsed = Number(value);
    if (!hasTwoDecimals(parsed) || parsed < 0 || parsed > 99999999.99) {
      throw new RangeError(
        'Enter a nonnegative amount with at most two decimals, below 100,000,000.',
      );
    }
    return parsed;
  }

  function save(
    nextOutcome: string,
    overrides?: { estimatedValue?: string; actualValue?: string },
  ) {
    setStatus('idle');
    setErrorMessage('');

    const resolvedLostReason =
      nextOutcome === 'LOST'
        ? (lostReason === 'Other' ? customLostReason : lostReason) || null
        : lostReason || null;

    startTransition(async () => {
      try {
        await updateLeadOutcome(
          lead.id,
          {
            outcome: nextOutcome,
            estimatedValue: parseMoney(overrides?.estimatedValue ?? estimatedValue),
            actualValue: parseMoney(overrides?.actualValue ?? actualValue),
            lostReason:
              nextOutcome === 'LOST'
                ? resolvedLostReason
                : lostReason
                  ? resolvedLostReason
                  : undefined,
          },
          lead.companyId,
        );
        setOutcome(nextOutcome as typeof outcome);
        setStatus('saved');
        router.refresh();
      } catch (error) {
        setErrorMessage(describeError(error));
        setStatus('error');
      }
    });
  }

  return (
    <section className="panel space-y-5 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink">Business outcome</h2>
        <p className="mt-2 text-xs leading-relaxed text-steel">
          Track the job separately from AI qualification.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <QuickAction
          label="Mark Contacted"
          onClick={() => save('CONTACTED')}
          disabled={isPending}
        />
        <QuickAction label="Mark Booked" onClick={() => save('BOOKED')} disabled={isPending} />
        <QuickAction label="Mark Won" onClick={() => save('WON')} disabled={isPending} />
        <QuickAction label="Mark Lost" onClick={() => save('LOST')} disabled={isPending} />
      </div>

      <fieldset disabled={isPending} className="space-y-4 border-t border-slate-100 pt-4">
        <Field label="Outcome">
          <select
            value={outcome}
            onChange={(event) => setOutcome(event.target.value as typeof outcome)}
            className="field"
          >
            {OUTCOMES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Estimated opportunity value">
          <MoneyInput value={estimatedValue} onChange={setEstimatedValue} placeholder="8000" />
        </Field>

        <Field label="Actual job value">
          <MoneyInput value={actualValue} onChange={setActualValue} placeholder="7200" />
        </Field>

        {outcome === 'LOST' && (
          <Field label="Lost reason">
            <select
              value={lostReason}
              onChange={(event) => setLostReason(event.target.value)}
              className="field"
            >
              <option value="">Select a reason</option>
              {LOST_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </select>
            {lostReason === 'Other' && (
              <input
                type="text"
                value={customLostReason}
                onChange={(event) => setCustomLostReason(event.target.value)}
                placeholder="Describe the reason"
                className="field mt-2"
              />
            )}
          </Field>
        )}

        <button
          type="button"
          onClick={() => save(outcome)}
          disabled={isPending}
          className="btn-primary w-full"
        >
          {isPending ? 'Saving…' : 'Save Outcome'}
        </button>

        {status === 'saved' && (
          <p className="text-sm font-medium text-emerald-600">Outcome saved.</p>
        )}
        {status === 'error' && <FormError message={errorMessage} />}
      </fieldset>
    </section>
  );
}

function QuickAction({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-slate-200 px-2.5 py-2 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
    >
      {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function MoneyInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const { company } = useBusinessAccess();
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-steel">
        {company?.currency ?? 'USD'}
      </span>
      <input
        type="number"
        min="0"
        max="99999999.99"
        step="0.01"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="field pl-12"
      />
    </div>
  );
}
