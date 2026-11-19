import { prisma } from '@lead-recovery/database';
import { createHash, randomUUID } from 'node:crypto';
import {
  calculateDocumentTotals,
  type AiDraft,
  type BillingDocument,
  type CustomerSnapshot,
  type DocumentInput,
  type DocumentPreparationInput,
} from '@lead-recovery/types';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { HttpError } from '../middleware/error-handler.js';
import { suggestConversationServices } from './billing-suggestion.service.js';
import { customerInclude, serializeCustomer } from './customer.service.js';
import {
  businessBillingProfileSchema,
  documentContextSchema,
} from '../schemas/document-context.schema.js';
import { estimateEvidence, loadDocumentContext } from './document-context.service.js';
import { servicePricingSchema } from '../schemas/workspace.schema.js';

export const documentInclude = {
  company: { select: { name: true } },
  customer: { include: customerInclude },
  items: { orderBy: { position: 'asc' } },
  invoice: { select: { id: true } },
} satisfies Prisma.BillingDocumentInclude;

type DocumentRecord = Prisma.BillingDocumentGetPayload<{ include: typeof documentInclude }>;

const aiDraftSchema: z.ZodType<AiDraft, unknown> = z.object({
  createdAt: z.string(),
  missingDetails: z.array(z.string()),
  matches: z.array(
    z.object({
      serviceId: z.string(),
      description: z.string(),
      unit: z.string().optional(),
      unitPrice: z.number().nullable(),
      catalogPricing: servicePricingSchema.optional(),
      evidence: z.string(),
      source: z.object({ kind: z.enum(['CALL_NOTE', 'SMS']), id: z.string() }).optional(),
    }),
  ),
});
const snapshotSchema: z.ZodType<CustomerSnapshot> = z.object({
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
});

function storedJson<T>(value: Prisma.JsonValue | null, schema: z.ZodType<T, unknown>): T | null {
  if (value === null) return null;
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error('Stored billing document data failed validation.');
  return parsed.data;
}

export function serializeDocument(document: DocumentRecord): BillingDocument {
  const items = document.items.map((item) => ({
    id: item.id,
    serviceId: item.serviceId,
    description: item.description,
    unit: item.unit,
    quantity: Number(item.quantity),
    unitPrice: item.unitPrice === null ? null : Number(item.unitPrice),
    suggestionReason: item.suggestionReason,
  }));
  const totals = calculateDocumentTotals(
    items,
    Number(document.discountAmount),
    Number(document.taxRate),
  );
  if (document.status === 'FINALIZED' && totals === null)
    throw new Error('A finalized document is missing approved exact prices.');
  return {
    id: document.id,
    companyId: document.companyId,
    customerId: document.customerId,
    leadId: document.leadId,
    kind: document.kind,
    status: document.status,
    number: document.number,
    revision: document.revision,
    title: document.title,
    currency: document.currency,
    notes: document.notes,
    dueDate: document.dueDate?.toISOString().slice(0, 10) ?? null,
    discountAmount: Number(document.discountAmount),
    taxRate: Number(document.taxRate),
    aiDraft: storedJson(document.aiDraft, aiDraftSchema),
    customerSnapshot: storedJson(document.customerSnapshot, snapshotSchema),
    businessName: document.businessName ?? document.company.name,
    billingProfile: storedJson(document.billingProfile, businessBillingProfileSchema),
    finalizedAt: document.finalizedAt?.toISOString() ?? null,
    finalizedBy: document.finalizedBy,
    sourceEstimateId: document.sourceEstimateId,
    callNoteId: document.callNoteId,
    context: storedJson(document.contextSnapshot, documentContextSchema),
    invoiceId: document.invoice?.id ?? null,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    customer: document.customer ? serializeCustomer(document.customer) : null,
    items,
    totals,
  };
}

export async function documentRecord(
  companyId: string,
  id: string,
  db: Prisma.TransactionClient = prisma,
) {
  const document = await db.billingDocument.findFirst({
    where: { id, companyId },
    include: documentInclude,
  });
  if (!document) throw new HttpError(404, 'Document not found in this workspace.');
  return document;
}

export async function listDocuments(companyId: string): Promise<BillingDocument[]> {
  const documents = await prisma.billingDocument.findMany({
    where: { companyId },
    include: documentInclude,
    orderBy: { updatedAt: 'desc' },
  });
  return documents.map(serializeDocument);
}

