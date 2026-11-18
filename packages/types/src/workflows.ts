import type { CustomerInput } from './billing.js';
import type { LeadStatus, UrgencyLevel } from './index.js';

export const FOLLOW_UP_TYPES = [
  'CALL_CUSTOMER',
  'SEND_ESTIMATE',
  'CONFIRM_APPOINTMENT',
  'REQUEST_INFORMATION',
  'FOLLOW_UP_QUOTE',
  'PREPARE_INVOICE',
  'CUSTOM',
] as const;
export type FollowUpType = (typeof FOLLOW_UP_TYPES)[number];
export type FollowUpStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED';
export type FollowUpSource = 'MANUAL' | 'AI' | 'AUTOMATION';
export type SuggestionStatus = 'PENDING' | 'ACCEPTED' | 'DISMISSED';
export type CallNoteReviewStatus = 'DRAFT' | 'EXTRACTED' | 'REVIEWED';
export type NoteFact<T> = { value: T | null; evidence: string | null };

export type NoteFacts = {
  customerName: NoteFact<string>;
  phone: NoteFact<string>;
  email: NoteFact<string>;
  serviceType: NoteFact<string>;
  issue: NoteFact<string>;
  location: NoteFact<string>;
  urgency: NoteFact<UrgencyLevel>;
  preferredTime: NoteFact<string>;
  projectType: NoteFact<string>;
  budgetRange: NoteFact<string>;
  timeline: NoteFact<string>;
  propertyOwner: NoteFact<boolean>;
};

export const NOTE_INFORMATION_FIELDS = [
  'customerName',
  'phone',
  'email',
  'serviceType',
  'issue',
  'location',
  'urgency',
  'preferredTime',
  'projectType',
  'budgetRange',
  'timeline',
  'propertyOwner',
] as const;
export const NOTE_FACT_KEYS = [
  ...NOTE_INFORMATION_FIELDS,
  'price',
  'appointment',
  'materials',
  'summary',
] as const;
export type NoteFactKey = (typeof NOTE_FACT_KEYS)[number];

export type SuggestedFollowUp = {
  type: FollowUpType;
  title: string;
  dueAt: string | null;
  dueText: string | null;
  priority: UrgencyLevel;
  evidence: string | null;
};

export type CallNoteExtraction = {
  facts: NoteFacts;
  price: {
    amount: number | null;
    currency: string | null;
    state: 'UNKNOWN' | 'PROPOSED' | 'AGREED';
    evidence: string | null;
  };

  appointment: {
    text: string | null;
    startsAt: string | null;
    state: 'UNKNOWN' | 'TENTATIVE' | 'CONFIRMED';
    evidence: string | null;
  };
  materials: { text: string; evidence: string }[];
  actions: SuggestedFollowUp[];
  missingInformation: string[];
  summary: string;
};

export function emptyCallNoteExtraction(): CallNoteExtraction {
  const empty = () => ({ value: null, evidence: null });
  return {
    facts: {
      customerName: empty(),
      phone: empty(),
      email: empty(),
      serviceType: empty(),
      issue: empty(),
      location: empty(),
      urgency: empty(),
      preferredTime: empty(),
      projectType: empty(),
      budgetRange: empty(),
      timeline: empty(),
      propertyOwner: empty(),
    },
    price: { amount: null, currency: null, state: 'UNKNOWN', evidence: null },
    appointment: { text: null, startsAt: null, state: 'UNKNOWN', evidence: null },
    materials: [],
    actions: [],
    missingInformation: [],
    summary: '',
  };
}

export const CONFIRMATION_FIELDS = [
  'customer.name',
  'customer.phone',
  'customer.email',
  'customer.address',
  'lead.serviceType',
  'lead.issue',
  'lead.location',
  'lead.urgency',
  'lead.preferredTime',
  'lead.projectType',
  'lead.budgetRange',
  'lead.timeline',
  'lead.propertyOwner',
  'lead.summary',
] as const;
export type ConfirmationField = (typeof CONFIRMATION_FIELDS)[number];
export const NOTE_FIELD_FACTS: Record<ConfirmationField, NoteFactKey> = {
  'customer.name': 'customerName',
  'customer.phone': 'phone',
  'customer.email': 'email',
  'customer.address': 'location',
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
};
export type HistoryContact = { id: string; name: string; phone: string | null };
export type HistoryLead = { id: string; phone: string; status: LeadStatus };
export type WorkflowAudit = {
  id: string;
  revision: number;
  action: string;
  actor: string;
  details: unknown;
  createdAt: string;
};

