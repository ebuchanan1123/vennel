import type { Prisma } from '@prisma/client';

import { HttpError } from '../middleware/error-handler.js';

export async function historyScope(
  db: Prisma.TransactionClient,
  companyId: string,
  input: { customerId: string | null; leadId: string | null; callNoteId?: string | null; assignedUserId?: string | null },
) {
  if (input.assignedUserId) {
    const member = await db.businessMembership.findUnique({ where: { companyId_userId: { companyId, userId: input.assignedUserId } } });
    if (!member) throw new HttpError(400, 'Assign follow-ups only to current members of this business.');
  }
  const customer = input.customerId
    ? await db.customer.findFirst({ where: { id: input.customerId, companyId, isArchived: false } })
    : null;
  if (input.customerId && !customer)
    throw new HttpError(404, 'Active customer not found in this business.');
  const lead = input.leadId
    ? await db.lead.findFirst({ where: { id: input.leadId, companyId } })
    : null;
  if (input.leadId && !lead) throw new HttpError(404, 'Lead not found in this business.');
  if (lead?.customerId && customer && lead.customerId !== customer.id) {
    throw new HttpError(400, 'Use the customer linked to this lead.');
  }
  if (input.callNoteId) {
    const note = await db.callNote.findFirst({
      where: { id: input.callNoteId, companyId, isArchived: false },
    });
    if (!note) throw new HttpError(404, 'Call note not found in this business.');
    if (customer && note.customerId !== customer.id)
      throw new HttpError(400, 'Use the customer associated with the call note.');
    if (lead && note.leadId && note.leadId !== lead.id)
      throw new HttpError(400, 'Use the lead associated with the call note.');
  }
  return { customer, lead };
}
