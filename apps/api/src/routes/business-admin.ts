import { Router } from 'express';
import { z } from 'zod';

import { asyncHandler } from '../middleware/async-handler.js';
import { currentAccount } from '../middleware/account-access.js';
import { recordParamsSchema, workspaceParamsSchema } from '../schemas/workspace.schema.js';
import {
  changeMember,
  createInvitation,
  getTeam,
  listMembers,
  revokeInvitation,
} from '../services/membership.service.js';
import {
  checkOnboarding,
  completeOnboarding,
  getOnboarding,
  onboardingSchema,
  updateOnboarding,
} from '../services/onboarding.service.js';

export const businessAdminRouter = Router({ mergeParams: true });
businessAdminRouter.get(
  '/members',
  asyncHandler(async (req, res) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    res.json(await listMembers(companyId));
  }),
);
businessAdminRouter.get(
  '/team',
  asyncHandler(async (req, res) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    res.json(await getTeam(companyId));
  }),
);
businessAdminRouter.post(
  '/team/invitations',
  asyncHandler(async (req, res) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    const body = z
      .object({
        email: z
          .string()
          .trim()
          .email()
          .transform((email) => email.toLowerCase()),
        role: z.enum(['OWNER', 'STAFF']),
      })
      .strict()
      .parse(req.body);
    res
      .status(201)
      .json(await createInvitation(companyId, currentAccount(req).id, body.email, body.role));
  }),
);
businessAdminRouter.post(
  '/team/invitations/:id/revoke',
  asyncHandler(async (req, res) => {
    const { companyId, id } = recordParamsSchema.parse(req.params);
    await revokeInvitation(companyId, currentAccount(req).id, id);
    res.status(204).send();
  }),
);
businessAdminRouter.patch(
  '/team/members/:id',
  asyncHandler(async (req, res) => {
    const { companyId, id } = recordParamsSchema.parse(req.params);
    const { role } = z
      .object({ role: z.enum(['OWNER', 'STAFF']).nullable() })
      .strict()
      .parse(req.body);
    await changeMember(companyId, currentAccount(req).id, id, role);
    res.status(204).send();
  }),
);
businessAdminRouter.get(
  '/onboarding',
  asyncHandler(async (req, res) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    res.json(await getOnboarding(companyId));
  }),
);
businessAdminRouter.patch(
  '/onboarding',
  asyncHandler(async (req, res) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    res.json(
      await updateOnboarding(companyId, currentAccount(req).id, onboardingSchema.parse(req.body)),
    );
  }),
);
businessAdminRouter.post(
  '/onboarding/check',
  asyncHandler(async (req, res) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    res.json(await checkOnboarding(companyId));
  }),
);
businessAdminRouter.post(
  '/onboarding/complete',
  asyncHandler(async (req, res) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    res.json(await completeOnboarding(companyId, currentAccount(req).id));
  }),
);
