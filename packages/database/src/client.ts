import { PrismaClient } from '@prisma/client';

declare global {
  var __leadRecoveryPrisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__leadRecoveryPrisma ??
  new PrismaClient({
    log: ['warn'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__leadRecoveryPrisma = prisma;
}
