# Vennel
## Product Brief

**Working tagline:** *From first conversation to finished work.*

**Initial market:** Canadian local service businesses  
**Initial supported industries:** Renovation/remodeling and HVAC  
**Product stage:** Functional development build; not yet a public production release  
**Brand status:** Vennel is the proposed brand. `vennel.ca` is the proposed primary domain; registration and brand clearance are separate steps.

---

## 1. Executive Summary

**Vennel is an AI-assisted customer and workflow platform that helps local businesses turn incoming enquiries into organized, actionable work.**

It connects the parts of a customer relationship that often become scattered:

- Phone calls and text conversations
- Customer contact information
- Notes about requested work
- Follow-up tasks
- Service descriptions and pricing
- Estimates and invoices
- The business's record of what happened next

The product starts with a practical problem: **busy business owners cannot always answer the phone, remember every conversation, or prepare a quote immediately.**

Vennel helps capture those opportunities, organize the information, and prepare the next action. AI assists with qualification, information extraction, service matching, and document preparation, but the business remains in control of customer commitments and financial decisions.

The longer-term vision is broader than recovering missed calls:

> **Vennel should become the place a local business uses to move from "someone contacted us" to "the work is organized, quoted, followed up, and invoiced."**

---

## 2. The Problem

Local service businesses frequently operate without a dedicated office team. The owner may be:

- Working at a customer's property
- Driving between appointments
- Buying materials
- Managing a crew
- Answering questions from existing customers
- Preparing estimates after hours

New enquiries still arrive throughout the day.

This creates several common problems.

### Missed opportunities

A potential customer calls, nobody answers, and the customer moves on to another business.

### Scattered information

Important details end up in text messages, personal notes, voice memos, or the owner's memory.

### Forgotten follow-ups

A customer needs a callback, an estimate needs to be prepared, or a quote needs to be followed up, but there is no clear reminder or person responsible.

### Slow estimate preparation

The owner repeatedly reconstructs the customer's request and manually builds similar documents.

### Inconsistent pricing

Some services have clear prices, while others depend on an inspection, measurements, materials, or project scope. A system that requires an exact price for every service encourages guessing.

### Limited visibility

The business may not have a reliable view of which enquiries are still active, which need attention, and which became booked or won work.

**Vennel's purpose is to reduce these gaps without creating another complicated administrative system.**

---

## 3. Who Vennel Is For

### Initial customer profile

Vennel is initially aimed at **Canadian owner-operated service businesses and small teams**, particularly businesses where:

- The owner spends significant time away from a desk.
- Phone calls are an important source of new customers.
- Work often needs qualification before it can be priced.
- Quotes require human judgment.
- Repeat customers and reliable follow-up matter.
- A full enterprise CRM would be unnecessarily complicated.

### Initial supported industries

The current application includes industry-specific qualification templates for:

#### Renovation and remodeling

Relevant information includes:

- Project type
- Location
- Budget range
- Timeline
- Property ownership
- Preferred contact or appointment timing

#### Heating and air conditioning

Relevant information includes:

- Requested service
- Reported problem
- Location
- Urgency
- Preferred timing

### Potential future industries

The architecture can support additional industries, but their templates and workflows still need implementation and testing. Potential examples include:

- Plumbing
- Electrical work
- Roofing
- Cleaning
- Landscaping
- General maintenance and repairs

These should not be advertised as fully supported industry templates yet.

---

## 4. Product Positioning

### One-sentence description

**Vennel helps local service businesses capture customer enquiries, keep track of the details, and move work forward with AI-assisted follow-ups, estimates, and invoices.**

### What Vennel combines

Vennel brings together elements of:

- Missed-call follow-up
- A lightweight customer relationship manager
- A call-note workspace
- A follow-up task manager
- A business-specific service catalog
- An estimate and invoice editor

The value is in connecting these functions, not simply providing a separate screen for each one.

### What Vennel is not

The current product is not:

