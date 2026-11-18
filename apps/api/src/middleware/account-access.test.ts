import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), membership: vi.fn() }));
vi.mock('../auth.js', () => ({ getAccountAuth: () => ({ api: { getSession: mocks.session } }) }));
vi.mock('@lead-recovery/database', () => ({
  prisma: { businessMembership: { findFirst: mocks.membership } },
}));
import { authorizeBusiness, currentAccount, requireAccount } from './account-access.js';
import { asyncHandler } from './async-handler.js';
import { errorHandler } from './error-handler.js';
let server: Server;
let url: string;
beforeAll(async () => {
  const app = express();
  app.use(requireAccount);
  app.get('/', (req, res) => res.json(currentAccount(req)));
  app.get(
    '/business/:id',
    asyncHandler(async (req, res) => {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      res.json(await authorizeBusiness(req, id, 'APPROVALS'));
    }),
  );
  app.use(errorHandler);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected local test server.');
  url = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(null);
  mocks.membership.mockResolvedValue(null);
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
describe('authenticated business access', () => {
  it('rejects unauthenticated requests and the removed developer-token bypass', async () => {
    expect((await fetch(url)).status).toBe(401);
    expect(
      (
        await fetch(url, {
          headers: { 'x-development-access': 'old-token', 'x-user-id': 'owner', 'x-role': 'OWNER' },
        })
      ).status,
    ).toBe(401);
  });
  it('accepts verified library sessions, not caller-supplied identity headers', async () => {
    mocks.session.mockResolvedValue({
      user: { id: 'user-a', name: 'Owner', email: 'owner@example.test', emailVerified: true },
    });
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect((await response.json()).id).toBe('user-a');
  });
  it('rejects unverified accounts', async () => {
    mocks.session.mockResolvedValue({
      user: { id: 'user-a', name: 'Owner', email: 'owner@example.test', emailVerified: false },
    });
    expect((await fetch(url)).status).toBe(403);
  });
  it('checks current business membership and denies staff approval even with a forged owner header', async () => {
    mocks.session.mockResolvedValue({
      user: { id: 'user-a', name: 'Staff', email: 'staff@example.test', emailVerified: true },
    });
    expect((await fetch(`${url}/business/other-business`)).status).toBe(404);
    mocks.membership.mockResolvedValue({ companyId: 'business-a', role: 'STAFF' });
    expect(
      (await fetch(`${url}/business/business-a`, { headers: { 'x-role': 'OWNER' } })).status,
    ).toBe(403);
    expect(mocks.membership).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { companyId: 'business-a', userId: 'user-a', company: { isActive: true } },
      }),
    );
  });
});
