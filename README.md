# Lead Recovery

AI-powered missed-call recovery, customer management, and owner-reviewed estimates and invoices for home-service businesses.

## Business workspace

- Responsive sidebar navigation, business switching, an opportunity overview, and a searchable lead inbox.
- Business-specific customer records with contact details, internal notes, linked leads, and document history.
- Service catalogs with descriptions, categories, units, matching keywords, and fixed prices, estimated ranges or quote-required pricing.
- Editable estimate and invoice drafts with catalog items, custom items, quantities, discounts, and tax.
- Conversation-based estimate preparation using AI to match requested services to the business's active catalog.
- Explicit owner approval, immutable finalized documents, printable documents, and estimate-to-invoice conversion.
- Reviewed call-note/SMS context in the existing document editor, plus separately approved finalized-document emails with delivery history.
- Structured post-call notes, transient voice-summary transcription, evidence-based extraction, and explicit owner review.
- Business-local follow-up tasks and suggestions, customer/lead history, opt-in owner emails, and durable background processing.
- Better Auth accounts, email verification/password reset, database sessions, per-business owner/staff permissions, verified invitations, and shared business onboarding.

**This is an authenticated development-stage application, not a certified public-production release.** Private APIs require a verified account and current business membership. Owner-only actions are enforced on the API, not merely hidden in the dashboard. The old developer-token bypass has been removed. Payment collection is not implemented. Live integrations, deployment hardening, monitoring and retention policies still need release validation before a real-customer pilot.

## Stack

- TypeScript monorepo with pnpm and Turborepo
- Express API
- Next.js dashboard
- PostgreSQL + Prisma
- Twilio voice/SMS webhooks
- OpenAI Responses API structured output
- Zod, ESLint, Prettier, Tailwind CSS

## Workspace

```text
apps/
  api/
  dashboard/
packages/
  database/
  types/
```

## Setup

1. Copy `.env.example` to `.env` and fill in the required values.
2. Install dependencies:

```bash
pnpm install
```

3. Start PostgreSQL and create the database from `DATABASE_URL`.
4. Generate Prisma client and run migrations:

```bash
pnpm db:generate
pnpm db:migrate
```

5. Seed demo data:

```bash
pnpm db:seed
```

6. Start the API and dashboard together:

```bash
pnpm dev
```

This builds shared dependencies and starts the API on port 4000, dashboard on port 3000, and a separate durable worker. PostgreSQL must already be running.

Open `http://localhost:3000/register`. Registration requires verification before login. Configure Resend for real account emails, or use the local development link command below.

`pnpm dev` uses `BETTER_AUTH_SECRET` when configured. Otherwise it generates a persistent secret in the ignored `.local/auth-secret` file, mode 600. It never prints that secret. Keep this file private and stable across restarts; production must use a persistent high-entropy environment secret shared by API instances. Do not copy secrets into `NEXT_PUBLIC_` variables, commits, chat, logs, or test reports.

The browser uses same-origin API/auth proxies. Server-rendered requests forward the current request's cookies rather than a global developer key. Direct unauthenticated data API calls return 401. Mutations require the configured application Origin; CORS is restricted to that origin. Production requires HTTPS, a configured email provider, a persistent auth secret and Twilio signature verification. Use development only on your local machine; do not expose dev servers publicly. Signed Twilio/Resend webhooks and capability-token notification opt-out routes remain separate.

## Phase 4: accounts, business access and onboarding

### Accounts and recovery

- Better Auth handles registration, password hashing, verification, login/logout, password reset and sessions through its Prisma adapter. Passwords require at least 12 characters. Sessions are stored in PostgreSQL, use HttpOnly/SameSite=Lax cookies, and use Secure cookies with HTTPS production settings.
- Verification links expire after one hour. Password-reset links are one-time, expire after one hour, and resetting a password revokes previous sessions.
- Auth rate limits are stored in PostgreSQL rather than process memory. The API overwrites caller-supplied rate-limit identity headers with the connection address. Behind the current same-origin gateway this is a conservative shared bucket; configure trusted ingress/per-client abuse controls before scaling publicly instead of trusting arbitrary forwarded IP headers.
- Security emails use durable `AUTH_EMAIL` jobs scoped to the account, not a business. They are never exposed in business job/history endpoints. The worker does not send expired links and never sends reserved `.test` account recipients to a live provider.
- Automatic account deletion is disabled so an account cannot silently orphan a business's last owner.

