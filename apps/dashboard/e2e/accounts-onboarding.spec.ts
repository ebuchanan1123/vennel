import { randomUUID } from 'node:crypto';
import { prisma } from '@lead-recovery/database';
import { test, expect } from '@playwright/test';
import { accountEmailSchema } from '../../api/src/services/account-email.service';
import {
  APP_ORIGIN,
  accountStorageState,
  createTestAccount,
  deleteTestAccount,
  grantTestOwner,
  type TestAccount,
} from './account-fixtures';

let owner: TestAccount;
let staff: TestAccount;
let invited: TestAccount;
let companyId: string;
let foreignCompanyId: string;
let customerId: string;
let documentId: string;
const uiEmail = `e2e-auth-ui-${randomUUID()}@example.test`;
const uiPassword = `Synthetic-public-ui-${randomUUID()}!`;
const uiBusinessName = `E2E Onboard ${randomUUID()}`;

test.beforeAll(async () => {
  owner = await createTestAccount('Role Owner');
  staff = await createTestAccount('Role Staff');
  invited = await createTestAccount('Invite Person');
  for (const foreign of [false, true]) {
    const company = await prisma.company.create({
      data: {
        name: foreign ? 'Forbidden test business' : 'Role test business',
        slug: `accounts-e2e-${randomUUID()}`,
        niche: 'HVAC',
        timeZone: 'UTC',
        serviceAreas: ['Test area'],
      },
    });
    if (foreign) foreignCompanyId = company.id;
    else companyId = company.id;
  }
  await grantTestOwner(companyId, owner.id);
  await prisma.businessMembership.create({ data: { companyId, userId: staff.id, role: 'STAFF' } });
  await prisma.businessMembership.create({
    data: { companyId: foreignCompanyId, userId: owner.id, role: 'STAFF' },
  });
  customerId = (
    await prisma.customer.create({
      data: { companyId, name: 'Role customer', email: 'customer@example.test' },
    })
  ).id;
  await prisma.catalogService.create({
    data: {
      companyId,
      name: 'Role diagnostic',
      category: 'Diagnostics',
      unitPrice: 125,
      keywords: [],
      unit: 'visit',
    },
  });
  documentId = (
    await prisma.billingDocument.create({
      data: {
        companyId,
        customerId,
        kind: 'ESTIMATE',
        title: 'Staff-editable draft',
        items: {
          create: [
            {
              description: 'Role diagnostic',
              unit: 'visit',
              quantity: 1,
              unitPrice: 125,
              position: 0,
            },
          ],
        },
      },
    })
  ).id;
});

test.afterAll(async () => {
  const uiUser = await prisma.user.findUnique({ where: { email: uiEmail } });
  const uiCompanies = uiUser
    ? await prisma.company.findMany({ where: { memberships: { some: { userId: uiUser.id } } } })
    : [];
  if (uiCompanies.some((company) => company.name !== uiBusinessName))
    throw new Error('Public UI fixture business ownership check failed.');
  const ids = [companyId, foreignCompanyId, ...uiCompanies.map((company) => company.id)].filter(
    Boolean,
  );
  const companies = await prisma.company.findMany({ where: { id: { in: ids } } });
  if (
    companies.some(
      (company) => !company.slug.startsWith('accounts-e2e-') && company.name !== uiBusinessName,
    )
  )
    throw new Error('Role fixture business ownership check failed.');
  if (ids.length)
    await prisma.$transaction(async (tx) => {
      const where = { companyId: { in: ids } };
      await tx.documentDelivery.deleteMany({ where });
      await tx.billingDocument.deleteMany({ where: { ...where, kind: 'INVOICE' } });
      await tx.billingDocument.deleteMany({ where });
      await tx.followUpTask.deleteMany({ where });
      await tx.followUpSuggestion.deleteMany({ where });
      await tx.callNote.deleteMany({ where });
      await tx.lead.deleteMany({ where });
      await tx.company.deleteMany({ where: { id: { in: ids } } });
    });
  for (const account of [owner, staff, invited].filter(Boolean)) await deleteTestAccount(account);
  if (uiUser)
    await deleteTestAccount({
      id: uiUser.id,
      email: uiEmail,
      password: uiPassword,
      name: 'UI Owner',
    });
  await prisma.$disconnect();
});

