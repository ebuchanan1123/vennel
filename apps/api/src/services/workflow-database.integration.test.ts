import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { emptyCallNoteExtraction, type CallNoteReviewInput } from '@lead-recovery/types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { env } from '../env.js';

const enabled = process.env.RUN_DATABASE_TESTS === 'true';
const schemaName = `workflow_test_${randomUUID().replaceAll('-', '')}`;
const admin = new PrismaClient();
const scopedUrl = new URL(env.DATABASE_URL);
scopedUrl.searchParams.set('schema', schemaName);
const database = new PrismaClient({ datasourceUrl: scopedUrl.toString() });
let companyId: string;
let customerId: string;
let claim: typeof import('./background-job.service.js').claimBackgroundJob;
let enqueue: typeof import('./background-job.service.js').enqueueBackgroundJob;
let finish: typeof import('./background-job.service.js').finishBackgroundJob;
let review: typeof import('./note-review.service.js').reviewCallNote;
let previewEmail: typeof import('./document-delivery.service.js').previewDocumentEmail;
let approveEmail: typeof import('./document-delivery.service.js').approveDocumentEmail;
let listDeliveries: typeof import('./document-delivery.service.js').listDocumentDeliveries;
let recordEvent: typeof import('./document-delivery-events.service.js').recordResendEvent;
let runJob: typeof import('../worker.js').runJob;
let prepareDocument: typeof import('./billing.service.js').prepareContextDocument;
const sendEmail = vi.fn(async () => 'synthetic-provider-email');
const suggestServices = vi.fn();