Without Resend, register first and run this in **your own local terminal**:

```bash
pnpm accounts:email --email your-address@example.com
```

Open the returned verification/reset link yourself. This command requires a local, non-production database and does not send email. Treat the link as a secret; do not paste it into chat. After verification, sign in normally.

### Existing business data is not automatically claimed

Existing companies, phone numbers, leads, conversations and documents are retained. The migration does not grant them to the first signup. After creating and verifying your account, explicitly bootstrap an unowned business:

```bash
pnpm accounts:grant-owner --email your-address@example.com --company northstar-heating
pnpm accounts:grant-owner --email your-address@example.com --company luxe-renovations
```

The command requires the target account to be verified, records an administrator audit entry, and refuses to replace an already-owned business. Refresh the dashboard afterward. No public endpoint can perform this bootstrap.

### Membership and role policy

Each request checks current membership for the requested business. Business switching lists only authorized memberships. Owning one business does not grant owner privileges in another.

| Action                                                                                        | Owner | Staff |
| --------------------------------------------------------------------------------------------- | ----- | ----- |
| Read business leads, customers, messages, notes, tasks, catalogs and documents                | Yes   | Yes   |
| Manage customers, call notes, lead outcomes and follow-ups                                    | Yes   | Yes   |
| Create/edit proposed estimate and invoice drafts                                              | Yes   | Yes   |
| Edit the authoritative service catalog/pricing                                                | Yes   | No    |
| Finalize documents, preview/approve customer emails and manage delivery retries               | Yes   | No    |
| Edit business settings, integrations, onboarding, notification preferences or background jobs | Yes   | No    |
| Invite/remove members and change roles                                                        | Yes   | No    |

Notes, tasks, final approvals and delivery approvals now record the authenticated actor. Existing historical audit labels remain unchanged. Follow-ups can be assigned only to current members of the same business, with assignee filtering. Removing a member clears their business task assignments and denies subsequent business requests.

Owners manage **Team & access**. Invitation links are opaque, stored only as hashes, expire after seven days, and require the exact verified recipient email to accept. Creation returns a private link to share; it does not automatically send an invitation email. Links can be revoked. Accepted/replayed links never restore a removed member or upgrade an existing role. Company-row locking prevents concurrent role changes from removing the last owner.

### Shared onboarding

After registration, email verification and sign-in, new accounts enter a dedicated full-screen setup wizard, separate from the dashboard. Each screen contains one step, a progress indicator and Back/Continue controls. Step 1 creates the business and makes the account its owner; time zone and currency are chosen on step 3 before prices are added. An eight-step flow covers:

1. Business name and tested industry.
2. Business contact email/phone and service areas.
3. IANA time zone and currency, with consistent dropdowns. Common time zones appear first, followed by the full browser-supported list.
4. The business's service catalog and owner-defined prices.
5. A single **What is your business' phone number?** question for the phone that should ring. Connection details stay collapsed by default. Owners can save with **Continue** or choose **Skip for now** without connecting calls.
6. Explicit owner notification preferences/consent.
7. Billing address, tax registration information and owner-entered default tax.
8. A readiness check and rolled-back customer/note/task/estimate dry run.

The dry run retains no synthetic customer data, does not call anyone, and does not send messages. Optional phone/email integrations can remain unconfigured while owners use manual call notes and estimates; readiness distinguishes that from live missed-call recovery.

Progress is saved after each Continue; Back returns to the last saved values without submitting unfinished fields. Reloading or signing back in resumes unfinished business setup rather than opening the dashboard. The dashboard opens after the final check and completion. Existing staff memberships and legacy businesses are not forced through a new-business signup. Owners adding another business can return to an existing workspace. Revisiting a completed business to edit its details does not restart signup; configuration checks are invalidated and must be rerun before finishing setup again.

Only HVAC and renovation are active. Shared industry defaults live in the typed industry registry used by onboarding and qualification. Cleaning, plumbing, roofing and general repair templates must be implemented/tested before activation; no industry-specific dashboard deployments are required.

