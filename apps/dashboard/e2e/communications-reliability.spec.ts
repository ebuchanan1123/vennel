import { randomUUID } from 'node:crypto';
import { prisma } from '@lead-recovery/database';
import type { SmsDeliveryRecord } from '@lead-recovery/types';

import {
  APP_ORIGIN,
  accountStorageState,
  createTestAccount,
  deleteTestAccount,
  expect,
  grantTestOwner,
  test,
} from './account-fixtures';

let companyId: string;
let leadId: string;
let unknownDeliveryId: string;
let unknownJobId: string;
const labels: Record<SmsDeliveryRecord['status'], string> = {
  PENDING: 'Pending send',
  SENDING: 'Submitting to provider',
  ACCEPTED: 'Provider accepted - delivery not confirmed',
  SENT: 'Sent by provider - delivery not confirmed',
  DELIVERED: 'Delivered',
  FAILED: 'Delivery failed - needs attention',
  UNKNOWN: 'Provider outcome unknown - needs review',
};

test.beforeAll(async ({ account }) => {
  const company = await prisma.company.create({
    data: {
      name: 'SMS reliability test business',
      slug: `workflow-e2e-sms-${randomUUID()}`,
      niche: 'HVAC',
      currency: 'CAD',
      timeZone: 'America/Toronto',
      serviceAreas: ['Toronto'],
      twilioPhoneNumber: '+15555550200',
      forwardToPhoneNumber: '+15555550201',
    },
  });
  companyId = company.id;
  await grantTestOwner(companyId, account.id);
  const lead = await prisma.lead.create({
    data: {
      companyId,
      source: 'SMS',
      phone: '+15555550202',
      status: 'NEEDS_HUMAN',
      needsHuman: true,
      summary: 'Review unsuccessful and uncertain SMS sends.',
    },
  });
  leadId = lead.id;
  const inbound = await prisma.message.create({
    data: { leadId, direction: 'INBOUND', body: 'Synthetic furnace inquiry.' },
  });
  await prisma.message.create({
    data: { leadId, direction: 'OUTBOUND', body: 'Historical reply without a provider receipt.' },
  });
  for (const status of Object.keys(labels) as SmsDeliveryRecord['status'][]) {
    const accepted = status === 'ACCEPTED' || status === 'SENT' || status === 'DELIVERED';
    const message = await prisma.message.create({
      data: {
        leadId,
        direction: 'OUTBOUND',
        body: `Status: ${status}`,
        smsDelivery: {
          create: {
            fromPhone: '+15555550200',
            toPhone: lead.phone,
            status,
            providerId: accepted ? `SM${randomUUID().replaceAll('-', '')}` : null,
            acceptedAt: accepted ? new Date() : null,
            deliveredAt: status === 'DELIVERED' ? new Date() : null,
            lastError: status === 'UNKNOWN' ? 'Acceptance could not be established.' : null,
          },
        },
      },
      include: { smsDelivery: true },
    });
    if (status !== 'UNKNOWN') continue;
    if (!message.smsDelivery) throw new Error('Expected the unknown delivery fixture.');
    unknownDeliveryId = message.smsDelivery.id;
    const conversation = await prisma.conversation.create({
      data: { companyId, phone: lead.phone, nextSequence: 1 },
    });
    const providerId = `SM${randomUUID().replaceAll('-', '')}`;
    const event = await prisma.webhookEvent.create({
      data: {
        eventType: 'SMS_MESSAGE',
        externalId: `${companyId}:SMS_MESSAGE:${providerId}`,
        providerId,
        companyId,
        conversationId: conversation.id,
        sequence: 1,
        payload: { from: lead.phone, to: '+15555550200', body: inbound.body },
        status: 'FAILED',
        attempts: 1,
        inboundMessageId: inbound.id,
        outboundMessageId: message.id,
      },
    });
    const job = await prisma.backgroundJob.create({
      data: {
        companyId,
        kind: 'INBOUND_SMS',
        eventKey: `communication:${event.externalId}`,
        payload: { webhookEventId: event.id },
        status: 'BLOCKED',
        attempts: 1,
        lastError: 'The provider outcome is uncertain.',
      },
    });
    unknownJobId = job.id;
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { jobId: job.id } });
  }
});

test.afterAll(async () => {
  if (companyId) {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    if (!company.slug.startsWith('workflow-e2e-sms-'))
      throw new Error('SMS fixture ownership check failed.');
    await prisma.$transaction(async (tx) => {
      await tx.webhookEvent.deleteMany({ where: { companyId } });
      await tx.backgroundJob.deleteMany({ where: { companyId } });
      await tx.company.delete({ where: { id: companyId } });
    });
  }
  await prisma.$disconnect();
});

