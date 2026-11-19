import { Router } from 'express';
import { prisma } from '@lead-recovery/database';
import { asyncHandler } from '../middleware/async-handler.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'lead-recovery-api',
    timestamp: new Date().toISOString(),
  });

  healthRouter.get(
    '/ready',
    asyncHandler(async (_req, res) => {
      let workerHealthy: boolean;
      try {
        workerHealthy = await prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT 1`;
            const worker = await tx.workerHeartbeat.findFirst({ orderBy: { lastSeenAt: 'desc' } });
            return Boolean(worker && Date.now() - worker.lastSeenAt.getTime() < 120000);
          },
          { timeout: 3000, maxWait: 1000 },
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            event: 'readiness_database_failed',
            errorType: error instanceof Error ? error.name : 'Unknown',
          }),
        );
        res.status(503).json({ ok: false, database: false, worker: false });
        return;
      }
      res
        .status(workerHealthy ? 200 : 503)
        .json({ ok: workerHealthy, database: true, worker: workerHealthy });
    }),
  );
});
