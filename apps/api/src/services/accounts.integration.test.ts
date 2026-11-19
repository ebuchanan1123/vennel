import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { env } from '../env.js';

const enabled = process.env.RUN_DATABASE_TESTS === 'true';
const schema = `accounts_test_${randomUUID().replaceAll('-', '')}`;
const origin = new URL(env.DASHBOARD_BASE_URL).origin;
const databaseURL = new URL(env.DATABASE_URL);
databaseURL.searchParams.set('schema', schema);
const admin = new PrismaClient();
const database = new PrismaClient({ datasourceUrl: databaseURL.toString() });
const secret = randomBytes(48).toString('base64url');
const password = 'Synthetic-test-passphrase-2026!';
const sendSms = vi.fn(async (input: { from: string; to: string; body: string }) => ({
  id: `SM${randomUUID().replaceAll('-', '')}`,
  status: 'queued',
  from: input.from,
  to: input.to,
  body: input.body,
  errorCode: null,
}));
const sendEmail = vi.fn(async () => 'resend-auth-synthetic');
let server: Server;
let base: string;
const allowedOrigins = new Set<string>();
let makeApp: typeof import('../app.js').createApiApp;
let makeAuth: typeof import('../auth.js').createAccountAuth;
let owner: { id: string; email: string; cookie: string };
let staff: { id: string; email: string; cookie: string };
let outsider: { id: string; email: string; cookie: string };
let companyId: string;
let otherId: string;
let legacyId: string;
let foreign: {
  customerId: string;
  leadId: string;
  noteId: string;
  taskId: string;
  documentId: string;
};

