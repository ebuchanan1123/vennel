import type { BackgroundJob, Prisma } from '@prisma/client';

export class JobLeaseLostError extends Error {
  constructor() {
    super('The worker lease expired or was replaced. No conversation changes were committed.');
    this.name = 'JobLeaseLostError';
  }
}

export async function assertJobLease(
  db: Prisma.TransactionClient,
  job: Pick<BackgroundJob, 'id' | 'leaseToken'>,
): Promise<void> {
  if (!job.leaseToken) throw new JobLeaseLostError();
  // Fence every checkpoint, including the transition immediately before an external send.
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "BackgroundJob"
    WHERE "id" = ${job.id} AND "status" = 'RUNNING' AND "leaseToken" = ${job.leaseToken}
      AND "leaseUntil" > (NOW() AT TIME ZONE 'UTC')
    FOR UPDATE`;
  if (!rows.length) throw new JobLeaseLostError();
}
