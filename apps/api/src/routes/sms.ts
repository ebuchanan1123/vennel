import { Router } from 'express';
import twilio from 'twilio';
import { LeadSource, LeadStatus, MessageDirection } from '@prisma/client';

import { env } from '../env.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { twilioSmsSchema } from '../schemas/twilio.schema.js';
import { getCompanyByTwilioNumber } from '../services/company.service.js';
import { withConversationLock } from '../services/conversation-lock.service.js';
import { EMERGENCY_ESCALATION_MESSAGE, isEmergencyMessage } from '../services/emergency.service.js';
import {
  IRRELEVANT_MESSAGE_REPLY,
  isIrrelevantMessage,
} from '../services/irrelevant-message.service.js';
import {
  createMessage,
  findOrCreateActiveLead,
  getRecentMessages,
  recordWebhookEventOnce,
  updateLead,
} from '../services/lead.service.js';
import { generateQualificationResponse } from '../services/qualification.service.js';
import { validateTwilioSignature } from '../services/twilio.service.js';

export const smsRouter = Router();

const QUALIFICATION_FALLBACK_MESSAGE =
  "Thanks - I've passed this along to the team, and someone will follow up with you.";
const HARDCODED_TWIML_MESSAGE =
  'SMS webhook received. Reply mode is hardcoded for webhook verification.';

smsRouter.post('/sms', asyncHandler(async (req, res) => {
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

  // Idempotency — dedup Twilio retries before touching lead state.
  const shouldProcess = await recordWebhookEventOnce('SMS_MESSAGE', MessageSid);
  if (!shouldProcess) {
    res.type('text/xml').send(new twilio.twiml.MessagingResponse().toString());
    return;
  }

  // Company lookup doesn't touch per-lead state, so it's safe outside the lock.
  const company = await getCompanyByTwilioNumber(To);
  if (!company) {
    res.status(404).send('No company configured for this Twilio number');
    return;
  }

  // Per-conversation lock: all lead-state reads, AI processing, and DB writes
  // for the same company + customer phone run sequentially so that a second
  // rapid message always sees the DB state committed by the first.
  const lockKey = `${company.id}:${From.replace(/[^\d+]/g, '')}`;
  const twiml = new twilio.twiml.MessagingResponse();
  let replyText = QUALIFICATION_FALLBACK_MESSAGE;

  await withConversationLock(lockKey, async () => {
    // Re-read lead state from DB inside the lock so we always have the latest.
    const lead = await findOrCreateActiveLead(company.id, From, LeadSource.SMS);
    await createMessage(lead.id, MessageDirection.INBOUND, Body);

    // ── Hardcoded verification mode ────────────────────────────────────────
    if (env.TWILIO_SMS_REPLY_MODE === 'hardcoded') {
      await createMessage(lead.id, MessageDirection.OUTBOUND, HARDCODED_TWIML_MESSAGE);
      replyText = HARDCODED_TWIML_MESSAGE;
      return;
    }

    // ── Deterministic emergency escalation (never reaches OpenAI) ─────────
    if (isEmergencyMessage(Body)) {
      await updateLead(lead.id, {
        status: LeadStatus.NEEDS_HUMAN,
        needsHuman: true,
        summary: 'Emergency language detected in SMS conversation.',
      });
      await createMessage(lead.id, MessageDirection.OUTBOUND, EMERGENCY_ESCALATION_MESSAGE);
      replyText = EMERGENCY_ESCALATION_MESSAGE;
      return;
    }

    // ── Deterministic spam/irrelevant filter ───────────────────────────────
    if (isIrrelevantMessage(Body)) {
      await updateLead(lead.id, {
        status: LeadStatus.NEEDS_HUMAN,
        needsHuman: true,
        summary: 'Message appears irrelevant or spam; escalated for human review.',
      });
      await createMessage(lead.id, MessageDirection.OUTBOUND, IRRELEVANT_MESSAGE_REPLY);
      replyText = IRRELEVANT_MESSAGE_REPLY;
      return;
    }

    // ── AI qualification ───────────────────────────────────────────────────
    try {
      const recentMessages = await getRecentMessages(lead.id, 10);
      const qualification = await generateQualificationResponse({
        company,
        lead,
        latestCustomerMessage: Body,
        recentMessages,
      });

      await updateLead(lead.id, {
        status: qualification.status,
        needsHuman: qualification.needsHuman,
        serviceType: qualification.serviceType,
        issue: qualification.issue,
        location: qualification.location,
        urgency: qualification.urgency,
        preferredTime: qualification.preferredTime,
        projectType: qualification.projectType,
        budgetRange: qualification.budgetRange,
        timeline: qualification.timeline,
        propertyOwner: qualification.propertyOwner,
        summary: qualification.summary,
      });

      await createMessage(lead.id, MessageDirection.OUTBOUND, qualification.reply);
      replyText = qualification.reply;
    } catch (error) {
      console.error('Qualification error', error);
      await updateLead(lead.id, { status: LeadStatus.NEEDS_HUMAN, needsHuman: true });
      await createMessage(lead.id, MessageDirection.OUTBOUND, QUALIFICATION_FALLBACK_MESSAGE);
      replyText = QUALIFICATION_FALLBACK_MESSAGE;
    }
  });

  twiml.message(replyText);
  res.type('text/xml').send(twiml.toString());
}));
