import { parseArgs } from 'node:util';
import { prisma } from '@lead-recovery/database';
import { z } from 'zod';
import twilio from 'twilio';

import { env } from '../env.js';
import { accountEmailSchema } from '../services/account-email.service.js';
import { customerBodySchema } from '../schemas/workspace.schema.js';

async function main() {
  const command = process.argv[2];
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: { email: { type: 'string' }, company: { type: 'string' }, number: { type: 'string' } },
    strict: true,
  });
  if (command === 'email') {
    if (
      env.NODE_ENV === 'production' ||
      !['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.DATABASE_URL).hostname)
    )
      throw new Error(
        'Development email links can be inspected only against a local, non-production database.',
      );
    const email = z.string().email().parse(values.email).toLowerCase();
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new Error('No local account exists for this email.');
    const job = await prisma.backgroundJob.findFirst({
      where: { userId: user.id, kind: 'AUTH_EMAIL' },
      orderBy: { createdAt: 'desc' },
    });
    if (!job)
      throw new Error('No account email is queued. Request a verification/reset email first.');
    const message = accountEmailSchema.parse(job.payload);
    if (new Date(message.expiresAt).getTime() <= Date.now())
      throw new Error('The local link expired. Request a new verification or reset email.');
    console.log(
      `Local ${message.type === 'VERIFY_EMAIL' ? 'verification' : 'password-reset'} link. Keep it private:\n${message.url}`,
    );
    return;
  }
  if (command === 'grant-owner') {
    const email = z.string().email().parse(values.email).toLowerCase();
    const slug = z.string().min(1).parse(values.company);
    await prisma.$transaction(async (tx) => {
      const company = await tx.company.findUnique({ where: { slug } });
      if (!company?.isActive) throw new Error('Active business not found.');
      await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${company.id} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { email } });
      if (!user?.emailVerified)
        throw new Error('The target account must exist and have completed email verification.');
      const members = await tx.businessMembership.findMany({ where: { companyId: company.id } });
      if (members.some((member) => member.userId === user.id && member.role === 'OWNER')) {
        console.log('This verified account is already an owner.');
        return;
      }
      if (members.length > 0)
        throw new Error(
          'This business already has members. Use authenticated owner team management instead of bootstrap.',
        );
      await tx.businessMembership.create({
        data: { companyId: company.id, userId: user.id, role: 'OWNER' },
      });
      await tx.businessMembershipAudit.create({
        data: {
          companyId: company.id,
          actorId: 'local-administrator',
          action: 'EXISTING_BUSINESS_OWNER_ASSIGNED',
          details: { userId: user.id, email },
        },
      });
      console.log(`Owner membership granted for ${slug}. Existing business data was preserved.`);
    });
    return;
  }
  if (command === 'assign-number') {
    const slug = z.string().min(1).parse(values.company);
    const number = customerBodySchema.shape.phone.parse(values.number);
    if (!number) throw new Error('Provide a valid incoming Twilio number.');
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN)
      throw new Error('Configure the platform Twilio account before verifying number ownership.');
    const numbers = await twilio(
      env.TWILIO_ACCOUNT_SID,
      env.TWILIO_AUTH_TOKEN,
    ).incomingPhoneNumbers.list({ phoneNumber: number, limit: 1 });
    if (!numbers.some((entry) => entry.phoneNumber === number))
      throw new Error(
        'This incoming number is not owned by the configured platform Twilio account.',
      );
    await prisma.$transaction(async (tx) => {
      const company = await tx.company.findUnique({ where: { slug } });
      if (!company?.isActive) throw new Error('Active business not found.');
      await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${company.id} FOR UPDATE`;
      if (
        (await tx.businessMembership.count({ where: { companyId: company.id, role: 'OWNER' } })) < 1
      )
        throw new Error('Assign a verified business owner first.');
      if (company.twilioPhoneNumber && company.twilioPhoneNumber !== number)
        throw new Error(
          'This business already has a different assigned number. Existing recovery configuration has not been replaced.',
        );
      await tx.company.update({ where: { id: company.id }, data: { twilioPhoneNumber: number } });
      await tx.businessMembershipAudit.create({
        data: {
          companyId: company.id,
          actorId: 'local-administrator',
          action: 'PLATFORM_NUMBER_ASSIGNED',
          details: { number },
        },
      });
      console.log(`Verified incoming number assigned to ${slug}. No call or SMS was sent.`);
    });
    return;
  }
  throw new Error(
    'Use email --email, grant-owner --email --company, or assign-number --company --number.',
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Account administration failed.');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
