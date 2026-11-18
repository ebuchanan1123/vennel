import { prisma } from '@lead-recovery/database';
import { Router } from 'express';

import { asyncHandler } from '../middleware/async-handler.js';
import { HttpError } from '../middleware/error-handler.js';
import {
  conversationDraftSchema,
  customerBodySchema,
  documentBodySchema,
  documentUpdateSchema,
  finalizeBodySchema,
  linkCustomerBodySchema,
  recordParamsSchema,
  serviceBodySchema,
  workspaceParamsSchema,
} from '../schemas/workspace.schema.js';
import {
  convertEstimate,
  createConversationEstimate,
  createDocument,
  documentInclude,
  finalizeDocument,
  getDocument,
  listDocuments,
  serializeDocument,
  updateDocument,
  prepareContextDocument,
} from '../services/billing.service.js';
import { createService, listServices, updateService } from '../services/catalog.service.js';
import {
  createCustomer,
  customerInclude,
  linkLeadCustomer,
  listCustomers,
  serializeCustomer,
  updateCustomer,
} from '../services/customer.service.js';
import { serializeLeadMoney } from '../services/lead.service.js';
import { callNotesRouter } from './call-notes.js';
import { followUpsRouter } from './follow-ups.js';
import { workspaceSettingsRouter } from './notifications.js';
import { callNoteInclude, serializeCallNote } from '../services/call-note.service.js';
import { followUpInclude, serializeFollowUp } from '../services/follow-up.service.js';
import { documentPreparationSchema } from '../schemas/document-context.schema.js';
import { documentDeliveryRouter } from './document-delivery.js';
import { authorizeBusiness, currentAccount } from '../middleware/account-access.js';
import type { BusinessPermission } from '@lead-recovery/types';
import { businessAdminRouter } from './business-admin.js';

export function workspacePermission(method: string, path: string): BusinessPermission {
  if (/^\/(team|invitations)(\/|$)/.test(path)) return 'TEAM';
  if (/^\/(settings|jobs)(\/|$)/.test(path)) return 'SETTINGS';
  if (/^\/onboarding(\/|$)/.test(path)) return 'INTEGRATIONS';
  if (/^\/documents\/[^/]+\/(finalize|deliveries|email-preview)(\/|$)/.test(path))
    return 'APPROVALS';
  if (method === 'GET' || method === 'HEAD') return 'READ';
  if (/^\/services(\/|$)/.test(path)) return 'CATALOG';
  if (/^\/documents(\/|$)/.test(path)) return 'DRAFTS';
  if (/^\/(customers|call-notes|follow-ups)(\/|$)/.test(path)) return 'OPERATIONS';
  return 'SETTINGS';
}

// Workspace IDs scope records, but are not authentication. Keep this API private until auth is implemented.
export const workspaceRouter = Router({ mergeParams: true });

workspaceRouter.use(
  asyncHandler(async (req, _res, next) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    await authorizeBusiness(req, companyId, workspacePermission(req.method, req.path));
    next();
  }),
);
workspaceRouter.get(
  '/info',
  asyncHandler(async (req, res) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { timeZone: true, currency: true },
    });
    res.json({ now: new Date().toISOString(), ...company });
  }),
);

workspaceRouter.use('/call-notes', callNotesRouter);
workspaceRouter.use('/', businessAdminRouter);
workspaceRouter.use('/follow-ups', followUpsRouter);
workspaceRouter.use('/', workspaceSettingsRouter);
workspaceRouter.use('/documents', documentDeliveryRouter);

workspaceRouter.get(
  '/customers',
  asyncHandler(async (req, res) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    res.json(await listCustomers(companyId));
  }),
);

workspaceRouter.post(
  '/customers',
  asyncHandler(async (req, res) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    res.status(201).json(await createCustomer(companyId, customerBodySchema.parse(req.body)));
  }),
);

workspaceRouter.post(
  '/customers/from-lead',
  asyncHandler(async (req, res) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    res.status(201).json(await linkLeadCustomer(companyId, linkCustomerBodySchema.parse(req.body)));
  }),
);