- An autonomous AI business owner
- An AI voice receptionist that conducts spoken telephone conversations
- A full accounting system
- A payment processor
- A complete scheduling, dispatch, or crew-management system
- A replacement for the owner's judgment about scope, pricing, safety, or customer commitments

---

## 5. The Core Customer Journey

Vennel supports two important starting points.

### A. The business misses a call

Once live phone recovery is connected:

1. A customer's call reaches the business's assigned recovery number.
2. Vennel attempts to connect the call to the phone the business answers.
3. If the call is missed, a text asks the customer what they need.
4. The customer can reply by SMS.
5. AI helps collect industry-relevant information.
6. The conversation and lead details appear in the business's workspace.
7. The business reviews the enquiry and decides what happens next.

The objective is to preserve the opportunity and collect useful information, not to promise a job, negotiate independently, or finalize a price.

### B. The business answers the call

Vennel also supports conversations that were answered normally:

1. A team member types a short call summary or records a voice summary.
2. AI proposes structured details, missing information, and possible next actions.
3. The business reviews and confirms the appropriate facts.
4. The note can be associated with a customer and lead.
5. Confirmed information can support follow-up tasks and draft documents.

**Voice summaries are a way to create written notes after a conversation. They are not automatic recordings or transcripts of every live phone call.**

---

## 6. Core Product Capabilities

### 6.1 Lead inbox and opportunity tracking

The lead workspace provides a central place to review incoming opportunities.

It supports:

- Searchable lead records
- Conversation history
- Structured qualification details
- Indicators for leads needing human attention
- Estimated and owner-recorded actual values
- Manually recorded outcomes such as contacted, estimate sent, booked, won, or lost
- Links to related customers, notes, tasks, and documents

Recording a lead as booked does not reserve a calendar appointment. Recording a value does not verify that money has been collected.

### 6.2 Customer directory

Each business has its own customer records, including:

- Name
- Phone number
- Email address
- Address
- Internal notes
- Related leads
- Call notes
- Follow-up history
- Estimate and invoice history

The business can create a customer or link an enquiry to an existing customer.

Phone and email normalization help prevent duplicates. Customer matching remains a reviewed action; records are not silently merged across businesses.

**Customers do not need a Vennel account to call, text, or receive an approved document. Accounts are for business owners and their staff.**

### 6.3 Call notes and structured review

Call notes preserve the business's original written summary or voice-summary transcription.

AI can propose details such as:

- Customer contact information
- Requested services or project type
- Reported issues
- Location
- Urgency
- Budget and timing
- Materials mentioned
- Follow-up actions
- Proposed or agreed pricing
- Tentative or confirmed appointment information
- Missing information

The review process distinguishes facts from suggestions.

For example:

- A proposed price is not automatically treated as an agreed price.
- A preferred appointment time is not automatically treated as a confirmed booking.
- An unclear statement is not silently converted into a firm commitment.

Selected facts can be applied to related records. Replacing existing information requires explicit confirmation where appropriate.

### 6.4 Follow-up tasks

Vennel supports tasks such as:

- Call the customer
- Prepare or send an estimate
- Confirm an appointment
- Request additional information
- Follow up on a quote
- Prepare an invoice
- Complete a custom action

Tasks support:

- Due dates and priorities
- Assignment to current members of the business
- Completion, reopening, cancellation, and rescheduling
- Customer, lead, and note associations
- Revision checks and audit history

Task views include overdue, due today, upcoming, completed, and cancelled work.

AI-generated follow-up suggestions remain suggestions until reviewed and accepted. Internal task reminders should not be confused with an automated customer marketing or reminder campaign.

### 6.5 Business-specific service catalogs

Each business defines its own services rather than relying on AI-generated market prices.

A service can include:

- Name
- Category
- Description and scope
- Pricing unit, such as a visit, hour, job, or square foot
- Matching keywords
- Pricing method
- Active or archived status

Descriptions can explain exclusions, assumptions, or factors affecting the final price.

The current catalog is managed through manual entry and editing. Bulk price-list or document imports are not implemented.

---

## 7. Flexible Service Pricing

Vennel supports three pricing methods.