Currencies currently supported: USD, CAD, EUR, GBP and AUD. Legacy businesses/data remain USD. Existing amounts are never converted or relabelled; currency changes are blocked after priced records exist. New drafts use business currency and owner-configured default tax. Finalized documents snapshot business contact/billing details, prices, units and the approving account so later profile edits do not change them. Tax remains owner-entered, not jurisdictionally calculated or legally certified.

Incoming Twilio numbers cannot be claimed through onboarding. A platform administrator can verify ownership and assign a number:

```bash
pnpm accounts:assign-number --company your-business-slug --number +15555550123
```

The command queries the configured platform Twilio account, requires an existing owner, and refuses to replace another assigned number. It does not place calls or send SMS. Owners can configure their own forwarding destination. Existing assigned numbers and recovery behavior are preserved. Saving an answering phone does not provision a recovery number or change carrier forwarding settings. To keep an existing public business number, arrange routing to the recovery number separately and use a separate mobile/direct line as the answering destination so calls do not loop back. Test the connection before relying on automatic missed-call texts.

### Deployment prerequisites

Run `pnpm build`, then start the dashboard/API/worker with their package `start`/`worker` commands under a process supervisor. Set `NODE_ENV=production` in the deployment environment so production startup checks apply to both API and worker. Configure HTTPS `DASHBOARD_BASE_URL`, a fixed trusted `API_INTERNAL_URL`, `BETTER_AUTH_SECRET`, Resend and provider webhook secrets. Restrict backend ingress appropriately, share the auth secret across instances, protect the database, and redact auth/invitation link tokens from access logs.

Durable multi-instance communications use the same PostgreSQL worker as notifications. Operational limits, monitoring and live-provider release validation remain required; this is not a blanket production-security certification.

## Milestone 1: call notes and follow-ups

### Post-call notes

- **Add call note** is available globally and from customer/lead detail pages. Notes are separate records, never artificial SMS messages.
- Select/create a customer now or during review, optionally associate a lead, record direction, approximate call time, optional phone number, and the original free-text summary.
- **Dictate a summary** uses browser microphone capture where supported. It records only the owner's post-call summary, not the phone call. The browser caps capture at two minutes; uploads are limited to 10 MB.
- Raw audio is held in memory only for upload/transcription, is not written to the database or disk by this application, and buffers/references are released after completion or failure. OpenAI's own retention policies apply separately. The transcript and note audit history are retained as business records.
- `OPENAI_TRANSCRIPTION_MODEL` defaults to `gpt-transcribe`. Text entry remains available for unsupported browsers, denied permissions, upload failures, missing keys, and provider errors.
- Analysis reuses the configured OpenAI client and existing HVAC/renovation qualification requirements. It returns validated facts with exact note evidence, missing information, proposed/agreed price states, tentative/confirmed appointment states, materials, and follow-up suggestions.
- Analysis never writes canonical customer/lead facts. The owner chooses which facts to confirm, which linked fields to update, and separately approves replacement of existing values. Timestamp and revision checks reject stale reviews.
- Original text, AI extraction, owner review, accepted/rejected information, and edits remain auditable. Note review does not mark a job won/completed, confirm a calendar booking, issue an invoice, or send customer messages.

### Follow-ups

- **Follow-ups** supports callbacks, estimate preparation/sending reminders, appointment confirmation, information requests, quote follow-ups, invoice preparation, and custom tasks.
- Owners can create, edit/reschedule, complete, reopen, or cancel tasks. Tasks retain source, priority, completion/cancellation timestamps, revisions, and audit history.
- Set an IANA business time zone in **Workspace settings**. Existing companies default to UTC without moving historical timestamps. Scheduling rejects nonexistent or ambiguous daylight-saving times instead of guessing.
- Views include overdue, due today, upcoming, completed, and cancelled tasks, with search and priority filtering. Customer/lead pages show associated notes and follow-ups.
- Confirmed note actions and meaningful SMS qualification milestones can produce suggestions. Suggestions do not become tasks until the owner confirms the customer and due time. Repeated note reviews and events do not duplicate tasks.
- Tasks are associated with the existing lead where appropriate; no duplicate job system was introduced. Staff assignment remains unavailable until authenticated memberships exist.

