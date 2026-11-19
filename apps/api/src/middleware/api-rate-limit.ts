import { randomUUID } from 'node:crypto';
import { prisma } from '@lead-recovery/database';

import { env } from '../env.js';
import { currentAccount } from './account-access.js';
import { asyncHandler } from './async-handler.js';
import { HttpError } from './error-handler.js';

export async function consumeApiRateLimit(accountId: string): Promise<boolean> {
  const key = `workspace-api:${accountId}`;
  const limit = env.API_RATE_LIMIT_PER_MINUTE;
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("id", "key", "count", "lastRequest")
    VALUES (${randomUUID()}, ${key}, 1,
      (FLOOR(EXTRACT(EPOCH FROM CLOCK_TIMESTAMP()) / 60) * 60000)::BIGINT)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimit"."lastRequest" < EXCLUDED."lastRequest" THEN 1
        ELSE LEAST("RateLimit"."count" + 1, ${limit + 1}) END,
      "lastRequest" = EXCLUDED."lastRequest"
    RETURNING "count"`;
  return Boolean(rows[0] && rows[0].count <= limit);
}

export const apiRateLimit = asyncHandler(async (req, res, next) => {
  const account = currentAccount(req);
  if (!(await consumeApiRateLimit(account.id))) {
    res.setHeader('Retry-After', '60');
    console.warn(JSON.stringify({ event: 'workspace_api_rate_limited', accountId: account.id }));
    throw new HttpError(429, 'Too many workspace requests. Please wait one minute and retry.');
  }
  next();
});