| Pricing method | Purpose | Document behavior |
|---|---|---|
| **Fixed price** | A defined price for a clearly scoped service | The fixed catalog price can be copied into an editable draft. |
| **Estimated range** | Guidance where the amount depends on scope | The range remains guidance; the document needs an exact reviewed price. |
| **Quote required** | Work that cannot responsibly be priced yet | No price is invented or substituted. |

Important rules:

- An unknown price is not stored as zero.
- Explicitly entering zero means the business intends the item to be free.
- AI does not choose the minimum, maximum, or midpoint of a range.
- Incomplete drafts display **Pricing required** rather than a misleading total.
- Every line needs an exact amount before a financial document can be finalized.

This allows a business to include custom work in its catalog without pretending that every project has a standard price.

---

## 8. Estimates and Invoices

### Draft preparation

The business can prepare documents manually or request AI-assisted service matching.

For AI-assisted preparation:

1. The system uses the associated customer messages and selected, confirmed call-note details.
2. AI identifies relevant services from that business's active catalog.
3. Matches retain supporting evidence and source information.
4. The server supplies fixed catalog prices, not the language model.
5. Quantities start at one and require review.
6. Range and quote-required items remain unpriced until an exact amount is entered.

Raw internal customer notes and unreviewed call-note text are not automatically used as customer-facing document content.

### Editing and review

Drafts support:

- Catalog services
- Custom line items
- Descriptions
- Quantities
- Pricing units
- Exact unit prices
- Discounts
- Tax rates
- Due or validity dates
- Customer-facing notes and terms

The business can add, remove, and adjust items before approval.

### Finalization

Only an owner can finalize an estimate or invoice.

Finalization requires an appropriate customer, line items, confirmed pricing units, exact amounts, and explicit approval.

Once finalized:

- The document receives a business-specific number.
- Its approved details are locked.
- Customer and business billing details are snapshotted.
- Prices and units remain unchanged when the catalog changes.
- The approving account is recorded.

Revision checks prevent an older tab from silently overwriting or approving a newer version.

### Estimate-to-invoice conversion

A finalized estimate can create an editable invoice draft using its reviewed items and prices.

The invoice requires its own review and approval. Repeated conversion attempts do not create an unlimited set of duplicate invoices.

Context-based invoice preparation does not treat an agreed price as proof that the work is complete.

### Printing and sending

Finalized documents can be printed or saved as PDF through the browser.

Customer email delivery is a separate action:

1. Choose the recipient.
2. Preview the exact email.
3. Approve the recipient and content.
4. Queue the approved message.

The current email contains the finalized document as HTML and plain text. **It is not a PDF attachment.**

Finalizing or emailing a document does not collect payment or automatically change a lead's outcome.

---

## 9. AI's Role and Its Limits

Vennel's operating principle is:

> **AI helps prepare the next step. The business controls the commitment.**

| AI can assist with | AI must not independently do |
|---|---|
| Qualifying an SMS enquiry | Promise availability or book a job |
| Extracting details from a call summary | Turn uncertain statements into confirmed facts |
| Identifying missing information | Invent missing customer information |
| Suggesting follow-up actions | Accept tasks and uncertain due times without review |
| Matching requested work to catalog services | Invent services or prices |
| Preparing editable document drafts | Finalize or send financial documents |
| Flagging configured high-risk situations | Act as an emergency-response service |
| Summarizing information | Mark a job completed or a payment collected |

AI analysis may receive the summary or transcription the user submits. Later document preparation uses scoped customer messages and selected confirmed note details rather than indiscriminately copying internal records.

Human-attention and safety flags are assistive safeguards, not guarantees that every urgent or dangerous situation will be recognized.

---

## 10. Accounts, Teams, and Business Separation

### Business accounts

The application includes:

- Email/password registration
- Email verification
- Sign-in and sign-out
- Password recovery
- Database-backed sessions
- Authentication rate limits
- Session revocation following password resets

Authentication uses Better Auth rather than a custom password system.

### Multiple businesses

An account can belong to more than one business.