async function request(path: string, method = 'GET', body?: unknown, cookie?: string) {
  return fetch(`${base}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      origin,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function createUser(email: string, verify = true) {
  const signup = await request('/api/auth/sign-up/email', 'POST', {
    name: email.split('@')[0],
    email,
    password,
    emailVerified: true,
    role: 'OWNER',
    callbackURL: '/login',
  });
  expect(signup.status).toBe(200);
  const user = await database.user.findUniqueOrThrow({ where: { email } });
  expect(user.emailVerified).toBe(false);
  if (!verify) return { id: user.id, email, cookie: '' };
  const job = await database.backgroundJob.findFirstOrThrow({
    where: { userId: user.id, kind: 'AUTH_EMAIL' },
    orderBy: { createdAt: 'desc' },
  });
  const data = (await import('./account-email.service.js')).accountEmailSchema.parse(job.payload);
  const link = new URL(data.url);
  const verified = await request(`${link.pathname}${link.search}`);
  expect(verified.status).toBe(302);
  const login = await request('/api/auth/sign-in/email', 'POST', { email, password });
  expect(login.status).toBe(200);
  const cookie = login.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ');
  expect(cookie).toContain('session_token=');
  expect(login.headers.getSetCookie().join(';')).toContain('HttpOnly');
  return { id: user.id, email, cookie };
}
async function createWorkspace(user: typeof owner, name: string) {
  const response = await request(
    '/api/accounts/businesses',
    'POST',
    { name, niche: 'HVAC', timeZone: 'UTC', currency: 'USD', requestId: randomUUID() },
    user.cookie,
  );
  expect(response.status).toBe(201);
  const result = await response.json();
  if (typeof result.companyId !== 'string')
    throw new Error('Business creation returned no workspace ID.');
  return result.companyId;
}

describe.runIf(enabled).sequential('real accounts, membership authorization and onboarding', () => {
  beforeAll(async () => {
    if (!/^accounts_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid owned schema.');
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    const migrated = spawnSync(
      'pnpm',
      ['--filter', '@lead-recovery/database', 'exec', 'prisma', 'migrate', 'deploy'],
      { env: { ...process.env, DATABASE_URL: databaseURL.toString() }, encoding: 'utf8' },
    );
    if (migrated.status !== 0)
      throw new Error(`Account test schema migration failed: ${migrated.stderr}`);
    const scope = await database.$queryRaw<{ name: string }[]>`SELECT current_schema() AS name`;
    if (scope[0]?.name !== schema)
      throw new Error('Account tests did not establish schema isolation.');
    vi.doMock('@lead-recovery/database', () => ({ prisma: database }));
    vi.doMock('./email-provider.service.js', async () => ({
      ...(await vi.importActual<typeof import('./email-provider.service.js')>(
        './email-provider.service.js',
      )),
      sendTransactionalEmail: sendEmail,
    }));
    vi.doMock('./twilio.service.js', async () => ({
      ...(await vi.importActual<typeof import('./twilio.service.js')>('./twilio.service.js')),
      smsProvider: { configured: () => true, send: sendSms, fetch: vi.fn() },
      validateTwilioSignature: (req: { header: (name: string) => string | undefined }) =>
        req.header('x-twilio-signature') === 'synthetic-provider-authorized',
    }));
    makeAuth = (await import('../auth.js')).createAccountAuth;
    makeApp = (await import('../app.js')).createApiApp;
    const auth = makeAuth(database, {
      secret,
      baseURL: origin,
      secureCookies: false,
      rateLimit: false,
    });
    server = createServer(makeApp(() => auth));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected local account test port.');
    base = `http://127.0.0.1:${address.port}`;
    allowedOrigins.add(base);
    const localFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (!allowedOrigins.has(url.origin))
        throw new Error('External provider calls are disabled in account tests.');
      return localFetch(input, init);
    });
    owner = await createUser('owner@accounts.example.test');
    staff = await createUser('staff@accounts.example.test');
    outsider = await createUser('outsider@accounts.example.test');
    legacyId = (
      await database.company.create({
        data: {
          name: 'Unassigned legacy business',
          slug: 'unassigned-legacy',
          niche: 'HVAC',
          serviceAreas: [],
        },
      })
    ).id;
    companyId = await createWorkspace(owner, 'Owner business');
    await database.company.update({
      where: { id: companyId },
      data: {
        businessEmail: 'business@example.test',
        businessPhone: '+15555550800',
        billingAddress: '10 Test Street',
        taxRegistrationNumber: 'TEST-TAX',
      },
    });
    otherId = await createWorkspace(outsider, 'Other business');
    await database.businessMembership.create({
      data: { companyId, userId: staff.id, role: 'STAFF' },
    });
    const customer = await database.customer.create({
      data: { companyId: otherId, name: 'Private other customer' },
    });
    const lead = await database.lead.create({
      data: {
        companyId: otherId,
        customerId: customer.id,
        phone: '+15555550900',
        source: 'SMS',
        messages: { create: [{ direction: 'INBOUND', body: 'Private other conversation' }] },
      },
    });
    const note = await database.callNote.create({
      data: {
        companyId: otherId,
        customerId: customer.id,
        leadId: lead.id,
        originalText: 'Private other note',
        text: 'Private other note',
        occurredAt: new Date(),
        confirmedFields: [],
      },
    });
    const task = await database.followUpTask.create({
      data: {
        companyId: otherId,
        customerId: customer.id,
        leadId: lead.id,
        type: 'CALL_CUSTOMER',
        title: 'Private task',
        dueAt: new Date(),
      },
    });
    const document = await database.billingDocument.create({
      data: {
        companyId: otherId,
        customerId: customer.id,
        kind: 'ESTIMATE',
        title: 'Private estimate',
      },
    });
    foreign = {
      customerId: customer.id,
      leadId: lead.id,
      noteId: note.id,
      taskId: task.id,
      documentId: document.id,
    };
  }, 60000);
  afterAll(async () => {
    if (server)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    await database.$disconnect();
    if (/^accounts_test_[a-f0-9]{32}$/.test(schema))
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
    vi.unstubAllGlobals();
  });

  it('requires a verified account and never grants existing companies to a new signup', async () => {
    expect((await request('/api/companies')).status).toBe(401);
    const unverified = await createUser('unverified@accounts.example.test', false);
    expect(
      (await request('/api/auth/sign-in/email', 'POST', { email: unverified.email, password }))
        .status,
    ).toBe(403);
    const credential = await database.account.findFirstOrThrow({
      where: { userId: unverified.id, providerId: 'credential' },
    });
    expect(credential.password).not.toBe(password);
    const companies = await request('/api/companies', 'GET', undefined, owner.cookie);
    const list = await companies.json();
    expect(list.map((entry: { id: string }) => entry.id)).toEqual([companyId]);
    expect(
      (await request(`/api/workspace/${legacyId}/customers`, 'GET', undefined, owner.cookie))
        .status,
    ).toBe(404);
  });

  it('denies cross-business lists, objects, messages and mutations on every private surface', async () => {
    for (const resource of [
      'customers',
      'services',
      'call-notes',
      'follow-ups',
      'documents',
      'settings',
      'jobs',
      'members',
      'team',
      'onboarding',
    ]) {
      expect(
        (await request(`/api/workspace/${otherId}/${resource}`, 'GET', undefined, owner.cookie))
          .status,
        resource,
      ).toBe(404);
    }
    for (const [resource, id] of [
      ['customers', foreign.customerId],
      ['call-notes', foreign.noteId],
      ['documents', foreign.documentId],
    ]) {
      expect(
        (
          await request(
            `/api/workspace/${companyId}/${resource}/${id}`,
            'GET',
            undefined,
            owner.cookie,
          )
        ).status,
        resource,
      ).toBe(404);
    }
    expect(
      (await request(`/api/leads/${foreign.leadId}`, 'GET', undefined, owner.cookie)).status,
    ).toBe(404);
    expect(
      (await request(`/api/leads?companyId=${otherId}`, 'GET', undefined, owner.cookie)).status,
    ).toBe(404);
    expect(
      (await request(`/api/dashboard/stats?companyId=${otherId}`, 'GET', undefined, owner.cookie))
        .status,
    ).toBe(404);
    expect(
      (
        await request(
          `/api/leads/${foreign.leadId}/outcome`,
          'PATCH',
          { outcome: 'WON' },
          owner.cookie,
        )
      ).status,
    ).toBe(404);
    const leads = await (await request('/api/leads', 'GET', undefined, owner.cookie)).json();
    expect(leads).toEqual([]);
    expect((await database.lead.findUniqueOrThrow({ where: { id: foreign.leadId } })).outcome).toBe(
      'UNKNOWN',
    );
  });

  it('permits staff operations and drafts but denies pricing, settings, team and financial approvals', async () => {
    const basePath = `/api/workspace/${companyId}`;
    const created = await request(
      `${basePath}/customers`,
      'POST',
      { name: 'Staff-managed customer', phone: null, email: null, address: null, notes: null },
      staff.cookie,
    );
    expect(created.status).toBe(201);
    const customer = await created.json();
    const note = await request(
      `${basePath}/call-notes`,
      'POST',
      {
        customerId: customer.id,
        leadId: null,
        text: 'Staff post-call summary',
        direction: 'INBOUND',
        occurredAt: new Date().toISOString(),
        phone: null,
      },
      staff.cookie,
    );
    expect(note.status).toBe(201);
    expect((await note.json()).audits[0].actor).toBe(staff.id);
    const draft = await request(
      `${basePath}/documents`,
      'POST',
      {
        kind: 'ESTIMATE',
        customerId: customer.id,
        title: 'Staff draft',
        notes: null,
        dueDate: null,
        discountAmount: 0,
        taxRate: 0,
        items: [],
      },
      staff.cookie,
    );
    expect(draft.status).toBe(201);
    const document = await draft.json();
    expect(
      (
        await request(
          `${basePath}/documents/${document.id}/finalize`,
          'POST',
          { revision: 1, approved: true },
          staff.cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `${basePath}/documents/${document.id}/email-preview`,
          'POST',
          { revision: 1, recipientEmail: 'customer@example.test' },
          staff.cookie,
        )
      ).status,
    ).toBe(403);
    for (const resource of ['settings', 'jobs', 'team', 'onboarding'])
      expect(
        (await request(`${basePath}/${resource}`, 'GET', undefined, staff.cookie)).status,
        resource,
      ).toBe(403);
    expect(
      (await request(`${basePath}/services`, 'POST', { name: 'Not allowed' }, staff.cookie)).status,
    ).toBe(403);
    const info = await request(`${basePath}/info`, 'GET', undefined, staff.cookie);
    expect(info.status).toBe(200);
    expect(await info.json()).not.toHaveProperty('notifications');
    expect((await request(`${basePath}/members`, 'GET', undefined, staff.cookie)).status).toBe(200);
  });

  it('only accepts invitations for the intended verified email and revokes membership immediately', async () => {
    const invited = await createUser('invited@accounts.example.test');
    const response = await request(
      `/api/workspace/${companyId}/team/invitations`,
      'POST',
      { email: invited.email, role: 'STAFF' },
      owner.cookie,
    );
    expect(response.status).toBe(201);
    const invitation = await response.json();
    const token = new URL(invitation.inviteURL).searchParams.get('token');
    expect(token).toHaveLength(43);
    expect(
      (await request('/api/accounts/invitations/accept', 'POST', { token }, outsider.cookie))
        .status,
    ).toBe(403);
    expect(
      (await request('/api/accounts/invitations/accept', 'POST', { token }, invited.cookie)).status,
    ).toBe(200);
    expect(
      (await request('/api/accounts/invitations/accept', 'POST', { token }, invited.cookie)).status,
    ).toBe(200);
    const membership = await database.businessMembership.findUniqueOrThrow({
      where: { companyId_userId: { companyId, userId: invited.id } },
    });
    expect(membership.role).toBe('STAFF');
    expect(
      (
        await request(
          `/api/workspace/${companyId}/team/members/${membership.id}`,
          'PATCH',
          { role: null },
          owner.cookie,
        )
      ).status,
    ).toBe(204);
    expect(
      (await request(`/api/workspace/${companyId}/customers`, 'GET', undefined, invited.cookie))
        .status,
    ).toBe(404);
    expect(
      (await request('/api/accounts/invitations/accept', 'POST', { token }, invited.cookie)).status,
    ).toBe(409);
    const lastOwner = await database.businessMembership.findUniqueOrThrow({
      where: { companyId_userId: { companyId, userId: owner.id } },
    });
    expect(
      (
        await request(
          `/api/workspace/${companyId}/team/members/${lastOwner.id}`,
          'PATCH',
          { role: null },
          owner.cookie,
        )
      ).status,
    ).toBe(409);
  });

  it('runs onboarding without retained test data, enforces immutable currency and scopes assignment', async () => {
    await database.catalogService.create({
      data: {
        companyId,
        name: 'Diagnostic',
        category: 'Diagnostics',
        unit: 'visit',
        unitPrice: 125,
        keywords: [],
      },
    });
    const profile = {
      step: 7,
      name: 'Owner business',
      niche: 'HVAC',
      currency: 'USD',
      timeZone: 'America/Toronto',
      businessEmail: 'business@example.test',
      businessPhone: '+15555550800',
      billingAddress: '10 Test Street',
      taxRegistrationNumber: 'TEST-TAX',
      defaultTaxRate: 13,
      forwardToPhoneNumber: null,
      serviceAreas: ['Test area'],
    };
    expect(
      (
        await request(
          `/api/workspace/${companyId}/onboarding`,
          'PATCH',
          { ...profile, currency: 'CAD' },
          owner.cookie,
        )
      ).status,
    ).toBe(409);
    expect(
      (await request(`/api/workspace/${companyId}/onboarding`, 'PATCH', profile, owner.cookie))
        .status,
    ).toBe(200);
    const before = await Promise.all([
      database.customer.count({ where: { companyId } }),
      database.callNote.count({ where: { companyId } }),
      database.billingDocument.count({ where: { companyId } }),
    ]);
    const readiness = await request(
      `/api/workspace/${companyId}/onboarding/check`,
      'POST',
      {},
      owner.cookie,
    );
    expect(readiness.status).toBe(200);
    expect((await readiness.json()).manualWorkflowReady).toBe(true);
    expect(
      await Promise.all([
        database.customer.count({ where: { companyId } }),
        database.callNote.count({ where: { companyId } }),
        database.billingDocument.count({ where: { companyId } }),
      ]),
    ).toEqual(before);
    expect(
      (await request(`/api/workspace/${companyId}/onboarding/complete`, 'POST', {}, owner.cookie))
        .status,
    ).toBe(200);
    const completed = await database.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(completed.onboardingCompletedAt).not.toBeNull();
    expect(
      (await request(`/api/workspace/${companyId}/onboarding`, 'PATCH', profile, owner.cookie))
        .status,
    ).toBe(200);
    const edited = await database.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(edited.onboardingCompletedAt).toEqual(completed.onboardingCompletedAt);
    expect(edited.onboardingTestedAt).toBeNull();
    const customer = await database.customer.findFirstOrThrow({ where: { companyId } });
    const task = {
      customerId: customer.id,
      leadId: null,
      title: 'Assigned callback',
      type: 'CALL_CUSTOMER',
      dueAt: new Date().toISOString(),
      priority: 'NORMAL',
      notes: null,
    };
    expect(
      (
        await request(
          `/api/workspace/${companyId}/follow-ups`,
          'POST',
          { ...task, assignedUserId: outsider.id },
          owner.cookie,
        )
      ).status,
    ).toBe(400);
    const assigned = await request(
      `/api/workspace/${companyId}/follow-ups`,
      'POST',
      { ...task, assignedUserId: staff.id },
      owner.cookie,
    );
    expect(assigned.status).toBe(201);
    expect((await assigned.json()).assignedUser.id).toBe(staff.id);
    const authJob = await database.backgroundJob.findFirstOrThrow({
      where: { userId: owner.id, kind: 'AUTH_EMAIL' },
    });
    expect(
      (
        await request(
          `/api/workspace/${companyId}/jobs/${authJob.id}/retry`,
          'POST',
          {},
          owner.cookie,
        )
      ).status,
    ).toBe(404);
  });

  it('rejects cross-origin writes and revoked sessions after logout', async () => {
    const blocked = await fetch(`${base}/api/accounts/businesses`, {
      method: 'POST',
      headers: {
        cookie: owner.cookie,
        origin: 'https://untrusted.example',
        'content-type': 'application/json',
      },
      body: '{}',
    });
    expect(blocked.status).toBe(403);
    const temporary = await createUser('logout@accounts.example.test');
    expect((await request('/api/auth/sign-out', 'POST', {}, temporary.cookie)).status).toBe(200);
    expect((await request('/api/companies', 'GET', undefined, temporary.cookie)).status).toBe(401);
  });

  it('resets passwords through one-time links and revokes existing sessions', async () => {
    const user = await createUser('reset@accounts.example.test');
    const requested = await request('/api/auth/request-password-reset', 'POST', {
      email: user.email,
      redirectTo: `${origin}/reset-password`,
    });
    expect(requested.status).toBe(200);
    const job = await database.backgroundJob.findFirstOrThrow({
      where: { userId: user.id, kind: 'AUTH_EMAIL' },
      orderBy: { createdAt: 'desc' },
    });
    const message = (await import('./account-email.service.js')).accountEmailSchema.parse(
      job.payload,
    );
    expect(message.type).toBe('PASSWORD_RESET');
    const link = new URL(message.url);
    const token = link.pathname.split('/').pop();
    const reset = await request('/api/auth/reset-password', 'POST', {
      token,
      newPassword: 'Changed-synthetic-passphrase-2026!',
    });
    expect(reset.status).toBe(200);
    expect((await request('/api/companies', 'GET', undefined, user.cookie)).status).toBe(401);
    expect(
      (await request('/api/auth/sign-in/email', 'POST', { email: user.email, password })).status,
    ).toBe(401);
    expect(
      (
        await request('/api/auth/sign-in/email', 'POST', {
          email: user.email,
          password: 'Changed-synthetic-passphrase-2026!',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request('/api/auth/reset-password', 'POST', {
          token,
          newPassword: 'Another-synthetic-passphrase-2026!',
        })
      ).status,
    ).not.toBe(200);
  });

  it('uses Secure, HttpOnly cookies for HTTPS deployments', async () => {
    const auth = makeAuth(database, {
      secret,
      baseURL: 'https://secure.example.test',
      secureCookies: true,
      rateLimit: false,
    });
    const response = await auth.api.signInEmail({
      body: { email: owner.email, password },
      headers: new Headers({ origin: 'https://secure.example.test' }),
      asResponse: true,
    });
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie().join(';');
    expect(cookies).toContain('HttpOnly');
    expect(cookies).toContain('Secure');
    expect(cookies).toContain('SameSite=Lax');
  });

  it('stores rate limits durably and ignores caller-supplied rate-limit identity headers', async () => {
    const auth = makeAuth(database, {
      secret,
      baseURL: origin,
      secureCookies: false,
      rateLimit: true,
    });
    const limited = createServer(makeApp(() => auth));
    await new Promise<void>((resolve) => limited.listen(0, '127.0.0.1', resolve));
    const address = limited.address();
    if (!address || typeof address === 'string') throw new Error('Expected rate-limit test port.');
    allowedOrigins.add(`http://127.0.0.1:${address.port}`);
    try {
      let blocked = false;
      for (let attempt = 0; attempt < 22; attempt += 1) {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: {
            origin,
            'content-type': 'application/json',
            'x-auth-client-ip': `203.0.113.${attempt + 1}`,
          },
          body: JSON.stringify({ email: owner.email, password: 'Incorrect-synthetic-passphrase!' }),
        });
        if (response.status === 429) {
          blocked = true;
          break;
        }
        expect(response.status).toBe(401);
      }
      expect(blocked).toBe(true);
      expect(await database.rateLimit.count()).toBeGreaterThan(0);
    } finally {
      allowedOrigins.delete(`http://127.0.0.1:${address.port}`);
      await new Promise<void>((resolve, reject) =>
        limited.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('rejects expired sessions and revoked invitation tokens', async () => {
    const user = await createUser('expired@accounts.example.test');
    await database.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await request('/api/companies', 'GET', undefined, user.cookie)).status).toBe(401);
    const response = await request(
      `/api/workspace/${companyId}/team/invitations`,
      'POST',
      { email: outsider.email, role: 'STAFF' },
      owner.cookie,
    );
    expect(response.status).toBe(201);
    const invitation = await response.json();
    const token = new URL(invitation.inviteURL).searchParams.get('token');
    const stored = await database.businessInvitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });
    expect(stored.tokenHash).not.toBe(token);
    expect(
      (
        await request(
          `/api/workspace/${companyId}/team/invitations/${invitation.id}/revoke`,
          'POST',
          {},
          owner.cookie,
        )
      ).status,
    ).toBe(204);
    expect(
      (await request('/api/accounts/invitations/accept', 'POST', { token }, outsider.cookie))
        .status,
    ).toBe(404);
  });

  it('preserves actual owner approval and billing snapshots on finalized documents', async () => {
    const customer = await database.customer.findFirstOrThrow({ where: { companyId } });
    const draftResponse = await request(
      `/api/workspace/${companyId}/documents`,
      'POST',
      {
        kind: 'ESTIMATE',
        customerId: customer.id,
        title: 'Owner-reviewed estimate',
        notes: null,
        dueDate: null,
        discountAmount: 0,
        taxRate: 13,
        items: [
          { description: 'Owner-reviewed diagnostic', unit: 'visit', quantity: 1, unitPrice: 125 },
        ],
      },
      staff.cookie,
    );
    expect(draftResponse.status).toBe(201);
    const draft = await draftResponse.json();
    const finalized = await request(
      `/api/workspace/${companyId}/documents/${draft.id}/finalize`,
      'POST',
      { revision: draft.revision, approved: true },
      owner.cookie,
    );
    expect(finalized.status).toBe(200);
    const document = await finalized.json();
    expect(document.finalizedBy).toBe(owner.id);
    expect(document.billingProfile.taxRegistrationNumber).toBe('TEST-TAX');
    expect(document.billingProfile.address).toBe('10 Test Street');
    expect(document.totals.total).toBe(141.25);
    await database.company.update({
      where: { id: companyId },
      data: { billingAddress: 'Updated address' },
    });
    const stored = await database.billingDocument.findUniqueOrThrow({ where: { id: draft.id } });
    expect(stored.billingProfile).toMatchObject({ address: '10 Test Street' });
  });

  it('scopes roles per business rather than granting an owner global privileges', async () => {
    await database.businessMembership.create({
      data: { companyId: otherId, userId: owner.id, role: 'STAFF' },
    });
    const response = await request('/api/companies', 'GET', undefined, owner.cookie);
    const businesses = await response.json();
    expect(businesses.find((company: { id: string }) => company.id === companyId).role).toBe(
      'OWNER',
    );
    expect(businesses.find((company: { id: string }) => company.id === otherId).role).toBe('STAFF');
    expect(
      (await request(`/api/workspace/${otherId}/customers`, 'GET', undefined, owner.cookie)).status,
    ).toBe(200);
    expect(
      (await request(`/api/workspace/${otherId}/settings`, 'GET', undefined, owner.cookie)).status,
    ).toBe(403);
  });

  it('requires a current owner for SMS recovery and scopes delivery records to the business', async () => {
    const message = await database.message.create({
      data: {
        leadId: foreign.leadId,
        direction: 'OUTBOUND',
        body: 'Private other outbound SMS',
        smsDelivery: {
          create: {
            fromPhone: '+15555550910',
            toPhone: '+15555550900',
            status: 'UNKNOWN',
          },
        },
      },
      include: { smsDelivery: true },
    });
    const id = message.smsDelivery?.id;
    if (!id) throw new Error('Expected the foreign delivery fixture.');
    const path = `/api/workspace/${companyId}/sms-deliveries/${id}/reconcile`;
    const body = { action: 'LOOKUP' };
    expect((await request(path, 'POST', body, staff.cookie)).status).toBe(403);
    expect((await request(path, 'POST', body, outsider.cookie)).status).toBe(404);
    expect((await request(path, 'POST', body, owner.cookie)).status).toBe(404);
    expect(
      (
        await request(
          `/api/workspace/${otherId}/sms-deliveries/${id}/reconcile`,
          'POST',
          body,
          owner.cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (await request(path, 'POST', { action: 'CONFIRM_NOT_SENT', approved: false }, owner.cookie))
        .status,
    ).toBe(400);
    expect(await database.smsDeliveryReview.count()).toBe(0);
  });

  it('serializes competing owner demotions so a business never loses its last owner', async () => {
    const second = await createUser('second-owner@accounts.example.test');
    const membership = await database.businessMembership.create({
      data: { companyId, userId: second.id, role: 'OWNER' },
    });
    const original = await database.businessMembership.findUniqueOrThrow({
      where: { companyId_userId: { companyId, userId: owner.id } },
    });
    const responses = await Promise.all([
      request(
        `/api/workspace/${companyId}/team/members/${original.id}`,
        'PATCH',
        { role: 'STAFF' },
        owner.cookie,
      ),
      request(
        `/api/workspace/${companyId}/team/members/${membership.id}`,
        'PATCH',
        { role: 'STAFF' },
        second.cookie,
      ),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([204, 409]);
    expect(await database.businessMembership.count({ where: { companyId, role: 'OWNER' } })).toBe(
      1,
    );
  });

  it('preserves signature-validated missed-call and emergency SMS webhooks outside user login', async () => {
    await database.company.update({
      where: { id: legacyId },
      data: { twilioPhoneNumber: '+15555550600', forwardToPhoneNumber: '+15555550601' },
    });
    const body = {
      CallSid: `CA${randomUUID().replaceAll('-', '')}`,
      From: '+15555550605',
      To: '+15555550600',
    };
    const post = (path: string, data: unknown, signed = true) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(signed ? { 'x-twilio-signature': 'synthetic-provider-authorized' } : {}),
        },
        body: JSON.stringify(data),
      });
    expect((await post('/webhooks/twilio/voice', body, false)).status).toBe(403);
    const voice = await post('/webhooks/twilio/voice', body);
    expect(voice.status).toBe(200);
    expect(await voice.text()).toContain('+15555550601');
    const missed = '/webhooks/twilio/voice/status?companySlug=unassigned-legacy';
    expect((await post(missed, { ...body, DialCallStatus: 'no-answer' })).status).toBe(200);
    expect((await post(missed, { ...body, DialCallStatus: 'no-answer' })).status).toBe(200);
    expect(sendSms).not.toHaveBeenCalled();
    const { runJob } = await import('../worker.js');
    const processEvent = async (eventType: string) => {
      const event = await database.webhookEvent.findFirstOrThrow({
        where: { companyId: legacyId, eventType },
      });
      const job = await database.backgroundJob.update({
        where: { id: event.jobId ?? '' },
        data: {
          status: 'RUNNING',
          attempts: 1,
          leaseToken: randomUUID(),
          leaseUntil: new Date(Date.now() + 60000),
        },
      });
      await runJob(job);
    };
    await processEvent('VOICE_STATUS');
    expect(sendSms).toHaveBeenCalledTimes(1);
    const sms = {
      MessageSid: `SM${randomUUID().replaceAll('-', '')}`,
      From: body.From,
      To: body.To,
      Body: 'I smell gas near the furnace.',
    };
    expect((await post('/webhooks/twilio/sms', sms)).status).toBe(200);
    await processEvent('SMS_MESSAGE');
    const lead = await database.lead.findFirstOrThrow({
      where: { companyId: legacyId, phone: body.From },
    });
    expect(lead.status).toBe('NEEDS_HUMAN');
    expect(lead.needsHuman).toBe(true);
    const count = await database.message.count({ where: { leadId: lead.id } });
    expect((await post('/webhooks/twilio/sms', sms)).status).toBe(200);
    expect(await database.message.count({ where: { leadId: lead.id } })).toBe(count);
  });

  it('delivers account-scoped email through the durable worker and refuses stale or mis-scoped links', async () => {
    const { prepareAccountEmail } = await import('./account-email.service.js');
    const { runJob } = await import('../worker.js');
    const previousFrom = env.RESEND_FROM_EMAIL;
    const previousKey = env.RESEND_API_KEY;
    env.RESEND_FROM_EMAIL = 'accounts@example.com';
    env.RESEND_API_KEY = 'synthetic-provider-key';
    sendEmail.mockClear();
    try {
      const account = await createUser('auth-delivery@example.com', false);
      const pending = await database.backgroundJob.findFirstOrThrow({
        where: { userId: account.id, kind: 'AUTH_EMAIL' },
      });
      expect(pending.companyId).toBeNull();
      const { accountEmailSchema } = await import('./account-email.service.js');
      const payload = accountEmailSchema.parse(pending.payload);
      expect(
        await prepareAccountEmail({
          ...pending,
          payload: { ...payload, expiresAt: new Date(Date.now() - 1000).toISOString() },
        }),
      ).toBeNull();
      await expect(prepareAccountEmail({ ...pending, userId: owner.id })).rejects.toMatchObject({
        retryable: false,
      });
      await expect(prepareAccountEmail({ ...pending, companyId })).rejects.toMatchObject({
        retryable: false,
      });
      await expect(
        prepareAccountEmail({
          ...pending,
          payload: {
            ...payload,
            url: 'https://other.example.com/api/auth/verify-email?token=synthetic',
          },
        }),
      ).rejects.toMatchObject({ retryable: false });
      await database.user.update({ where: { id: account.id }, data: { emailVerified: true } });
      expect(await prepareAccountEmail(pending)).toBeNull();
      await database.user.update({ where: { id: account.id }, data: { emailVerified: false } });
      const reserved = await createUser('auth-blocked@accounts.example.test', false);
      const reservedJob = await database.backgroundJob.findFirstOrThrow({
        where: { userId: reserved.id, kind: 'AUTH_EMAIL' },
      });
      await expect(prepareAccountEmail(reservedJob)).rejects.toMatchObject({ blocked: true });
      expect(sendEmail).not.toHaveBeenCalled();
      const claimed = await database.backgroundJob.update({
        where: { id: pending.id },
        data: {
          status: 'RUNNING',
          attempts: 1,
          leaseToken: randomUUID(),
          leaseUntil: new Date(Date.now() + 60000),
        },
      });
      await runJob(claimed);
      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ id: claimed.id, companyId: null, userId: account.id }),
        expect.objectContaining({ to: account.email, subject: 'Verify your Lead Recovery email' }),
      );
      const completed = await database.backgroundJob.findUniqueOrThrow({
        where: { id: pending.id },
      });
      expect(completed.status).toBe('SUCCEEDED');
      expect(completed.providerId).toBe('resend-auth-synthetic');
      expect(completed.deliveryPayload).toMatchObject({ to: account.email });
      expect(
        await database.jobAttempt.count({
          where: { jobId: pending.id, outcome: 'SUCCEEDED', finishedAt: { not: null } },
        }),
      ).toBe(1);
    } finally {
      env.RESEND_FROM_EMAIL = previousFrom;
      env.RESEND_API_KEY = previousKey;
    }
  });

  it('creates one owned business for concurrent retries and rejects conflicting creation details', async () => {
    const input = {
      name: 'Concurrent business A',
      niche: 'RENOVATION',
      timeZone: 'UTC',
      currency: 'CAD',
      requestId: randomUUID(),
    };
    const competing = await Promise.all([
      request('/api/accounts/businesses', 'POST', input, owner.cookie),
      request(
        '/api/accounts/businesses',
        'POST',
        { ...input, name: 'Concurrent business B' },
        owner.cookie,
      ),
    ]);
    expect(competing.map((response) => response.status).sort()).toEqual([201, 409]);
    const success = competing.find((response) => response.status === 201);
    if (!success) throw new Error('Expected exactly one successful creation request.');
    const created = await success.json();
    const company = await database.company.findUniqueOrThrow({ where: { id: created.companyId } });
    const retry = await request(
      '/api/accounts/businesses',
      'POST',
      { ...input, name: company.name },
      owner.cookie,
    );
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual({ companyId: company.id });
    expect(
      (
        await request(
          '/api/accounts/businesses',
          'POST',
          { ...input, name: company.name, currency: 'EUR' },
          owner.cookie,
        )
      ).status,
    ).toBe(409);
    expect(
      await database.company.count({ where: { createRequestKey: company.createRequestKey } }),
    ).toBe(1);
    expect(
      await database.businessMembership.count({
        where: { companyId: company.id, userId: owner.id, role: 'OWNER' },
      }),
    ).toBe(1);
    expect(
      await database.businessMembershipAudit.count({
        where: { companyId: company.id, action: 'BUSINESS_CREATED' },
      }),
    ).toBe(1);
  });
});
