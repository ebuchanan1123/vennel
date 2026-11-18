import { Router } from 'express';
import { z } from 'zod';

import { asyncHandler } from '../middleware/async-handler.js';
import { currentAccount } from '../middleware/account-access.js';
import { acceptInvitation } from '../services/membership.service.js';
import { createBusiness, createBusinessSchema } from '../services/onboarding.service.js';

export const accountsRouter = Router();
accountsRouter.post(
  '/businesses',
  asyncHandler(async (req, res) => {
    res
      .status(201)
      .json(await createBusiness(currentAccount(req).id, createBusinessSchema.parse(req.body)));
  }),
);
accountsRouter.post(
  '/invitations/accept',
  asyncHandler(async (req, res) => {
    const { token } = z
      .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
      .strict()
      .parse(req.body);
    res.json(await acceptInvitation(currentAccount(req), token));
  }),
);