Access and permissions are determined separately for each membership. Someone may be an owner in one business and staff in another.

Business records, including customers, leads, services, tasks, and documents, remain scoped to the appropriate business.

### Owner and staff permissions

| Capability | Owner | Staff |
|---|---:|---:|
| Work with leads, customers, notes, and follow-ups | Yes | Yes |
| Create and edit financial drafts | Yes | Yes |
| Read service pricing and documents | Yes | Yes |
| Change authoritative catalog pricing | Yes | No |
| Finalize financial documents | Yes | No |
| Approve customer document emails | Yes | No |
| Manage business settings and notification preferences | Yes | No |
| Invite members and change access | Yes | No |

Team invitations use private links tied to the intended verified email address. Owners can revoke invitations, change roles, and remove members.

The system protects against removing the last owner. Automatic team-invitation email delivery is not implemented yet; invitation links can be shared manually.

Permissions are enforced by the API, not merely by hiding dashboard buttons.

---

## 11. Signup and Onboarding

Signup is separate from the home dashboard.

After registration, email verification, and sign-in, a new business enters a **full-screen, step-by-step setup wizard**:

1. Business and industry
2. Contact information
3. Time zone and currency
4. Services and pricing
5. Business phone
6. Notifications
7. Billing and tax
8. Review and finish

The setup experience includes:

- One step per screen
- A simple progress indicator
- Back and Continue controls
- Saved progress
- Resumption after leaving and signing back in
- Optional phone setup
- A final transition into the dashboard

The phone screen starts with the plain question:

> **What is your business' phone number?**

Technical connection details remain secondary.

The final readiness check distinguishes between the core manual workflow and optional live integrations. It does not place test calls or send messages, and its temporary data-flow test is rolled back.

---

## 12. Notifications and Communications

Vennel has three distinct email purposes.

### Account emails

- Email verification
- Password recovery

These are necessary for the normal public account experience.

### Internal owner notifications

Businesses can opt in to notifications about:

- New leads
- Situations needing human attention
- Overdue follow-ups
- Draft documents needing review

The business chooses the recipient and notification preferences.

### Customer document emails

Finalized estimates and invoices require a separate recipient preview and owner approval.

Sending history distinguishes between:

- Queued
- Sending
- Provider accepted
- Failed or blocked
- Cancelled
- Delivered, delayed, bounced, or complained, when verified callbacks are configured

**Provider acceptance is not the same as inbox delivery. Delivery is not proof that the recipient read the message.**

---

## 13. Reporting and Visibility

The current dashboard includes information such as:

- Captured missed-call/SMS leads
- Qualified leads
- Leads still being qualified
- Leads needing human attention
- Booked and won outcomes
- Estimated pipeline value
- Owner-recorded value associated with won work

Financial document views also distinguish drafts, finalized estimates, and finalized invoices.

These figures require careful interpretation:

- Capturing a missed-call lead is not proof that a sale was recovered.
- Estimated pipeline is not earned revenue.
- Owner-recorded won value is not bank-verified payment collection.
- Finalized invoices are not payment receipts.

Vennel should help a business understand its activity without overstating results.

---

## 14. Canadian-First Launch Strategy

The initial commercial focus is **Canadian local service businesses**.

### What already supports that direction

- CAD is a supported business currency.
- Businesses choose their own time zone.
- Scheduling uses business-local time.
- Daylight-saving ambiguities are rejected rather than silently guessed.
- Business billing details and tax registration information can be recorded.
- Owners control the tax rate applied to documents.

Other supported currencies are USD, EUR, GBP, and AUD. Currency changes are restricted once relevant records exist; amounts are not silently converted or relabelled.

### What still requires work or review

#### Canadian tax handling

The current system uses an owner-entered percentage. It does not automatically determine GST, HST, PST, or QST obligations, calculate jurisdiction-specific treatment, or provide tax filing.

#### Privacy and messaging compliance

PIPEDA, applicable provincial privacy requirements, CASL, consent practices, and provider-specific messaging requirements need appropriate review before live commercial use.