### Owner notifications and durable work

1. Configure `RESEND_API_KEY`, a verified `RESEND_FROM_EMAIL`, and `DASHBOARD_BASE_URL` locally.
2. In **Workspace settings**, enter the owner recipient address, explicitly opt in, and select new-lead, human-attention, overdue-task, and draft-review notifications.
3. Keep the worker running with `pnpm dev`. A separately supervised worker can also use `pnpm --filter @lead-recovery/api worker`.

Notification events and due work are persisted in PostgreSQL. Workers use atomic `FOR UPDATE SKIP LOCKED` leasing, lease fencing/recovery, bounded retries, unique event keys, attempt history, and heartbeat visibility. SQL clock comparisons explicitly use UTC even when PostgreSQL's session time zone is not UTC. Polling discovers durable due work; schedules are not stored in in-memory timers.

Resend retries reuse a fixed payload and idempotency key and stop after 23 hours from the first provider attempt, before the provider's 24-hour key-retention window expires. Expired/ambiguous delivery requires operator verification, not a blind new send. Missing provider configuration produces visible blocked jobs, never a fake sent state. A successful job records provider acceptance; it is not an inbox-delivery guarantee.

Each attempt rechecks business notification consent and relevance. Opt-out links require a confirmation POST, so link scanners do not silently unsubscribe owners; RFC one-click POST is also supported. No customer-facing notification, document delivery, payment collection, or subscription billing was added in this milestone.

## Phase 3: reviewed context and approved document delivery

### Notes to estimates

- Reviewed call notes, customer profiles, and lead details offer **Next document steps** using the existing billing system. Choose a specific note or lead on a customer profile instead of blending unrelated jobs.
- Both manual and AI-assisted estimate preparation preserve an internal context snapshot. It includes selected confirmed note facts and states, customer contact information, and up to 30 inbound SMS messages for the associated lead. Lead-based preparation includes up to five associated reviewed notes.
- Raw note/transcription text, rejected facts, original evidence quotations, and internal customer notes are not used as drafting context. Confirmed facts must actually have been selected during owner review. Source note revisions and AI match provenance remain visible in the document editor.
- AI still matches catalog service IDs with source evidence; the server supplies fixed catalog prices/units and starts quantities at one. Estimated ranges remain guidance, and quote-required items remain unpriced until review. Confirmed proposed/agreed amounts remain context, not automatic overrides. Appointments remain tentative/confirmed as recorded; no bookings are created.
- New preparation requests use a request UUID and scoped uniqueness so retries return the same draft. Source changes during preparation reject stale drafts.
- **Prepare invoice for completed work** is offered only for leads the owner explicitly marked won/completed. The backend checks that outcome and completion timestamp; agreeing to a price is never sufficient. This creates an empty, editable invoice draft for owner review, not a finalized invoice. Normal manual invoice creation remains available for other legitimate billing milestones.
- Existing estimates can be reviewed or converted to invoice drafts. Concurrent conversion attempts reuse one invoice rather than duplicating it.

### Finalized document emails

1. Configure `RESEND_API_KEY` and a verified `RESEND_FROM_EMAIL` locally. Never put credentials into frontend/public environment variables or chat.
2. In **Workspace settings**, enable owner-approved customer document emails, choose the business display name and optional reply-to email, and confirm authorization. The actual From address remains the verified platform sender; arbitrary unverified From addresses are not accepted.
3. Open a finalized estimate/invoice and enter the intended recipient. **Preview customer email** shows the exact sender, recipient, subject, HTML and plain-text document content without sending anything.
4. Confirm the preview and recipient, then **Approve & queue email**. The server verifies the finalized revision, preview digest, business settings and explicit approval. Drafts cannot be delivered. A changed recipient, sender or document requires a new preview.
5. Delivery approval, recipient, sender, revision, immutable customer-facing snapshot, provider receipt and attempt history are stored separately from the locked billing document. The email contains the full finalized document; it does not depend on exposing the private dashboard or linking a customer to localhost.
6. The existing PostgreSQL worker sends the authorized email. Retries use the same snapshotted message and provider idempotency key, with the same 23-hour safe retry window as owner notifications. Missing/removed provider configuration becomes visibly blocked. Disablement cancels queued/blocked jobs; already in-flight or provider-accepted messages cannot be recalled.
7. **Refresh delivery status** shows queued, sending, accepted, blocked, failed, cancelled and, when verified callbacks are configured, delivered/delayed/bounced/complained states. Provider acceptance is not labelled delivered. "Delivered" means the recipient's mail server accepted the message, not that it was read.

