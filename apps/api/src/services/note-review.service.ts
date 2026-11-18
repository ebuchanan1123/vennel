import { prisma } from '@lead-recovery/database';
import {
  NOTE_INFORMATION_FIELDS,
  NOTE_FIELD_FACTS,
  type CallNote,
  type CallNoteExtraction,
  type CallNoteReviewInput,
  type ConfirmationField,
  type NoteFactKey,
} from '@lead-recovery/types';
import type { Customer, Lead } from '@prisma/client';

import { HttpError } from '../middleware/error-handler.js';
import { customerBodySchema } from '../schemas/workspace.schema.js';
import { callNoteInclude, callNoteRecord, serializeCallNote } from './call-note.service.js';
import { createFollowUp } from './follow-up.service.js';
import { historyScope } from './history-scope.service.js';
import { blankNoteExtraction } from './note-extraction.service.js';

const customerFields = {
  'customer.name': 'name',
  'customer.phone': 'phone',
  'customer.email': 'email',
  'customer.address': 'address',
} as const;
const leadFields = {
  'lead.serviceType': 'serviceType',
  'lead.issue': 'issue',
  'lead.location': 'location',
  'lead.urgency': 'urgency',
  'lead.preferredTime': 'preferredTime',
  'lead.projectType': 'projectType',
  'lead.budgetRange': 'budgetRange',
  'lead.timeline': 'timeline',
  'lead.propertyOwner': 'propertyOwner',
  'lead.summary': 'summary',
} as const;
function isCustomerField(field: ConfirmationField): field is keyof typeof customerFields {
  return field.startsWith('customer.');
}
function isLeadField(field: ConfirmationField): field is keyof typeof leadFields {
  return field.startsWith('lead.');
}

export function confirmedExtraction(
  extraction: CallNoteExtraction,
  accepted: NoteFactKey[],
): CallNoteExtraction {
  const result = blankNoteExtraction();
  const selected = new Set(accepted);
  for (const key of NOTE_INFORMATION_FIELDS) {
    if (selected.has(key)) Object.assign(result.facts, { [key]: extraction.facts[key] });
  }
  if (selected.has('price')) result.price = extraction.price;
  if (selected.has('appointment')) result.appointment = extraction.appointment;
  if (selected.has('materials')) result.materials = extraction.materials;
  if (selected.has('summary')) result.summary = extraction.summary;
  result.missingInformation = extraction.missingInformation;
  return result;
}