export type CallNote = {
  id: string;
  companyId: string;
  customerId: string | null;
  leadId: string | null;
  originalText: string;
  text: string;
  source: 'TEXT' | 'VOICE';
  direction: 'INBOUND' | 'OUTBOUND';
  occurredAt: string;
  phone: string | null;
  revision: number;
  reviewStatus: CallNoteReviewStatus;
  extraction: CallNoteExtraction | null;
  extractionRevision: number | null;
  confirmedData: CallNoteExtraction | null;
  confirmedFields: string[];
  reviewedAt: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  customer: HistoryContact | null;
  lead: HistoryLead | null;
  audits: WorkflowAudit[];
  reviewContext: {
    customer:
      (HistoryContact & { email: string | null; address: string | null; updatedAt: string }) | null;
    lead:
      | ({
          id: string;
          updatedAt: string;
          summary: string | null;
        } & {
          [
            K in Exclude<keyof NoteFacts, 'customerName' | 'phone' | 'email'>
          ]: NoteFacts[K]['value'];
        })
      | null;
  };
};

export type CallNoteInput = {
  customerId: string | null;
  newCustomer?: CustomerInput;
  leadId: string | null;
  text: string;
  direction: 'INBOUND' | 'OUTBOUND';
  occurredAt: string;
  phone: string | null;
};

export type CallNoteReviewInput = {
  revision: number;
  customerId: string | null;
  newCustomer?: CustomerInput;
  leadId: string | null;
  confirmed: CallNoteExtraction;
  acceptFacts: NoteFactKey[];
  applyFields: ConfirmationField[];
  replaceFields: ConfirmationField[];
  expectedCustomerUpdatedAt: string | null;
  expectedLeadUpdatedAt: string | null;
  acceptedActions: { index: number; dueAt: string }[];
};

export type FollowUpTask = {
  id: string;
  companyId: string;
  customerId: string;
  leadId: string | null;
  callNoteId: string | null;
  assignedUserId: string | null;
  assignedUser?: { id: string; name: string } | null;
  type: FollowUpType;
  title: string;
  dueAt: string;
  status: FollowUpStatus;
  priority: UrgencyLevel;
  notes: string | null;
  source: FollowUpSource;
  revision: number;
  sourceSuggestionId: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  customer: HistoryContact;
  lead: HistoryLead | null;
  audits: WorkflowAudit[];
};

export type FollowUpInput = {
  customerId: string;
  leadId: string | null;
  callNoteId?: string | null;
  type: FollowUpType;
  title: string;
  dueAt: string;
  priority: UrgencyLevel;
  notes: string | null;
  assignedUserId?: string | null;
};

export type FollowUpSuggestion = SuggestedFollowUp & {
  id: string;
  companyId: string;
  customerId: string | null;
  leadId: string | null;
  callNoteId: string | null;
  source: FollowUpSource;
  status: SuggestionStatus;
  createdAt: string;
  taskId: string | null;
  customer: HistoryContact | null;
  lead: HistoryLead | null;
};

export type NotificationPreferences = {
  enabled: boolean;
  recipientEmail: string | null;
  consentedAt: string | null;
  newLeads: boolean;
  humanAttention: boolean;
  overdueFollowUps: boolean;
  documentReview: boolean;
  documentReminderHours: number;
};

export type WorkspaceSettings = {
  now: string;
  timeZone: string;
  notifications: NotificationPreferences;
  emailProviderConfigured: boolean;
  workerHealthy: boolean;
  failedJobs: number;
  blockedJobs: number;
  documentEmail: {
    enabled: boolean;
    senderName: string;
    replyTo: string | null;
    senderEmail: string | null;
    webhookConfigured: boolean;
  };
};

export type SmsDeliveryRecord = {
  id: string;
  status: 'PENDING' | 'SENDING' | 'ACCEPTED' | 'SENT' | 'DELIVERED' | 'FAILED' | 'UNKNOWN';
  providerId: string | null;
  providerStatus: string | null;
  acceptedAt: string | null;
  deliveredAt: string | null;
  lastError: string | null;
  errorCode: string | null;
};

export type BackgroundJobRecord = {
  id: string;
  kind:
    | 'AUTH_EMAIL'
    | 'OWNER_EMAIL'
    | 'DOCUMENT_EMAIL'
    | 'LEAD_FOLLOW_UP_SUGGESTIONS'
    | 'INBOUND_SMS'
    | 'MISSED_CALL_RECOVERY';
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'CANCELLED';
  attempts: number;
  maxAttempts: number;
  dueAt: string;
  completedAt: string | null;
  lastError: string | null;
  providerId: string | null;
  createdAt: string;
  history: {
    attempt: number;
    startedAt: string;
    finishedAt: string | null;
    outcome: string | null;
    error: string | null;
    providerId: string | null;
  }[];
};