Repeated approval requests reuse their delivery record. A second request for the same recipient and finalized revision reopens the existing delivery by default; another copy requires explicit resend approval. Active or ambiguous deliveries cannot be duplicated. Safe retries/cancellation are offered only when appropriate; expired ambiguous deliveries require verification with the provider. A bounce/complaint/suppression requires correcting the recipient instead of blindly resending.

Emails include only the finalized customer-facing document, not AI suggestions, source notes, task details or internal context. They are HTML/plain-text transactional documents, not PDF attachments. Browser print/save-PDF remains available. Sending never updates lead outcomes, confirms job completion, records payment, or subscribes customers to marketing.

### Verified delivery callbacks

Create a Resend webhook pointing to `https://your-public-api/webhooks/resend` and configure its `RESEND_WEBHOOK_SECRET` locally. Subscribe to `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, and `email.suppressed`.

The endpoint verifies Svix signatures against the original raw request body, rejects tampered/expired signatures, deduplicates provider event IDs, and correlates events with delivery receipts. Events arriving before the send receipt are reconciled safely. Only event IDs, provider IDs, event types and timestamps are retained from these callbacks; provider message bodies and recipient payloads are not stored. Without this configuration, the UI can confirm provider acceptance but not mail-server delivery.

### Next milestone: reliability and release hardening

Authentication, verified memberships, roles and shared onboarding are implemented in Phase 4. Durable SMS ingestion/ordering remains separate from the durable email worker; current SMS sequencing is still process-local. Complete deployment/integration validation and Phase 5 hardening before public rollout.

## Customer-to-invoice workflow

1. Select the business in the sidebar. Each business has its own customers, services, and documents.
2. Add customers in **Customers**, or create/link one from a lead detail screen. Phone numbers and email addresses are normalized to prevent duplicate contacts within the same business. Matching phones are suggestions: the owner must confirm the link. Customer records are never silently merged.
3. Owners add services in **Services & pricing**, choosing **Fixed price**, **Estimated range** (minimum and maximum), or **Quote required** (no price). Catalog prices use the business currency (legacy businesses remain USD). Existing services stay fixed-price until edited. Use the description to explain scope, exclusions or what affects the final price, and keywords to describe customer phrases. Archiving excludes a service from new suggestions without changing existing documents.
4. From a lead, choose **Prepare estimate with AI** or **Prepare manually**. AI preparation requires `OPENAI_API_KEY`, an active catalog, and an inbound customer message. Human-attention leads cannot use AI preparation. AI failures are reported explicitly; manual preparation remains available.
5. AI returns catalog service IDs and exact conversation evidence, not prices or quantities. The server copies only fixed catalog prices, starts quantities at 1, and preserves original pricing guidance and uncertainties. Range/quote-required services remain unpriced; neither the AI nor the server chooses a bound or midpoint. Suggestions still require human scope review; AI matching is not a guarantee.
6. In the draft editor, select a customer, review every line (including its pricing unit, such as a visit or hour), add custom items, and enter any discount and applicable tax. New manual line items default to a job unit; catalog and AI items use the service's unit. Units and prices are snapshotted on the document, not read back from the current catalog. Older drafts without units require owner confirmation before finalization. Line amounts are rounded to cents; discounts are applied before tax. Tax is owner-entered, not jurisdictionally determined by the application.
7. Save the draft, enter exact amounts for any unpriced lines, check the review confirmation, and finalize. Blank prices are stored as missing, never $0; incomplete drafts display **Pricing required** instead of misleading totals. Explicitly entered zero prices still mean free. Finalization requires an active customer, at least one line item, and an exact price on every line. It assigns a business-specific document number and snapshots customer and business details. Finalized prices and customer details remain unchanged when the catalog or customer record is edited later. Revision checks prevent stale tabs from overwriting or approving newer edits.
8. Use **Print / save PDF**, or separately preview/approve an email of the finalized document after configuring document delivery. A finalized estimate can create a new, editable invoice draft using the reviewed prices; the invoice needs its own owner approval. An estimate can have only one converted invoice.

Finalization does **not** email or text a document, mark a lead's outcome as sent/won, or collect payment. Track lead outcomes separately and issue invoices only when appropriate for your business. The document template does not yet include a configurable business address, tax registration number, or jurisdiction-specific invoice requirements.

## Validation

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

API tests mock AI, Twilio sends and Resend; no real providers are called. Dashboard tests require the local development stack and PostgreSQL to be running. Test accounts are verified using the proven auth implementation and use synthetic credentials/reserved `.test` emails; fixtures never claim original businesses:

```bash
pnpm --filter @lead-recovery/dashboard exec playwright install chromium
pnpm --filter @lead-recovery/dashboard test
```

Database concurrency tests create and remove an isolated, randomly named PostgreSQL schema. They require schema-creation permissions and never claim work from the application schema:

```bash
RUN_DATABASE_TESTS=true pnpm --filter @lead-recovery/api test -- src/services/workflow-database.integration.test.ts
RUN_DATABASE_TESTS=true pnpm --filter @lead-recovery/api test -- src/services/accounts.integration.test.ts
```

Those integration tests are explicitly skipped without `RUN_DATABASE_TESTS=true`; a skipped test is not a pass.

## Twilio Webhooks

Configure your Twilio voice number to point at public HTTPS endpoints:

- `POST https://your-public-url/webhooks/twilio/voice`
- `POST https://your-public-url/webhooks/twilio/sms`
- Delivery callbacks are attached by the worker to `POST https://your-public-url/webhooks/twilio/sms/status/:id`.

