import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { prisma } from '@lead-recovery/database';
import { APP_ORIGIN, test, expect, grantTestOwner } from './account-fixtures';
import { emptyCallNoteExtraction } from '@lead-recovery/types';

config({ path: '../../.env' });
let companyId: string;
let noteId: string;
const originalText =
  'Taylor called about an AC diagnostic. I proposed 125 dollars. They would like a callback next week.';

test.beforeAll(async ({ account }) => {
  const suffix = randomUUID();
  const company = await prisma.company.create({
    data: {
      name: 'Workflow E2E validation',
      slug: `workflow-e2e-${suffix}`,
      niche: 'HVAC',
      timeZone: 'America/Toronto',
      twilioPhoneNumber: `test-${suffix}`,
      forwardToPhoneNumber: '+15555550999',
      serviceAreas: ['Test area'],
    },
  });
  companyId = company.id;
  await grantTestOwner(companyId, account.id);
});

test.afterAll(async () => {
  if (companyId) {
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company?.slug.startsWith('workflow-e2e-'))
      throw new Error('Fixture ownership check failed.');
    await prisma.$transaction(async (tx) => {
      await tx.followUpTask.deleteMany({ where: { companyId } });
      await tx.followUpSuggestion.deleteMany({ where: { companyId } });
      await tx.callNote.deleteMany({ where: { companyId } });
      await tx.company.delete({ where: { id: companyId } });
    });
  }
  await prisma.$disconnect();
});

test('mobile owner records an answered call, reviews facts, and completes a follow-up', async ({
  page,
}) => {
  await page.goto(`/call-notes/new?companyId=${companyId}`);
  await page.getByRole('textbox', { name: /^What happened on the call/ }).fill(originalText);
  await page.getByRole('combobox', { name: /^Customer \(optional/ }).selectOption('new');
  await page.getByLabel('New customer name', { exact: true }).fill('Taylor E2E');
  await page.getByRole('button', { name: 'Save & review manually', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Review call note manually', exact: true }),
  ).toBeVisible();
  noteId = new URL(page.url()).pathname.split('/').pop() ?? '';
  await page.getByLabel('Service requested', { exact: true }).fill('AC diagnostic');
  await page.getByRole('checkbox', { name: 'Confirm service requested', exact: true }).check();
  await page.getByRole('checkbox', { name: /^I reviewed the selected facts/ }).check();
  await page.getByRole('button', { name: 'Confirm reviewed note', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Reviewed call note', exact: true }),
  ).toBeVisible();
  const stored = await prisma.callNote.findUniqueOrThrow({ where: { id: noteId } });
  expect(stored.originalText).toBe(originalText);
  expect(stored.reviewStatus).toBe('REVIEWED');
  expect(stored.confirmedFields).toContain('serviceType');
  expect(await prisma.message.count({ where: { lead: { companyId } } })).toBe(0);
  await page.getByRole('link', { name: 'Add follow-up', exact: true }).click();
  await page.getByLabel('Task title', { exact: true }).fill('Callback Taylor E2E');
  await page.getByRole('textbox', { name: /^Due date & time/ }).fill('2030-02-15T11:30');
  await page.getByRole('button', { name: 'Save follow-up', exact: true }).click();
  await expect(page.getByText('Callback Taylor E2E', { exact: true })).toBeVisible();
  const task = await prisma.followUpTask.findFirstOrThrow({
    where: { companyId, title: 'Callback Taylor E2E' },
  });
  expect(task.dueAt.toISOString()).toBe('2030-02-15T16:30:00.000Z');
  expect(task.callNoteId).toBe(noteId);
  await page.getByRole('button', { name: 'Complete', exact: true }).click();
  await page.getByRole('button', { name: 'Completed', exact: true }).click();
  await expect(page.getByText('Callback Taylor E2E', { exact: true })).toBeVisible();
  const completed = await prisma.followUpTask.findUniqueOrThrow({ where: { id: task.id } });
  expect(completed.status).toBe('COMPLETED');
  expect(completed.completedAt).not.toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('microphone permission failures preserve a usable text-only fallback', async ({ page }) => {
  const before = await prisma.callNote.count({ where: { companyId } });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException('Denied', 'NotAllowedError');
        },
      },
    });
  });
  await page.goto(`/call-notes/new?companyId=${companyId}`);
  await page.getByRole('button', { name: 'Dictate a summary', exact: true }).click();
  await expect(page.locator('main [role="alert"]')).toContainText('permission was denied');
  await expect(page.getByRole('textbox', { name: /^What happened on the call/ })).toBeEditable();
  expect(await prisma.callNote.count({ where: { companyId } })).toBe(before);
});

