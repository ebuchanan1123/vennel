'use client';

import { useState } from 'react';

export function UnsubscribeConfirmation({
  token,
  businessName,
}: {
  token: string;
  businessName: string;
}) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  return (
    <div className="mx-auto max-w-lg p-8">
      <h1 className="text-xl font-semibold">Owner email notifications</h1>
      <p className="mt-3 text-sm text-steel">{businessName}</p>
      {done ? (
        <p role="status" className="mt-5 text-sm text-emerald-700">
          Owner notifications have been disabled.
        </p>
      ) : (
        <>
          <p className="mt-5 text-sm">
            Confirm to stop transactional owner reminders. Merely opening this link does not change
            your preferences.
          </p>
          <button
            className="btn-primary mt-5"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              setError('');
              try {
                const response = await fetch(
                  `/notifications/unsubscribe/${encodeURIComponent(token)}/confirm`,
                  { method: 'POST' },
                );
                if (!response.ok)
                  throw new Error('Unable to disable notifications. The link may have expired.');
                setDone(true);
              } catch (cause) {
                setError(
                  cause instanceof Error ? cause.message : 'Unable to disable notifications.',
                );
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? 'Updating...' : 'Disable owner emails'}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}
