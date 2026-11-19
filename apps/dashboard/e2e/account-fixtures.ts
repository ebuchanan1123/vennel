import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { prisma } from '@lead-recovery/database';
import { createAccountAuth } from '../../api/src/auth';
import { accountEmailSchema } from '../../api/src/services/account-email.service';
import { test as base, expect } from '@playwright/test';

config({ path: '../../.env' });
export const APP_ORIGIN = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000')
  .origin;
export type TestAccount = { id: string; email: string; password: string; name: string };
let fixtureAuth: ReturnType<typeof createAccountAuth> | undefined;
function auth() {
  const database = new URL(process.env.DATABASE_URL ?? '');
  if (
    process.env.NODE_ENV === 'production' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)
  ) {
    throw new Error('Account fixtures require a local development database.');
  }
  const secret =
    process.env.BETTER_AUTH_SECRET ??
    readFileSync(resolve('../../.local/auth-secret'), 'utf8').trim();
  fixtureAuth ??= createAccountAuth(prisma, {
    secret,
    baseURL: APP_ORIGIN,
    secureCookies: false,
    rateLimit: false,
  });
  return fixtureAuth;
}

export async function createTestAccount(name = 'E2E Owner'): Promise<TestAccount> {
  const email = `e2e-auth-${randomUUID()}@example.test`;
  const password = `Synthetic-passphrase-${randomUUID()}!`;
  await auth().api.signUpEmail({ body: { name, email, password, callbackURL: '/login' } });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const job = await prisma.backgroundJob.findFirstOrThrow({
    where: { userId: user.id, kind: 'AUTH_EMAIL' },
    orderBy: { createdAt: 'desc' },
  });
  const payload = accountEmailSchema.parse(job.payload);
  const response = await auth().handler(
    new Request(payload.url, { headers: { origin: APP_ORIGIN } }),
  );
  if (!response.ok && response.status !== 302)
    throw new Error('Fixture email verification failed.');
  if (!(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified)
    throw new Error('Fixture account was not verified.');
  return { id: user.id, email, password, name };
}
export async function accountStorageState(account: TestAccount) {
  const response = await auth().api.signInEmail({
    body: { email: account.email, password: account.password },
    headers: new Headers({ origin: APP_ORIGIN }),
    asResponse: true,
  });
  if (!response.ok) throw new Error('Fixture sign-in failed.');
  const cookies = response.headers.getSetCookie().flatMap((entry) => {
    const pair = entry.split(';')[0] ?? '';
    const separator = pair.indexOf('=');
    if (separator <= 0) return [];
    return [
      {
        name: pair.slice(0, separator),
        value: pair.slice(separator + 1),
        domain: new URL(APP_ORIGIN).hostname,
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax' as const,
      },
    ];
  });
  return { cookies, origins: [] };
}
export async function grantTestOwner(companyId: string, accountId: string) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  if (
    !['workflow-e2e-', 'document-e2e-', 'accounts-e2e-'].some((prefix) =>
      company.slug.startsWith(prefix),
    )
  )
    throw new Error('Test membership ownership check failed.');
  await prisma.businessMembership.create({ data: { companyId, userId: accountId, role: 'OWNER' } });
}
export async function deleteTestAccount(account: TestAccount) {
  const user = await prisma.user.findUnique({ where: { id: account.id } });
  if (
    !user ||
    user.email !== account.email ||
    !user.email.startsWith('e2e-auth-') ||
    !user.email.endsWith('@example.test')
  )
    throw new Error('Test account cleanup ownership check failed.');
  await prisma.user.delete({ where: { id: account.id } });
}

export const test = base.extend<object, { account: TestAccount }>({
  account: [
    async ({ browserName }, use) => {
      void browserName;
      const account = await createTestAccount();
      try {
        await use(account);
      } finally {
        await deleteTestAccount(account);
        await prisma.$disconnect();
      }
    },
    { scope: 'worker' },
  ],
  storageState: async ({ account }, use) => {
    await use(await accountStorageState(account));
  },
});
export { expect };
