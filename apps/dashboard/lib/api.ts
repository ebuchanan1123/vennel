import type {
  BillingDocument,
  CatalogService,
  CustomerInput,
  CustomerRecord,
  DocumentInput,
  ServiceInput,
  CallNote,
  CallNoteInput,
  CallNoteReviewInput,
  FollowUpTask,
  FollowUpInput,
  FollowUpSuggestion,
  WorkspaceSettings,
  BackgroundJobRecord,
  SmsDeliveryRecord,
  SmsReconciliationInput,
  DocumentPreparationInput,
  DocumentEmailPreview,
  DocumentEmailApproval,
  DocumentDelivery,
  AccountProfile,
  BusinessRole,
  BusinessCurrency,
  TeamMember,
  TeamWorkspace,
  OnboardingInput,
  OnboardingProfile,
  OnboardingCheck,
} from '@lead-recovery/types';
import { internalApiUrl } from './development-access';

export type {
  AiDraft,
  BillingDocument,
  CatalogService,
  CustomerInput,
  CustomerRecord,
  DocumentInput,
  DocumentItemInput,
  DocumentKind,
  ServiceInput,
  CallNote,
  CallNoteInput,
  CallNoteReviewInput,
  CallNoteExtraction,
  NoteFactKey,
  ConfirmationField,
  FollowUpTask,
  FollowUpInput,
  FollowUpSuggestion,
  WorkspaceSettings,
  BackgroundJobRecord,
  DocumentPreparationInput,
  DocumentEmailPreview,
  DocumentEmailApproval,
  DocumentDelivery,
  DocumentContext,
  AccountProfile,
  BusinessRole,
  TeamMember,
  TeamWorkspace,
  OnboardingInput,
  OnboardingProfile,
  OnboardingCheck,
} from '@lead-recovery/types';

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function createTransport(cookie?: string) {
  async function apiRequest(path: string, init?: RequestInit): Promise<Response> {
    let response: Response;
    try {
      const inBrowser = typeof globalThis.window !== 'undefined';
      const url = inBrowser ? `/api/backend${path}` : `${internalApiUrl()}${path}`;
      response = await fetch(url, {
        ...init,
        headers: {
          ...(init?.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
          ...(!inBrowser && cookie ? { cookie } : {}),
          ...init?.headers,
        },
        cache: 'no-store',
      });
    } catch (error) {
      console.error('Unable to reach the lead recovery API', error);
      throw new ApiError('Unable to reach the API. Is the server running?');
    }

    if (!response.ok) {
      const body: unknown = await response.json();
      let message = `Request failed (${response.status}). Please try again.`;
      if (isRecord(body) && typeof body.error === 'string') {
        message = body.error;
        if (isRecord(body.details)) {
          const errors = (
            isRecord(body.details.fieldErrors) ? Object.values(body.details.fieldErrors) : []
          ).flatMap((value) =>
            Array.isArray(value)
              ? value.filter((entry): entry is string => typeof entry === 'string')
              : [],
          );
          if (Array.isArray(body.details.formErrors))
            errors.push(
              ...body.details.formErrors.filter(
                (entry): entry is string => typeof entry === 'string',
              ),
            );
          if (errors.length > 0) message += ` ${errors.join(' ')}`;
        }
      }
      throw new ApiError(message, response.status);
    }

    return response;
  }

  async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    return (await apiRequest(path, init)).json() as Promise<T>;
  }
  return { apiRequest, apiFetch };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export type Company = {
  id: string;
  name: string;
  slug: string;
  niche: string;
  twilioPhoneNumber: string | null;
  forwardToPhoneNumber: string | null;
  serviceAreas: string[];
  isActive: boolean;
  timeZone: string;
  currency: BusinessCurrency;
  defaultTaxRate: number;
  role: BusinessRole;
  onboardingStep: number;
  onboardingCompletedAt: string | null;
};

export type Message = {
  id: string;
  leadId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  body: string;
  createdAt: string;
  smsDelivery?: SmsDeliveryRecord | null;
};

export type Lead = {
  id: string;
  companyId: string;
  customerId: string | null;
  customer?: Pick<CustomerRecord, 'id' | 'name' | 'phone' | 'email' | 'address'> | null;
  phone: string;
  source: string;
  status: string;
  serviceType: string | null;
  issue: string | null;
  location: string | null;
  urgency: string | null;
  preferredTime: string | null;
  budgetRange: string | null;
  projectType: string | null;
  timeline: string | null;
  propertyOwner: boolean | null;
  needsHuman: boolean;
  summary: string | null;
  outcome: string;
  estimatedValue: number | null;
  actualValue: number | null;
  lostReason: string | null;
  contactedAt: string | null;
  bookedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  company?: Pick<Company, 'id' | 'name' | 'niche' | 'timeZone' | 'currency'>;
};

export type LeadDetail = Lead & {
  company: NonNullable<Lead['company']>;
  messages: Message[];
  documents: Pick<BillingDocument, 'id' | 'kind' | 'status' | 'number' | 'title'>[];
  callNotes: CallNote[];
  followUps: FollowUpTask[];
};

export type CustomerDetail = CustomerRecord & {
  leads: Lead[];
  documents: BillingDocument[];
  callNotes: CallNote[];
  followUps: FollowUpTask[];
};

export type DashboardStats = {
  recoveredLeads: number;
  qualifiedLeads: number;
  needsHuman: number;
  inProgress: number;
  bookedJobs: number;
  wonJobs: number;
  estimatedPipeline: number;
  wonRevenue: number;
};

export type OutcomeUpdatePayload = {
  outcome: string;
  estimatedValue?: number | null;
  actualValue?: number | null;
  lostReason?: string | null;
};

export function createApi(cookie?: string) {
  const { apiRequest, apiFetch } = createTransport(cookie);
  function getCompanies(): Promise<Company[]> {
    return apiFetch('/api/companies');
  }

  function getLeads(filters: {
    companyId?: string;
    status?: string;
    outcome?: string;
  }): Promise<Lead[]> {
    const params = new URLSearchParams();
    if (filters.companyId) params.set('companyId', filters.companyId);
    if (filters.status) params.set('status', filters.status);
    if (filters.outcome) params.set('outcome', filters.outcome);
    const query = params.toString();
    return apiFetch(`/api/leads${query ? `?${query}` : ''}`);
  }

  function getLeadDetail(id: string, companyId?: string): Promise<LeadDetail> {
    const query = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
    return apiFetch(`/api/leads/${encodeURIComponent(id)}${query}`);
  }

  function getDashboardStats(companyId: string): Promise<DashboardStats> {
    return apiFetch(`/api/dashboard/stats?companyId=${encodeURIComponent(companyId)}`);
  }

  function updateLeadOutcome(
    id: string,
    payload: OutcomeUpdatePayload,
    companyId?: string,
  ): Promise<Lead> {
    const query = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
    return apiFetch(`/api/leads/${encodeURIComponent(id)}/outcome${query}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  function workspacePath(companyId: string, path: string): string {
    return `/api/workspace/${encodeURIComponent(companyId)}${path}`;
  }

  function getCustomers(companyId: string): Promise<CustomerRecord[]> {
    return apiFetch(workspacePath(companyId, '/customers'));
  }

  function getCustomer(companyId: string, id: string): Promise<CustomerDetail> {
    return apiFetch(workspacePath(companyId, `/customers/${encodeURIComponent(id)}`));
  }

  function saveCustomer(
    companyId: string,
    input: CustomerInput,
    id?: string,
  ): Promise<CustomerRecord> {
    return apiFetch(
      workspacePath(companyId, `/customers${id ? `/${encodeURIComponent(id)}` : ''}`),
      {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(input),
      },
    );
  }

  function linkCustomer(
    companyId: string,
    input: { leadId: string; customerId?: string; name?: string },
  ): Promise<CustomerRecord> {
    return apiFetch(workspacePath(companyId, '/customers/from-lead'), {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  function getServices(companyId: string): Promise<CatalogService[]> {
    return apiFetch(workspacePath(companyId, '/services'));
  }

  function saveService(
    companyId: string,
    input: ServiceInput,
    id?: string,
  ): Promise<CatalogService> {
    return apiFetch(
      workspacePath(companyId, `/services${id ? `/${encodeURIComponent(id)}` : ''}`),
      {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(input),
      },
    );
  }

  function getDocuments(companyId: string): Promise<BillingDocument[]> {
    return apiFetch(workspacePath(companyId, '/documents'));
  }

  function getDocument(companyId: string, id: string): Promise<BillingDocument> {
    return apiFetch(workspacePath(companyId, `/documents/${encodeURIComponent(id)}`));
  }

  function createDocument(companyId: string, input: DocumentInput): Promise<BillingDocument> {
    return apiFetch(workspacePath(companyId, '/documents'), {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  function saveDocument(
    companyId: string,
    id: string,
    revision: number,
    document: DocumentInput,
  ): Promise<BillingDocument> {
    return apiFetch(workspacePath(companyId, `/documents/${encodeURIComponent(id)}`), {
      method: 'PATCH',
      body: JSON.stringify({ revision, document }),
    });
  }

  function finalizeDocument(
    companyId: string,
    id: string,
    revision: number,
  ): Promise<BillingDocument> {
    return apiFetch(workspacePath(companyId, `/documents/${encodeURIComponent(id)}/finalize`), {
      method: 'POST',
      body: JSON.stringify({ revision, approved: true }),
    });
  }

  function convertEstimate(companyId: string, id: string): Promise<BillingDocument> {
    return apiFetch(workspacePath(companyId, `/documents/${encodeURIComponent(id)}/convert`), {
      method: 'POST',
    });
  }

  function createConversationEstimate(companyId: string, leadId: string): Promise<BillingDocument> {
    return apiFetch(workspacePath(companyId, '/documents/from-conversation'), {
      method: 'POST',
      body: JSON.stringify({ leadId }),
    });
  }

  function prepareContextDocument(
    companyId: string,
    input: DocumentPreparationInput,
  ): Promise<BillingDocument> {
    return apiFetch(workspacePath(companyId, '/documents/from-context'), {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  function previewDocumentEmail(
    companyId: string,
    document: { id: string; revision: number },
    recipientEmail: string,
  ): Promise<DocumentEmailPreview> {
    return apiFetch(
      workspacePath(companyId, `/documents/${encodeURIComponent(document.id)}/email-preview`),
      { method: 'POST', body: JSON.stringify({ revision: document.revision, recipientEmail }) },
    );
  }
  function approveDocumentEmail(
    companyId: string,
    documentId: string,
    input: DocumentEmailApproval,
  ): Promise<DocumentDelivery> {
    return apiFetch(
      workspacePath(companyId, `/documents/${encodeURIComponent(documentId)}/deliveries`),
      { method: 'POST', body: JSON.stringify(input) },
    );
  }
  function getDocumentDeliveries(
    companyId: string,
    documentId: string,
  ): Promise<DocumentDelivery[]> {
    return apiFetch(
      workspacePath(companyId, `/documents/${encodeURIComponent(documentId)}/deliveries`),
    );
  }
  function cancelDocumentEmail(
    companyId: string,
    documentId: string,
    deliveryId: string,
  ): Promise<DocumentDelivery> {
    return apiFetch(
      workspacePath(
        companyId,
        `/documents/${encodeURIComponent(documentId)}/deliveries/${encodeURIComponent(deliveryId)}/cancel`,
      ),
      { method: 'POST' },
    );
  }
  function retryDocumentEmail(
    companyId: string,
    documentId: string,
    deliveryId: string,
  ): Promise<DocumentDelivery> {
    return apiFetch(
      workspacePath(
        companyId,
        `/documents/${encodeURIComponent(documentId)}/deliveries/${encodeURIComponent(deliveryId)}/retry`,
      ),
      { method: 'POST' },
    );
  }

  function getCallNotes(companyId: string): Promise<CallNote[]> {
    return apiFetch(workspacePath(companyId, '/call-notes'));
  }
  function getCallNote(companyId: string, id: string): Promise<CallNote> {
    return apiFetch(workspacePath(companyId, `/call-notes/${encodeURIComponent(id)}`));
  }
  function saveCallNote(
    companyId: string,
    input: CallNoteInput,
    existing?: { id: string; revision: number },
  ): Promise<CallNote> {
    return apiFetch(
      workspacePath(
        companyId,
        `/call-notes${existing ? `/${encodeURIComponent(existing.id)}` : ''}`,
      ),
      {
        method: existing ? 'PATCH' : 'POST',
        body: JSON.stringify(existing ? { revision: existing.revision, note: input } : input),
      },
    );
  }
  function analyzeCallNote(companyId: string, id: string, revision: number): Promise<CallNote> {
    return apiFetch(workspacePath(companyId, `/call-notes/${encodeURIComponent(id)}/analyze`), {
      method: 'POST',
      body: JSON.stringify({ revision }),
    });
  }
  function reviewCallNote(
    companyId: string,
    id: string,
    input: CallNoteReviewInput,
  ): Promise<CallNote> {
    return apiFetch(workspacePath(companyId, `/call-notes/${encodeURIComponent(id)}/review`), {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  function archiveCallNote(
    companyId: string,
    id: string,
    revision: number,
    isArchived: boolean,
  ): Promise<CallNote> {
    return apiFetch(workspacePath(companyId, `/call-notes/${encodeURIComponent(id)}/archive`), {
      method: 'PATCH',
      body: JSON.stringify({ revision, isArchived }),
    });
  }
  function transcribeCallNote(
    companyId: string,
    audio: Blob,
    metadata: Omit<CallNoteInput, 'text' | 'newCustomer'>,
  ): Promise<CallNote> {
    const body = new FormData();
    body.set('audio', audio, 'call-summary');
    body.set('metadata', JSON.stringify(metadata));
    return apiFetch(workspacePath(companyId, '/call-notes/transcribe'), { method: 'POST', body });
  }
  function getFollowUps(companyId: string): Promise<FollowUpTask[]> {
    return apiFetch(workspacePath(companyId, '/follow-ups'));
  }
  function getFollowUpSuggestions(companyId: string): Promise<FollowUpSuggestion[]> {
    return apiFetch(workspacePath(companyId, '/follow-ups/suggestions'));
  }
  function saveFollowUp(
    companyId: string,
    input: FollowUpInput,
    existing?: { id: string; revision: number },
  ): Promise<FollowUpTask> {
    return apiFetch(
      workspacePath(
        companyId,
        `/follow-ups${existing ? `/${encodeURIComponent(existing.id)}` : ''}`,
      ),
      {
        method: existing ? 'PATCH' : 'POST',
        body: JSON.stringify(existing ? { revision: existing.revision, task: input } : input),
      },
    );
  }
  function changeFollowUpStatus(
    companyId: string,
    task: { id: string; revision: number },
    status: FollowUpTask['status'],
  ): Promise<FollowUpTask> {
    return apiFetch(workspacePath(companyId, `/follow-ups/${encodeURIComponent(task.id)}/status`), {
      method: 'PATCH',
      body: JSON.stringify({ revision: task.revision, status }),
    });
  }
  function acceptFollowUpSuggestion(
    companyId: string,
    id: string,
    input: {
      customerId: string;
      dueAt: string;
      title: string;
      priority: FollowUpTask['priority'];
      notes: string | null;
      assignedUserId?: string | null;
    },
  ): Promise<FollowUpTask> {
    return apiFetch(
      workspacePath(companyId, `/follow-ups/suggestions/${encodeURIComponent(id)}/accept`),
      { method: 'POST', body: JSON.stringify(input) },
    );
  }
  async function dismissFollowUpSuggestion(companyId: string, id: string): Promise<void> {
    await apiRequest(
      workspacePath(companyId, `/follow-ups/suggestions/${encodeURIComponent(id)}/dismiss`),
      { method: 'POST' },
    );
  }
  function getWorkspaceSettings(companyId: string): Promise<WorkspaceSettings> {
    return apiFetch(workspacePath(companyId, '/settings'));
  }
  function saveWorkspaceSettings(
    companyId: string,
    input: {
      timeZone: string;
      notifications: Omit<WorkspaceSettings['notifications'], 'consentedAt'> & { consent: boolean };
      documentEmail?: {
        enabled: boolean;
        senderName: string;
        replyTo: string | null;
        authorized: boolean;
      };
    },
  ): Promise<WorkspaceSettings> {
    return apiFetch(workspacePath(companyId, '/settings'), {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }
  function getBackgroundJobs(companyId: string): Promise<BackgroundJobRecord[]> {
    return apiFetch(workspacePath(companyId, '/jobs'));
  }
  async function retryBackgroundJob(companyId: string, id: string): Promise<void> {
    await apiRequest(workspacePath(companyId, `/jobs/${encodeURIComponent(id)}/retry`), {
      method: 'POST',
    });
  }
  function reconcileSmsDelivery(
    companyId: string,
    id: string,
    input: SmsReconciliationInput,
  ): Promise<SmsDeliveryRecord> {
    return apiFetch(
      workspacePath(companyId, `/sms-deliveries/${encodeURIComponent(id)}/reconcile`),
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );
  }

  function getAccount(): Promise<AccountProfile> {
    return apiFetch('/api/account');
  }
  function getMembers(companyId: string): Promise<TeamMember[]> {
    return apiFetch(workspacePath(companyId, '/members'));
  }
  function getTeam(companyId: string): Promise<TeamWorkspace> {
    return apiFetch(workspacePath(companyId, '/team'));
  }
  function getWorkflowClock(
    companyId: string,
  ): Promise<{ now: string; timeZone: string; currency: BusinessCurrency }> {
    return apiFetch(workspacePath(companyId, '/info'));
  }
  function createBusiness(input: {
    requestId: string;
    name: string;
    niche: string;
    timeZone: string;
    currency: BusinessCurrency;
  }): Promise<{ companyId: string }> {
    return apiFetch('/api/accounts/businesses', { method: 'POST', body: JSON.stringify(input) });
  }
  function acceptInvitation(token: string): Promise<{ companyId: string }> {
    return apiFetch('/api/accounts/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }
  function createInvitation(
    companyId: string,
    email: string,
    role: BusinessRole,
  ): Promise<{ id: string; inviteURL: string }> {
    return apiFetch(workspacePath(companyId, '/team/invitations'), {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    });
  }
  async function changeMember(
    companyId: string,
    id: string,
    role: BusinessRole | null,
  ): Promise<void> {
    await apiRequest(workspacePath(companyId, `/team/members/${encodeURIComponent(id)}`), {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
  }
  async function revokeInvitation(companyId: string, id: string): Promise<void> {
    await apiRequest(
      workspacePath(companyId, `/team/invitations/${encodeURIComponent(id)}/revoke`),
      { method: 'POST' },
    );
  }
  function getOnboarding(companyId: string): Promise<OnboardingProfile> {
    return apiFetch(workspacePath(companyId, '/onboarding'));
  }
  function updateOnboarding(companyId: string, input: OnboardingInput): Promise<OnboardingProfile> {
    return apiFetch(workspacePath(companyId, '/onboarding'), {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }
  function checkOnboarding(companyId: string): Promise<OnboardingCheck> {
    return apiFetch(workspacePath(companyId, '/onboarding/check'), { method: 'POST' });
  }
  function completeOnboarding(companyId: string): Promise<OnboardingProfile> {
    return apiFetch(workspacePath(companyId, '/onboarding/complete'), { method: 'POST' });
  }
  return {
    getAccount,
    getCompanies,
    getLeads,
    getLeadDetail,
    getDashboardStats,
    updateLeadOutcome,
    getCustomers,
    getCustomer,
    saveCustomer,
    linkCustomer,
    getServices,
    saveService,
    getDocuments,
    getDocument,
    createDocument,
    saveDocument,
    finalizeDocument,
    convertEstimate,
    createConversationEstimate,
    prepareContextDocument,
    previewDocumentEmail,
    approveDocumentEmail,
    getDocumentDeliveries,
    cancelDocumentEmail,
    retryDocumentEmail,
    getCallNotes,
    getCallNote,
    saveCallNote,
    analyzeCallNote,
    reviewCallNote,
    archiveCallNote,
    transcribeCallNote,
    getFollowUps,
    getFollowUpSuggestions,
    saveFollowUp,
    changeFollowUpStatus,
    acceptFollowUpSuggestion,
    dismissFollowUpSuggestion,
    getWorkspaceSettings,
    saveWorkspaceSettings,
    getBackgroundJobs,
    retryBackgroundJob,
    reconcileSmsDelivery,
    getMembers,
    getTeam,
    getWorkflowClock,
    createBusiness,
    acceptInvitation,
    createInvitation,
    changeMember,
    revokeInvitation,
    getOnboarding,
    updateOnboarding,
    checkOnboarding,
    completeOnboarding,
  };
}

export const {
  getAccount,
  getCompanies,
  getLeads,
  getLeadDetail,
  getDashboardStats,
  updateLeadOutcome,
  getCustomers,
  getCustomer,
  saveCustomer,
  linkCustomer,
  getServices,
  saveService,
  getDocuments,
  getDocument,
  createDocument,
  saveDocument,
  finalizeDocument,
  convertEstimate,
  createConversationEstimate,
  prepareContextDocument,
  previewDocumentEmail,
  approveDocumentEmail,
  getDocumentDeliveries,
  cancelDocumentEmail,
  retryDocumentEmail,
  getCallNotes,
  getCallNote,
  saveCallNote,
  analyzeCallNote,
  reviewCallNote,
  archiveCallNote,
  transcribeCallNote,
  getFollowUps,
  getFollowUpSuggestions,
  saveFollowUp,
  changeFollowUpStatus,
  acceptFollowUpSuggestion,
  dismissFollowUpSuggestion,
  getWorkspaceSettings,
  saveWorkspaceSettings,
  getBackgroundJobs,
  retryBackgroundJob,
  reconcileSmsDelivery,
  getMembers,
  getTeam,
  getWorkflowClock,
  createBusiness,
  acceptInvitation,
  createInvitation,
  changeMember,
  revokeInvitation,
  getOnboarding,
  updateOnboarding,
  checkOnboarding,
  completeOnboarding,
} = createApi();
