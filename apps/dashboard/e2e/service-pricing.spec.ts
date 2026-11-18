import { randomUUID } from 'node:crypto';
import { prisma } from '@lead-recovery/database';
import { expect, test, grantTestOwner } from './account-fixtures';

let companyId: string;
let customerId: string;

test.beforeAll(async ({ account }) => {
  const company = await prisma.company.create({
    data: {
      name: 'Service pricing test business',
      slug: `document-e2e-pricing-${randomUUID()}`,
      niche: 'RENOVATION',
      currency: 'CAD',
      timeZone: 'America/Toronto',
      serviceAreas: [],
    },
  });
  companyId = company.id;
  await grantTestOwner(companyId, account.id);
  customerId = (
    await prisma.customer.create({ data: { companyId, name: 'Pricing test customer' } })
  ).id;
});

test.afterAll(async () => {
  if (companyId) {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    if (!company.slug.startsWith('document-e2e-pricing-'))
      throw new Error('Pricing fixture ownership check failed.');
    await prisma.$transaction(async (tx) => {
      await tx.documentDelivery.deleteMany({ where: { companyId } });
      await tx.billingDocument.deleteMany({ where: { companyId, kind: 'INVOICE' } });
      await tx.billingDocument.deleteMany({ where: { companyId } });
      await tx.company.delete({ where: { id: companyId } });
    });
  }
  await prisma.$disconnect();
});