export async function reviewCallNote(
  companyId: string,
  id: string,
  input: CallNoteReviewInput,
  actorId = 'system',
): Promise<CallNote> {
  return prisma.$transaction(async (tx) => {
    const note = await callNoteRecord(companyId, id, tx);
    if (note.revision !== input.revision || note.isArchived || note.reviewStatus === 'REVIEWED') {
      throw new HttpError(
        409,
        'This note was already reviewed or changed. Refresh before confirming.',
      );
    }
    if (note.extraction && note.extractionRevision !== note.revision)
      throw new HttpError(409, 'Analyze the current note version before applying AI suggestions.');
    const created = input.newCustomer
      ? await tx.customer.create({
          data: { ...customerBodySchema.parse(input.newCustomer), companyId },
        })
      : null;
    const customerId = created?.id ?? input.customerId;
    if (!customerId) throw new HttpError(400, 'Choose a customer for this reviewed note.');
    const { customer, lead } = await historyScope(tx, companyId, {
      customerId,
      leadId: input.leadId,
    });
    if (!customer) throw new HttpError(404, 'Customer not found.');
    if (
      (note.customerId && note.customerId !== customerId) ||
      (note.leadId && note.leadId !== input.leadId)
    ) {
      throw new HttpError(
        400,
        'Keep the existing customer and lead association when reviewing this note.',
      );
    }
    const accepted = new Set(input.acceptFacts);
    for (const field of input.applyFields) {
      if (!accepted.has(NOTE_FIELD_FACTS[field]))
        throw new HttpError(400, 'Confirm a fact before applying it to a record.');
    }
    if (input.replaceFields.some((field) => !input.applyFields.includes(field))) {
      throw new HttpError(400, 'Replacement approvals must correspond to selected record updates.');
    }
    const confirmed = confirmedExtraction(input.confirmed, input.acceptFacts);
    const customerUpdates: Partial<Pick<Customer, 'name' | 'phone' | 'email' | 'address'>> = {};
    const leadUpdates: Partial<
      Pick<
        Lead,
        | 'customerId'
        | 'serviceType'
        | 'issue'
        | 'location'
        | 'urgency'
        | 'preferredTime'
        | 'projectType'
        | 'budgetRange'
        | 'timeline'
        | 'propertyOwner'
        | 'summary'
      >
    > = {};
    const proposedCustomer = {
      name: confirmed.facts.customerName.value,
      phone: confirmed.facts.phone.value
        ? customerBodySchema.shape.phone.parse(confirmed.facts.phone.value)
        : null,
      email: confirmed.facts.email.value
        ? customerBodySchema.shape.email.parse(confirmed.facts.email.value)
        : null,
      address: confirmed.facts.location.value,
    };
    const proposedLead = {
      serviceType: confirmed.facts.serviceType.value,
      issue: confirmed.facts.issue.value,
      location: confirmed.facts.location.value,
      urgency: confirmed.facts.urgency.value,
      preferredTime: confirmed.facts.preferredTime.value,
      projectType: confirmed.facts.projectType.value,
      budgetRange: confirmed.facts.budgetRange.value,
      timeline: confirmed.facts.timeline.value,
      propertyOwner: confirmed.facts.propertyOwner.value,
      summary: confirmed.summary || null,
    };
    for (const field of input.applyFields) {
      if (isCustomerField(field)) {
        const key = customerFields[field];
        const value = proposedCustomer[key];
        if (value === null)
          throw new HttpError(400, 'Unknown information cannot clear a confirmed customer field.');
        if (
          customer[key] !== null &&
          customer[key] !== '' &&
          customer[key] !== value &&
          !input.replaceFields.includes(field)
        ) {
          throw new HttpError(
            409,
            `Explicitly approve replacing the existing ${key} before saving.`,
          );
        }
        Object.assign(customerUpdates, { [key]: value });
      } else if (isLeadField(field)) {
        if (!lead)
          throw new HttpError(
            400,
            'Select a lead before updating lead information. Facts can still be confirmed on the note.',
          );
        const key = leadFields[field];
        const value = proposedLead[key];
        if (value === null)
          throw new HttpError(400, 'Unknown information cannot clear a confirmed lead field.');
        if (
          lead[key] !== null &&
          lead[key] !== '' &&
          lead[key] !== value &&
          !input.replaceFields.includes(field)
        ) {
          throw new HttpError(409, `Explicitly approve replacing the existing lead ${key}.`);
        }
        Object.assign(leadUpdates, { [key]: value });
      }
    }
    if (Object.keys(customerUpdates).length > 0) {
      if (!created && customer.updatedAt.toISOString() !== input.expectedCustomerUpdatedAt)
        throw new HttpError(
          409,
          'Customer information changed. Reload the current values before confirming.',
        );
      const updated = await tx.customer.updateMany({
        where: { id: customerId, companyId, updatedAt: customer.updatedAt },
        data: customerUpdates,
      });
      if (updated.count !== 1)
        throw new HttpError(409, 'Customer information changed during review.');
    }
    if (lead && !lead.customerId) leadUpdates.customerId = customerId;
    if (lead && Object.keys(leadUpdates).length > 0) {
      if (lead.updatedAt.toISOString() !== input.expectedLeadUpdatedAt)
        throw new HttpError(409, 'Lead information changed. Reload before confirming.');
      const updated = await tx.lead.updateMany({
        where: { id: lead.id, companyId, updatedAt: lead.updatedAt },
        data: leadUpdates,
      });
      if (updated.count !== 1) throw new HttpError(409, 'Lead information changed during review.');
    }
    const updated = await tx.callNote.updateMany({
      where: { id, companyId, revision: input.revision, isArchived: false },
      data: {
        customerId,
        leadId: input.leadId,
        confirmedData: confirmed,
        confirmedFields: input.acceptFacts,
        reviewStatus: 'REVIEWED',
        reviewedAt: new Date(),
        revision: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new HttpError(409, 'The note changed during review.');
    for (let index = 0; index < input.confirmed.actions.length; index += 1) {
      const action = input.confirmed.actions[index];
      if (!action) continue;
      const acceptedAction = input.acceptedActions.find((selection) => selection.index === index);
      const source = note.extraction ? 'AI' : 'MANUAL';
      const suggestion = await tx.followUpSuggestion.upsert({
        where: {
          companyId_sourceKey: { companyId, sourceKey: `note:${id}:${note.revision}:${index}` },
        },
        create: {
          companyId,
          customerId,
          leadId: input.leadId,
          callNoteId: id,
          sourceKey: `note:${id}:${note.revision}:${index}`,
          ...action,
          dueAt: action.dueAt ? new Date(action.dueAt) : null,
          source,
          status: acceptedAction ? 'ACCEPTED' : 'PENDING',
          reviewedAt: acceptedAction ? new Date() : null,
        },
        update: {},
      });
      if (acceptedAction) {
        await createFollowUp(
          companyId,
          {
            customerId,
            leadId: input.leadId,
            callNoteId: id,
            type: action.type,
            title: action.title,
            dueAt: acceptedAction.dueAt,
            priority: action.priority,
            notes: action.evidence,
          },
          actorId,
          tx,
          source,
          suggestion.id,
        );
      }
    }
    if (input.acceptedActions.some((selection) => !input.confirmed.actions[selection.index])) {
      throw new HttpError(400, 'An accepted action does not exist in this review.');
    }
    await tx.callNoteAudit.create({
      data: {
        noteId: id,
        revision: input.revision + 1,
        action: note.extraction ? 'AI_REVIEWED' : 'MANUALLY_REVIEWED',
        actor: actorId,
        details: {
          acceptedFacts: input.acceptFacts,
          applyFields: input.applyFields,
          replaceFields: input.replaceFields,
          ownerReviewedInformation: input.confirmed,
          customerBefore: {
            name: customer.name,
            phone: customer.phone,
            email: customer.email,
            address: customer.address,
          },
          leadBefore: lead
            ? {
                customerId: lead.customerId,
                serviceType: lead.serviceType,
                issue: lead.issue,
                location: lead.location,
                urgency: lead.urgency,
                preferredTime: lead.preferredTime,
                projectType: lead.projectType,
                budgetRange: lead.budgetRange,
                timeline: lead.timeline,
                propertyOwner: lead.propertyOwner,
                summary: lead.summary,
                updatedAt: lead.updatedAt.toISOString(),
              }
            : null,
          customerUpdates,
          leadUpdates,
          acceptedActions: input.acceptedActions,
        },
      },
    });
    return serializeCallNote(
      await tx.callNote.findUniqueOrThrow({ where: { id }, include: callNoteInclude }),
    );
  });
}
