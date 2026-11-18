import { prisma } from '@lead-recovery/database';
import {
  NOTE_INFORMATION_FIELDS,
  type DocumentContext,
  type DocumentPreparationInput,
} from '@lead-recovery/types';
import type { Prisma } from '@prisma/client';

import { HttpError } from '../middleware/error-handler.js';
import { noteExtractionSchema } from '../schemas/call-note.schema.js';

type ContextInput = Pick<DocumentPreparationInput, 'customerId' | 'leadId' | 'callNoteId'>;
export type EstimateEvidence = { kind: 'CALL_NOTE' | 'SMS'; id: string; text: string };

export async function loadDocumentContext(
  companyId: string,
  input: ContextInput,
  db: Prisma.TransactionClient = prisma,
): Promise<DocumentContext> {
  let note;
  if (input.callNoteId) {
    note = await db.callNote.findFirst({
      where: { id: input.callNoteId, companyId, isArchived: false, reviewStatus: 'REVIEWED' },
    });
    if (!note || !note.reviewedAt || !note.confirmedData)
      throw new HttpError(404, 'A reviewed call note was not found in this business.');
  }
  if (input.leadId && note?.leadId && input.leadId !== note.leadId)
    throw new HttpError(400, 'The call note belongs to a different lead.');
  if (input.customerId && note?.customerId && input.customerId !== note.customerId)
    throw new HttpError(400, 'The call note belongs to a different customer.');
  const leadId = input.leadId ?? note?.leadId;
  const lead = leadId
    ? await db.lead.findFirst({
        where: { id: leadId, companyId },
        include: {
          messages: {
            where: { direction: 'INBOUND' },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 30,
          },
        },
      })
    : null;
  if (leadId && !lead) throw new HttpError(404, 'Lead not found in this business.');
  const customerId = input.customerId ?? note?.customerId ?? lead?.customerId;
  if (customerId && lead?.customerId && customerId !== lead.customerId)
    throw new HttpError(400, 'Choose the customer linked to this lead.');
  const customer = customerId
    ? await db.customer.findFirst({ where: { id: customerId, companyId, isArchived: false } })
    : null;
  if (customerId && !customer)
    throw new HttpError(404, 'Active customer not found in this business.');
  const notes = note
    ? [note]
    : lead
      ? await db.callNote.findMany({
          where: {
            companyId,
            leadId: lead.id,
            isArchived: false,
            reviewStatus: 'REVIEWED',
            ...(customerId ? { customerId } : {}),
          },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: 5,
        })
      : [];
  return {
    version: 1,
    customer: customer
      ? {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          address: customer.address,
          updatedAt: customer.updatedAt.toISOString(),
        }
      : null,
    lead: lead
      ? {
          id: lead.id,
          updatedAt: lead.updatedAt.toISOString(),
          status: lead.status,
          needsHuman: lead.needsHuman,
          outcome: lead.outcome,
          completedAt: lead.completedAt?.toISOString() ?? null,
        }
      : null,
    notes: notes.map((entry) => {
      if (!entry.reviewedAt) throw new Error('Reviewed call-note metadata is incomplete.');
      const parsed = noteExtractionSchema.safeParse(entry.confirmedData);
      if (!parsed.success) throw new Error('Confirmed call-note information is invalid.');
      const selected = new Set(entry.confirmedFields);
      const information = parsed.data;
      return {
        id: entry.id,
        revision: entry.revision,
        reviewedAt: entry.reviewedAt.toISOString(),
        facts: NOTE_INFORMATION_FIELDS.flatMap((field) => {
          const value = information.facts[field].value;
          return selected.has(field) && value !== null ? [{ field, value }] : [];
        }),
        summary: selected.has('summary') && information.summary ? information.summary : null,
        price: selected.has('price')
          ? {
              amount: information.price.amount,
              currency: information.price.currency,
              state: information.price.state,
            }
          : null,
        appointment: selected.has('appointment')
          ? {
              text: information.appointment.text,
              startsAt: information.appointment.startsAt,
              state: information.appointment.state,
            }
          : null,
        materials: selected.has('materials')
          ? information.materials.map((material) => material.text)
          : [],
      };
    }),
    messages: (lead?.messages ?? [])
      .map((message) => ({
        id: message.id,
        body: message.body,
        createdAt: message.createdAt.toISOString(),
      }))
      .reverse(),
  };
}

export function estimateEvidence(context: DocumentContext): EstimateEvidence[] {
  return [
    ...context.notes.flatMap((note) => [
      ...note.facts
        .filter((fact) => ['serviceType', 'issue', 'projectType'].includes(fact.field))
        .map((fact) => ({ kind: 'CALL_NOTE' as const, id: note.id, text: String(fact.value) })),
      ...(note.summary ? [{ kind: 'CALL_NOTE' as const, id: note.id, text: note.summary }] : []),
    ]),
    ...context.messages.map((message) => ({
      kind: 'SMS' as const,
      id: message.id,
      text: message.body,
    })),
  ];
}
