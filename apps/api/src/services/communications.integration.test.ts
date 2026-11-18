import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { PrismaClient, type BackgroundJob } from '@prisma/client';
import type { QualificationResult } from '@lead-recovery/types';
import twilio from 'twilio';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../env.js';
import type { SmsProvider } from './twilio.service.js';
import type { runQualificationModel } from './openai.service.js';

const enabled = process.env.RUN_DATABASE_TESTS === 'true';
const schema = `communications_test_${randomUUID().replaceAll('-', '')}`;
const scopedUrl = new URL(env.DATABASE_URL);
scopedUrl.searchParams.set('schema', schema);
const admin = new PrismaClient();
const database = new PrismaClient({ datasourceUrl: scopedUrl.toString() });
const signatureToken = 'synthetic-twilio-token-not-a-provider-credential';
const publicUrl = 'https://twilio.example.test';
const phone = '+15555550101';
const customer = '+15555550102';
const sid = (prefix = 'SM') => `${prefix}${randomUUID().replaceAll('-', '')}`;
const provider: SmsProvider = {
  configured: vi.fn(() => true),
  send: vi.fn(),
  fetch: vi.fn(),
};
const ai = vi.fn<typeof runQualificationModel>();
const modelResult: QualificationResult = {
  reply: 'What city are you in?',
  serviceType: null,
  issue: null,
  location: null,
  urgency: null,
  preferredTime: null,
  projectType: null,
  budgetRange: null,
  timeline: null,
  propertyOwner: null,
  status: 'QUALIFYING',
  needsHuman: false,
  summary: null,
};
let servers: Server[] = [];
let bases: string[] = [];
let companyId: string;
let claim: typeof import('./background-job.service.js').claimBackgroundJob;
let finish: typeof import('./background-job.service.js').finishBackgroundJob;
let retry: typeof import('./background-job.service.js').retryBackgroundJob;
let run: typeof import('../worker.js').runJob;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function post(path: string, data: Record<string, string>, instance = 0, signed = true) {
  const signature = twilio.getExpectedTwilioSignature(signatureToken, `${publicUrl}${path}`, data);
  return fetch(`${bases[instance]}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(signed ? { 'x-twilio-signature': signature } : {}),
    },
    body: new URLSearchParams(data).toString(),
  });
}
function sms(overrides: Record<string, string> = {}) {
  return {
    MessageSid: sid(),
    From: customer,
    To: phone,
    Body: 'My furnace is not heating.',
    ...overrides,
  };
}
function call(overrides: Record<string, string> = {}) {
  return {
    CallSid: sid('CA'),
    From: customer,
    To: phone,
    DialCallStatus: 'no-answer',
    ...overrides,
  };
}
async function nextJob(): Promise<BackgroundJob> {
  for (;;) {
    const job = await claim();
    if (!job) throw new Error('Expected a claimable communication job.');
    if (job.kind === 'INBOUND_SMS' || job.kind === 'MISSED_CALL_RECOVERY') return job;
    await finish(job, { status: 'CANCELLED', error: 'Unrelated test fixture work.' });
  }
}
async function runNext() {
  const job = await nextJob();
  await run(job);
  return database.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
}
async function makeDue(id: string) {
  await database.backgroundJob.update({ where: { id }, data: { dueAt: new Date(0) } });
}
async function delivery() {
  return database.smsDelivery.findFirstOrThrow({ include: { message: true } });
}
async function status(
  id: string,
  providerId: string,
  value: string,
  extras: Record<string, string> = {},
) {
  return post(`/webhooks/twilio/sms/status/${id}`, {
    MessageSid: providerId,
    MessageStatus: value,
    From: phone,
    To: customer,
    ...extras,
  });
}

describe.runIf(enabled).sequential('durable communications on isolated PostgreSQL', () => {
  beforeAll(async () => {
    if (!/^communications_test_[a-f0-9]{32}$/.test(schema))
      throw new Error('Invalid owned schema.');
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    const migrated = spawnSync(
      'pnpm',
      ['--filter', '@lead-recovery/database', 'exec', 'prisma', 'migrate', 'deploy'],
      { env: { ...process.env, DATABASE_URL: scopedUrl.toString() }, encoding: 'utf8' },
    );
    if (migrated.status !== 0)
      throw new Error(`Communication test migration failed: ${migrated.stderr}`);
    const scope = await database.$queryRaw<{ name: string }[]>`SELECT current_schema() AS name`;
    if (scope[0]?.name !== schema)
      throw new Error('Communication database isolation was not established.');
    vi.doMock('@lead-recovery/database', () => ({ prisma: database }));
    vi.doMock('../env.js', () => ({
      env: {
        ...env,
        API_BASE_URL: publicUrl,
        BETTER_AUTH_SECRET: 'synthetic-auth-secret-for-isolated-tests-only-2026',
        TWILIO_VALIDATE_SIGNATURES: true,
        TWILIO_AUTH_TOKEN: signatureToken,
        TWILIO_ACCOUNT_SID: undefined,
        TWILIO_SMS_REPLY_MODE: 'openai',
        OPENAI_API_KEY: 'synthetic-key-not-a-provider-credential',
      },
    }));
    vi.doMock('./twilio.service.js', async () => ({
      ...(await vi.importActual<typeof import('./twilio.service.js')>('./twilio.service.js')),
      smsProvider: provider,
    }));
    vi.doMock('./openai.service.js', () => ({ openai: null, runQualificationModel: ai }));
    const jobs = await import('./background-job.service.js');
    claim = jobs.claimBackgroundJob;
    finish = jobs.finishBackgroundJob;
    retry = jobs.retryBackgroundJob;
    run = (await import('../worker.js')).runJob;
    const { createApiApp } = await import('../app.js');
    for (let index = 0; index < 2; index += 1) {
      const server = createServer(createApiApp());
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected local test server.');
      servers.push(server);
      bases.push(`http://127.0.0.1:${address.port}`);
    }
  }, 60000);

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(provider.configured).mockReturnValue(true);
    vi.mocked(provider.send).mockImplementation(async (input) => ({
      id: sid(),
      status: 'queued',
      from: input.from,
      to: input.to,
      body: input.body,
      errorCode: null,
    }));
    ai.mockResolvedValue(modelResult);
    await database.webhookEvent.deleteMany();
    await database.backgroundJob.deleteMany();
    await database.company.deleteMany();
    companyId = (
      await database.company.create({
        data: {
          name: 'Isolated HVAC',
          slug: 'isolated-hvac',
          niche: 'HVAC',
          serviceAreas: ['Toronto'],
          twilioPhoneNumber: phone,
          forwardToPhoneNumber: '+15555550103',
        },
      })
    ).id;
  });

  afterAll(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
    );
    servers = [];
    bases = [];
    await database.$disconnect();
    if (/^communications_test_[a-f0-9]{32}$/.test(schema))
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
  });

  it('acknowledges only after persisting the event and job, without waiting for AI or sending SMS', async () => {
    const response = await post('/webhooks/twilio/sms', sms());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/xml');
    expect(await response.text()).not.toContain('<Message>');
    expect(await database.webhookEvent.findFirst()).toMatchObject({
      status: 'RECEIVED',
      attempts: 0,
    });
    expect(await database.backgroundJob.findFirst()).toMatchObject({
      status: 'PENDING',
      kind: 'INBOUND_SMS',
    });
    expect(await database.message.count()).toBe(0);
    expect(ai).not.toHaveBeenCalled();
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent deliveries received by two API instances and retries after completion', async () => {
    const body = sms();
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, index) => post('/webhooks/twilio/sms', body, index % 2)),
    );
    expect(responses.map((response) => response.status)).toEqual(Array(8).fill(200));
    expect(await database.webhookEvent.count()).toBe(1);
    expect(await database.backgroundJob.count()).toBe(1);
    await runNext();
    expect(await database.message.count()).toBe(2);
    expect(ai).toHaveBeenCalledTimes(1);
    expect(provider.send).toHaveBeenCalledTimes(1);
    await post('/webhooks/twilio/sms', body, 1);
    expect(await database.message.count()).toBe(2);
    expect(await database.backgroundJob.count()).toBe(1);
  });

  it('recovers a crash after persistence and claiming but before processing', async () => {
    await post('/webhooks/twilio/sms', sms());
    const first = await nextJob();
    await database.backgroundJob.update({
      where: { id: first.id },
      data: { leaseUntil: new Date(0) },
    });
    const recovered = await runNext();
    expect(recovered).toMatchObject({ id: first.id, status: 'SUCCEEDED', attempts: 2 });
    expect(await database.webhookEvent.findFirst()).toMatchObject({
      status: 'COMPLETED',
      attempts: 2,
    });
    expect(await database.message.count()).toBe(2);
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('orders two rapid messages in one conversation, including while the first AI request is running', async () => {
    await post('/webhooks/twilio/sms', sms({ Body: 'I am in Toronto.' }));
    await post('/webhooks/twilio/sms', sms({ Body: 'This is urgent.' }));
    const entered = deferred<void>();
    const release = deferred<QualificationResult>();
    ai.mockImplementationOnce(async () => {
      entered.resolve();
      return release.promise;
    });
    const first = await nextJob();
    const running = run(first);
    await entered.promise;
    expect(await claim()).toBeNull();
    release.resolve({ ...modelResult, location: 'Toronto' });
    await running;
    ai.mockImplementationOnce(async (input) => {
      expect(input.lead.location).toBe('Toronto');
      return { ...modelResult, urgency: 'HIGH' };
    });
    await runNext();
    const lead = await database.lead.findFirstOrThrow();
    expect(lead).toMatchObject({ location: 'Toronto', urgency: 'HIGH' });
    expect(await database.lead.count()).toBe(1);
    expect(provider.send).toHaveBeenCalledTimes(2);
  });

  it('allows different conversations to be processed concurrently by different worker claims', async () => {
    await post('/webhooks/twilio/sms', sms());
    await post('/webhooks/twilio/sms', sms({ From: '+15555550104' }));
    const claims = await Promise.all([claim(), claim()]);
    expect(claims.every(Boolean)).toBe(true);
    const entered = deferred<void>();
    const release = deferred<QualificationResult>();
    let active = 0;
    ai.mockImplementation(async () => {
      active += 1;
      if (active === 2) entered.resolve();
      return release.promise;
    });
    const running = Promise.all(
      claims.map((job) => {
        if (!job) throw new Error('Expected a worker claim.');
        return run(job);
      }),
    );
    await entered.promise;
    expect(await database.webhookEvent.count({ where: { status: 'PROCESSING' } })).toBe(2);
    release.resolve(modelResult);
    await running;
    expect(provider.send).toHaveBeenCalledTimes(2);
  });

  it('fences a stale AI result after a worker restart without duplicating updates or replies', async () => {
    await post('/webhooks/twilio/sms', sms());
    const entered = deferred<void>();
    const release = deferred<QualificationResult>();
    ai.mockImplementationOnce(async () => {
      entered.resolve();
      return release.promise;
    });
    const first = await nextJob();
    const stale = run(first);
    await entered.promise;
    await database.backgroundJob.update({
      where: { id: first.id },
      data: { leaseUntil: new Date(0) },
    });
    ai.mockResolvedValueOnce({ ...modelResult, location: 'Toronto' });
    await runNext();
    release.resolve({ ...modelResult, location: 'Incorrect stale result' });
    await stale;
    expect(await database.lead.findFirst()).toMatchObject({ location: 'Toronto' });
    expect(await database.message.count()).toBe(2);
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('retries AI timeouts with persisted inbound state, then escalates with a single safe fallback', async () => {
    ai.mockRejectedValue(new Error('Synthetic AI timeout'));
    await post('/webhooks/twilio/sms', sms());
    const first = await runNext();
    expect(first).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(first.dueAt.getTime()).toBeGreaterThan(Date.now() + 25000);
    expect(await database.message.count()).toBe(1);
    expect(provider.send).not.toHaveBeenCalled();
    await database.backgroundJob.update({ where: { id: first.id }, data: { maxAttempts: 2 } });
    await makeDue(first.id);
    expect(await runNext()).toMatchObject({ status: 'SUCCEEDED', attempts: 2 });
    expect(await database.lead.findFirst()).toMatchObject({
      status: 'NEEDS_HUMAN',
      needsHuman: true,
    });
    expect(await database.webhookEvent.findFirst()).toMatchObject({
      status: 'COMPLETED',
      attempts: 2,
      lastError: expect.stringContaining('AI qualification'),
    });
    expect(await database.message.count()).toBe(2);
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('preserves call forwarding and queues a missed-call recovery SMS before acknowledgement', async () => {
    const body = call();
    const forwarded = await post('/webhooks/twilio/voice', body);
    expect(forwarded.status).toBe(200);
    const xml = await forwarded.text();
    expect(xml).toContain('timeout="12"');
    expect(xml).toContain('+15555550103');
    const response = await post('/webhooks/twilio/voice/status?companySlug=isolated-hvac', body);
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('<Message>');
    expect(provider.send).not.toHaveBeenCalled();
    await runNext();
    const accepted = await delivery();
    expect(accepted).toMatchObject({
      status: 'ACCEPTED',
      deliveredAt: null,
      providerId: expect.any(String),
    });
    expect(accepted.acceptedAt).toBeInstanceOf(Date);
    expect(accepted.message.body).toContain('Sorry we missed your call');
    expect(await database.lead.findFirst()).toMatchObject({ source: 'MISSED_CALL' });
  });

  it('deduplicates missed-call webhooks across dial states and suppresses recent recovery greetings', async () => {
    const body = call();
    const path = '/webhooks/twilio/voice/status?companySlug=isolated-hvac';
    await Promise.all([post(path, body), post(path, { ...body, DialCallStatus: 'failed' }, 1)]);
    expect(await database.webhookEvent.count()).toBe(1);
    await runNext();
    await post(path, call());
    await runNext();
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(await database.webhookEvent.count({ where: { status: 'COMPLETED' } })).toBe(2);
  });

  it('retries explicit Twilio rejection with bounded backoff without repeating AI or creating another message', async () => {
    vi.mocked(provider.send).mockRejectedValueOnce({ status: 429 });
    await post('/webhooks/twilio/sms', sms());
    const first = await runNext();
    expect(first.status).toBe('PENDING');
    expect(await delivery()).toMatchObject({ status: 'FAILED', providerId: null });
    expect(await database.webhookEvent.findFirst()).toMatchObject({ status: 'FAILED' });
    await makeDue(first.id);
    expect(await runNext()).toMatchObject({ status: 'SUCCEEDED', attempts: 2 });
    expect(await database.message.count()).toBe(2);
    expect(ai).toHaveBeenCalledTimes(1);
    expect(provider.send).toHaveBeenCalledTimes(2);
  });

  it('recovers a missed-call send rejection without losing the recovery job', async () => {
    vi.mocked(provider.send).mockRejectedValueOnce({ code: 'ECONNREFUSED' });
    await post('/webhooks/twilio/voice/status?companySlug=isolated-hvac', call());
    const first = await runNext();
    expect(first.status).toBe('PENDING');
    await makeDue(first.id);
    await runNext();
    expect(await database.message.count()).toBe(1);
    expect(await delivery()).toMatchObject({ status: 'ACCEPTED' });
    expect(provider.send).toHaveBeenCalledTimes(2);
  });

  it.each([{ code: 'ETIMEDOUT' }, { status: 500 }])(
    'blocks an ambiguous missed-call send outcome instead of blindly resending (%j)',
    async (failure) => {
      vi.mocked(provider.send).mockRejectedValueOnce(failure);
      const body = call();
      const path = '/webhooks/twilio/voice/status?companySlug=isolated-hvac';
      await post(path, body);
      const blocked = await runNext();
      expect(blocked.status).toBe('BLOCKED');
      expect(await delivery()).toMatchObject({ status: 'UNKNOWN', providerId: null });
      expect(await database.lead.findFirst()).toMatchObject({ needsHuman: true });
      await expect(retry(companyId, blocked.id)).rejects.toMatchObject({ status: 409 });
      await post(path, body, 1);
      expect(provider.send).toHaveBeenCalledTimes(1);
      expect(await database.webhookEvent.count()).toBe(1);
    },
  );

  it('does not resend after a send-stage crash, and accepts a late receipt from the original worker', async () => {
    const entered = deferred<void>();
    const release = deferred<Awaited<ReturnType<SmsProvider['send']>>>();
    vi.mocked(provider.send).mockImplementationOnce(async () => {
      entered.resolve();
      return release.promise;
    });
    await post('/webhooks/twilio/voice/status?companySlug=isolated-hvac', call());
    const first = await nextJob();
    const stale = run(first);
    await entered.promise;
    const pending = await delivery();
    expect(pending.status).toBe('SENDING');
    await database.backgroundJob.update({
      where: { id: first.id },
      data: { leaseUntil: new Date(0) },
    });
    expect(await runNext()).toMatchObject({ status: 'BLOCKED' });
    expect(provider.send).toHaveBeenCalledTimes(1);
    release.resolve({
      id: sid(),
      status: 'queued',
      from: phone,
      to: customer,
      body: pending.message.body,
      errorCode: null,
    });
    await stale;
    expect(await delivery()).toMatchObject({ status: 'ACCEPTED' });
    expect(await database.backgroundJob.findUnique({ where: { id: first.id } })).toMatchObject({
      status: 'SUCCEEDED',
    });
  });

  it('uses a signed late callback to reconcile an unknown outcome and release ordered work', async () => {
    vi.mocked(provider.send).mockRejectedValueOnce({ code: 'ETIMEDOUT' });
    await post('/webhooks/twilio/sms', sms());
    const blocked = await runNext();
    const unknown = await delivery();
    await post('/webhooks/twilio/sms', sms({ Body: 'Are you there?' }));
    const receiptId = sid();
    expect((await status(unknown.id, receiptId, 'sent')).status).toBe(204);
    expect(await database.backgroundJob.findUnique({ where: { id: blocked.id } })).toMatchObject({
      status: 'SUCCEEDED',
    });
    await runNext();
    expect(await database.message.count()).toBe(4);
    expect(provider.send).toHaveBeenCalledTimes(2);
  });

  it('records failed delivery, deduplicates callbacks, and never regresses on out-of-order status', async () => {
    await post('/webhooks/twilio/sms', sms());
    await runNext();
    const accepted = await delivery();
    if (!accepted.providerId) throw new Error('Expected provider acceptance.');
    const id = accepted.providerId;
    expect((await status(accepted.id, id, 'undelivered', { ErrorCode: '21610' })).status).toBe(204);
    await status(accepted.id, id, 'undelivered', { ErrorCode: '21610' });
    await status(accepted.id, id, 'queued');
    expect(await delivery()).toMatchObject({ status: 'FAILED', errorCode: '21610' });
    expect(await database.lead.findFirst()).toMatchObject({ needsHuman: true });
    await status(accepted.id, id, 'delivered');
    await status(accepted.id, id, 'sent');
    await status(accepted.id, id, 'failed');
    expect(await delivery()).toMatchObject({
      status: 'DELIVERED',
      acceptedAt: accepted.acceptedAt,
      errorCode: null,
      lastError: null,
    });
    expect((await delivery()).deliveredAt).toBeInstanceOf(Date);
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('handles a delivery callback arriving before the send API returns without downgrading it', async () => {
    const id = sid();
    vi.mocked(provider.send).mockImplementationOnce(async (input) => {
      const current = await delivery();
      expect((await status(current.id, id, 'delivered')).status).toBe(204);
      return {
        id,
        status: 'queued',
        from: input.from,
        to: input.to,
        body: input.body,
        errorCode: null,
      };
    });
    await post('/webhooks/twilio/sms', sms());
    expect(await runNext()).toMatchObject({ status: 'SUCCEEDED', providerId: id });
    expect(await delivery()).toMatchObject({ status: 'DELIVERED', providerId: id });
  });

  it('rejects invalid signatures, malformed payloads and mismatched business routing before persistence', async () => {
    expect((await post('/webhooks/twilio/sms', sms(), 0, false)).status).toBe(403);
    expect((await post('/webhooks/twilio/voice', call(), 0, false)).status).toBe(403);
    expect((await post('/webhooks/twilio/sms', sms({ MessageSid: 'invalid' }))).status).toBe(400);
    expect((await post('/webhooks/twilio/sms', sms({ From: 'not-a-phone' }))).status).toBe(400);
    expect((await post('/webhooks/twilio/sms', sms({ Body: 'x'.repeat(1601) }))).status).toBe(400);
    expect(
      (
        await post(
          '/webhooks/twilio/voice/status?companySlug=isolated-hvac',
          call({ To: '+15555550999' }),
        )
      ).status,
    ).toBe(404);
    expect(await database.webhookEvent.count()).toBe(0);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('scopes identical provider IDs and customer phones to their receiving businesses', async () => {
    const other = await database.company.create({
      data: {
        name: 'Other business',
        slug: 'other-business',
        niche: 'RENOVATION',
        serviceAreas: [],
        twilioPhoneNumber: '+15555550105',
      },
    });
    const body = sms();
    await post('/webhooks/twilio/sms', body);
    await post('/webhooks/twilio/sms', { ...body, To: other.twilioPhoneNumber ?? '' }, 1);
    const jobs = await Promise.all([nextJob(), nextJob()]);
    await Promise.all(jobs.map(run));
    expect(await database.conversation.count()).toBe(2);
    expect(await database.lead.count({ where: { companyId } })).toBe(1);
    expect(await database.lead.count({ where: { companyId: other.id } })).toBe(1);
    const first = await database.smsDelivery.findFirstOrThrow({
      where: { message: { lead: { companyId } } },
    });
    expect(
      (
        await status(first.id, first.providerId ?? sid(), 'delivered', {
          From: other.twilioPhoneNumber ?? '',
        })
      ).status,
    ).toBe(409);
    expect(await database.smsDelivery.findUnique({ where: { id: first.id } })).toMatchObject({
      status: 'ACCEPTED',
    });
  });

  it('protects messaging records and delivery callbacks from unauthorized access', async () => {
    await post('/webhooks/twilio/sms', sms());
    await runNext();
    const current = await delivery();
    expect((await fetch(`${bases[0]}/api/leads/${current.message.leadId}`)).status).toBe(401);
    expect(
      (
        await post(
          `/webhooks/twilio/sms/status/${current.id}`,
          {
            MessageSid: current.providerId ?? sid(),
            MessageStatus: 'delivered',
          },
          0,
          false,
        )
      ).status,
    ).toBe(403);
    expect((await status(current.id, sid(), 'delivered')).status).toBe(409);
    expect(await delivery()).toMatchObject({ status: 'ACCEPTED' });
  });
});
