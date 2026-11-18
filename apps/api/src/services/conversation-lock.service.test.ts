import { prisma } from '@lead-recovery/database';
import { describe, expect, it, vi } from 'vitest';

import { assertJobLease, JobLeaseLostError } from './conversation-lock.service.js';

describe('durable conversation checkpoint fencing', () => {
  it('rejects unclaimed jobs before any database mutation', async () => {
    const job = { id: 'job', leaseToken: null };
    await expect(assertJobLease(prisma, job)).rejects.toBeInstanceOf(JobLeaseLostError);
  });

  it('locks the claimed row and requires an unexpired matching lease', async () => {
    const query = vi.spyOn(prisma, '$queryRaw').mockResolvedValue([{ id: 'job' }]);
    try {
      await assertJobLease(prisma, { id: 'job', leaseToken: 'token' });
      const sql = query.mock.calls[0]?.[0];
      expect(Array.isArray(sql) ? sql.join(' ') : '').toContain('FOR UPDATE');
      expect(Array.isArray(sql) ? sql.join(' ') : '').toContain('"leaseUntil" >');
      query.mockResolvedValueOnce([]);
      await expect(
        assertJobLease(prisma, { id: 'job', leaseToken: 'stale' }),
      ).rejects.toBeInstanceOf(JobLeaseLostError);
    } finally {
      query.mockRestore();
    }
  });
});
