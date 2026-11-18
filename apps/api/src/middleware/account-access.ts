import { fromNodeHeaders } from 'better-auth/node';
import { prisma } from '@lead-recovery/database';
import {
  hasBusinessPermission,
  type AccountProfile,
  type BusinessPermission,
} from '@lead-recovery/types';
import type { Request, Response, NextFunction } from 'express';

import { getAccountAuth } from '../auth.js';
import { env } from '../env.js';
import { HttpError } from './error-handler.js';
import { asyncHandler } from './async-handler.js';

export function accountSessionMiddleware(authProvider: typeof getAccountAuth = getAccountAuth) {
  return asyncHandler(async (req, _res, next) => {
    const session = await authProvider().api.getSession({
      headers: fromNodeHeaders(req.headers),
      query: { disableCookieCache: true },
    });
    if (!session) throw new HttpError(401, 'Sign in to access your business workspace.');
    if (!session.user.emailVerified)
      throw new HttpError(403, 'Verify your email address before accessing business data.');
    req.account = {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      emailVerified: session.user.emailVerified,
    };
    next();
  });
}
export const requireAccount = accountSessionMiddleware();

export function currentAccount(req: Request): AccountProfile {
  if (!req.account) throw new HttpError(401, 'Sign in to continue.');
  return req.account;
}

export function requireSameOrigin(req: Request, _res: Response, next: NextFunction): void {
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
    req.header('origin') !== new URL(env.DASHBOARD_BASE_URL).origin
  ) {
    throw new HttpError(
      403,
      'State-changing requests must come from the configured application origin.',
    );
  }
  next();
}

export async function authorizeBusiness(
  req: Request,
  companyId: string,
  permission: BusinessPermission = 'READ',
) {
  const user = currentAccount(req);
  const membership = await prisma.businessMembership.findFirst({
    where: { companyId, userId: user.id, company: { isActive: true } },
    select: { role: true, companyId: true },
  });
  if (!membership) throw new HttpError(404, 'Business workspace not found.');
  if (!hasBusinessPermission(membership.role, permission))
    throw new HttpError(403, 'An owner must approve this action.');
  req.businessAccess = membership;
  return membership;
}

export function requireBusinessPermission(permission: BusinessPermission) {
  return asyncHandler(async (req, _res, next) => {
    const companyId = req.params.companyId;
    if (typeof companyId !== 'string' || !companyId)
      throw new HttpError(400, 'A business workspace is required.');
    await authorizeBusiness(req, companyId, permission);
    next();
  });
}