export async function getDocument(companyId: string, id: string): Promise<BillingDocument> {
  return serializeDocument(await documentRecord(companyId, id));
}

async function validateReferences(
  db: Prisma.TransactionClient,
  companyId: string,
  input: Pick<DocumentInput, 'customerId' | 'leadId'> & { items: { serviceId?: string | null }[] },
  existing?: DocumentRecord,
): Promise<void> {
  if (input.customerId) {
    const customer = await db.customer.findFirst({ where: { id: input.customerId, companyId } });
    if (!customer || (customer.isArchived && input.customerId !== existing?.customerId)) {
      throw new HttpError(400, 'Choose an active customer from this workspace.');
    }
  }
  if (input.leadId) {
    const lead = await db.lead.findFirst({ where: { id: input.leadId, companyId } });
    if (!lead) throw new HttpError(400, 'Choose a lead from this workspace.');
    if (lead.customerId && input.customerId && lead.customerId !== input.customerId) {
      throw new HttpError(400, 'This document must use the customer linked to its lead.');
    }
    if (existing?.callNoteId) {
      const note = await db.callNote.findFirst({ where: { id: existing.callNoteId, companyId } });
      if (!note || (input.customerId && note.customerId !== input.customerId)) {
        throw new HttpError(400, 'Use the customer associated with the source call note.');
      }
    }
  }
  const serviceIds = [
    ...new Set(input.items.flatMap((item) => (item.serviceId ? [item.serviceId] : []))),
  ];
  if (serviceIds.length > 0) {
    const services = await db.catalogService.findMany({
      where: { companyId, id: { in: serviceIds } },
    });
    for (const id of serviceIds) {
      const service = services.find((entry) => entry.id === id);
      const wasAlreadyUsed = existing?.items.some((item) => item.serviceId === id);
      if (!service || (!service.isActive && !wasAlreadyUsed)) {
        throw new HttpError(400, 'Line items must use active services from this workspace.');
      }
    }
  }
}

function documentData(input: DocumentInput) {
  return {
    title: input.title,
    customerId: input.customerId,
    leadId: input.leadId ?? null,
    notes: input.notes,
    dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : null,
    discountAmount: input.discountAmount,
    taxRate: input.taxRate,
  };
}

