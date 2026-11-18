import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { prisma } from '@lead-recovery/database';
import { emptyCallNoteExtraction } from '@lead-recovery/types';
import { expect, test, grantTestOwner } from './account-fixtures';

config({ path: '../../.env' });
let companyId: string;
let otherCompanyId: string;
let customerId: string;
let noteId: string;
let serviceId: string;
let leadId: string;
let finalizedId: string;
const privateText = 'Private access code 7123. Customer requested an AC diagnostic.';

test.beforeAll(async ({ account }) => {
  for (const other of [false, true]) {
    const suffix = randomUUID();
    const company = await prisma.company.create({
      data: {
        name: other ? 'Other document test business' : 'Document workflow test business',
        slug: `document-e2e-${suffix}`,
        niche: 'HVAC',
        timeZone: 'America/Toronto',
        twilioPhoneNumber: `test-${suffix}`,
        forwardToPhoneNumber: '+15555550999',
        serviceAreas: ['Test area'],
      },
    });
    if (other) otherCompanyId = company.id;
    else companyId = company.id;
  }
  await grantTestOwner(companyId, account.id);
  const customer = await prisma.customer.create({
    data: { companyId, name: 'Taylor Document Test', email: 'customer@example.test' },
  });
  customerId = customer.id;
  const confirmed = emptyCallNoteExtraction();
  confirmed.facts.serviceType = {
    value: 'AC diagnostic',
    evidence: 'Customer requested an AC diagnostic.',
  };
  confirmed.price = { amount: 125, currency: 'USD', state: 'AGREED', evidence: null };
  noteId = (
    await prisma.callNote.create({
      data: {
        companyId,
        customerId,
        originalText: privateText,
        text: privateText,
        occurredAt: new Date(),
        reviewedAt: new Date(),
        reviewStatus: 'REVIEWED',
        revision: 3,
        confirmedData: confirmed,
        confirmedFields: ['serviceType', 'price'],
      },
    })
  ).id;
  serviceId = (
    await prisma.catalogService.create({
      data: {
        companyId,
        name: 'AC diagnostic',
        unit: 'visit',
        category: 'Diagnostics',
        unitPrice: 125,
        keywords: ['diagnostic'],
        isActive: true,
      },
    })
  ).id;
  leadId = (
    await prisma.lead.create({
      data: { companyId, customerId, phone: '+15555550100', source: 'SMS', status: 'QUALIFIED' },
    })
  ).id;
  finalizedId = (
    await prisma.billingDocument.create({
      data: {
        companyId,
        customerId,
        kind: 'ESTIMATE',
        status: 'FINALIZED',
        revision: 3,
        number: 'EST-TEST-1',
        businessName: 'Document workflow test business',
        title: 'Finalized API test document',
        finalizedAt: new Date(),
        customerSnapshot: {
          name: customer.name,
          email: customer.email,
          phone: null,
          address: null,
        },
        items: {
          create: [
            { description: 'Diagnostic', unit: 'visit', quantity: 1, unitPrice: 125, position: 0 },
          ],
        },
      },
    })
  ).id;
});

test.afterAll(async () => {
  const ids = [companyId, otherCompanyId].filter(Boolean);
  if (ids.length) {
    const companies = await prisma.company.findMany({ where: { id: { in: ids } } });
    if (companies.some((company) => !company.slug.startsWith('document-e2e-')))
      throw new Error('Document fixture ownership check failed.');
    await prisma.$transaction(async (tx) => {
      await tx.documentDelivery.deleteMany({ where: { companyId: { in: ids } } });
      await tx.billingDocument.deleteMany({ where: { companyId: { in: ids }, kind: 'INVOICE' } });
      await tx.billingDocument.deleteMany({ where: { companyId: { in: ids } } });
      await tx.callNote.deleteMany({ where: { companyId: { in: ids } } });
      await tx.lead.deleteMany({ where: { companyId: { in: ids } } });
      await tx.company.deleteMany({ where: { id: { in: ids } } });
    });
  }
  await prisma.$disconnect();
});