describe.runIf(enabled)('isolated PostgreSQL workflow integration', () => {
  beforeAll(async () => {
    if (!/^workflow_test_[a-f0-9]{32}$/.test(schemaName))
      throw new Error('Invalid owned schema name.');
    // Schema identifiers cannot be SQL parameters; the identifier is generated and strictly checked above.
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
    const migration = spawnSync(
      'pnpm',
      ['--filter', '@lead-recovery/database', 'exec', 'prisma', 'migrate', 'deploy'],
      {
        env: { ...process.env, DATABASE_URL: scopedUrl.toString() },
        encoding: 'utf8',
      },
    );
    if (migration.status !== 0)
      throw new Error(`Test schema migration failed: ${migration.stderr}`);
    const scope = await database.$queryRaw<{ name: string }[]>`SELECT current_schema() AS name`;
    if (scope[0]?.name !== schemaName)
      throw new Error('Database test isolation was not established; no queue work was claimed.');
    vi.doMock('@lead-recovery/database', () => ({ prisma: database }));
    vi.doMock('../env.js', () => ({
      env: {
        ...env,
        RESEND_API_KEY: 'synthetic-provider-key',
        RESEND_FROM_EMAIL: 'verified@example.test',
      },
    }));
    vi.doMock('./email-provider.service.js', async () => ({
      ...(await vi.importActual<typeof import('./email-provider.service.js')>(
        './email-provider.service.js',
      )),
      sendTransactionalEmail: sendEmail,
    }));
    vi.doMock('./billing-suggestion.service.js', () => ({
      suggestConversationServices: suggestServices,
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('External provider calls are disabled in database tests.');
      }),
    );
    const jobs = await import('./background-job.service.js');
    claim = jobs.claimBackgroundJob;
    enqueue = jobs.enqueueBackgroundJob;
    finish = jobs.finishBackgroundJob;
    review = (await import('./note-review.service.js')).reviewCallNote;
    const delivery = await import('./document-delivery.service.js');
    previewEmail = delivery.previewDocumentEmail;
    approveEmail = delivery.approveDocumentEmail;
    listDeliveries = delivery.listDocumentDeliveries;
    recordEvent = (await import('./document-delivery-events.service.js')).recordResendEvent;
    runJob = (await import('../worker.js')).runJob;
    prepareDocument = (await import('./billing.service.js')).prepareContextDocument;
    const company = await database.company.create({
      data: {
        name: 'Isolated workflow test',
        slug: 'isolated-workflow-test',
        niche: 'HVAC',
        timeZone: 'America/Toronto',
        twilioPhoneNumber: '+15555550998',
        forwardToPhoneNumber: '+15555550999',
        serviceAreas: ['Test area'],
      },
    });
    companyId = company.id;
    customerId = (
      await database.customer.create({ data: { companyId, name: 'Confirmed customer' } })
    ).id;
  }, 60000);

  afterAll(async () => {
    await database.$disconnect();
    if (/^workflow_test_[a-f0-9]{32}$/.test(schemaName)) {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    }
    await admin.$disconnect();
    vi.unstubAllGlobals();
  });

  it('persists a single outbox event under concurrent generation and leases it to only one worker', async () => {
    await Promise.all(
      Array.from({ length: 5 }, () =>
        enqueue(database, companyId, 'OWNER_EMAIL', 'same-event', { test: true }),
      ),
    );
    expect(await database.backgroundJob.count({ where: { companyId } })).toBe(1);
    const claims = await Promise.all(Array.from({ length: 4 }, () => claim()));
    if (!claims.some(Boolean)) {
      const timing =
        await database.$queryRaw`SELECT "dueAt", NOW() AS "databaseNow", current_setting('TimeZone') AS "databaseZone", ("dueAt" <= (NOW() AT TIME ZONE 'UTC')) AS "eligible" FROM "BackgroundJob"`;
      throw new Error(`No job was leased: ${JSON.stringify(timing)}`);
    }
    expect(claims.filter(Boolean)).toHaveLength(1);
    const job = claims.find((value) => value !== null);
    if (!job) throw new Error('Expected one leased job.');
    expect(job.attempts).toBe(1);
    await finish(job, { status: 'CANCELLED', error: 'Test fixture.' });
  });

  it('recovers expired leases and rejects stale-worker completion', async () => {
    const queued = await enqueue(database, companyId, 'OWNER_EMAIL', 'expired-lease', {});
    const first = await claim();
    if (!first) throw new Error('Expected first lease.');
    await database.backgroundJob.update({
      where: { id: queued.id },
      data: { leaseUntil: new Date(Date.now() - 1000) },
    });
    const second = await claim();
    if (!second) throw new Error('Expected recovered lease.');
    expect(second.id).toBe(first.id);
    expect(second.leaseToken).not.toBe(first.leaseToken);
    await finish(first, { status: 'SUCCEEDED', providerId: 'stale-receipt' });
    expect(
      (await database.backgroundJob.findUniqueOrThrow({ where: { id: first.id } })).status,
    ).toBe('RUNNING');
    await finish(second, { status: 'CANCELLED', error: 'Test fixture.' });
  });

  it('commits only one owner review and task when the same note is confirmed concurrently', async () => {
    const note = await database.callNote.create({
      data: {
        companyId,
        customerId,
        originalText: 'Call the customer tomorrow.',
        text: 'Call the customer tomorrow.',
        occurredAt: new Date(),
        confirmedFields: [],
      },
    });
    const confirmed = emptyCallNoteExtraction();
    confirmed.actions = [
      {
        type: 'CALL_CUSTOMER',
        title: 'Callback',
        dueAt: null,
        dueText: 'tomorrow',
        priority: 'NORMAL',
        evidence: 'Call the customer tomorrow.',
      },
    ];
    const input: CallNoteReviewInput = {
      revision: 1,
      customerId,
      leadId: null,
      confirmed,
      acceptFacts: [],
      applyFields: [],
      replaceFields: [],
      expectedCustomerUpdatedAt: null,
      expectedLeadUpdatedAt: null,
      acceptedActions: [{ index: 0, dueAt: '2030-01-01T12:00:00Z' }],
    };
    const results = await Promise.allSettled([
      review(companyId, note.id, input),
      review(companyId, note.id, input),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await database.followUpTask.count({ where: { companyId, callNoteId: note.id } })).toBe(
      1,
    );
    expect(
      (await database.callNote.findUniqueOrThrow({ where: { id: note.id } })).originalText,
    ).toBe('Call the customer tomorrow.');
    expect((await database.customer.findUniqueOrThrow({ where: { id: customerId } })).name).toBe(
      'Confirmed customer',
    );
  });

  it('queues one approved document email, recovers an early callback and records actual worker attempts', async () => {
    await database.company.update({
      where: { id: companyId },
      data: { documentEmailEnabled: true, documentReplyTo: 'office@example.test' },
    });
    const document = await database.billingDocument.create({
      data: {
        companyId,
        customerId,
        kind: 'ESTIMATE',
        status: 'FINALIZED',
        revision: 3,
        number: 'EST-DATABASE-1',
        businessName: 'Isolated workflow test',
        title: 'Reviewed diagnostic',
        finalizedAt: new Date(),
        customerSnapshot: {
          name: 'Confirmed customer',
          phone: null,
          email: 'customer@example.test',
          address: null,
        },
        items: {
          create: [
            {
              description: 'AC diagnostic',
              unit: 'visit',
              quantity: 1,
              unitPrice: 125,
              position: 0,
            },
          ],
        },
      },
    });
    const preview = await previewEmail(companyId, document.id, 3, 'customer@example.test');
    const input = {
      requestId: randomUUID(),
      revision: 3,
      recipientEmail: preview.recipientEmail,
      previewHash: preview.previewHash,
      approved: true as const,
    };
    const [first, repeated] = await Promise.all([
      approveEmail(companyId, document.id, input),
      approveEmail(companyId, document.id, input),
    ]);
    expect(first.id).toBe(repeated.id);
    expect(await database.documentDelivery.count({ where: { companyId } })).toBe(1);
    expect(
      await database.backgroundJob.count({ where: { companyId, kind: 'DOCUMENT_EMAIL' } }),
    ).toBe(1);
    const event = {
      type: 'email.delivered',
      created_at: new Date().toISOString(),
      data: { email_id: 'synthetic-provider-email' },
    };
    await recordEvent('signed-provider-event-a', event);
    await recordEvent('signed-provider-event-a', event);
    expect(await database.documentDeliveryEvent.count()).toBe(1);
    const job = await claim();
    if (!job || job.kind !== 'DOCUMENT_EMAIL')
      throw new Error('Expected the isolated approved document job.');
    await runJob(job);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const history = await listDeliveries(companyId, document.id);
    expect(history[0]?.status).toBe('DELIVERED');
    expect(history[0]?.attempts[0]?.outcome).toBe('SUCCEEDED');
    expect(history[0]?.events).toHaveLength(1);
    expect(history[0]?.job.canRetry).toBe(false);
    expect(
      (await database.billingDocument.findUniqueOrThrow({ where: { id: document.id } })).revision,
    ).toBe(3);
    expect(await database.lead.count({ where: { companyId } })).toBe(0);
    await expect(approveEmail('different-business', document.id, input)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('prepares one catalog-priced AI estimate from selected reviewed-note facts despite concurrent retries', async () => {
    const service = await database.catalogService.create({
      data: {
        companyId,
        name: 'Diagnostic visit',
        category: 'Diagnostics',
        unit: 'visit',
        unitPrice: 125,
        keywords: ['diagnostic'],
      },
    });
    const confirmed = emptyCallNoteExtraction();
    confirmed.facts.serviceType = {
      value: 'Diagnostic visit',
      evidence: 'An earlier original quote',
    };
    confirmed.facts.issue = { value: 'Rejected private issue', evidence: 'Unconfirmed evidence' };
    confirmed.price = {
      amount: 70,
      currency: 'USD',
      state: 'AGREED',
      evidence: 'An agreed amount',
    };
    const note = await database.callNote.create({
      data: {
        companyId,
        customerId,
        originalText: 'Private original summary not for drafting',
        text: 'Private current note text',
        occurredAt: new Date(),
        reviewStatus: 'REVIEWED',
        reviewedAt: new Date(),
        revision: 3,
        confirmedFields: ['serviceType', 'price'],
        confirmedData: confirmed,
      },
    });
    suggestServices.mockResolvedValue({
      createdAt: new Date().toISOString(),
      missingDetails: [],
      matches: [
        {
          serviceId: service.id,
          description: service.name,
          unit: service.unit,
          unitPrice: 125,
          evidence: 'Diagnostic visit',
        },
      ],
    });
    const input = {
      requestId: randomUUID(),
      customerId,
      callNoteId: note.id,
      kind: 'ESTIMATE' as const,
      useAi: true,
    };
    const [first, repeated] = await Promise.all([
      prepareDocument(companyId, input),
      prepareDocument(companyId, input),
    ]);
    expect(first.id).toBe(repeated.id);
    expect(
      await database.billingDocument.count({
        where: { companyId, preparationKey: input.requestId },
      }),
    ).toBe(1);
    expect(first.items[0]?.unitPrice).toBe(125);
    expect(first.items[0]?.quantity).toBe(1);
    expect(first.aiDraft?.matches[0]?.source).toEqual({ kind: 'CALL_NOTE', id: note.id });
    expect(first.context?.notes[0]?.price).toMatchObject({ amount: 70, state: 'AGREED' });
    expect(first.aiDraft?.missingDetails.join(' ')).toContain('reconcile');
    expect(JSON.stringify(suggestServices.mock.calls)).not.toContain('Private original');
    expect(JSON.stringify(suggestServices.mock.calls)).not.toContain('Rejected private');
    expect(first.status).toBe('DRAFT');
    expect(first.number).toBeNull();
  });

  it('persists flexible service pricing and requires exact reviewed amounts before finalizing an AI draft', async () => {
    const catalog = await import('./catalog.service.js');
    const billing = await import('./billing.service.js');
    const { serviceBodySchema } = await import('../schemas/workspace.schema.js');
    const { validateServiceSuggestions } = await vi.importActual<
      typeof import('./billing-suggestion.service.js')
    >('./billing-suggestion.service.js');
    const base = {
      name: 'Inspection',
      description: null,
      category: 'General',
      unit: 'job',
      unitPrice: 125,
      keywords: [],
      isActive: true,
    };
    const fixed = await catalog.createService(companyId, serviceBodySchema.parse(base));
    const range = await catalog.createService(
      companyId,
      serviceBodySchema.parse({
        ...base,
        name: 'Bathroom renovation',
        pricingType: 'RANGE',
        unitPrice: null,
        minPrice: 500,
        maxPrice: 1500,
      }),
    );
    const quote = await catalog.createService(
      companyId,
      serviceBodySchema.parse({
        ...base,
        name: 'Custom repair',
        pricingType: 'QUOTE_REQUIRED',
        unitPrice: null,
      }),
    );
    expect(fixed).toMatchObject({ pricingType: 'FIXED', unitPrice: 125 });
    expect(range).toMatchObject({
      pricingType: 'RANGE',
      unitPrice: null,
      minPrice: 500,
      maxPrice: 1500,
    });
    expect(quote).toMatchObject({
      pricingType: 'QUOTE_REQUIRED',
      unitPrice: null,
      minPrice: null,
      maxPrice: null,
    });
    await expect(
      database.catalogService.create({
        data: {
          companyId,
          name: 'Invalid mixed pricing',
          category: 'General',
          keywords: [],
          pricingType: 'RANGE',
          unitPrice: 0,
          minPrice: 500,
          maxPrice: 1500,
        },
      }),
    ).rejects.toThrow('CatalogService_pricing_check');

    const text = 'Inspection, Bathroom renovation, and Custom repair are requested.';
    const lead = await database.lead.create({
      data: {
        companyId,
        customerId,
        phone: '+15555550701',
        source: 'SMS',
        status: 'QUALIFIED',
        messages: { create: { direction: 'INBOUND', body: text } },
      },
    });
    const services = await database.catalogService.findMany({
      where: { id: { in: [fixed.id, range.id, quote.id] }, companyId },
    });
    suggestServices.mockResolvedValue(
      validateServiceSuggestions(
        {
          matches: [fixed, range, quote].map((service) => ({
            serviceId: service.id,
            evidence: service.name,
          })),
          missingDetails: [],
        },
        services,
        [text],
      ),
    );
    const prepared = await prepareDocument(companyId, {
      requestId: randomUUID(),
      leadId: lead.id,
      kind: 'ESTIMATE',
      useAi: true,
    });
    expect(prepared.items.map((item) => item.unitPrice)).toEqual([125, null, null]);
    expect(prepared.totals).toBeNull();
    expect((await billing.getDocument(companyId, prepared.id)).totals).toBeNull();
    expect(
      prepared.aiDraft?.matches.find((match) => match.serviceId === range.id)?.catalogPricing,
    ).toMatchObject({ pricingType: 'RANGE', minPrice: 500, maxPrice: 1500 });
    const before = await database.company.findUniqueOrThrow({ where: { id: companyId } });
    await expect(
      billing.finalizeDocument(companyId, prepared.id, prepared.revision),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('exact price') });
    expect(
      (await database.company.findUniqueOrThrow({ where: { id: companyId } })).nextDocumentNumber,
    ).toBe(before.nextDocumentNumber);

    const reviewed = await billing.updateDocument(companyId, prepared.id, prepared.revision, {
      kind: prepared.kind,
      title: prepared.title,
      customerId,
      leadId: lead.id,
      notes: null,
      dueDate: null,
      discountAmount: 0,
      taxRate: 13,
      items: prepared.items.map((item) => ({
        serviceId: item.serviceId,
        description: item.description,
        unit: item.unit ?? 'job',
        quantity: item.quantity,
        unitPrice:
          item.serviceId === range.id ? 875 : item.serviceId === quote.id ? 210 : item.unitPrice,
      })),
    });
    const finalized = await billing.finalizeDocument(
      companyId,
      reviewed.id,
      reviewed.revision,
      'test-owner',
    );
    expect(finalized.totals).toEqual({ subtotal: 1210, discount: 0, tax: 157.3, total: 1367.3 });
    expect(finalized.finalizedBy).toBe('test-owner');
    await catalog.updateService(
      companyId,
      range.id,
      serviceBodySchema.parse({
        ...base,
        name: range.name,
        pricingType: 'QUOTE_REQUIRED',
        unitPrice: null,
      }),
    );
    const unchanged = await billing.getDocument(companyId, finalized.id);
    expect(unchanged.items.map((item) => item.unitPrice)).toEqual([125, 875, 210]);
    expect(
      unchanged.aiDraft?.matches.find((match) => match.serviceId === range.id)?.catalogPricing,
    ).toMatchObject({ minPrice: 500, maxPrice: 1500 });
    expect(unchanged.totals).toEqual(finalized.totals);
  });
});
