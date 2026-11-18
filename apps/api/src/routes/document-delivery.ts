import { Router } from 'express';
import { z } from 'zod';

import { env } from '../env.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { currentAccount } from '../middleware/account-access.js';
import { HttpError } from '../middleware/error-handler.js';
import {
  documentEmailApprovalSchema,
  documentEmailPreviewSchema,
} from '../schemas/document-context.schema.js';
import { recordParamsSchema } from '../schemas/workspace.schema.js';
import {
  approveDocumentEmail,
  cancelDocumentEmail,
  listDocumentDeliveries,
  previewDocumentEmail,
  retryDocumentEmail,
} from '../services/document-delivery.service.js';
import {
  recordResendEvent,
  verifyResendEvent,
} from '../services/document-delivery-events.service.js';

export const documentDeliveryRouter = Router({ mergeParams: true });
documentDeliveryRouter.get(
  '/:id/deliveries',
  asyncHandler(async (req, res) => {
    const { companyId, id } = recordParamsSchema.parse(req.params);
    res.json(await listDocumentDeliveries(companyId, id));
  }),
);
documentDeliveryRouter.post(
  '/:id/email-preview',
  asyncHandler(async (req, res) => {
    const { companyId, id } = recordParamsSchema.parse(req.params);
    const body = documentEmailPreviewSchema.parse(req.body);
    res.json(await previewDocumentEmail(companyId, id, body.revision, body.recipientEmail));
  }),
);
documentDeliveryRouter.post(
  '/:id/deliveries',
  asyncHandler(async (req, res) => {
    const { companyId, id } = recordParamsSchema.parse(req.params);
    res
      .status(202)
      .json(
        await approveDocumentEmail(
          companyId,
          id,
          documentEmailApprovalSchema.parse(req.body),
          currentAccount(req).id,
        ),
      );
  }),
);
const deliveryParamsSchema = recordParamsSchema.extend({ deliveryId: z.string().min(1) });
documentDeliveryRouter.post(
  '/:id/deliveries/:deliveryId/cancel',
  asyncHandler(async (req, res) => {
    const { companyId, id, deliveryId } = deliveryParamsSchema.parse(req.params);
    res.json(await cancelDocumentEmail(companyId, id, deliveryId));
  }),
);
documentDeliveryRouter.post(
  '/:id/deliveries/:deliveryId/retry',
  asyncHandler(async (req, res) => {
    const { companyId, id, deliveryId } = deliveryParamsSchema.parse(req.params);
    res.json(await retryDocumentEmail(companyId, id, deliveryId));
  }),
);

export const resendWebhookRouter = Router();
resendWebhookRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    if (!env.RESEND_WEBHOOK_SECRET)
      throw new HttpError(503, 'Email delivery webhooks are not configured.');
    if (!Buffer.isBuffer(req.body))
      throw new HttpError(400, 'The webhook requires the original request body.');
    const headers = z
      .object({ id: z.string().min(1), timestamp: z.string().min(1), signature: z.string().min(1) })
      .parse({
        id: req.header('svix-id'),
        timestamp: req.header('svix-timestamp'),
        signature: req.header('svix-signature'),
      });
    const event = verifyResendEvent(req.body, headers, env.RESEND_WEBHOOK_SECRET);
    await recordResendEvent(headers.id, event);
    res.json({ received: true });
  }),
);