test('reviewed answered-call details prepare an editable estimate and a safe email preview', async ({
  page,
}) => {
  await page.goto(`/call-notes/${noteId}?companyId=${companyId}`);
  await page.getByRole('button', { name: 'Prepare estimate manually', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Review estimate draft', exact: true }),
  ).toBeVisible();
  const id = new URL(page.url()).pathname.split('/').pop();
  if (!id) throw new Error('No draft was created.');
  const draft = await prisma.billingDocument.findUniqueOrThrow({ where: { id } });
  expect(draft.customerId).toBe(customerId);
  expect(draft.callNoteId).toBe(noteId);
  expect(JSON.stringify(draft.contextSnapshot)).toContain('AC diagnostic');
  expect(JSON.stringify(draft.contextSnapshot)).not.toContain('7123');
  expect(await prisma.lead.count({ where: { companyId } })).toBe(1);
  await page
    .getByRole('combobox', { name: 'Add a service from your catalog', exact: true })
    .selectOption(serviceId);
  await page.getByLabel('Quantity 1', { exact: true }).fill('2');
  await page.getByLabel('Discount (USD)', { exact: true }).fill('10');
  await page.getByLabel('Tax rate (%)', { exact: true }).fill('13');
  await page
    .getByRole('checkbox', {
      name: 'I have reviewed the customer, scope, quantities, prices, and applicable tax.',
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: 'Finalize estimate', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Estimate EST-/ })).toBeVisible();
  const finalized = await prisma.billingDocument.findUniqueOrThrow({ where: { id } });
  await page.getByLabel('Confirm recipient email', { exact: true }).fill('recipient@example.test');
  const previewResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/email-preview') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Preview customer email', exact: true }).click();
  const preview = await (await previewResponse).json();
  expect(preview.text).toContain('$271.20');
  expect(preview.text).not.toContain('7123');
  expect(preview.text).not.toContain('AGREED');
  expect(preview.recipientEmail).toBe('recipient@example.test');
  await page.getByRole('checkbox', { name: /^I reviewed this exact email and recipient/ }).check();
  await expect(
    page.getByRole('button', { name: 'Approve & queue email', exact: true }),
  ).toBeDisabled();
  expect(await prisma.documentDelivery.count({ where: { companyId } })).toBe(0);
  await prisma.catalogService.update({
    where: { id: serviceId },
    data: { unitPrice: 999, unit: 'hour' },
  });
  const unchanged = await prisma.billingDocument.findUniqueOrThrow({
    where: { id },
    include: { items: true },
  });
  expect(unchanged.revision).toBe(finalized.revision);
  expect(Number(unchanged.items[0]?.unitPrice)).toBe(125);
  expect(unchanged.items[0]?.unit).toBe('visit');
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('document APIs reject foreign context, unfinished-work invoices, drafts and unapproved email', async ({
  request,
}) => {
  const path = `/api/backend/api/workspace/${companyId}/documents`;
  const foreign = `/api/backend/api/workspace/${otherCompanyId}/documents`;
  const context = { requestId: randomUUID(), callNoteId: noteId, kind: 'ESTIMATE', useAi: false };
  expect((await request.post(`${foreign}/from-context`, { data: context })).status()).toBe(404);
  const invoice = await request.post(`${path}/from-context`, {
    data: { requestId: randomUUID(), leadId, kind: 'INVOICE', useAi: false },
  });
  expect(invoice.status()).toBe(400);
  const draftResponse = await request.post(`${path}/from-context`, {
    data: { requestId: randomUUID(), customerId, kind: 'ESTIMATE', useAi: false },
  });
  expect(draftResponse.status()).toBe(201);
  const draft = await draftResponse.json();
  expect(
    (
      await request.post(`${path}/${draft.id}/email-preview`, {
        data: { revision: draft.revision, recipientEmail: 'customer@example.test' },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.post(`${foreign}/${finalizedId}/email-preview`, {
        data: { revision: 3, recipientEmail: 'customer@example.test' },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post(`${path}/${finalizedId}/deliveries`, {
        data: {
          revision: 3,
          recipientEmail: 'customer@example.test',
          previewHash: 'a'.repeat(64),
          requestId: randomUUID(),
        },
      })
    ).status(),
  ).toBe(400);
  expect(await prisma.documentDelivery.count({ where: { companyId } })).toBe(0);
  expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).outcome).toBe('UNKNOWN');
});

test('repeated manual preparation requests reuse a single draft and reject changed request details', async ({
  request,
}) => {
  const path = `/api/backend/api/workspace/${companyId}/documents/from-context`;
  const data = { requestId: randomUUID(), callNoteId: noteId, kind: 'ESTIMATE', useAi: false };
  const first = await request.post(path, { data });
  expect(first.status()).toBe(201);
  const second = await request.post(path, { data });
  expect(second.status()).toBe(201);
  expect((await first.json()).id).toBe((await second.json()).id);
  expect(
    (await request.post(path, { data: { ...data, callNoteId: undefined, customerId } })).status(),
  ).toBe(409);
  expect(
    await prisma.billingDocument.count({ where: { companyId, preparationKey: data.requestId } }),
  ).toBe(1);
});

test('completed-work invoice drafts require an explicit owner-recorded outcome, not a quoted price', async ({
  request,
}) => {
  const lead = await prisma.lead.create({
    data: { companyId, customerId, phone: '+15555550199', source: 'SMS', status: 'QUALIFIED' },
  });
  const base = `/api/backend/api/workspace/${companyId}/documents/from-context`;
  expect(
    (
      await request.post(base, {
        data: { requestId: randomUUID(), leadId: lead.id, kind: 'INVOICE', useAi: false },
      })
    ).status(),
  ).toBe(400);
  const outcome = await request.patch(
    `/api/backend/api/leads/${lead.id}/outcome?companyId=${companyId}`,
    { data: { outcome: 'WON', actualValue: 200 } },
  );
  expect(outcome.status()).toBe(200);
  const response = await request.post(base, {
    data: { requestId: randomUUID(), leadId: lead.id, kind: 'INVOICE', useAi: false },
  });
  expect(response.status()).toBe(201);
  const invoice = await response.json();
  expect(invoice.kind).toBe('INVOICE');
  expect(invoice.status).toBe('DRAFT');
  expect(invoice.number).toBeNull();
  expect(invoice.context.lead.completedAt).not.toBeNull();
  expect(invoice.items).toEqual([]);
  expect(await prisma.documentDelivery.count({ where: { companyId } })).toBe(0);
});
