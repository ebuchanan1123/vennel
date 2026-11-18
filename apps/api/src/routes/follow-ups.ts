import { Router } from 'express';

import { asyncHandler } from '../middleware/async-handler.js';
import { currentAccount } from '../middleware/account-access.js';
import {
  acceptSuggestionSchema,
  followUpBodySchema,
  followUpStatusSchema,
  followUpUpdateSchema,
} from '../schemas/call-note.schema.js';
import { recordParamsSchema, workspaceParamsSchema } from '../schemas/workspace.schema.js';
import {
  acceptFollowUpSuggestion,
  changeFollowUpStatus,
  createFollowUp,
  dismissFollowUpSuggestion,
  listFollowUps,
  listFollowUpSuggestions,
  updateFollowUp,
} from '../services/follow-up.service.js';

export const followUpsRouter = Router({ mergeParams: true });
followUpsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    res.json(await listFollowUps(companyId));
  }),
);
followUpsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    res
      .status(201)
      .json(
        await createFollowUp(companyId, followUpBodySchema.parse(req.body), currentAccount(req).id),
      );
  }),
);
followUpsRouter.get(
  '/suggestions',
  asyncHandler(async (req, res) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    res.json(await listFollowUpSuggestions(companyId));
  }),
);
followUpsRouter.post(
  '/suggestions/:id/accept',
  asyncHandler(async (req, res) => {
    const { companyId, id } = recordParamsSchema.parse(req.params);
    res.json(
      await acceptFollowUpSuggestion(
        companyId,
        id,
        acceptSuggestionSchema.parse(req.body),
        currentAccount(req).id,
      ),
    );
  }),
);
followUpsRouter.post(
  '/suggestions/:id/dismiss',
  asyncHandler(async (req, res) => {
    const { companyId, id } = recordParamsSchema.parse(req.params);
    await dismissFollowUpSuggestion(companyId, id);
    res.status(204).send();
  }),
);
followUpsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { companyId, id } = recordParamsSchema.parse(req.params);
    const body = followUpUpdateSchema.parse(req.body);
    res.json(await updateFollowUp(companyId, id, body.revision, body.task, currentAccount(req).id));
  }),
);
followUpsRouter.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const { companyId, id } = recordParamsSchema.parse(req.params);
    const body = followUpStatusSchema.parse(req.body);
    res.json(
      await changeFollowUpStatus(companyId, id, body.revision, body.status, currentAccount(req).id),
    );
  }),
);
