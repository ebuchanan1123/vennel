import { Router } from 'express';

import { asyncHandler } from '../middleware/async-handler.js';
import { listMemberCompanies } from '../services/membership.service.js';
import { currentAccount } from '../middleware/account-access.js';

export const companiesRouter = Router();

companiesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const companies = await listMemberCompanies(currentAccount(req).id);
    res.json(companies);
  }),
);
