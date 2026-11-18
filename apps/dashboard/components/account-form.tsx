'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { authClient, safeReturnPath } from '../lib/auth-client';
import { Icon } from './icon';
import { Field, FormError } from './ui';
import { useClientReady } from '../lib/use-client-ready';

export function AccountForm({
  mode,
  returnTo,
  resetToken,
  verificationError,
}: {
  mode: 'login' | 'register' | 'forgot' | 'reset' | 'verify';
  returnTo?: string;
  resetToken?: string;
  verificationError?: string;
}) {
  const ready = useClientReady();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState(
    verificationError ? 'The account link is invalid or expired. Request a new link below.' : '',
  );
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const next = safeReturnPath(returnTo);
  const title = {
    login: 'Welcome back',
    register: 'Create your account',
    forgot: 'Reset your password',
    reset: 'Choose a new password',
    verify: 'Verify your email address',
  }[mode];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    if ((mode === 'register' || mode === 'reset') && password !== confirmation) {
      setError('The passwords do not match.');
      return;
    }
    setPending(true);
    try {
      if (mode === 'login') {
        const result = await authClient.signIn.email({ email, password });
        if (result.error) throw new Error(result.error.message ?? 'Sign-in failed.');
        // Reload across the auth boundary so cached layouts cannot retain another session.
        globalThis.location.assign(next);
      } else if (mode === 'register') {
        const result = await authClient.signUp.email({
          name,
          email,
          password,
          callbackURL: `/login?returnTo=${encodeURIComponent(next)}`,
        });
        if (result.error) throw new Error(result.error.message ?? 'Registration failed.');
        setPassword('');
        setConfirmation('');
        setNotice(
          'If this address can be registered, a verification email has been queued. Verify it before signing in. Existing account holders can sign in or request a password reset.',
        );
      } else if (mode === 'forgot') {
        const result = await authClient.requestPasswordReset({
          email,
          redirectTo: `/reset-password?returnTo=${encodeURIComponent(next)}`,
        });
        if (result.error) throw new Error(result.error.message ?? 'The reset request failed.');
        setNotice('If the account exists, a password-reset email has been queued.');
      } else if (mode === 'reset') {
        if (!resetToken)
          throw new Error('This password-reset link is incomplete. Request a new reset email.');
        const result = await authClient.resetPassword({ newPassword: password, token: resetToken });
        if (result.error) throw new Error(result.error.message ?? 'Password reset failed.');
        setPassword('');
        setConfirmation('');
        setNotice(
          'Password reset. Existing sessions have been revoked. Sign in with the new password.',
        );
      } else {
        const result = await authClient.sendVerificationEmail({
          email,
          callbackURL: `/login?returnTo=${encodeURIComponent(next)}`,
        });
        if (result.error)
          throw new Error(result.error.message ?? 'The verification request failed.');
        setNotice('If verification is needed, a new link has been queued.');
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'The account request failed. Please try again.',
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5">
      <div className="w-full max-w-md">
        <Link href="/login" className="mb-8 flex items-center justify-center gap-3">
          <span className="brand-mark">
            <Icon name="trend" />
          </span>
          <span className="text-xl font-semibold">
            Lead<span className="text-ember">Recovery</span>
          </span>
        </Link>
        <form className="panel space-y-5 p-6 sm:p-8" onSubmit={submit}>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-2 text-sm leading-relaxed text-steel">
              Your business relationships, conversations, and documents in one secure workspace.
            </p>
          </div>
          <fieldset disabled={pending || !ready} className="space-y-4">
            {mode === 'register' && (
              <Field label="Your name">
                <input
                  className="field"
                  autoComplete="name"
                  required
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
            )}
            {mode !== 'reset' && (
              <Field label="Email address">
                <input
                  className="field"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </Field>
            )}
            {(mode === 'login' || mode === 'register' || mode === 'reset') && (
              <Field
                label={mode === 'login' ? 'Password' : 'New password'}
                hint={
                  mode === 'login'
                    ? undefined
                    : 'Use at least 12 characters. Passwords are securely hashed by Better Auth.'
                }
              >
                <input
                  className="field"
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                  minLength={mode === 'login' ? 1 : 12}
                  maxLength={128}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
            )}
            {(mode === 'register' || mode === 'reset') && (
              <Field label="Confirm password">
                <input
                  className="field"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </Field>
            )}
            <FormError message={error} />
            {notice && (
              <p
                role="status"
                className="rounded-lg bg-emerald-50 p-3 text-xs leading-relaxed text-emerald-800"
              >
                {notice}
              </p>
            )}
            <button className="btn-primary w-full" type="submit">
              {pending
                ? 'Please wait...'
                : {
                    login: 'Sign in',
                    register: 'Create account',
                    forgot: 'Request reset link',
                    reset: 'Reset password',
                    verify: 'Request verification email',
                  }[mode]}
            </button>
          </fieldset>
          {mode === 'login' && (
            <div className="flex flex-wrap justify-between gap-3 text-xs font-medium text-ember">
              <Link href="/forgot-password">Forgot password?</Link>
              <Link href={`/register?returnTo=${encodeURIComponent(next)}`}>Create an account</Link>
            </div>
          )}
          {mode !== 'login' && (
            <Link
              className="block text-center text-xs font-medium text-ember"
              href={`/login?returnTo=${encodeURIComponent(next)}`}
            >
              Back to sign in
            </Link>
          )}
          {mode === 'login' && (
            <Link
              className="block text-xs text-steel"
              href={`/verify-email?returnTo=${encodeURIComponent(next)}`}
            >
              Need a new verification email?
            </Link>
          )}
          {process.env.NODE_ENV === 'development' && mode !== 'login' && (
            <p className="border-t border-slate-100 pt-4 text-[11px] leading-relaxed text-steel">
              Local development without Resend: run{' '}
              <code>pnpm accounts:email --email your-address</code> in your own terminal to retrieve
              the latest verification/reset link. Do not share links or passwords in chat.
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
