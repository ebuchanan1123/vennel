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
const providerOrigins = new Set<string>();
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
let start: typeof import('../worker.js').startWorker;
let renew: typeof import('./background-job.service.js').renewBackgroundJobLease;
let reap: typeof import('./background-job.service.js').reapExpiredBackgroundJobs;
let reserve: typeof import('./provider-usage.service.js').reserveProviderUsage;
let consumeLimit: typeof import('../middleware/api-rate-limit.js').consumeApiRateLimit;
let reconcile: typeof import('./sms-delivery.service.js').reconcileSmsDelivery;
let config: typeof env;

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
    config = (await import('../env.js')).env;
    const jobs = await import('./background-job.service.js');
    claim = jobs.claimBackgroundJob;
    finish = jobs.finishBackgroundJob;
    retry = jobs.retryBackgroundJob;
    renew = jobs.renewBackgroundJobLease;
    reap = jobs.reapExpiredBackgroundJobs;
    run = (await import('../worker.js')).runJob;
    start = (await import('../worker.js')).startWorker;
    reserve = (await import('./provider-usage.service.js')).reserveProviderUsage;
    consumeLimit = (await import('../middleware/api-rate-limit.js')).consumeApiRateLimit;
    reconcile = (await import('./sms-delivery.service.js')).reconcileSmsDelivery;
    const { createApiApp } = await import('../app.js');
    for (let index = 0; index < 2; index += 1) {
      const server = createServer(createApiApp());
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected local test server.');
      servers.push(server);
      bases.push(`http://127.0.0.1:${address.port}`);
    }
    const localFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (!bases.includes(url.origin) && !providerOrigins.has(url.origin))
        throw new Error('External provider calls are disabled in communication tests.');
      return localFetch(input, init);
    });
  }, 60000);

  beforeEach(async () => {
    vi.clearAllMocks();
    config.AI_DAILY_REQUEST_LIMIT = 200;
    config.SMS_DAILY_SEND_LIMIT = 500;
    config.API_RATE_LIMIT_PER_MINUTE = 120;
    config.WORKER_CONCURRENCY = 4;
    vi.mocked(provider.configured).mockReturnValue(true);
    vi.mocked(provider.send)
      .mockReset()
      .mockImplementation(async (input) => ({
        id: sid(),
        status: 'queued',
        from: input.from,
        to: input.to,
        body: input.body,
        errorCode: null,
      }));
    vi.mocked(provider.fetch)
      .mockReset()
      .mockImplementation(async (id) => {
        const current = await database.smsDelivery.findUniqueOrThrow({
          where: { providerId: id },
          include: { message: true },
        });
        return {
          id,
          status: 'delivered',
          from: current.fromPhone,
          to: current.toPhone,
          body: current.message.body,
          errorCode: null,
        };
      });
    ai.mockReset().mockResolvedValue(modelResult);
    await database.webhookEvent.deleteMany();
    await database.backgroundJob.deleteMany();
    await database.company.deleteMany();
    await database.rateLimit.deleteMany();
    await database.workerHeartbeat.deleteMany();
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
    vi.unstubAllGlobals();
  });

  it('acknowledges only after persisting the event and job, without waiting for AI or sending SMS', async () => {
    const started = performance.now();
    const response = await post('/webhooks/twilio/sms', sms());
    expect(performance.now() - started).toBeLessThan(2000);
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
    expect(await database.backgroundJob.count({ where: { kind: 'INBOUND_SMS' } })).toBe(1);
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
      expect(
        await database.backgroundJob.count({ where: { kind: 'LEAD_FOLLOW_UP_SUGGESTIONS' } }),
      ).toBe(0);
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

  it('rolls back the event and conversation when durable enqueue fails, and accepts a subsequent webhook retry', async () => {
    await database.$executeRawUnsafe(
      'ALTER TABLE "BackgroundJob" ADD CONSTRAINT "test_reject_sms" CHECK ("kind" <> \'INBOUND_SMS\')',
    );
    const log = vi.spyOn(console, 'error');
    const privateText = `Private customer content ${randomUUID()}`;
    const body = sms({ Body: privateText });
    try {
      expect((await post('/webhooks/twilio/sms', body)).status).toBe(500);
      expect(await database.webhookEvent.count()).toBe(0);
      expect(await database.conversation.count()).toBe(0);
      const logs = JSON.stringify(log.mock.calls);
      expect(logs).not.toContain(privateText);
      expect(logs).not.toContain(signatureToken);
    } finally {
      await database.$executeRawUnsafe(
        'ALTER TABLE "BackgroundJob" DROP CONSTRAINT "test_reject_sms"',
      );
      log.mockRestore();
    }
    expect((await post('/webhooks/twilio/sms', body)).status).toBe(200);
    expect(await database.webhookEvent.count()).toBe(1);
  });

  it('preserves historical deduplication markers without replaying old outbound messages', async () => {
    const body = sms();
    await database.webhookEvent.create({
      data: { eventType: 'SMS_MESSAGE', externalId: body.MessageSid, status: 'COMPLETED' },
    });
    expect((await post('/webhooks/twilio/sms', body)).status).toBe(200);
    expect(await database.backgroundJob.count()).toBe(0);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it.each(['anonymous', 'client:synthetic-caller', 'sip:caller@example.test'])(
    'continues forwarding non-SMS caller ID %s without attempting recovery SMS',
    async (from) => {
      const body = call({ From: from });
      expect((await post('/webhooks/twilio/voice', body)).status).toBe(200);
      expect(
        (await post('/webhooks/twilio/voice/status?companySlug=isolated-hvac', body)).status,
      ).toBe(200);
      expect(await runNext()).toMatchObject({ status: 'SUCCEEDED' });
      expect(await database.webhookEvent.findFirst()).toMatchObject({
        status: 'COMPLETED',
        lastError: expect.stringContaining('caller ID'),
      });
      expect(provider.send).not.toHaveBeenCalled();
    },
  );

  it('never sends model-generated prices, bookings or commitments to customers', async () => {
    const unsafe = 'The price is $125 and your appointment is confirmed for tomorrow.';
    ai.mockResolvedValue({ ...modelResult, reply: unsafe });
    await post('/webhooks/twilio/sms', sms({ Body: 'What does it cost and can I book tomorrow?' }));
    await runNext();
    const outgoing = await delivery();
    expect(outgoing.message.body).not.toContain(unsafe);
    expect(outgoing.message.body).not.toContain('$125');
    expect(outgoing.message.body).not.toContain('appointment is confirmed');
    expect(outgoing.message.body).toContain('must confirm pricing and availability');
    expect(outgoing.message.body).toContain('What kind of heating or cooling service');
  });

  it('does not allow a later AI result to clear human-attention flags', async () => {
    await post('/webhooks/twilio/sms', sms({ Body: 'I smell gas.' }));
    await runNext();
    await post('/webhooks/twilio/sms', sms({ Body: 'What should I do next?' }));
    await runNext();
    expect(await database.lead.findFirst()).toMatchObject({
      status: 'NEEDS_HUMAN',
      needsHuman: true,
    });
    expect(provider.send).toHaveBeenCalledTimes(2);
  });

  it('retries rather than overwriting a human-attention update made during qualification', async () => {
    await post('/webhooks/twilio/sms', sms());
    const entered = deferred<void>();
    const release = deferred<QualificationResult>();
    ai.mockImplementationOnce(async () => {
      entered.resolve();
      return release.promise;
    });
    const job = await nextJob();
    const running = run(job);
    await entered.promise;
    const lead = await database.lead.findFirstOrThrow();
    await database.lead.update({
      where: { id: lead.id },
      data: { needsHuman: true, status: 'NEEDS_HUMAN' },
    });
    release.resolve(modelResult);
    await running;
    expect(await database.backgroundJob.findUnique({ where: { id: job.id } })).toMatchObject({
      status: 'PENDING',
    });
    expect(provider.send).not.toHaveBeenCalled();
    await makeDue(job.id);
    await runNext();
    expect(await database.lead.findFirst()).toMatchObject({
      needsHuman: true,
      status: 'NEEDS_HUMAN',
    });
  });

  it('reconciles an accepted SMS through a durable provider lookup when callbacks are missing', async () => {
    await post('/webhooks/twilio/sms', sms());
    await runNext();
    const check = await database.backgroundJob.findFirstOrThrow({
      where: { kind: 'SMS_STATUS_RECONCILIATION' },
    });
    expect(check.dueAt.getTime()).toBeGreaterThan(Date.now() + 55000);
    await makeDue(check.id);
    const claimed = await claim();
    if (!claimed) throw new Error('Expected the status reconciliation job.');
    expect(claimed.id).toBe(check.id);
    await run(claimed);
    expect(await delivery()).toMatchObject({ status: 'DELIVERED' });
    expect(provider.fetch).toHaveBeenCalledTimes(1);
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('records an owner-verified provider receipt for an unknown send without submitting another SMS', async () => {
    vi.mocked(provider.send).mockRejectedValueOnce({ code: 'ETIMEDOUT' });
    await post('/webhooks/twilio/sms', sms());
    const job = await runNext();
    const unknown = await delivery();
    const id = sid();
    vi.mocked(provider.fetch).mockResolvedValueOnce({
      id,
      status: 'sent',
      from: phone,
      to: customer,
      body: unknown.message.body,
      errorCode: null,
    });
    await reconcile(companyId, unknown.id, 'verified-owner', { action: 'LOOKUP', providerId: id });
    expect(await delivery()).toMatchObject({ status: 'SENT', providerId: id });
    expect(await database.backgroundJob.findUnique({ where: { id: job.id } })).toMatchObject({
      status: 'SUCCEEDED',
    });
    expect(await database.smsDeliveryReview.findFirst()).toMatchObject({
      actorId: 'verified-owner',
      action: 'LOOKUP',
      providerId: id,
    });
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('requires explicit owner verification before retrying an unknown send, preserving the existing message', async () => {
    vi.mocked(provider.send).mockRejectedValueOnce({ code: 'ETIMEDOUT' });
    await post('/webhooks/twilio/sms', sms());
    await runNext();
    const unknown = await delivery();
    const queued = await reconcile(companyId, unknown.id, 'verified-owner', {
      action: 'CONFIRM_NOT_SENT',
      approved: true,
    });
    expect(queued).toEqual({
      id: unknown.id,
      status: 'PENDING',
      providerId: null,
      providerStatus: null,
      acceptedAt: null,
      deliveredAt: null,
      lastError: null,
      errorCode: null,
    });
    await runNext();
    expect(await delivery()).toMatchObject({ id: unknown.id, status: 'ACCEPTED' });
    expect(await database.smsDeliveryReview.findFirst()).toMatchObject({
      actorId: 'verified-owner',
      action: 'CONFIRM_NOT_SENT',
    });
    expect(await database.message.count()).toBe(2);
    expect(ai).toHaveBeenCalledTimes(1);
    expect(provider.send).toHaveBeenCalledTimes(2);
    await expect(
      reconcile(companyId, unknown.id, 'verified-owner', {
        action: 'CONFIRM_NOT_SENT',
        approved: true,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('enforces business-scoped daily AI reservations atomically under concurrent requests', async () => {
    config.AI_DAILY_REQUEST_LIMIT = 2;
    const outcomes = await Promise.allSettled(
      Array.from({ length: 10 }, () => reserve(companyId, 'AI_REQUEST')),
    );
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    const usage = await database.providerUsage.findFirstOrThrow();
    expect(usage.used).toBe(2);
    expect(usage.windowStart.getUTCHours()).toBe(0);
    const other = await database.company.create({
      data: { name: 'Other quota', slug: 'other-quota', niche: 'HVAC', serviceAreas: [] },
    });
    await reserve(other.id, 'AI_REQUEST');
    expect(
      await database.providerUsage.findFirst({ where: { companyId: other.id } }),
    ).toMatchObject({ used: 1 });
  });

  it('blocks excess SMS submissions before the provider call and makes the pause visible', async () => {
    config.SMS_DAILY_SEND_LIMIT = 1;
    await post('/webhooks/twilio/sms', sms());
    await runNext();
    await post('/webhooks/twilio/sms', sms());
    expect(await runNext()).toMatchObject({
      status: 'BLOCKED',
      lastError: expect.stringContaining('daily SMS'),
    });
    expect(await database.smsDelivery.count({ where: { status: 'PENDING' } })).toBe(1);
    expect(await database.lead.findFirst()).toMatchObject({ needsHuman: true });
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('uses a shared database API rate limit rather than per-instance memory', async () => {
    config.API_RATE_LIMIT_PER_MINUTE = 2;
    const decisions = await Promise.all(
      Array.from({ length: 10 }, () => consumeLimit('same-account')),
    );
    expect(decisions.filter(Boolean)).toHaveLength(2);
    expect(await database.rateLimit.findFirst()).toMatchObject({ count: 3 });
    await database.rateLimit.updateMany({ data: { lastRequest: BigInt(Date.now() - 120000) } });
    expect(await consumeLimit('same-account')).toBe(true);
    expect(await database.rateLimit.findFirst()).toMatchObject({ count: 1 });
  });

  it('renews only a current, unexpired lease and recovers exhausted crash attempts with human visibility', async () => {
    await post('/webhooks/twilio/sms', sms());
    const entered = deferred<void>();
    const release = deferred<QualificationResult>();
    ai.mockImplementationOnce(async () => {
      entered.resolve();
      return release.promise;
    });
    const job = await nextJob();
    const running = run(job);
    await entered.promise;
    expect(await renew(job)).toBe(true);
    await database.backgroundJob.update({
      where: { id: job.id },
      data: { leaseUntil: new Date(0), maxAttempts: 1 },
    });
    expect(await renew(job)).toBe(false);
    await reap();
    expect(await database.backgroundJob.findUnique({ where: { id: job.id } })).toMatchObject({
      status: 'FAILED',
    });
    expect(await database.webhookEvent.findFirst()).toMatchObject({ status: 'FAILED' });
    expect(await database.lead.findFirst()).toMatchObject({ needsHuman: true });
    expect(await database.jobAttempt.findFirst()).toMatchObject({
      outcome: 'LEASE_EXPIRED',
      finishedAt: expect.any(Date),
    });
    release.resolve(modelResult);
    await running;
    await retry(companyId, job.id);
    await runNext();
    expect(await database.webhookEvent.findFirst()).toMatchObject({ status: 'COMPLETED' });
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('recovers provider acceptance when a worker crashes before finishing its final attempt', async () => {
    await post('/webhooks/twilio/sms', sms());
    const job = await nextJob();
    await (await import('./communication.service.js')).processCommunicationJob(job);
    await database.backgroundJob.update({
      where: { id: job.id },
      data: { leaseUntil: new Date(0), maxAttempts: 1 },
    });
    await reap();
    expect(await database.backgroundJob.findUnique({ where: { id: job.id } })).toMatchObject({
      status: 'SUCCEEDED',
      providerId: expect.any(String),
    });
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('renews an active job lease while AI is running', async () => {
    await post('/webhooks/twilio/sms', sms());
    const entered = deferred<void>();
    const release = deferred<QualificationResult>();
    ai.mockImplementationOnce(async () => {
      entered.resolve();
      return release.promise;
    });
    const job = await nextJob();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const running = run(job);
    try {
      await entered.promise;
      await database.backgroundJob.update({
        where: { id: job.id },
        data: { leaseUntil: new Date(Date.now() + 5000) },
      });
      await vi.advanceTimersByTimeAsync(40000);
      await vi.waitFor(async () => {
        const renewed = await database.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
        expect(renewed.leaseUntil?.getTime()).toBeGreaterThan(Date.now() + 110000);
      });
    } finally {
      release.resolve(modelResult);
      await running;
      vi.useRealTimers();
    }
  });

  it('reports database/worker readiness and drains active work on shutdown without claiming new events', async () => {
    expect((await fetch(`${bases[0]}/health`)).status).toBe(200);
    expect((await fetch(`${bases[0]}/health/ready`)).status).toBe(503);
    config.WORKER_CONCURRENCY = 2;
    await post('/webhooks/twilio/sms', sms());
    await post('/webhooks/twilio/sms', sms({ From: '+15555550109' }));
    const entered = deferred<void>();
    const release = deferred<QualificationResult>();
    let active = 0;
    ai.mockImplementation(async () => {
      active += 1;
      if (active === 2) entered.resolve();
      return release.promise;
    });
    const stop = new AbortController();
    const worker = start(stop.signal);
    try {
      await vi.waitFor(() => expect(active).toBe(2), { timeout: 2000 });
      expect((await fetch(`${bases[0]}/health/ready`)).status).toBe(200);
      stop.abort();
      await post('/webhooks/twilio/sms', sms({ From: '+15555550110' }));
    } finally {
      stop.abort();
      release.resolve(modelResult);
      await worker;
    }
    expect(await database.workerHeartbeat.count()).toBe(0);
    expect(
      await database.backgroundJob.count({ where: { kind: 'INBOUND_SMS', status: 'PENDING' } }),
    ).toBe(1);
    expect(provider.send).toHaveBeenCalledTimes(2);
  });

  it.each(['success', 'timeout'] as const)(
    'validates the actual AI SDK transport against a local provider (%s)',
    async (mode) => {
      const { APIConnectionTimeoutError } = await import('openai');
      const actual =
        await vi.importActual<typeof import('./openai.service.js')>('./openai.service.js');
      const client = actual.openai;
      if (!client) throw new Error('Expected the synthetic test AI client.');
      const requests: unknown[] = [];
      const server = createServer(async (request, response) => {
        let body = '';
        for await (const chunk of request) body += chunk;
        requests.push(JSON.parse(body));
        if (mode === 'timeout') return;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            id: 'resp_synthetic',
            object: 'response',
            status: 'completed',
            model: 'synthetic-model',
            output: [
              {
                id: 'msg_synthetic',
                type: 'message',
                role: 'assistant',
                status: 'completed',
                content: [
                  { type: 'output_text', text: JSON.stringify(modelResult), annotations: [] },
                ],
              },
            ],
          }),
        );
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('Expected the local provider port.');
      const base = `http://127.0.0.1:${address.port}`;
      const originalBase = client.baseURL;
      const originalTimeout = client.timeout;
      client.baseURL = base;
      client.timeout = 1000;
      providerOrigins.add(base);
      try {
        const company = await database.company.findUniqueOrThrow({ where: { id: companyId } });
        const lead = await database.lead.create({
          data: { companyId, phone: customer, source: 'SMS' },
        });
        const started = performance.now();
        const result = actual.runQualificationModel({
          company,
          lead,
          recentMessages: [],
          latestCustomerMessage: 'Synthetic furnace inquiry',
          missingFields: ['serviceType', 'issue'],
        });
        if (mode === 'success') await expect(result).resolves.toEqual(modelResult);
        else await expect(result).rejects.toBeInstanceOf(APIConnectionTimeoutError);
        expect(performance.now() - started).toBeLessThan(4000);
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({
          model: config.OPENAI_MODEL,
          max_output_tokens: 1200,
          store: false,
        });
        expect(client.maxRetries).toBe(0);
        expect(await database.providerUsage.findFirst()).toMatchObject({
          kind: 'AI_REQUEST',
          used: 1,
        });
      } finally {
        client.baseURL = originalBase;
        client.timeout = originalTimeout;
        providerOrigins.delete(base);
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );

  it('keeps an older blocked job visible after more than 100 newer successful jobs', async () => {
    const blocked = await database.backgroundJob.create({
      data: {
        companyId,
        kind: 'INBOUND_SMS',
        eventKey: 'old-blocked-event',
        payload: {},
        status: 'BLOCKED',
        lastError: 'Operator review is required.',
        createdAt: new Date(Date.now() - 86400000),
      },
    });
    await database.backgroundJob.createMany({
      data: Array.from({ length: 125 }, (_, index) => ({
        companyId,
        kind: 'SMS_STATUS_RECONCILIATION',
        eventKey: `new-completed-${index}`,
        payload: {},
        status: 'SUCCEEDED',
      })),
    });
    const listed = await (
      await import('./background-job.service.js')
    ).listBackgroundJobs(companyId);
    expect(listed).toHaveLength(100);
    expect(listed[0]).toMatchObject({ id: blocked.id, status: 'BLOCKED' });
    expect(listed.every((job) => job.id === blocked.id || job.status === 'SUCCEEDED')).toBe(true);
  });
});
