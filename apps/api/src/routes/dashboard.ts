import { Router } from 'express';
import { z } from 'zod';

import { asyncHandler } from '../middleware/async-handler.js';
import { getDashboardStats } from '../services/dashboard-stats.service.js';
import { listMemberCompanies } from '../services/membership.service.js';
import { authorizeBusiness, currentAccount } from '../middleware/account-access.js';

export const dashboardRouter = Router();

const statsQuerySchema = z.object({
  companyId: z.string().optional(),
});

dashboardRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const query = statsQuerySchema.parse(req.query);

    let companyId = query.companyId;
    if (!companyId) {
      const companies = await listMemberCompanies(currentAccount(req).id);
      const activeCompanies = companies.filter((company) => company.isActive);
      if (activeCompanies.length !== 1) {
        res.status(400).json({ error: 'companyId is required when multiple companies exist' });
        return;
      }
      companyId = activeCompanies[0]!.id;
    }

    await authorizeBusiness(req, companyId);
    const stats = await getDashboardStats(companyId);
    res.json(stats);
  }),
);
