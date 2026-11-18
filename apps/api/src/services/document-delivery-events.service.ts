import { prisma } from '@lead-recovery/database';
import { Webhook } from 'svix';
import { z } from 'zod';

import { HttpError } from '../middleware/error-handler.js';

const eventSchema = z.object({
  type: z.string().min(1),
  created_at: z.string().datetime({ offset: true }),
  data: z.object({ email_id: z.string().min(1) }),
});
const recordedTypes = new Set([
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.failed',
  'email.suppressed',
]);

export function verifyResendEvent(
  rawBody: Buffer,
  headers: { id: string; timestamp: string; signature: string },
  secret: string,
): unknown {
  const webhook = new Webhook(secret);
  try {
    return webhook.verify(rawBody.toString('utf8'), {
      'svix-id': headers.id,
      'svix-timestamp': headers.timestamp,
      'svix-signature': headers.signature,
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new HttpError(403, 'Invalid email-provider webhook signature.');
  }
}

export async function recordResendEvent(eventId: string, input: unknown): Promise<void> {
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, 'Invalid email-provider event.');
  const event = parsed.data;
  if (!recordedTypes.has(event.type)) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`resend-document:${event.data.email_id}`}))`;
    const delivery = await tx.documentDelivery.findUnique({
      where: { providerId: event.data.email_id },
      select: { id: true },
    });
    const previous = await tx.documentDeliveryEvent.findUnique({ where: { id: eventId } });
    if (previous) {
      if (
        previous.providerId !== event.data.email_id ||
        previous.type !== event.type ||
        previous.occurredAt.toISOString() !== new Date(event.created_at).toISOString()
      ) {
        throw new HttpError(409, 'This provider event ID was already used with different details.');
      }
      return;
    }
    await tx.documentDeliveryEvent.create({
      data: {
        id: eventId,
        providerId: event.data.email_id,
        deliveryId: delivery?.id,
        type: event.type,
        occurredAt: new Date(event.created_at),
      },
    });
  });
}