test('unsupported microphones leave text capture available', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: undefined });
  });
  await page.goto(`/call-notes/new?companyId=${companyId}`);
  await page.getByRole('button', { name: 'Dictate a summary', exact: true }).click();
  await expect(page.locator('main [role="alert"]')).toContainText('unavailable in this browser');
  await expect(page.getByRole('textbox', { name: /^What happened on the call/ })).toBeEditable();
});

test('AI suggestions require explicit replacement approval and preserve proposal uncertainty', async ({
  page,
}) => {
  const customer = await prisma.customer.create({
    data: { companyId, name: 'Confirmed business contact' },
  });
  const text = 'Taylor called. I quoted $125, not agreed. They prefer Thursday afternoon.';
  const extraction = emptyCallNoteExtraction();
  extraction.facts.customerName = { value: 'Taylor', evidence: 'Taylor' };
  extraction.price = {
    amount: 125,
    currency: null,
    state: 'PROPOSED',
    evidence: 'I quoted $125, not agreed.',
  };
  extraction.appointment = {
    text: 'Thursday afternoon',
    startsAt: null,
    state: 'TENTATIVE',
    evidence: 'They prefer Thursday afternoon.',
  };
  extraction.missingInformation = ['Confirm currency and an exact appointment time.'];
  const note = await prisma.callNote.create({
    data: {
      companyId,
      customerId: customer.id,
      originalText: text,
      text,
      occurredAt: new Date(),
      revision: 2,
      reviewStatus: 'EXTRACTED',
      extractionRevision: 2,
      extraction,
      confirmedFields: [],
    },
  });
  await page.goto(`/call-notes/${note.id}?companyId=${companyId}`);
  await expect(page.getByRole('combobox', { name: 'Price state', exact: true })).toHaveValue(
    'PROPOSED',
  );
  await expect(page.getByRole('combobox', { name: 'Appointment state', exact: true })).toHaveValue(
    'TENTATIVE',
  );
  await page.getByRole('checkbox', { name: 'Confirm customer name', exact: true }).check();
  await page.getByRole('checkbox', { name: /^Update customer\.name/ }).check();
  await page.getByRole('checkbox', { name: /^I reviewed the selected facts/ }).check();
  await page.getByRole('button', { name: 'Confirm reviewed note', exact: true }).click();
  await expect(page.locator('main [role="alert"]')).toContainText('approve replacing');
  expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).name).toBe(
    'Confirmed business contact',
  );
  await page
    .getByRole('checkbox', {
      name: 'Explicitly replace this existing confirmed value.',
      exact: true,
    })
    .check();
  await page.getByRole('checkbox', { name: /^I reviewed the selected facts/ }).check();
  await page.getByRole('button', { name: 'Confirm reviewed note', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Reviewed call note', exact: true }),
  ).toBeVisible();
  expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).name).toBe(
    'Taylor',
  );
  expect((await prisma.callNote.findUniqueOrThrow({ where: { id: note.id } })).originalText).toBe(
    text,
  );
});

test('public-looking gateway requests and forged public-view headers do not expose business data', async ({
  request,
  browser,
}) => {
  const anonymous = await browser.newContext({
    baseURL: APP_ORIGIN,
    storageState: { cookies: [], origins: [] },
  });
  try {
    const external = await anonymous.request.get('/api/backend/api/companies', {
      headers: {
        'x-forwarded-for': '203.0.113.10',
        'x-workspace-public-view': 'notifications',
      },
    });
    expect([401, 403]).toContain(external.status());
    expect(await external.text()).not.toContain(companyId);
  } finally {
    await anonymous.close();
  }
  const response = await request.get(`/?companyId=${companyId}`, {
    headers: { 'x-workspace-public-view': 'notifications' },
  });
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('Your business at a glance');
});
