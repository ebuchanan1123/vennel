import { Router } from 'express';
import twilio from 'twilio';
import { z } from 'zod';

import { asyncHandler } from '../middleware/async-handler.js';
import { twilioSmsSchema, twilioSmsStatusSchema } from '../schemas/twilio.schema.js';
import { getCompanyByTwilioNumber } from '../services/company.service.js';
import { persistCommunicationEvent } from '../services/communication.service.js';
import { recordSmsStatus } from '../services/sms-delivery.service.js';
import { validateTwilioSignature } from '../services/twilio.service.js';

export const smsRouter = Router();

smsRouter.post(
  '/sms',
  asyncHandler(async (req, res) => {
    if (!validateTwilioSignature(req)) {
      res.status(403).send('Invalid Twilio signature');
      return;
    }
    const parsed = twilioSmsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).send('Invalid Twilio sms payload');
      return;
    }
    const { Body, From, MessageSid, To } = parsed.data;
    const company = await getCompanyByTwilioNumber(To);
    if (!company) {
      res.status(404).send('No company configured for this Twilio number');
      return;
    }
    await persistCommunicationEvent({
      companyId: company.id,
      eventType: 'SMS_MESSAGE',
      providerId: MessageSid,
      from: From,
      to: To,
      body: Body,
    });
    res.type('text/xml').send(new twilio.twiml.MessagingResponse().toString());
  }),
);

smsRouter.post(
  '/sms/status/:id',
  asyncHandler(async (req, res) => {
    if (!validateTwilioSignature(req)) {
      res.status(403).send('Invalid Twilio signature');
      return;
    }
    const { id } = z.object({ id: z.string().min(1).max(128) }).parse(req.params);
    const data = twilioSmsStatusSchema.parse(req.body);
    await recordSmsStatus(id, {
      providerId: data.MessageSid,
      providerStatus: data.MessageStatus,
      from: data.From,
      to: data.To,
      errorCode: data.ErrorCode,
    });
    res.status(204).send();
  }),
);
