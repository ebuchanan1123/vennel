'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { SmsDeliveryRecord, SmsReconciliationInput } from '@lead-recovery/types';

import { errorMessage, reconcileSmsDelivery } from '../lib/api';

export function SmsDeliveryActions({
  companyId,
  delivery,
}: {
  companyId: string;
  delivery: SmsDeliveryRecord;
}) {
  const router = useRouter();
  const [providerId, setProviderId] = useState(delivery.providerId ?? '');
  const [verifiedNotSent, setVerifiedNotSent] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, startTransition] = useTransition();
  function submit(event: FormEvent, input: SmsReconciliationInput) {
    event.preventDefault();
    setError('');
    setNotice('');
    startTransition(async () => {
      try {
        await reconcileSmsDelivery(companyId, delivery.id, input);
        setNotice(
          input.action === 'LOOKUP'
            ? 'Provider status checked. Acceptance is not proof of delivery.'
            : 'Verified unsent message queued for another attempt.',
        );
        setVerifiedNotSent(false);
        router.refresh();
      } catch (cause) {
        setError(errorMessage(cause));
      }
    });
  }
  return (
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer">Review SMS delivery</summary>
      <div className="mt-2 space-y-3 rounded-lg bg-white p-3 text-ink">
        <p>
          Check Twilio records before authorizing another SMS. A timeout does not mean the send
          failed.
        </p>
        <form
          className="space-y-2"
          onSubmit={(event) =>
            submit(event, {
              action: 'LOOKUP',
              ...(providerId.trim() ? { providerId: providerId.trim() } : {}),
            })
          }
        >
          <label className="block">
            Twilio MessageSid
            <input
              className="field mt-1"
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
              placeholder="SM..."
              required={!delivery.providerId}
              pattern="(SM|MM)[a-fA-F0-9]{32}"
              disabled={pending}
            />
          </label>
          <button className="btn-secondary" disabled={pending}>
            Check provider status
          </button>
        </form>
        {!delivery.providerId &&
          (delivery.status === 'UNKNOWN' || delivery.status === 'SENDING') && (
            <form
              className="space-y-2 border-t border-slate-200 pt-3"
              onSubmit={(event) =>
                submit(event, {
                  action: 'CONFIRM_NOT_SENT',
                  approved: true,
                })
              }
            >
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={verifiedNotSent}
                  onChange={(event) => setVerifiedNotSent(event.target.checked)}
                  disabled={pending}
                  required
                />
                I verified that the original worker has stopped and Twilio did not accept this SMS.
                I understand an incorrect confirmation can send a duplicate.
              </label>
              <button className="btn-secondary" disabled={pending || !verifiedNotSent}>
                Authorize verified-unsent retry
              </button>
            </form>
          )}
        {error && (
          <p role="alert" className="text-rose-700">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-emerald-700">
            {notice}
          </p>
        )}
      </div>
    </details>
  );
}