test('public registration verifies email before login and completes shared CAD renovation onboarding', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('Your name', { exact: true }).fill('UI Owner');
  await page.getByLabel('Email address', { exact: true }).fill(uiEmail);
  await page.getByLabel(/^New password/).fill(uiPassword);
  await page.getByLabel('Confirm password', { exact: true }).fill(uiPassword);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('verification email');
  const user = await prisma.user.findUniqueOrThrow({ where: { email: uiEmail } });
  expect(user.emailVerified).toBe(false);
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill(uiEmail);
  await page.getByLabel('Password', { exact: true }).fill(uiPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('main [role="alert"]')).toContainText(/verif/i);
  const job = await prisma.backgroundJob.findFirstOrThrow({
    where: { userId: user.id, kind: 'AUTH_EMAIL' },
    orderBy: { createdAt: 'desc' },
  });
  const link = accountEmailSchema.parse(job.payload).url;
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  await page.getByLabel('Email address', { exact: true }).fill(uiEmail);
  await page.getByLabel('Password', { exact: true }).fill(uiPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Business & industry', exact: true }),
  ).toBeVisible();
  await expect(page.locator('#workspace-navigation')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toHaveCount(0);
  await expect(page.getByRole('main')).toHaveCount(1);
  const progress = page.getByRole('progressbar', { name: 'Business setup progress' });
  await expect(progress).toHaveAttribute('aria-valuenow', '1');
  await expect(page.getByRole('combobox', { name: 'Business currency', exact: true })).toHaveCount(
    0,
  );
  await page.getByLabel('Business name', { exact: true }).fill(uiBusinessName);
  await page.getByRole('combobox', { name: 'Industry', exact: true }).selectOption('RENOVATION');
  await page.getByRole('button', { name: 'Save & continue', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Contact information', exact: true }),
  ).toBeVisible();
  await expect(progress).toHaveAttribute('aria-valuenow', '2');
  await page.getByLabel('Business contact email', { exact: true }).fill('unfinished-email');
  await page.getByLabel('Business contact phone', { exact: true }).fill('unfinished-phone');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Business & industry', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Business name', { exact: true })).toHaveValue(uiBusinessName);
  await expect(page.getByRole('combobox', { name: 'Industry', exact: true })).toHaveValue(
    'RENOVATION',
  );
  await page.getByRole('button', { name: 'Save & continue', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Contact information', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Business contact email', { exact: true })).toHaveValue('');
  expect(
    await prisma.company.count({ where: { memberships: { some: { userId: user.id } } } }),
  ).toBe(1);
  await page.getByLabel('Business contact email', { exact: true }).fill('business@example.test');
  await page.getByLabel('Business contact phone', { exact: true }).fill('+15555550777');
  await page.getByRole('textbox', { name: /^Service areas/ }).fill('Test city');
  await page.getByRole('button', { name: 'Save & continue', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Time zone & currency', exact: true }),
  ).toBeVisible();
  await expect(progress).toHaveAttribute('aria-valuenow', '3');
  const timeZone = page.getByRole('combobox', { name: 'Business time zone', exact: true });
  const currency = page.getByRole('combobox', { name: 'Business currency', exact: true });
  await expect(timeZone).toHaveJSProperty('tagName', 'SELECT');
  await expect(timeZone).toHaveClass('field');
  await expect(currency).toHaveClass('field');
  await timeZone.selectOption('America/Vancouver');
  await currency.selectOption('CAD');
  await page.getByRole('button', { name: 'Save & continue', exact: true }).click();
  await expect(progress).toHaveAttribute('aria-valuenow', '4');
  await page.getByRole('button', { name: 'Add service', exact: true }).click();
  await page.getByLabel('Service name', { exact: true }).fill('Renovation consultation');
  await page.getByLabel('Price (CAD)', { exact: true }).fill('150');
  await page.getByRole('button', { name: 'Save service', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Service saved');
  await page.getByRole('button', { name: 'Save & continue', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: "What is your business' phone number?", exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save & continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Billing & tax', exact: true })).toBeVisible();
  await page
    .getByLabel('Business billing address', { exact: true })
    .fill('100 Fixture Avenue, Test city');
  await page
    .getByLabel('Tax registration number (if applicable)', { exact: true })
    .fill('TEST-CAD-TAX');
  await page.getByLabel('Default tax rate (%)', { exact: true }).fill('13');
  await page.getByRole('button', { name: 'Save & continue', exact: true }).click();
  await page.getByRole('button', { name: 'Run readiness check', exact: true }).click();
  await expect(
    page.getByText('The manual call-note to estimate workflow is ready.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Finish setup', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your business at a glance', exact: true }),
  ).toBeVisible();
  await expect(page.locator('#workspace-navigation')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeVisible();
  await expect(progress).toHaveCount(0);
  const business = await prisma.company.findFirstOrThrow({
    where: { memberships: { some: { userId: user.id, role: 'OWNER' } } },
  });
  expect(business.currency).toBe('CAD');
  expect(business.timeZone).toBe('America/Vancouver');
  expect(business.niche).toBe('RENOVATION');
  expect(Number(business.defaultTaxRate)).toBe(13);
  expect(business.onboardingCompletedAt).not.toBeNull();
  expect(await prisma.lead.count({ where: { companyId: business.id } })).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('time-zone dropdowns preserve saved aliases and persist UTC and additional IANA zones', async ({
  page,
}) => {
  await prisma.company.update({
    where: { id: companyId },
    data: { timeZone: 'US/Eastern', onboardingStep: 2, onboardingCompletedAt: new Date() },
  });
  await page.context().addCookies((await accountStorageState(owner)).cookies);
  await page.goto(`/onboarding/${companyId}?companyId=${companyId}`);
  const timeZone = page.getByRole('combobox', { name: /^Business time zone/ });
  await expect(timeZone).toHaveValue('US/Eastern');
  await expect(timeZone.getByRole('option', { name: 'US/Eastern', exact: true })).toHaveCount(1);
  await expect(timeZone).toHaveClass('field');
  await expect(page.getByRole('combobox', { name: 'Business currency', exact: true })).toHaveClass(
    'field',
  );
  await timeZone.selectOption('Pacific/Auckland');
  await expect(timeZone).toHaveValue('Pacific/Auckland');

  await page.goto(`/settings?companyId=${companyId}`);
  await expect(timeZone).toHaveJSProperty('tagName', 'SELECT');
  await expect(timeZone).toHaveValue('US/Eastern');
  await timeZone.selectOption('UTC');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Business settings saved.');
  await page.reload();
  await expect(timeZone).toHaveValue('UTC');
  await timeZone.selectOption('Pacific/Auckland');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Business settings saved.');
  await page.reload();
  await expect(timeZone).toHaveValue('Pacific/Auckland');
  const business = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  expect(business.timeZone).toBe('Pacific/Auckland');
});

test('single-question phone setup hides connection details and preserves saved numbers', async ({
  page,
}) => {
  await prisma.company.update({
    where: { id: companyId },
    data: {
      onboardingStep: 4,
      businessEmail: 'phone-setup@example.test',
      businessPhone: '+15555550710',
      twilioPhoneNumber: null,
      forwardToPhoneNumber: null,
    },
  });
  await page.context().addCookies((await accountStorageState(owner)).cookies);
  await page.goto(`/onboarding/${companyId}?companyId=${companyId}`);
  await expect(
    page.getByRole('heading', { name: "What is your business' phone number?", exact: true }),
  ).toBeVisible();
  await expect(page.locator('form').getByRole('textbox')).toHaveCount(1);
  await expect(page.getByRole('list', { name: 'How missed-call follow-up works' })).toHaveCount(0);
  const recoveryNumber = page.getByRole('region', {
    name: 'Your LeadRecovery number',
    exact: true,
    includeHidden: true,
  });
  await expect(recoveryNumber).toBeHidden();
  await expect(page.getByText('Assigned incoming Twilio number', { exact: true })).toHaveCount(0);
  const answeringPhone = page.getByRole('textbox', {
    name: "What is your business' phone number?",
    exact: true,
  });
  await expect(answeringPhone).toHaveValue('');
  await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
  let company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  expect(company.onboardingStep).toBe(5);
  expect(company.twilioPhoneNumber).toBeNull();
  expect(company.forwardToPhoneNumber).toBeNull();
  expect(company.businessPhone).toBe('+15555550710');

  const phoneStep = page.getByRole('button', { name: 'Back', exact: true });
  await phoneStep.click();
  await answeringPhone.fill('+1 (555) 555-0711');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
  company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  expect(company.forwardToPhoneNumber).toBe('+15555550711');
  expect(company.twilioPhoneNumber).toBeNull();

  await prisma.company.update({
    where: { id: companyId },
    data: { twilioPhoneNumber: '+15555550712' },
  });
  await page.reload();
  await phoneStep.click();
  await expect(recoveryNumber).toBeHidden();
  await page.getByText('Phone connection details', { exact: true }).click();
  await expect(recoveryNumber).toBeVisible();
  await expect(recoveryNumber).toContainText('Number added');
  await expect(recoveryNumber).toContainText('+15555550712');
  await expect(recoveryNumber).not.toContainText('Not connected yet');
  await expect(answeringPhone).toHaveValue('+15555550711');
  await expect(
    page.getByText(/Saving this screen does not change forwarding settings/),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
  company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  expect(company.twilioPhoneNumber).toBe('+15555550712');
  expect(company.forwardToPhoneNumber).toBe('+15555550711');
});

test('unfinished signup resumes after reload, attempted dashboard entry and signing back in', async ({
  page,
}) => {
  const account = await createTestAccount('Setup Resume Owner');
  const name = `E2E Signup Resume ${randomUUID()}`;
  let id: string | undefined;
  try {
    await page.context().addCookies((await accountStorageState(account)).cookies);
    const response = await page.request.post('/api/backend/api/accounts/businesses', {
      data: {
        requestId: randomUUID(),
        name,
        niche: 'RENOVATION',
        timeZone: 'UTC',
        currency: 'CAD',
      },
      headers: { origin: APP_ORIGIN },
    });
    expect(response.status()).toBe(201);
    const result: unknown = await response.json();
    if (
      !result ||
      typeof result !== 'object' ||
      !('companyId' in result) ||
      typeof result.companyId !== 'string'
    )
      throw new Error('Resume fixture business creation returned no ID.');
    id = result.companyId;
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Contact information', exact: true }),
    ).toBeVisible();
    await expect(page.locator('#workspace-navigation')).toHaveCount(0);
    await page.getByLabel('Business contact email', { exact: true }).fill('resume@example.test');
    await page.getByLabel('Business contact phone', { exact: true }).fill('+15555550780');
    await page.getByRole('button', { name: 'Save & continue', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Time zone & currency', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('combobox', { name: 'Business time zone', exact: true })
      .selectOption('America/Toronto');
    await page.reload();
    await expect(
      page.getByRole('progressbar', { name: 'Business setup progress' }),
    ).toHaveAttribute('aria-valuenow', '3');
    await expect(
      page.getByRole('combobox', { name: 'Business time zone', exact: true }),
    ).toHaveValue('UTC');
    await page.goto(`/services?companyId=${id}`);
    await expect(page).toHaveURL(new RegExp(`/onboarding/${id}`));
    await expect(
      page.getByRole('heading', { name: 'Time zone & currency', exact: true }),
    ).toBeVisible();
    await expect(page.locator('#workspace-navigation')).toHaveCount(0);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
    await page.getByLabel('Email address', { exact: true }).fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Time zone & currency', exact: true }),
    ).toBeVisible();
    await page.goto(`/onboarding/${id}`);
    await expect(
      page.getByRole('combobox', { name: 'Business currency', exact: true }),
    ).toHaveValue('CAD');
    expect(
      await prisma.company.count({ where: { memberships: { some: { userId: account.id } } } }),
    ).toBe(1);
  } finally {
    if (id) {
      const deleted = await prisma.company.deleteMany({
        where: {
          id,
          name,
          memberships: {
            some: { userId: account.id, role: 'OWNER' },
            every: { userId: account.id },
          },
        },
      });
      expect(deleted.count, 'Resume fixture ownership check failed.').toBe(1);
    }
    await deleteTestAccount(account);
  }
});

test('existing members can create another business without dashboard chrome and return to their workspace', async ({
  page,
}) => {
  await page.context().addCookies((await accountStorageState(owner)).cookies);
  const before = await prisma.businessMembership.count({ where: { userId: owner.id } });
  await page.goto(`/?companyId=${companyId}`);
  await expect(
    page.getByRole('heading', { name: 'Your business at a glance', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('link', { name: '+ Create business', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Business & industry', exact: true }),
  ).toBeVisible();
  await expect(page.locator('#workspace-navigation')).toHaveCount(0);
  await expect(page.getByRole('main')).toHaveCount(1);
  await page.getByRole('link', { name: 'Back to workspace', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your business at a glance', exact: true }),
  ).toBeVisible();
  await expect(page.locator('#workspace-navigation')).toHaveCount(1);
  expect(await prisma.businessMembership.count({ where: { userId: owner.id } })).toBe(before);
});

test('staff sees only authorized business operations and cannot finalize or administer access', async ({
  page,
}) => {
  await page.context().addCookies((await accountStorageState(staff)).cookies);
  await page.goto(`/services?companyId=${companyId}`);
  await expect(
    page.getByRole('heading', { name: 'Services & pricing', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add service', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit Role diagnostic', exact: true })).toHaveCount(
    0,
  );
  await page.goto(`/billing/${documentId}?companyId=${companyId}`);
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finalize estimate', exact: true })).toHaveCount(0);
  expect(
    (
      await page.request.post(
        `/api/backend/api/workspace/${companyId}/documents/${documentId}/finalize`,
        {
          data: { revision: 1, approved: true },
          headers: { origin: APP_ORIGIN, 'x-role': 'OWNER' },
        },
      )
    ).status(),
  ).toBe(403);
  expect(
    (await page.request.get(`/api/backend/api/workspace/${foreignCompanyId}/customers`)).status(),
  ).toBe(404);
  await page.goto(`/call-notes/new?companyId=${companyId}&customerId=${customerId}`);
  await page
    .getByRole('textbox', { name: /^What happened on the call/ })
    .fill('Staff callback summary.');
  await page.getByRole('button', { name: 'Save & review manually', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Review call note manually', exact: true }),
  ).toBeVisible();
  const id = new URL(page.url()).pathname.split('/').pop();
  const note = await prisma.callNote.findUniqueOrThrow({
    where: { id },
    include: { audits: true },
  });
  expect(note.audits[0]?.actor).toBe(staff.id);
  await page.goto(`/team?companyId=${companyId}`);
  await expect(page.locator('main [role="alert"]')).toContainText('owner');
});

test('owner invitations admit only the intended verified member and removal revokes access', async ({
  page,
  browser,
}) => {
  await page.context().addCookies((await accountStorageState(owner)).cookies);
  await page.goto(`/team?companyId=${companyId}`);
  await page.getByLabel('Invited email address', { exact: true }).fill(invited.email);
  await page.getByRole('button', { name: 'Create invitation link', exact: true }).click();
  const link = page.getByLabel('Private invitation link', { exact: true });
  await expect(link).toBeVisible();
  const url = await link.inputValue();
  const joined = await browser.newContext({
    baseURL: APP_ORIGIN,
    storageState: await accountStorageState(invited),
    extraHTTPHeaders: { origin: APP_ORIGIN },
    viewport: { width: 390, height: 844 },
  });
  try {
    const invitePage = await joined.newPage();
    await invitePage.goto(url);
    await invitePage
      .getByRole('button', { name: 'Accept business invitation', exact: true })
      .click();
    await expect(
      invitePage.getByRole('heading', { name: 'Your business at a glance', exact: true }),
    ).toBeVisible();
    const membership = await prisma.businessMembership.findUniqueOrThrow({
      where: { companyId_userId: { companyId, userId: invited.id } },
    });
    expect(membership.role).toBe('STAFF');
    await page.getByRole('button', { name: 'Refresh team', exact: true }).click();
    await page.getByRole('button', { name: 'Remove Invite Person', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Member removed');
    expect(
      (await joined.request.get(`/api/backend/api/workspace/${companyId}/customers`)).status(),
    ).toBe(404);
    await page.getByRole('button', { name: 'Make staff', exact: true }).click();
    await expect(page.locator('main [role="alert"]')).toContainText('at least one owner');
  } finally {
    await joined.close();
  }
});

test('sign-out clears the session and private pages require login', async ({ page }) => {
  await page.context().addCookies((await accountStorageState(owner)).cookies);
  await page.goto(`/?companyId=${companyId}`);
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  expect((await page.request.get('/api/backend/api/companies')).status()).toBe(401);
  await page.goto(`/customers?companyId=${companyId}`);
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
});

test('authorized business switching changes permissions for the same signed-in account', async ({
  page,
}) => {
  await page.context().addCookies((await accountStorageState(owner)).cookies);
  await page.goto(`/services?companyId=${companyId}`);
  await expect(page.getByRole('button', { name: 'Add service', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Business workspace', exact: true })
    .selectOption(foreignCompanyId);
  await expect(
    page.getByRole('heading', { name: 'Your business at a glance', exact: true }),
  ).toBeVisible();
  await page.goto(`/services?companyId=${foreignCompanyId}`);
  await expect(page.getByRole('button', { name: 'Add service', exact: true })).toHaveCount(0);
  expect(
    (
      await page.request.post(`/api/backend/api/workspace/${foreignCompanyId}/services`, {
        data: { name: 'Not authorized' },
      })
    ).status(),
  ).toBe(403);
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Business workspace', exact: true })
    .selectOption(companyId);
  await expect(
    page.getByRole('heading', { name: 'Your business at a glance', exact: true }),
  ).toBeVisible();
  await page.goto(`/services?companyId=${companyId}`);
  await expect(page.getByRole('button', { name: 'Add service', exact: true })).toBeVisible();
});
