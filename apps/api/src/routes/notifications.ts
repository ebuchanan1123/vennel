import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@lead-recovery/database';

import { asyncHandler } from '../middleware/async-handler.js';
import { HttpError } from '../middleware/error-handler.js';
import { recordParamsSchema, workspaceParamsSchema } from '../schemas/workspace.schema.js';
import { listBackgroundJobs, retryBackgroundJob } from '../services/background-job.service.js';
import { notificationOptOut } from '../services/notification.service.js';
import {
  getWorkspaceSettings,
  updateWorkspaceSettings,
  workspaceSettingsSchema,
} from '../services/workspace-settings.service.js';

export const workspaceSettingsRouter = Router({ mergeParams: true });
workspaceSettingsRouter.get(
  '/settings',
  asyncHandler(async (req, res) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    res.json(await getWorkspaceSettings(companyId));
  }),
);
workspaceSettingsRouter.patch(
  '/settings',
  asyncHandler(async (req, res) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    res.json(await updateWorkspaceSettings(companyId, workspaceSettingsSchema.parse(req.body)));
  }),
);
workspaceSettingsRouter.get(
  '/jobs',
  asyncHandler(async (req, res) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    res.json(await listBackgroundJobs(companyId));
  }),
);
workspaceSettingsRouter.post(
  '/jobs/:id/retry',
  asyncHandler(async (req, res) => {
    const { companyId, id } = recordParamsSchema.parse(req.params);
    await retryBackgroundJob(companyId, id);
    res.status(204).send();
  }),
);

export const publicNotificationsRouter = Router();
const tokenSchema = z.object({ token: z.string().uuid() });
publicNotificationsRouter.get(
  '/unsubscribe/:token',
  asyncHandler(async (req, res) => {
    const { token } = tokenSchema.parse(req.params);
    const preferences = await prisma.notificationPreference.findUnique({
      where: { optOutToken: token },
      include: { company: { select: { name: true } } },
    });
    if (!preferences) throw new HttpError(404, 'This notification link is invalid or expired.');
    res.json({ businessName: preferences.company.name, enabled: preferences.enabled });
  }),
);
publicNotificationsRouter.post(
  '/unsubscribe/:token',
  asyncHandler(async (req, res) => {
    const { token } = tokenSchema.parse(req.params);
    await notificationOptOut(token);
    res.json({ unsubscribed: true });
  }),
);
