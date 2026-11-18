import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@lead-recovery/database';

import { env } from './env.js';
import { HttpError } from './middleware/error-handler.js';
import { enqueueAccountEmail } from './services/account-email.service.js';

export function createAccountAuth(
  database: PrismaClient,
  options: { secret: string; baseURL: string; secureCookies: boolean; rateLimit?: boolean },
) {
  return betterAuth({
    appName: 'Lead Recovery',
    baseURL: options.baseURL,
    basePath: '/api/auth',
    secret: options.secret,
    trustedOrigins: [new URL(options.baseURL).origin],
    database: prismaAdapter(database, { provider: 'postgresql' }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 3600,
      sendResetPassword: async ({ user, url }) => {
        await enqueueAccountEmail(
          database,
          { userId: user.id, email: user.email, url, type: 'PASSWORD_RESET' },
          options.baseURL,
        );
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: 3600,
      sendVerificationEmail: async ({ user, url }) => {
        await enqueueAccountEmail(
          database,
          { userId: user.id, email: user.email, url, type: 'VERIFY_EMAIL' },
          options.baseURL,
        );
      },
    },
    session: {
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: options.rateLimit ?? true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/get-session': false,
        '/sign-in/email': { window: 60, max: 20 },
        '/sign-up/email': { window: 60, max: 10 },
        '/request-password-reset': { window: 60, max: 5 },
        '/send-verification-email': { window: 60, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: options.secureCookies,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
      ipAddress: { ipAddressHeaders: ['x-auth-client-ip'] },
    },
    user: { deleteUser: { enabled: false } },
  });
}

let instance: ReturnType<typeof createAccountAuth> | undefined;
export function getAccountAuth() {
  if (!env.BETTER_AUTH_SECRET)
    throw new HttpError(
      503,
      'Configure BETTER_AUTH_SECRET, or start the local workspace with pnpm dev.',
    );
  instance ??= createAccountAuth(prisma, {
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.DASHBOARD_BASE_URL,
    secureCookies: env.NODE_ENV === 'production',
  });
  return instance;
}
