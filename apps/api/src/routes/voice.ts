import { Router } from 'express';
import twilio from 'twilio';
import { z } from 'zod';

import { env } from '../env.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { twilioVoiceSchema, twilioVoiceStatusSchema } from '../schemas/twilio.schema.js';
import { getCompanyByTwilioNumber } from '../services/company.service.js';
import { isMissedDialStatus } from '../services/dial-status.service.js';
import { persistCommunicationEvent } from '../services/communication.service.js';
import { validateTwilioSignature } from '../services/twilio.service.js';

export const voiceRouter = Router();

const voiceStatusQuerySchema = z.object({
  companySlug: z.string().min(1),
});

voiceRouter.post(
  '/voice',
  asyncHandler(async (req, res) => {
    if (!validateTwilioSignature(req)) {
      res.status(403).send('Invalid Twilio signature');
      return;
    }

    const parsed = twilioVoiceSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).send('Invalid Twilio voice payload');
      return;
    }

    const company = await getCompanyByTwilioNumber(parsed.data.To);

    if (!company) {
      res.status(404).send('No company configured for this Twilio number');
      return;
    }
    if (!company.forwardToPhoneNumber) {
      res.status(503).send('Phone forwarding is not configured for this business');
      return;
    }

    const response = new twilio.twiml.VoiceResponse();
    response.say('Please hold while we connect your call.');
    response.dial(
      {
        timeout: 12,
        action: `${env.API_BASE_URL}/webhooks/twilio/voice/status?companySlug=${encodeURIComponent(company.slug)}`,
        method: 'POST',
      },
      company.forwardToPhoneNumber,
    );

    res.type('text/xml').send(response.toString());
  }),
);

voiceRouter.post(
  '/voice/status',
  asyncHandler(async (req, res) => {
    if (!validateTwilioSignature(req)) {
      res.status(403).send('Invalid Twilio signature');
      return;
    }

    const parsed = twilioVoiceStatusSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).send('Invalid Twilio voice status payload');
      return;
    }

    const parsedQuery = voiceStatusQuerySchema.safeParse(req.query);

    if (!parsedQuery.success) {
      res.status(400).send('Missing company identifier');
      return;
    }

    const company = await getCompanyByTwilioNumber(parsed.data.To);

    if (!company || company.slug !== parsedQuery.data.companySlug) {
      res.status(404).send('Company not found');
      return;
    }

    const { CallSid, DialCallStatus, From } = parsed.data;

    if (isMissedDialStatus(DialCallStatus)) {
      await persistCommunicationEvent({
        companyId: company.id,
        eventType: 'VOICE_STATUS',
        providerId: CallSid,
        from: From,
        to: parsed.data.To,
      });
    }

    const response = new twilio.twiml.VoiceResponse();
    res.type('text/xml').send(response.toString());
  }),
);