export async function createDocument(
  companyId: string,
  input: DocumentInput,
): Promise<BillingDocument> {
  return prisma.$transaction(async (tx) => {
    await validateReferences(tx, companyId, input);
    await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${companyId} FOR UPDATE`;
    const company = await tx.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { currency: true },
    });
    const document = await tx.billingDocument.create({
      data: {
        ...documentData(input),
        companyId,
        kind: input.kind,
        currency: company.currency,
        items: { create: input.items.map((item, position) => ({ ...item, position })) },
      },
      include: documentInclude,
    });
    return serializeDocument(document);
  });
}

export async function updateDocument(
  companyId: string,
  id: string,
  revision: number,
  input: DocumentInput,
): Promise<BillingDocument> {
  return prisma.$transaction(async (tx) => {
    const existing = await documentRecord(companyId, id, tx);
    if (existing.status !== 'DRAFT')
      throw new HttpError(409, 'Finalized documents cannot be edited.');
    if (existing.revision !== revision)
      throw new HttpError(409, 'This draft changed in another tab. Refresh before saving.');
    if (input.kind !== existing.kind || (input.leadId ?? null) !== existing.leadId) {
      throw new HttpError(400, 'A document cannot change its type or original lead.');
    }
    await validateReferences(tx, companyId, input, existing);
    const updated = await tx.billingDocument.updateMany({
      where: { id, companyId, status: 'DRAFT', revision },
      data: { ...documentData(input), revision: { increment: 1 } },
    });
    if (updated.count !== 1)
      throw new HttpError(409, 'This draft changed in another tab. Refresh before saving.');
    await tx.documentItem.deleteMany({ where: { documentId: id } });
    if (input.items.length > 0) {
      await tx.documentItem.createMany({
        data: input.items.map((item, position) => ({
          ...item,
          documentId: id,
          position,
          suggestionReason: item.serviceId
            ? (existing.items.find((original) => original.serviceId === item.serviceId)
                ?.suggestionReason ?? null)
            : null,
        })),
      });
    }
    return serializeDocument(await documentRecord(companyId, id, tx));
  });
}

export async function finalizeDocument(
  companyId: string,
  id: string,
  revision: number,
  actorId = 'system',
): Promise<BillingDocument> {
  return prisma.$transaction(async (tx) => {
    const existing = await documentRecord(companyId, id, tx);
    if (existing.status !== 'DRAFT' || existing.revision !== revision) {
      throw new HttpError(
        409,
        'This document has changed or was already finalized. Refresh before approving.',
      );
    }
    if (!existing.customer || existing.customer.isArchived) {
      throw new HttpError(400, 'Choose an active customer before finalizing this document.');
    }
    if (existing.items.length === 0)
      throw new HttpError(400, 'Add at least one line item before finalizing.');
    if (existing.items.some((item) => !item.unit?.trim())) {
      throw new HttpError(400, 'Confirm a pricing unit for every line item before finalizing.');
    }
    if (existing.items.some((item) => item.unitPrice === null))
      throw new HttpError(
        400,
        'Enter an exact price for every line item before finalizing this document.',
      );
    await validateReferences(tx, companyId, existing, existing);
    const view = serializeDocument(existing);
    calculateDocumentTotals(view.items, view.discountAmount, view.taxRate);
    const company = await tx.company.update({
      where: { id: companyId },
      data: { nextDocumentNumber: { increment: 1 } },
    });
    const number = `${existing.kind === 'ESTIMATE' ? 'EST' : 'INV'}-${String(company.nextDocumentNumber - 1).padStart(5, '0')}`;
    const customer = existing.customer;
    const updated = await tx.billingDocument.updateMany({
      where: { id, companyId, status: 'DRAFT', revision },
      data: {
        status: 'FINALIZED',
        revision: { increment: 1 },
        number,
        finalizedAt: new Date(),
        finalizedBy: actorId,
        businessName: company.name,
        billingProfile: {
          email: company.businessEmail ?? null,
          phone: company.businessPhone ?? null,
          address: company.billingAddress ?? null,
          taxRegistrationNumber: company.taxRegistrationNumber ?? null,
        },
        customerSnapshot: {
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          address: customer.address,
        },
      },
    });
    if (updated.count !== 1)
      throw new HttpError(409, 'This document changed while being approved. Please refresh.');
    return serializeDocument(await documentRecord(companyId, id, tx));
  });
}

export async function convertEstimate(companyId: string, id: string): Promise<BillingDocument> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<
      { id: string }[]
    >`SELECT "id" FROM "BillingDocument" WHERE "id" = ${id} AND "companyId" = ${companyId} FOR UPDATE`;
    if (!locked.length) throw new HttpError(404, 'Estimate not found in this workspace.');
    const source = await documentRecord(companyId, id, tx);
    if (source.kind !== 'ESTIMATE' || source.status !== 'FINALIZED') {
      throw new HttpError(400, 'Only a finalized estimate can be converted to an invoice.');
    }
    if (source.invoice)
      return serializeDocument(await documentRecord(companyId, source.invoice.id, tx));
    const invoice = await tx.billingDocument.create({
      data: {
        companyId,
        customerId: source.customerId,
        leadId: source.leadId,
        kind: 'INVOICE',
        title: source.title,
        currency: source.currency,
        notes: source.notes,
        discountAmount: source.discountAmount,
        taxRate: source.taxRate,
        sourceEstimateId: source.id,
        callNoteId: source.callNoteId,
        contextSnapshot: source.contextSnapshot ?? Prisma.JsonNull,
        aiDraft: source.aiDraft ?? Prisma.JsonNull,
        items: {
          create: source.items.map((item, position) => ({
            serviceId: item.serviceId,
            description: item.description,
            unit: item.unit,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            suggestionReason: item.suggestionReason,
            position,
          })),
        },
      },
      include: documentInclude,
    });
    return serializeDocument(invoice);
  });
}

export async function createConversationEstimate(
  companyId: string,
  leadId: string,
): Promise<BillingDocument> {
  return prepareContextDocument(companyId, {
    leadId,
    kind: 'ESTIMATE',
    useAi: true,
    requestId: randomUUID(),
  });
}

function preparationHash(input: DocumentPreparationInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        customerId: input.customerId ?? null,
        leadId: input.leadId ?? null,
        callNoteId: input.callNoteId ?? null,
        kind: input.kind,
        useAi: input.useAi,
      }),
    )
    .digest('hex');
}

export async function prepareContextDocument(
  companyId: string,
  input: DocumentPreparationInput,
): Promise<BillingDocument> {
  const hash = preparationHash(input);
  const previous = await prisma.billingDocument.findFirst({
    where: { companyId, preparationKey: input.requestId },
    include: documentInclude,
  });
  if (previous) {
    if (previous.preparationHash !== hash)
      throw new HttpError(409, 'This preparation request was already used with different details.');
    return serializeDocument(previous);
  }
  const context = await loadDocumentContext(companyId, input);
  if (
    input.kind === 'INVOICE' &&
    (input.useAi || context.lead?.outcome !== 'WON' || !context.lead.completedAt)
  ) {
    throw new HttpError(
      400,
      'Prepare an invoice from work only after the owner has recorded the job as won/completed. A quoted or agreed price does not confirm completion.',
    );
  }
  if (input.useAi && (context.lead?.needsHuman || context.lead?.status === 'NEEDS_HUMAN')) {
    throw new HttpError(
      400,
      'This lead requires human attention. Review it before preparing an AI estimate.',
    );
  }
  const evidence = estimateEvidence(context);
  const services = input.useAi
    ? await prisma.catalogService.findMany({ where: { companyId, isActive: true } })
    : [];
  const suggestions = input.useAi
    ? await suggestConversationServices(
        services,
        evidence.map((source) => source.text),
        context,
      )
    : null;
  const aiDraft = suggestions
    ? {
        ...suggestions,
        matches: suggestions.matches.map((match) => {
          const source = evidence.find((entry) => entry.text.includes(match.evidence));
          if (!source)
            throw new HttpError(
              502,
              'An AI suggestion had no confirmed source. No document was created.',
            );
          return { ...match, source: { kind: source.kind, id: source.id } };
        }),
        missingDetails: [
          ...suggestions.missingDetails,
          ...(context.notes.some((note) => note.price)
            ? [
                'Note prices retain their proposed/agreed state. Only fixed catalog prices are copied; reconcile quote-required items, ranges and agreed prices manually.',
              ]
            : []),
        ],
      }
    : null;

  try {
    return await prisma.$transaction(async (tx) => {
      const currentContext = await loadDocumentContext(companyId, input, tx);
      if (JSON.stringify(context) !== JSON.stringify(currentContext)) {
        throw new HttpError(
          409,
          'The source information changed while the draft was being prepared. Review it and try again.',
        );
      }
      const currentServices = aiDraft
        ? await tx.catalogService.findMany({
            where: {
              companyId,
              isActive: true,
              id: { in: (aiDraft?.matches ?? []).map((match) => match.serviceId) },
            },
          })
        : [];
      for (const match of aiDraft?.matches ?? []) {
        if (!match.unit)
          throw new HttpError(
            502,
            'AI preparation returned an incomplete pricing basis. No estimate was created.',
          );
        const original = services.find((service) => service.id === match.serviceId);
        const current = currentServices.find((service) => service.id === match.serviceId);
        if (!original || !current || original.updatedAt.getTime() !== current.updatedAt.getTime()) {
          throw new HttpError(
            409,
            'Your service catalog changed during preparation. Generate the estimate again.',
          );
        }
      }
      await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${companyId} FOR UPDATE`;
      const company = await tx.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { currency: true, defaultTaxRate: true },
      });
      const document = await tx.billingDocument.create({
        data: {
          companyId,
          leadId: context.lead?.id ?? null,
          customerId: context.customer?.id ?? null,
          kind: input.kind,
          currency: company.currency,
          taxRate: company.defaultTaxRate,
          title: input.kind === 'ESTIMATE' ? 'Service estimate' : 'Invoice for completed work',
          callNoteId: input.callNoteId ?? null,
          contextSnapshot: context,
          preparationKey: input.requestId,
          preparationHash: hash,
          aiDraft: aiDraft ?? Prisma.JsonNull,
          items: {
            create: (aiDraft?.matches ?? []).map((match, position) => ({
              serviceId: match.serviceId,
              description: match.description,
              unit: match.unit,
              quantity: 1,
              unitPrice: match.unitPrice,
              suggestionReason: match.evidence,
              position,
            })),
          },
        },
        include: documentInclude,
      });
      return serializeDocument(document);
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
      throw error;
    const existing = await prisma.billingDocument.findFirst({
      where: { companyId, preparationKey: input.requestId },
      include: documentInclude,
    });
    if (!existing || existing.preparationHash !== hash) throw error;
    return serializeDocument(existing);
  }
}