### Durable communications

Apply the `20261118230000_durable_communications` migration and deploy API and worker together; stop old webhook handlers during the cutover. SMS and missed-call webhooks acknowledge only after committing an event and its background job. AI qualification and Twilio API sends run in the existing worker. Run at least one worker; multiple workers coordinate through PostgreSQL, not process-local mutexes.

Events are ordered by business and customer phone. Retries reuse persisted inbound messages and checkpointed qualification/outbound records. Failed or blocked head-of-line events intentionally pause that conversation until safely resolved. Provider acceptance, sending, delivery, failure and unknown outcomes are distinct in conversation history. An uncertain send is **not** automatically resent: Twilio Messaging has no application send-idempotency guarantee. Signed late callbacks can resolve uncertainty; inspect provider records before any manual recovery.

`OPENAI_TIMEOUT_MS` defaults to 20000; `SMS_PROVIDER_TIMEOUT_MS` defaults to 15000. SDK-level automatic retries are disabled; the durable job controls bounded retries. Historical webhook markers are preserved without replaying messages, and historical outbound messages remain explicitly untracked.

For local development you can expose the Express API with either ngrok or Cloudflare Tunnel.

ngrok example:

```bash
ngrok http 4000
```

Cloudflare Tunnel example:

```bash
cloudflared tunnel --url http://localhost:4000
```

Use the HTTPS URL from the tunnel provider in the Twilio webhook configuration.

## Local Notes

- Set `TWILIO_VALIDATE_SIGNATURES=false` only for local development.
- Production should keep Twilio request validation enabled.
- The voice flow forwards the inbound call with a 12-second timeout, then queues recovery only for `no-answer`, `busy`, or `failed` callback states.
- Missed-call retries are protected by business-scoped call idempotency, ordered durable processing and recent-message duplicate suppression.
- HVAC and renovation both use the same qualification engine. Behavior is selected with `getQualificationConfig(company)`.

## API Endpoints

