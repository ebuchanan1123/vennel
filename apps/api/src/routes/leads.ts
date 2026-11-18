import { Router } from 'express';
import { LeadOutcome, LeadStatus } from '@prisma/client';
import { prisma } from '@lead-recovery/database';
import { z } from 'zod';
import { hasTwoDecimals } from '@lead-recovery/types';

import { asyncHandler } from '../middleware/async-handler.js';
import { authorizeBusiness, currentAccount } from '../middleware/account-access.js';
import { HttpError } from '../middleware/error-handler.js';
import { listMemberCompanies } from '../services/membership.service.js';
import {
  getLeadDetail,
  listLeads,
  serializeLeadMoney,
  updateLeadOutcome,
} from '../services/lead.service.js';

export const leadsRouter = Router();

const leadsQuerySchema = z.object({
  companyId: z.string().optional(),
  status: z.nativeEnum(LeadStatus).optional(),
  outcome: z.nativeEnum(LeadOutcome).optional(),
});

const leadParamsSchema = z.object({
  id: z.string().min(1),
});

const outcomeBodySchema = z.object({
  outcome: z.nativeEnum(LeadOutcome),
  estimatedValue: z.number().min(0).max(99999999.99).refine(hasTwoDecimals).nullable().optional(),
  actualValue: z.number().min(0).max(99999999.99).refine(hasTwoDecimals).nullable().optional(),
  lostReason: z.string().max(500).nullable().optional(),
});

leadsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = leadsQuerySchema.parse(req.query);
    const companyIds = (await listMemberCompanies(currentAccount(req).id)).map(
      (company) => company.id,
    );
    if (query.companyId) await authorizeBusiness(req, query.companyId);
    const leads = await listLeads({
      companyId: query.companyId,
      status: query.status,
      outcome: query.outcome,
      companyIds,
    });

    res.json(leads.map(serializeLeadMoney));
  }),
);

leadsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const params = leadParamsSchema.parse(req.params);
    const query = leadsQuerySchema.parse(req.query);
    const companyId = await accessibleLeadCompany(req, params.id, query.companyId);
    const lead = await getLeadDetail(params.id, companyId);

    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    res.json(serializeLeadMoney(lead));
  }),
);

leadsRouter.patch(
  '/:id/outcome',
  asyncHandler(async (req, res) => {
    const params = leadParamsSchema.parse(req.params);
    const parsedBody = outcomeBodySchema.safeParse(req.body);

    if (!parsedBody.success) {
      res
        .status(400)
        .json({ error: 'Invalid outcome payload', details: parsedBody.error.flatten() });
      return;
    }

    const query = leadsQuerySchema.parse(req.query);
    const companyId = await accessibleLeadCompany(req, params.id, query.companyId);
    await authorizeBusiness(req, companyId, 'OPERATIONS');
    const existing = await getLeadDetail(params.id, companyId);
    if (!existing) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const updated = await updateLeadOutcome(params.id, parsedBody.data);
    res.json(serializeLeadMoney(updated));
  }),
);

async function accessibleLeadCompany(
  req: import('express').Request,
  id: string,
  companyId?: string,
): Promise<string> {
  const lead = await prisma.lead.findFirst({
    where: {
      id,
      companyId,
      company: { isActive: true, memberships: { some: { userId: currentAccount(req).id } } },
    },
    select: { companyId: true },
  });
  if (!lead) throw new HttpError(404, 'Lead not found.');
  return lead.companyId;
}