workspaceRouter.get(
  '/customers/:id',
  asyncHandler(async (req, res) => {
    const { companyId, id } = recordParamsSchema.parse(req.params);
    const customer = await prisma.customer.findFirst({
      where: { id, companyId },
      include: {
        ...customerInclude,
        leads: { include: { company: true, customer: true }, orderBy: { createdAt: 'desc' } },
        documents: { include: documentInclude, orderBy: { updatedAt: 'desc' } },
        callNotes: {
          where: { isArchived: false },
          include: callNoteInclude,
          orderBy: { occurredAt: 'desc' },
        },
        followUps: { include: followUpInclude, orderBy: { dueAt: 'asc' } },
      },
    });
    if (!customer) throw new HttpError(404, 'Customer not found in this workspace.');
    res.json({
      ...serializeCustomer(customer),
      leads: customer.leads.map(serializeLeadMoney),
      documents: customer.documents.map(serializeDocument),
      callNotes: customer.callNotes.map(serializeCallNote),
      followUps: customer.followUps.map(serializeFollowUp),
    });
  }),
);

workspaceRouter.patch(
  '/customers/:id',
  asyncHandler(async (req, res) => {
    const { companyId, id } = recordParamsSchema.parse(req.params);
    res.json(await updateCustomer(companyId, id, customerBodySchema.parse(req.body)));
  }),
);

workspaceRouter.get(
  '/services',
  asyncHandler(async (req, res) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    res.json(await listServices(companyId));
  }),
);

workspaceRouter.post(
  '/services',
  asyncHandler(async (req, res) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    res.status(201).json(await createService(companyId, serviceBodySchema.parse(req.body)));
  }),
);

workspaceRouter.patch(
  '/services/:id',
  asyncHandler(async (req, res) => {
    const { companyId, id } = recordParamsSchema.parse(req.params);
    res.json(await updateService(companyId, id, serviceBodySchema.parse(req.body)));
  }),
);

workspaceRouter.get(
  '/documents',
  asyncHandler(async (req, res) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    res.json(await listDocuments(companyId));
  }),
);

workspaceRouter.post(
  '/documents',
  asyncHandler(async (req, res) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    res.status(201).json(await createDocument(companyId, documentBodySchema.parse(req.body)));
  }),
);

workspaceRouter.post(
  '/documents/from-context',
  asyncHandler(async (req, res) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    res
      .status(201)
      .json(await prepareContextDocument(companyId, documentPreparationSchema.parse(req.body)));
  }),
);

workspaceRouter.post(
  '/documents/from-conversation',
  asyncHandler(async (req, res) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    const { leadId } = conversationDraftSchema.parse(req.body);
    res.status(201).json(await createConversationEstimate(companyId, leadId));
  }),
);

workspaceRouter.get(
  '/documents/:id',
  asyncHandler(async (req, res) => {
    const { companyId, id } = recordParamsSchema.parse(req.params);
    res.json(await getDocument(companyId, id));
  }),
);

workspaceRouter.patch(
  '/documents/:id',
  asyncHandler(async (req, res) => {
    const { companyId, id } = recordParamsSchema.parse(req.params);
    const body = documentUpdateSchema.parse(req.body);
    res.json(await updateDocument(companyId, id, body.revision, body.document));
  }),
);

workspaceRouter.post(
  '/documents/:id/finalize',
  asyncHandler(async (req, res) => {
    const { companyId, id } = recordParamsSchema.parse(req.params);
    const body = finalizeBodySchema.parse(req.body);
    res.json(await finalizeDocument(companyId, id, body.revision, currentAccount(req).id));
  }),
);

workspaceRouter.post(
  '/documents/:id/convert',
  asyncHandler(async (req, res) => {
    const { companyId, id } = recordParamsSchema.parse(req.params);
    res.status(201).json(await convertEstimate(companyId, id));
  }),
);
