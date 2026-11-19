import { prisma } from '@lead-recovery/database';
import type { Prisma } from '@prisma/client';

import { env } from '../env.js';
import { HttpError } from '../middleware/error-handler.js';

export class ProviderUsageLimitError extends HttpError {
  constructor(public readonly kind: 'AI_REQUEST' | 'AI_AUDIO_BYTES' | 'SMS_SEND') {
    super(
      429,
      `The business's daily ${kind === 'SMS_SEND' ? 'SMS send' : 'AI usage'} limit was reached. Review usage before increasing the limit.`,
    );
    this.name = 'ProviderUsageLimitError';
  }
}

export async function reserveProviderUsage(
  companyId: string,
  kind: ProviderUsageLimitError['kind'],
  amount = 1,
  db: Prisma.TransactionClient = prisma,
): Promise<void> {
  if (!Number.isSafeInteger(amount) || amount < 1)
    throw new HttpError(400, 'Provider usage reservations require a positive integer amount.');
  const limit =
    kind === 'AI_REQUEST'
      ? env.AI_DAILY_REQUEST_LIMIT
      : kind === 'SMS_SEND'
        ? env.SMS_DAILY_SEND_LIMIT
        : env.AI_DAILY_AUDIO_BYTE_LIMIT;
  const rows = await db.$queryRaw<{ used: number }[]>`
    INSERT INTO "ProviderUsage" ("companyId", "kind", "windowStart", "used")
    SELECT ${companyId}, ${kind}, DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC'), ${amount}
    WHERE ${amount} <= ${limit}
    ON CONFLICT ("companyId", "kind", "windowStart") DO UPDATE
      SET "used" = "ProviderUsage"."used" + EXCLUDED."used"
      WHERE "ProviderUsage"."used" + EXCLUDED."used" <= ${limit}
    RETURNING "used"`;
  if (!rows.length) throw new ProviderUsageLimitError(kind);
}