#### Language

The initial interface is English. French localization and any Quebec-specific requirements need further work.

#### Data residency

A Canadian brand or `.ca` domain does not establish Canadian-only data residency. Hosting regions, external processors, retention, and privacy disclosures still need a defined production strategy.

---

## 15. Technical Overview

Vennel currently uses a TypeScript-based monorepo.

| Layer | Technology |
|---|---|
| Web application | Next.js and React |
| Interface styling | Tailwind CSS |
| Backend API | Express |
| Database | PostgreSQL |
| Database access and migrations | Prisma |
| Authentication | Better Auth |
| Calls and SMS | Twilio |
| AI processing | OpenAI |
| Transactional email | Resend |
| Validation | Shared TypeScript contracts and Zod |
| Background work | PostgreSQL-backed durable worker |
| Testing | Vitest and Playwright |

### Core records

The main data relationships include:

- Accounts and business memberships
- Businesses
- Customers
- Leads and messages
- Call notes and confirmed facts
- Follow-up tasks and suggestions
- Catalog services
- Estimates, invoices, and line items
- Email delivery approvals and events
- Background jobs and attempts

### Reliability foundations

Implemented safeguards include:

- Durable background jobs
- Worker leases and recovery
- Retry tracking
- Duplicate-event protections
- Provider idempotency
- Revision checks
- Financial document snapshots
- Audit history for important reviewed actions
- Explicit blocked and failed states

Email retries reuse approved content rather than quietly generating a different message.

Some SMS sequencing is still process-local. Durable, multi-instance SMS processing remains a significant production-hardening item.

---

## 16. Current Integration Readiness

The implementation of an integration and the activation of a live provider account are separate milestones.

| Integration | Implemented capability | Remaining activation or validation |
|---|---|---|
| **Twilio** | Call forwarding, missed-call SMS, inbound messaging | Assign a suitable number to the business, configure routing/webhooks, and validate real calls and texts |
| **OpenAI** | Qualification, transcription, extraction, service matching | Validate credentials, supported models, real-world quality, latency, and costs |
| **Resend** | Account emails, owner alerts, approved document emails | Complete verified sender-domain configuration and validate sending |
| **Delivery callbacks** | Signature verification and status reconciliation | Configure the provider webhook and signing secret, then verify real events |

Provider accounts and platform credentials should be managed centrally by the platform operator, not supplied separately by every local business.

Businesses provide their business details, service catalog, answering phone, and preferences.

Phone-number provisioning is currently operator-managed rather than a fully self-service purchase flow.

**Once authenticated, the manual customer, note, task, and document workflows can be used without live phone recovery or AI. Normal public signup still needs working verification-email delivery.**

---

## 17. Current Product Maturity

Vennel is a **functional development-stage product with persistent data and implemented workflows**, not simply a set of mock screens.

Implemented areas include:

- Authenticated accounts and memberships
- Business isolation and owner/staff permissions
- Full-screen onboarding
- Customer and lead workspaces
- Reviewed call notes
- Follow-up tasks and assignments
- Flexible service pricing
- Editable financial drafts
- Owner-approved document finalization
- Approved email delivery workflows
- Durable background processing

Recent completed validation included:

- **23 dashboard test cases**, covering browser workflows and routing policy
- **16 account/API integration test cases**
- Workspace type checks
- Lint and formatting checks
- A full production build
- Desktop and mobile visual checks

Tests cover important flows including signup, saved progress, business permissions, tenant isolation, notes, tasks, pricing, document approval, and delivery safeguards.

**These results do not establish production readiness, compliance certification, or successful operation of every real external-provider scenario.**

---

## 18. What Is Not Implemented Yet

The current product does not include:

- Subscription billing for Vennel itself
- Customer payment collection
- Bank reconciliation or bookkeeping
- A full accounting ledger
- Customer portals
- Electronic quote acceptance or signatures
- PDF attachments in document emails
- Automatic calendar booking or availability management
- Dispatch, route optimization, or full crew scheduling
- Inventory or purchasing management
- Automatic service-catalog file imports
- General CRM or accounting integrations
- Native iOS or Android applications
- Automatic team-invitation emails
- Fully distributed SMS ingestion and ordering
- Certified Canadian tax or regulatory compliance
- Established Canadian-only data residency
- A completed public-production deployment