test('mobile conversation history distinguishes every delivery state and never invents historical delivery', async ({
  page,
}) => {
  await page.goto(`/leads/${leadId}?companyId=${companyId}`);
  await expect(page.getByRole('heading', { name: 'Conversation', exact: true })).toBeVisible();
  for (const [status, label] of Object.entries(labels)) {
    const bubble = page.getByText(`Status: ${status}`, { exact: true }).locator('..');
    await expect(bubble).toContainText(label);
    if (status !== 'DELIVERED')
      await expect(bubble.getByText('Delivered', { exact: true })).toHaveCount(0);
  }
  await expect(
    page.getByText('Delivery not tracked (historical message)', { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('unavailable provider lookup is explicit and does not change or resend an uncertain message', async ({
  page,
}) => {
  await page.goto(`/leads/${leadId}?companyId=${companyId}`);
  const bubble = page.getByText('Status: UNKNOWN', { exact: true }).locator('..');
  await bubble.getByText('Review SMS delivery', { exact: true }).click();
  await expect(
    bubble.getByRole('button', { name: 'Authorize verified-unsent retry' }),
  ).toBeDisabled();
  await bubble
    .getByRole('textbox', { name: 'Twilio MessageSid' })
    .fill(`SM${randomUUID().replaceAll('-', '')}`);
  await bubble.getByRole('button', { name: 'Check provider status', exact: true }).click();
  await expect(bubble.getByRole('alert')).toContainText('Twilio is not configured');
  expect(await prisma.smsDelivery.findUnique({ where: { id: unknownDeliveryId } })).toMatchObject({
    status: 'UNKNOWN',
    providerId: null,
  });
  expect(await prisma.smsDeliveryReview.count({ where: { deliveryId: unknownDeliveryId } })).toBe(
    0,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('an explicit owner attestation durably queues the same message and records the approving account', async ({
  page,
  account,
}) => {
  const count = await prisma.message.count({ where: { leadId } });
  await page.goto(`/leads/${leadId}?companyId=${companyId}`);
  const bubble = page.getByText('Status: UNKNOWN', { exact: true }).locator('..');
  await bubble.getByText('Review SMS delivery', { exact: true }).click();
  await bubble.getByRole('checkbox', { name: /original worker has stopped/ }).check();
  await bubble
    .getByRole('button', { name: 'Authorize verified-unsent retry', exact: true })
    .click();
  await expect(bubble.getByRole('status')).toContainText('queued for another attempt');
  await expect(bubble).toContainText('Pending send');
  expect(await prisma.backgroundJob.findUnique({ where: { id: unknownJobId } })).toMatchObject({
    status: 'PENDING',
  });
  expect(
    await prisma.smsDeliveryReview.findFirst({ where: { deliveryId: unknownDeliveryId } }),
  ).toMatchObject({
    action: 'CONFIRM_NOT_SENT',
    actorId: account.id,
  });
  expect(await prisma.message.count({ where: { leadId } })).toBe(count);
});

test('staff can read delivery history but cannot authorize recovery, and outsiders cannot read it', async ({
  browser,
}) => {
  const staff = await createTestAccount('SMS staff test');
  const outsider = await createTestAccount('SMS outsider test');
  try {
    await prisma.businessMembership.create({
      data: { companyId, userId: staff.id, role: 'STAFF' },
    });
    const staffContext = await browser.newContext({
      baseURL: APP_ORIGIN,
      storageState: await accountStorageState(staff),
      extraHTTPHeaders: { origin: APP_ORIGIN },
    });
    const outsiderContext = await browser.newContext({
      baseURL: APP_ORIGIN,
      storageState: await accountStorageState(outsider),
      extraHTTPHeaders: { origin: APP_ORIGIN },
    });
    try {
      const page = await staffContext.newPage();
      await page.goto(`/leads/${leadId}?companyId=${companyId}`);
      await expect(page.getByRole('heading', { name: 'Conversation', exact: true })).toBeVisible();
      await expect(page.getByText('Review SMS delivery', { exact: true })).toHaveCount(0);
      const path = `/api/backend/api/workspace/${companyId}/sms-deliveries/${unknownDeliveryId}/reconcile`;
      expect(
        (
          await staffContext.request.post(path, {
            data: { action: 'CONFIRM_NOT_SENT', approved: true },
          })
        ).status(),
      ).toBe(403);
      expect(
        (
          await outsiderContext.request.get(
            `/api/backend/api/leads/${leadId}?companyId=${companyId}`,
          )
        ).status(),
      ).toBe(404);
    } finally {
      await staffContext.close();
      await outsiderContext.close();
    }
  } finally {
    await deleteTestAccount(staff);
    await deleteTestAccount(outsider);
  }
});
