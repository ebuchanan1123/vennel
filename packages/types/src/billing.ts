import type { BusinessBillingProfile } from './accounts.js';

export type DocumentKind = 'ESTIMATE' | 'INVOICE';
export type DocumentStatus = 'DRAFT' | 'FINALIZED';

export type CustomerRecord = {
  id: string;
  companyId: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  leadCount: number;
  documentCount: number;
};

export type CustomerInput = Pick<
  CustomerRecord,
  'name' | 'phone' | 'email' | 'address' | 'notes'
> & {
  isArchived?: boolean;
};

export type ServicePricing = {
  pricingType: 'FIXED' | 'RANGE' | 'QUOTE_REQUIRED';
  unitPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
};

export type CatalogService = ServicePricing & {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  category: string;
  unit: string;
  keywords: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ServiceInput = Pick<
  CatalogService,
  | 'name'
  | 'description'
  | 'category'
  | 'unit'
  | 'pricingType'
  | 'unitPrice'
  | 'minPrice'
  | 'maxPrice'
  | 'keywords'
  | 'isActive'
>;

export type DocumentItemInput = {
  serviceId?: string | null;
  description: string;
  unit?: string;
  quantity: number;
  unitPrice: number | null;
};

export type DocumentItem = Omit<DocumentItemInput, 'unit'> & {
  id: string;
  unit: string | null;
  suggestionReason: string | null;
};

export type DocumentTotals = {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
};

export type CustomerSnapshot = {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
};

export type AiDraft = {
  createdAt: string;
  missingDetails: string[];
  matches: {
    serviceId: string;
    description: string;
    unit?: string;
    unitPrice: number | null;
    catalogPricing?: ServicePricing;
    evidence: string;
    source?: { kind: 'CALL_NOTE' | 'SMS'; id: string };
  }[];
};

export type DocumentContext = {
  version: 1;
  customer: {
    id: string;
    updatedAt: string;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
  } | null;
  lead: {
    id: string;
    updatedAt: string;
    status: string;
    needsHuman: boolean;
    outcome: string;
    completedAt: string | null;
  } | null;
  notes: {
    id: string;
    revision: number;
    reviewedAt: string;
    facts: { field: string; value: string | boolean }[];
    summary: string | null;
    price: {
      amount: number | null;
      currency: string | null;
      state: 'UNKNOWN' | 'PROPOSED' | 'AGREED';
    } | null;
    appointment: {
      text: string | null;
      startsAt: string | null;
      state: 'UNKNOWN' | 'TENTATIVE' | 'CONFIRMED';
    } | null;
    materials: string[];
  }[];
  messages: { id: string; body: string; createdAt: string }[];
};

export type DocumentPreparationInput = {
  requestId: string;
  customerId?: string;
  leadId?: string;
  callNoteId?: string;
  kind: DocumentKind;
  useAi: boolean;
};

export type BillingDocument = {
  id: string;
  companyId: string;
  customerId: string | null;
  leadId: string | null;
  kind: DocumentKind;
  status: DocumentStatus;
  number: string | null;
  revision: number;
  title: string;
  currency: string;
  notes: string | null;
  dueDate: string | null;
  discountAmount: number;
  taxRate: number;
  aiDraft: AiDraft | null;
  customerSnapshot: CustomerSnapshot | null;
  businessName: string;
  billingProfile?: BusinessBillingProfile | null;
  finalizedAt: string | null;
  finalizedBy?: string | null;
  sourceEstimateId: string | null;
  callNoteId: string | null;
  context: DocumentContext | null;
  invoiceId: string | null;
  createdAt: string;
  updatedAt: string;
  customer: CustomerRecord | null;
  items: DocumentItem[];
  totals: DocumentTotals | null;
};

export type FinalizedDocumentSnapshot = Pick<
  BillingDocument,
  | 'kind'
  | 'title'
  | 'currency'
  | 'notes'
  | 'dueDate'
  | 'discountAmount'
  | 'taxRate'
  | 'businessName'
  | 'finalizedAt'
> & {
  billingProfile?: BusinessBillingProfile | null;
  number: string;
  customer: CustomerSnapshot;
  items: { description: string; unit: string | null; quantity: number; unitPrice: number }[];
};

export type DocumentEmailPreview = {
  recipientEmail: string;
  senderName: string;
  senderEmail: string | null;
  replyTo: string | null;
  subject: string;
  text: string;
  html: string;
  previewHash: string;
  revision: number;
  enabled: boolean;
  providerConfigured: boolean;
};

export type DocumentEmailApproval = {
  requestId: string;
  revision: number;
  recipientEmail: string;
  previewHash: string;
  approved: true;
  resendApproved?: boolean;
};

export type DocumentDelivery = {
  id: string;
  documentId: string;
  documentRevision: number;
  recipientEmail: string;
  senderName: string;
  senderEmail: string;
  replyTo: string | null;
  approvedAt: string;
  approvedBy: string;
  status:
    | 'QUEUED'
    | 'SENDING'
    | 'ACCEPTED'
    | 'DELIVERED'
    | 'DELAYED'
    | 'BOUNCED'
    | 'COMPLAINED'
    | 'FAILED'
    | 'BLOCKED'
    | 'CANCELLED';
  acceptedAt: string | null;
  providerId: string | null;
  job: {
    id: string;
    status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'CANCELLED';
    attempts: number;
    lastError: string | null;
    canRetry: boolean;
    canCancel: boolean;
  };
  attempts: {
    attempt: number;
    startedAt: string;
    finishedAt: string | null;
    outcome: string | null;
    error: string | null;
    providerId: string | null;
  }[];
  events: { type: string; occurredAt: string }[];
};

export type DocumentInput = {
  kind: DocumentKind;
  title: string;
  customerId: string | null;
  leadId?: string | null;
  notes: string | null;
  dueDate: string | null;
  discountAmount: number;
  taxRate: number;
  items: DocumentItemInput[];
};

export function hasTwoDecimals(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
}

export function calculateDocumentTotals(
  items: { quantity: number; unitPrice: number }[],
  discountAmount?: number,
  taxRate?: number,
): DocumentTotals;
export function calculateDocumentTotals(
  items: Pick<DocumentItemInput, 'quantity' | 'unitPrice'>[],
  discountAmount?: number,
  taxRate?: number,
): DocumentTotals | null;
export function calculateDocumentTotals(
  items: Pick<DocumentItemInput, 'quantity' | 'unitPrice'>[],
  discountAmount = 0,
  taxRate = 0,
): DocumentTotals | null {
  if (items.length > 100) throw new RangeError('A document can contain at most 100 items.');
  for (const item of items) {
    if (!hasTwoDecimals(item.quantity) || item.quantity <= 0 || item.quantity > 10000) {
      throw new RangeError(
        'Quantities must be between 0.01 and 10,000, with at most two decimals.',
      );
    }
    if (
      item.unitPrice !== null &&
      (!hasTwoDecimals(item.unitPrice) || item.unitPrice < 0 || item.unitPrice > 1000000)
    ) {
      throw new RangeError('Prices must be between 0 and 1,000,000, with at most two decimals.');
    }
  }
  if (!hasTwoDecimals(discountAmount) || discountAmount < 0 || discountAmount > 1000000) {
    throw new RangeError('Enter a valid discount between 0 and 1,000,000.');
  }
  if (!hasTwoDecimals(taxRate) || taxRate < 0 || taxRate > 100) {
    throw new RangeError('Tax must be between 0 and 100%, with at most two decimals.');
  }
  const pricedItems = items.flatMap((item) =>
    item.unitPrice === null ? [] : [{ quantity: item.quantity, unitPrice: item.unitPrice }],
  );
  if (pricedItems.length !== items.length) return null;
  // Round each extended line in integer cents, then apply discount and tax once.
  const subtotalCents = pricedItems.reduce(
    (total, item) =>
      total +
      (BigInt(Math.round(item.unitPrice * 100)) * BigInt(Math.round(item.quantity * 100)) + 50n) /
        100n,
    0n,
  );
  const discountCents = BigInt(Math.round(discountAmount * 100));
  if (discountCents > subtotalCents)
    throw new RangeError('The discount cannot exceed the subtotal.');
  const taxCents =
    ((subtotalCents - discountCents) * BigInt(Math.round(taxRate * 100)) + 5000n) / 10000n;
  return {
    subtotal: Number(subtotalCents) / 100,
    discount: Number(discountCents) / 100,
    tax: Number(taxCents) / 100,
    total: Number(subtotalCents - discountCents + taxCents) / 100,
  };
}
