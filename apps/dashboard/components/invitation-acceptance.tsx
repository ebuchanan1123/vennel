'use client';

import Link from 'next/link';
import { useState } from 'react';
import { authClient } from '../lib/auth-client';
import { acceptInvitation, errorMessage } from '../lib/api';
import { workspaceHref } from '../lib/navigation';
import { FormError } from './ui';

export function InvitationAcceptance({ token }: { token: string }) {
  const { data: session, isPending } = authClient.useSession();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const returnTo = `/invite?token=${encodeURIComponent(token)}`;
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5">
      <section className="panel w-full max-w-lg space-y-5 p-8">
        <h1 className="text-2xl font-semibold">Join a business workspace</h1>
        <p className="text-sm leading-relaxed text-steel">
          Sign in with the exact email address that received this invitation. Membership is granted
          only after its token, recipient, expiry, and verified account are checked.
        </p>
        {isPending ? (
          <p className="text-sm text-steel">Checking your account...</p>
        ) : session ? (
          <>
            <p className="text-sm">
              Signed in as <strong>{session.user.email}</strong>
            </p>
            <button
              className="btn-primary w-full"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                setError('');
                try {
                  const result = await acceptInvitation(token);
                  globalThis.location.assign(workspaceHref('/', result.companyId));
                } catch (cause) {
                  setError(errorMessage(cause));
                  setPending(false);
                }
              }}
            >
              {pending ? 'Accepting...' : 'Accept business invitation'}
            </button>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <Link className="btn-primary" href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>
              Sign in to accept
            </Link>
            <Link
              className="btn-secondary"
              href={`/register?returnTo=${encodeURIComponent(returnTo)}`}
            >
              Create and verify an account
            </Link>
          </div>
        )}
        <FormError message={error} />
        <Link className="block text-xs font-medium text-ember" href="/">
          Return to workspace
        </Link>
      </section>
    </main>
  );
}
