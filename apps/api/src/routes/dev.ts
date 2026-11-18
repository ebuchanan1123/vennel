/**
 * Development-only endpoints.
 * This router is mounted only when NODE_ENV === 'development'.
 * Never expose these routes in production.
 */
import { Router } from 'express';
import { z } from 'zod';

import { asyncHandler } from '../middleware/async-handler.js';
import { getCompanyByTwilioNumber } from '../services/company.service.js';
import { deleteLeadsByPhone } from '../services/lead.service.js';
import { authorizeBusiness } from '../middleware/account-access.js';

export const devRouter = Router();

const resetSchema = z.object({
  phone: z.string().min(1),
  twilioNumber: z.string().min(1),
});

/**
 * DELETE /dev/leads
 * Body: { phone: string, twilioNumber: string }
 *
 * Hard-deletes all leads (and their messages) for a phone number under the
 * company that owns the given Twilio number. Useful for resetting between
 * manual test runs without touching the database directly.
 */
devRouter.delete(
  '/leads',
  asyncHandler(async (req, res) => {
    const parsed = resetSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'phone and twilioNumber are required' });
      return;
    }

    const { phone, twilioNumber } = parsed.data;

    const company = await getCompanyByTwilioNumber(twilioNumber);
    if (!company) {
      res.status(404).json({ error: 'No company found for that Twilio number' });
      return;
    }

    await authorizeBusiness(req, company.id, 'SETTINGS');
    const deleted = await deleteLeadsByPhone(company.id, phone);
    res.json({ deleted, phone, company: company.slug });
  }),
);