- `GET /health`
- `/api/auth/*` (Better Auth registration, verification, sessions, login/logout and recovery)
- `GET /api/account`
- `POST /api/accounts/businesses`
- `POST /api/accounts/invitations/accept`
- `GET /api/companies`
- `GET /api/workspace/:companyId/info`
- `GET /api/workspace/:companyId/members`
- `GET /api/workspace/:companyId/team`
- `POST /api/workspace/:companyId/team/invitations`
- `POST /api/workspace/:companyId/team/invitations/:id/revoke`
- `PATCH /api/workspace/:companyId/team/members/:id`
- `GET/PATCH /api/workspace/:companyId/onboarding`
- `POST /api/workspace/:companyId/onboarding/check`
- `POST /api/workspace/:companyId/onboarding/complete`
- `GET /api/leads`
- `GET /api/leads/:id`
- `GET /api/workspace/:companyId/customers`
- `POST /api/workspace/:companyId/customers`
- `GET /api/workspace/:companyId/customers/:id`
- `PATCH /api/workspace/:companyId/customers/:id`
- `POST /api/workspace/:companyId/customers/from-lead`
- `GET /api/workspace/:companyId/services`
- `POST /api/workspace/:companyId/services`
- `PATCH /api/workspace/:companyId/services/:id`
- `GET /api/workspace/:companyId/documents`
- `POST /api/workspace/:companyId/documents`
- `POST /api/workspace/:companyId/documents/from-conversation`
- `POST /api/workspace/:companyId/documents/from-context` (request UUID, source, document kind and manual/AI mode)
- `GET /api/workspace/:companyId/documents/:id`
- `PATCH /api/workspace/:companyId/documents/:id` (`revision` and `document`)
- `POST /api/workspace/:companyId/documents/:id/finalize` (`revision` and `approved: true`)
- `POST /api/workspace/:companyId/documents/:id/convert`
- `POST /api/workspace/:companyId/documents/:id/email-preview`
- `GET /api/workspace/:companyId/documents/:id/deliveries`
- `POST /api/workspace/:companyId/documents/:id/deliveries` (preview digest, finalized revision, recipient, request UUID and explicit approval)
- `POST /api/workspace/:companyId/documents/:id/deliveries/:deliveryId/retry`
- `POST /api/workspace/:companyId/documents/:id/deliveries/:deliveryId/cancel`
- `POST /webhooks/resend` (verified raw-body delivery events)
- `GET/POST /api/workspace/:companyId/call-notes`
- `GET/PATCH /api/workspace/:companyId/call-notes/:id`
- `POST /api/workspace/:companyId/call-notes/transcribe`
- `POST /api/workspace/:companyId/call-notes/:id/analyze`
- `POST /api/workspace/:companyId/call-notes/:id/review`
- `PATCH /api/workspace/:companyId/call-notes/:id/archive`
- `GET/POST /api/workspace/:companyId/follow-ups`
- `PATCH /api/workspace/:companyId/follow-ups/:id`
- `PATCH /api/workspace/:companyId/follow-ups/:id/status`
- `GET /api/workspace/:companyId/follow-ups/suggestions`
- `POST /api/workspace/:companyId/follow-ups/suggestions/:id/accept`
- `POST /api/workspace/:companyId/follow-ups/suggestions/:id/dismiss`
- `GET/PATCH /api/workspace/:companyId/settings`
- `GET /api/workspace/:companyId/jobs`
- `POST /api/workspace/:companyId/jobs/:id/retry`
- `GET/POST /api/notifications/unsubscribe/:token` (scoped capability link, no workspace data access)
- `POST /webhooks/twilio/voice`
- `POST /webhooks/twilio/voice/status`
- `POST /webhooks/twilio/sms`
- `POST /webhooks/twilio/sms/status/:id` (verified provider delivery callbacks)

## Demo Flow

1. Customer calls the Twilio number.
2. Twilio forwards to the configured business number.
3. If nobody answers, Twilio calls the status callback.
4. The API durably queues recovery; the worker creates or reuses the lead and submits the recovery SMS.
5. Customer replies by SMS.
6. Emergency messages are deterministically escalated.
7. Non-emergency messages go through background structured OpenAI qualification; the webhook does not wait for AI.
8. Lead fields, messages, and dashboard views update from the same database.

## Production Gaps

This release does not include subscription billing, payment collection, customer acceptance/signatures, jurisdiction-specific tax calculation/compliance certification, catalog file imports, CRM integrations, calendar booking or automatic team-invitation email delivery. Basic business billing profiles, owner/staff access control and durable distributed communications are implemented. Validate production email/phone integrations, HTTPS/ingress, quotas, monitoring, backups and retention before a real-customer pilot.