These should be treated as potential future scope, not features already available.

---

## 19. Commercial Direction

### Proposed business model

A likely model is a **subscription per business**, potentially with allowances or additional charges for:

- Calling and phone numbers
- SMS usage
- AI processing
- Email usage
- Team size or advanced capabilities

This is a proposed direction. Final pricing, packages, billing mechanics, and usage limits have not been established or implemented.

### Initial go-to-market approach

A practical launch path would be:

1. Complete provider activation and production hardening.
2. Recruit a small group of Canadian renovation and HVAC businesses.
3. Observe real customer enquiries and owner workflows.
4. Measure whether Vennel reduces missed follow-ups and administrative work.
5. Refine onboarding and everyday usability.
6. Expand only after reliability and customer value are demonstrated.

### Measures worth validating in a pilot

- Time until a new enquiry receives a response
- Percentage of enquiries receiving appropriate follow-up
- Time required to prepare an estimate
- Lead-to-estimate conversion
- Estimate-to-won-work conversion
- Overdue task frequency
- Owner time spent on administration
- AI corrections required during review
- Messaging and AI cost per active business

Some of these are proposed pilot measures, not existing dashboard reports.

No conversion improvements, revenue gains, or customer results should be claimed without real evidence.

---

## 20. Recommended Development Priorities

### Near-term: make live operation dependable

- Finish the brand/domain decision and sender-domain setup.
- Activate and test real email delivery.
- Assign and test business calling numbers.
- Verify SMS qualification with real conversations.
- Validate AI models and transcription behavior.
- Complete durable, multi-instance SMS processing.
- Establish production HTTPS, ingress, monitoring, backups, and recovery.
- Review dependencies, security configuration, and abuse controls.
- Define usage limits and operating costs.

### Before broader customer adoption

- Complete privacy, consent, messaging, and retention policies.
- Validate Canadian billing and tax presentation.
- Establish support and incident-handling procedures.
- Run a controlled pilot.
- Improve the product based on actual owner behavior.

### Later expansion

Subject to customer demand:

- Additional industry templates
- French-language support
- Catalog imports
- Customer acceptance and payment workflows
- Calendar, accounting, and CRM integrations
- Subscription billing and usage-based commercial plans

These are priorities and possibilities, not dated delivery commitments.

---

## 21. Design Principles

1. **Make the next action clear.**  
   The owner should understand what needs attention without learning technical terminology.

2. **Use plain language.**  
   Ask questions such as "What is your business' phone number?" rather than exposing provider configuration as the primary experience.

3. **Keep the business in control.**  
   AI can prepare and suggest; it cannot independently make financial or scheduling commitments.

4. **Do not invent certainty.**  
   Unknown prices, tentative appointments, and incomplete information must remain visibly uncertain.

5. **Preserve context.**  
   A customer's request should not need to be reconstructed every time someone creates a task or document.

6. **Keep businesses separate.**  
   Customer information, pricing, documents, and permissions belong to the correct business.

7. **Show failures honestly.**  
   A blocked email is not "sent." A queued message is not "delivered." An invoice is not a payment.

8. **Stay focused on local businesses.**  
   The product should reduce administrative work, not introduce enterprise-level complexity before it is needed.

---

## 22. Shareable Short Description

> **Vennel is an AI-assisted customer and workflow platform for local service businesses, launching with a Canadian-first focus. It helps businesses capture missed-call enquiries, organize customer information, record and review call notes, manage follow-ups, and prepare estimates and invoices using their own service catalog. AI assists with the preparation, while owners retain control over prices, customer commitments, document approval, and sending. The product is currently in development, with working core workflows and remaining live-integration and production-readiness work underway.**

### In one line

**Vennel turns scattered customer conversations into clear, owner-controlled next steps.**