test('owners add and edit fixed, estimated-range and quote-required services without stale prices', async ({
  page,
}) => {
  await page.goto(`/services?companyId=${companyId}`);
  await page.getByRole('button', { name: 'Add service', exact: true }).click();
  const pricingType = page.getByRole('combobox', { name: /^Pricing type/ });
  await expect(pricingType).toHaveValue('FIXED');
  await page.getByLabel('Service name', { exact: true }).fill('Diagnostic visit');
  await page.getByLabel('Price (CAD)', { exact: true }).fill('125');
  await page.getByRole('button', { name: 'Save service', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Service saved.');

  await page.getByRole('button', { name: 'Add service', exact: true }).click();
  await page.getByLabel('Service name', { exact: true }).fill('Bathroom renovation');
  await pricingType.selectOption('RANGE');
  await expect(page.getByLabel('Price (CAD)', { exact: true })).toHaveCount(0);
  await page.getByLabel('Minimum price (CAD)', { exact: true }).fill('500');
  await page.getByLabel('Maximum price (CAD)', { exact: true }).fill('1500');
  await page
    .getByRole('textbox', { name: /^Description/ })
    .fill('Depends on room size and materials.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Save service', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Service saved.');
  const rangeCard = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Bathroom renovation', exact: true }) });
  await expect(rangeCard).toContainText('CA$500.00 - CA$1,500.00');
  await expect(rangeCard).toContainText('Estimated range');

  await page.getByRole('button', { name: 'Add service', exact: true }).click();
  await page.getByLabel('Service name', { exact: true }).fill('Custom repair');
  await pricingType.selectOption('QUOTE_REQUIRED');
  await expect(page.locator('form').getByRole('spinbutton')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save service', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Service saved.');
  await page.reload();
  const quoteCard = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Custom repair', exact: true }) });
  await expect(quoteCard).toContainText('Quote required');
  await expect(quoteCard).not.toContainText('CA$0.00');
  const quote = await prisma.catalogService.findFirstOrThrow({
    where: { companyId, name: 'Custom repair' },
  });
  expect(quote).toMatchObject({
    pricingType: 'QUOTE_REQUIRED',
    unitPrice: null,
    minPrice: null,
    maxPrice: null,
  });

  await page.getByRole('button', { name: 'Edit Bathroom renovation', exact: true }).click();
  await expect(pricingType).toHaveValue('RANGE');
  await expect(page.getByLabel('Minimum price (CAD)', { exact: true })).toHaveValue('500');
  await expect(page.getByLabel('Maximum price (CAD)', { exact: true })).toHaveValue('1500');
  await pricingType.selectOption('FIXED');
  await page.getByLabel('Price (CAD)', { exact: true }).fill('900');
  await page.getByRole('button', { name: 'Save service', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Service saved.');
  const fixed = await prisma.catalogService.findFirstOrThrow({
    where: { companyId, name: 'Bathroom renovation' },
  });
  expect(fixed.pricingType).toBe('FIXED');
  expect(Number(fixed.unitPrice)).toBe(900);
  expect(fixed.minPrice).toBeNull();
  expect(fixed.maxPrice).toBeNull();
  await page.getByRole('button', { name: 'Edit Bathroom renovation', exact: true }).click();
  await pricingType.selectOption('QUOTE_REQUIRED');
  await page.getByRole('button', { name: 'Save service', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Service saved.');
  await page.getByRole('button', { name: 'Edit Bathroom renovation', exact: true }).click();
  await expect(pricingType).toHaveValue('QUOTE_REQUIRED');
  await pricingType.selectOption('RANGE');
  await page.getByLabel('Minimum price (CAD)', { exact: true }).fill('650');
  await page.getByLabel('Maximum price (CAD)', { exact: true }).fill('1800');
  await page.getByRole('button', { name: 'Save service', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Service saved.');
  await page.reload();
  await expect(rangeCard).toContainText('CA$650.00 - CA$1,800.00');
  const updated = await prisma.catalogService.findUniqueOrThrow({ where: { id: fixed.id } });
  expect(updated.pricingType).toBe('RANGE');
  expect(updated.unitPrice).toBeNull();
  expect(Number(updated.minPrice)).toBe(650);
  expect(Number(updated.maxPrice)).toBe(1800);
});

test('unpriced services remain editable drafts until exact amounts are entered and owner-approved', async ({
  page,
}) => {
  const range = await prisma.catalogService.create({
    data: {
      companyId,
      name: 'Draft renovation',
      category: 'General',
      pricingType: 'RANGE',
      minPrice: 500,
      maxPrice: 1500,
      keywords: [],
    },
  });
  const quote = await prisma.catalogService.create({
    data: {
      companyId,
      name: 'Draft custom work',
      category: 'General',
      pricingType: 'QUOTE_REQUIRED',
      keywords: [],
    },
  });
  await page.goto(`/billing/new?companyId=${companyId}&customerId=${customerId}`);
  const addService = page.getByRole('combobox', {
    name: 'Add a service from your catalog',
    exact: true,
  });
  await addService.selectOption(range.id);
  await addService.selectOption(quote.id);
  await expect(page.getByLabel('Unit price 1', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Unit price 2', { exact: true })).toHaveValue('');
  await expect(page.getByText('Pricing required', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Review estimate draft', exact: true }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/\/billing\/new(?:\?|$)/);
  const id = new URL(page.url()).pathname.split('/').pop();
  if (!id) throw new Error('No pricing draft was created.');
  await page.reload();
  const stored = await prisma.billingDocument.findUniqueOrThrow({
    where: { id },
    include: { items: { orderBy: { position: 'asc' } } },
  });
  expect(stored.items.map((item) => item.unitPrice)).toEqual([null, null]);
  const review = page.getByRole('checkbox', {
    name: 'I have reviewed the customer, scope, quantities, prices, and applicable tax.',
    exact: true,
  });
  await expect(review).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Finalize estimate', exact: true })).toBeDisabled();
  const denied = await page.request.post(
    `/api/backend/api/workspace/${companyId}/documents/${id}/finalize`,
    { data: { revision: stored.revision, approved: true } },
  );
  expect(denied.status()).toBe(400);
  expect((await denied.json()).error).toContain('exact price');
  await page.goto(`/billing?companyId=${companyId}`);
  await expect(page.getByRole('row').filter({ hasText: 'Draft estimate' })).toContainText(
    'Pricing required',
  );
  await page.goto(`/billing/${id}?companyId=${companyId}`);
  await page.getByLabel('Unit price 1', { exact: true }).fill('875');
  await page.getByLabel('Unit price 2', { exact: true }).fill('210');
  await review.check();
  await page.getByRole('button', { name: 'Finalize estimate', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Estimate EST-/ })).toBeVisible();
  const total = page
    .locator('dl > div')
    .filter({ has: page.locator('dt', { hasText: /^Total\b/ }) })
    .locator('dd');
  await expect(total).toHaveText('CA$1,085.00');
  await prisma.catalogService.update({
    where: { id: range.id },
    data: { pricingType: 'QUOTE_REQUIRED', minPrice: null, maxPrice: null },
  });
  await page.reload();
  await expect(total).toHaveText('CA$1,085.00');
  const finalized = await prisma.billingDocument.findUniqueOrThrow({
    where: { id },
    include: { items: { orderBy: { position: 'asc' } } },
  });
  expect(finalized.status).toBe('FINALIZED');
  expect(finalized.items.map((item) => Number(item.unitPrice))).toEqual([875, 210]);
});
