# Vennel: controlled-pilot readiness and operations

This hardening makes the existing communications pipeline durable. It is not a
certification of live telephony, delivery, infrastructure security, Canadian
messaging compliance, or production disaster recovery.

## 1. Findings verified against the implementation

| Area                  | Finding                                                                                                                                                                          | Resolution                                                                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Incoming SMS          | Confirmed: the provider ID was recorded before lead creation, qualification and message persistence completed. A crash could make retries disappear.                             | Commit an immutable event and its job together before acknowledging. Persist processing checkpoints and retry history.                                                                 |
| Conversation locking  | Confirmed: promise chains coordinated only one Node process.                                                                                                                     | PostgreSQL allocates business/phone sequence numbers; claims cannot pass an incomplete earlier event. Fence every conversation checkpoint with the current worker lease.               |
| Missed calls          | Confirmed: a handled marker preceded the synchronous provider send; missing credentials could also return a success-shaped null.                                                 | Durable recovery jobs, explicit configuration failures, persisted send intent and provider receipts.                                                                                   |
| SMS webhook latency   | Confirmed: the webhook awaited AI and returned an untracked TwiML reply.                                                                                                         | Empty Twilio-compatible acknowledgement after commit; worker qualification and outbound REST messaging.                                                                                |
| Delivery evidence     | Confirmed: an outbound message row did not establish provider acceptance or delivery.                                                                                            | Separate pending, sending, accepted, sent, delivered, failed and unknown states, signed callbacks, bounded status reconciliation and honest historical labels.                         |
| Existing durable work | Already implemented: PostgreSQL claims, skip-locked concurrency, expiring leases, exponential retries, email idempotency, transactional owner notifications and attempt history. | Extend that infrastructure; no Redis or second queue. Add atomic attempt creation, renewal, fencing, exhausted-lease recovery, bounded concurrency and draining.                       |
| Accounts and tenants  | Already substantially implemented: verified accounts, database sessions, live membership checks, owner/staff permissions and same-origin mutations.                              | Preserve those controls and expand isolation/recovery tests. Do not treat business IDs or client role headers as authorization.                                                        |
| Pilot operation       | Confirmed gaps: no database-backed general API/AI/SMS budgets, shallow liveness, unsafe raw error logging, and inadequate shutdown handling.                                     | Shared limits, database/worker readiness, redacted structured errors and graceful shutdown.                                                                                            |
| Failure visibility    | New reconciliation volume could hide an old blocked job behind the 100 newest jobs.                                                                                              | Show oldest failed/blocked jobs first, then recent work. A regression creates 125 newer successful jobs and verifies the old failure remains visible.                                  |
| Browser consistency   | Recovery could succeed while its displayed status remained stale. Production navigation also retained stale workspace/setup state at business boundaries.                        | Return the committed typed delivery state and render it directly. Business switching and leaving business creation use fresh navigation to discard the prior workspace's cached state. |
| Dependencies          | Confirmed critical advisories in the pinned Next.js release and affected supporting packages.                                                                                    | Patch Next.js/React/auth/HTTP dependencies; update Zod and compatible SDK/test tooling. One Prisma configuration-tooling advisory remains explicitly tracked below.                    |

## 2. Architecture and important changes

```text
Twilio webhook
  -> verify signature and validate payload/business routing
  -> transaction: conversation sequence + webhook event + existing background job
  -> acknowledge with valid empty TwiML

Existing PostgreSQL worker
  -> atomic claim + attempt record + renewable lease
  -> earliest incomplete event for business/customer phone
  -> transaction: persist inbound message and lead once
  -> AI outside transactions, with request timeout and bounded job retries
  -> transaction: fenced lead changes + owner/milestone jobs + outbound record
  -> transaction: reserve usage and persist SENDING intent
  -> Twilio REST request outside transactions
  -> persist provider evidence; complete the event and fenced job

Signed delivery callback / bounded provider GET / explicit owner review
  -> verify correlation and monotonically update delivery state
  -> resolve uncertainty without automatically submitting another SMS
```

Important modules:

- [Communication processing](apps/api/src/services/communication.service.ts),
  [job infrastructure](apps/api/src/services/background-job.service.ts),
  [lease fencing](apps/api/src/services/conversation-lock.service.ts) and
  [worker lifecycle](apps/api/src/worker.ts).
- [SMS delivery and review](apps/api/src/services/sms-delivery.service.ts),
  [Twilio adapter](apps/api/src/services/twilio.service.ts),
  [SMS webhooks](apps/api/src/routes/sms.ts) and
  [voice forwarding/recovery](apps/api/src/routes/voice.ts).
- [Provider budgets](apps/api/src/services/provider-usage.service.ts),
  [API rate limits](apps/api/src/middleware/api-rate-limit.ts),
  [environment validation](apps/api/src/env.ts) and
  [readiness](apps/api/src/routes/health.ts).
- [Delivery panel](apps/dashboard/components/sms-delivery-panel.tsx),
  [conversation history](apps/dashboard/components/conversation-view.tsx),
  [operator job history](apps/dashboard/components/workspace-settings.tsx) and
  [shared contracts](packages/types/src/workflows.ts).
- [Business switching](apps/dashboard/components/app-shell.tsx) and
  [setup exit](apps/dashboard/components/onboarding-shell.tsx) establish fresh
  workspace boundaries without changing ordinary in-workspace navigation.
- [Database failure scenarios](apps/api/src/services/communications.integration.test.ts)
  and [browser regressions](apps/dashboard/e2e/communications-reliability.spec.ts).

Additive migrations:

1. [Durable communications](packages/database/prisma/migrations/20261118230000_durable_communications/migration.sql):
   conversations, event state/checkpoints, SMS delivery records and job kinds.
2. [Pilot safeguards](packages/database/prisma/migrations/20261118233000_pilot_safeguards/migration.sql):
   usage counters, audited owner recovery and reconciliation jobs.

Existing leads, customers, messages, approvals and account data are retained.
Historical webhook markers have no replayable payload. They remain compatibility
markers and are not automatically replayed. Their migrated completion state is
not proof that an old workflow or delivery actually finished. Investigate any
pre-migration gaps against Twilio records. Historical outbound messages without
provider evidence remain explicitly untracked.

## 3. Guarantees and intentional boundaries

- **Durable admission:** a successful SMS/missed-call acknowledgement follows
  the event/job transaction commit. Database failures do not return a fake success.
- **Idempotent local effects:** provider/business event keys and checkpointed
  message links prevent duplicate leads, qualification commits and outbound
  records when webhooks or worker attempts repeat.
- **Ordered conversation state:** an incomplete event blocks later work for the
  same business/customer phone. Unrelated conversations can run concurrently.
  Ordering is database admission order, not a reconstruction of carrier timestamps.
- **Recoverable claims:** leases last 120 seconds and renew every 40 seconds.
  Expired attempts can be reclaimed; stale results cannot commit conversation
  changes. Exhausted crash attempts become visible failed work with human flags.
- **Bounded retries:** normally five attempts, with 30-second exponential backoff
  capped at one hour. Explicit operator retry grants another bounded batch.
  Failed/blocked head-of-line events intentionally pause, rather than silently
  reorder, their conversation.
- **No external calls in transactions:** AI, SMS sending and provider status
  retrieval run outside database transactions.
- **No invented SMS commitments:** AI still extracts industry-specific fields,
  but customer-facing intake uses server-owned questions and handoffs, not model
  prose. Emergency handling remains deterministic. Later AI cannot clear human
  attention, and concurrent human changes trigger qualification retry.
- **Meaningful evidence:** accepted/sent is not delivered. Duplicate and late
  callbacks cannot downgrade delivered evidence. A failed delivery flags human
  attention. Provider lookup never needs to submit another SMS.
- **Acknowledged UI state:** owner recovery returns the committed delivery
  record, which the panel renders directly instead of depending on a later
  server-component refresh to correct the displayed state.
- **Safe alerting:** existing opted-in owner notifications remain transactional.
  A recovery failure with no customer reply does not enqueue unsupported AI
  follow-up suggestions without conversation evidence.
- **Voice compatibility:** forwarding and its 12-second dial timeout remain.
  Anonymous, client and SIP caller identifiers still forward; non-SMS identifiers
  produce a recorded no-recovery outcome rather than an invalid SMS request.

There is **no claim of exactly-once carrier delivery**. A process can die between
persisting send intent and recording a provider receipt. Timeouts and send-side
5xx responses are ambiguous, not proof of rejection. Automatic resubmission is
limited to known non-acceptance, such as HTTP 429 or failure to establish a
connection. Application restarts never blindly resend an uncertain request.

When no provider ID is known, a signed late callback can establish acceptance.
Otherwise an owner must inspect Twilio logs and verify the original worker has
stopped. Only an explicit, audited assertion that the SMS was **not accepted**
permits another attempt. A wrong assertion, an unaccounted-for stale process, or
carrier behaviour can still produce a duplicate.

## 4. Deployment and provider activation

Use the locked dependency versions and a supported runtime; validation used
Node 24.16.0 and pnpm 9.12.3.

### Configuration

Keep secrets in a deployment secret manager, never in `NEXT_PUBLIC_` variables,
commits, URLs, screenshots or application/access logs.

| Setting                                   | Requirement / default                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                            | Shared writable PostgreSQL primary for every API and worker.                                                              |
| `BETTER_AUTH_SECRET`                      | Persistent high-entropy secret, at least 32 characters, shared across API instances.                                      |
| `NODE_ENV`                                | `production` for deployed API/worker; never expose test/development settings to customer traffic.                         |
| `DASHBOARD_BASE_URL`                      | Canonical public HTTPS application origin.                                                                                |
| `API_BASE_URL`                            | Canonical public HTTPS API origin, with unchanged webhook paths/query strings through ingress.                            |
| `API_INTERNAL_URL`                        | Fixed trusted backend HTTP(S) origin for the dashboard proxy.                                                             |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`     | Valid provider key and verified sender; required by production account verification.                                      |
| `RESEND_WEBHOOK_SECRET`                   | Configure for verified document-email delivery callbacks.                                                                 |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Configure together for the platform account; verify ownership of assigned business numbers.                               |
| `TWILIO_VALIDATE_SIGNATURES`              | Must be `true` in production.                                                                                             |
| `TWILIO_SMS_REPLY_MODE`                   | `openai`; hardcoded verification mode is development-only.                                                                |
| `OPENAI_API_KEY`, `OPENAI_MODEL`          | Activate a supported Responses API model; qualification default is `gpt-4.1-mini`.                                        |
| `OPENAI_TRANSCRIPTION_MODEL`              | Select a transcription model actually available to the provider account before enabling dictation.                        |
| `OPENAI_TIMEOUT_MS`                       | Qualification/client default 20000; supported range 1000-60000. Other workflow requests retain explicit bounded timeouts. |
| `SMS_PROVIDER_TIMEOUT_MS`                 | Default 15000; supported range 1000-30000.                                                                                |
| `WORKER_CONCURRENCY`                      | Default 4 per process, allowed 1-16; size database connections and provider capacity accordingly.                         |
| `WORKER_POLL_INTERVAL_MS`                 | Default 1000; worker sleep is capped at five seconds for responsive heartbeats/shutdown.                                  |
| `API_RATE_LIMIT_PER_MINUTE`               | Default 120 per authenticated account, shared across instances.                                                           |
| `AI_DAILY_REQUEST_LIMIT`                  | Default 200 per business per UTC day.                                                                                     |
| `AI_DAILY_AUDIO_BYTE_LIMIT`               | Default 20971520 bytes per business per UTC day.                                                                          |
| `SMS_DAILY_SEND_LIMIT`                    | Default 500 submissions per business per UTC day.                                                                         |

Unset unused optional email/signing values rather than assigning invalid empty
strings. Configuration presence is not a live-provider connectivity test.
Usage reservations count attempts conservatively, not billing units, SMS segments
or a guaranteed dollar spend. Configure provider-side spend alerts/limits and
restrict Twilio geographic permissions to the intended pilot.

### Coordinated rollout

1. Take a protected backup and prove a restore into a separate database.
2. Stop old inline webhook handlers and workers during cutover. Configure and
   verify Twilio timeout/5xx retry and voice fallback behaviour first; do not
   acknowledge a maintenance failure with HTTP 200.
3. Generate the client and apply migrations using a migration role:

   ```bash
   pnpm install --frozen-lockfile
   pnpm db:generate
   pnpm --filter @lead-recovery/database exec prisma migrate deploy
   pnpm build
   ```

4. Start the dashboard, API and at least one separately supervised worker.
   The API/worker commands are `pnpm --filter @lead-recovery/api start` and
   `pnpm --filter @lead-recovery/api worker`.
5. Check `/health` for liveness and `/health/ready` for database plus recent
   successful worker polling. Readiness is not a provider-delivery guarantee.
6. Configure Twilio `POST /webhooks/twilio/voice` and
   `POST /webhooks/twilio/sms`. Forwarding supplies the voice action callback.
   The worker attaches `POST /webhooks/twilio/sms/status/:id` to each send.
   Preserve the exact public URL for signature verification.
7. Test answered calls, missed calls, text replies, delivery callbacks, owner
   alerts, worker restarts and provider failures with approved test numbers
   before routing real contractor traffic.

Restrict backend ingress, enforce edge connection/body/rate limits, sanitize
forwarded headers at trusted ingress and retain HTTPS throughout the public
boundary. The application does not trust arbitrary forwarded IPs for identity.
Preserve clock synchronization and PostgreSQL durable WAL/commit settings.

## 5. Monitoring and recovery

- Alert on failed/blocked jobs, old pending events, expired running leases,
  exhausted attempts, unknown SMS outcomes, repeated provider rejection,
  quota exhaustion and stale worker heartbeats. Assign a human responder.
- Workspace settings prioritize failed/blocked jobs before newer successful
  work; the view remains capped at 100. Use scoped database/operator reporting
  for larger backlogs rather than assuming this is the entire history.
- Owner SMS review supports verified MessageSid lookup and explicit
  verified-unsent retry. Ordinary job retry rejects uncertain sends.
- Review queued work before reassigning a Twilio number or deactivating a
  business. Existing jobs recheck current business/number authorization.
- Stop claiming on shutdown, allow active requests/jobs to drain, and give the
  worker termination grace longer than its longest bounded external request.
  Force-killed work is recovered by leases, not by guessing a send outcome.
- Keep structured job/delivery IDs for diagnosis. Do not add message bodies,
  provider credentials, auth links, invitation tokens or session cookies to logs.
- OpenAI Responses requests use `store: false`; this does not establish zero
  provider retention, Canadian data residency or a completed privacy review.

## 6. Backup and disaster recovery

Use managed encrypted backups plus WAL/PITR where available. Define an owner,
retention, RPO and RTO, monitor backup failures, and schedule restore drills.
Backups contain customer conversations, account/session data and private links.
Protect them as production secrets.

For a logical backup, configure private PostgreSQL service/pass files rather
than putting a credential-bearing URL on a command line:

```bash
PGSERVICE=vennel_backup pg_dump \
  --format=custom --no-owner --file=/secure/vennel-before-hardening.dump
```

Have the database operator provision a separate empty restore database and
verify that the restore service cannot point to production:

```bash
psql 'service=vennel_restore' -c 'SELECT current_database(), current_schema();'
pg_restore --dbname='service=vennel_restore' --no-owner --no-acl \
  --exit-on-error /secure/vennel-before-hardening.dump
```

Then verify schema/migrations, tenant access, counts and representative workflows.
Keep restored workers and outbound providers disabled until inspecting queued
jobs and reconciling sends already accepted outside the restored database.
Restoring an older snapshot can otherwise replay work that happened after the
backup. Do not delete unknown delivery evidence or reset jobs indiscriminately.

These are activation/recovery instructions, not a claim that a production
backup, PITR policy or restore drill was performed during this implementation.

## 7. Verification

Validation used real local PostgreSQL in owned, randomly named schemas.
Production builds and browser tests used a separate source/dependency snapshot
and ports 3187/4187 so existing project servers were not stopped or rebuilt.
Browser tests used the production dashboard build with a loopback test API,
synthetic accounts and no configured outbound provider credentials.

| Check                                                                                                                      | Executed outcome                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RUN_DATABASE_TESTS=true pnpm --filter @lead-recovery/api test`                                                            | 279 tests passed in 32 current-source files.                                                                                                                                                                                                      |
| Communications database scenarios                                                                                          | 41 cases, including duplicates across API instances, conversation ordering/concurrency, crashes, stale-worker fencing, AI timeout/fallback, ambiguous sends, signed/out-of-order callbacks, quotas, shutdown and the 100-job visibility boundary. |
| Actual AI SDK transport                                                                                                    | Local synthetic HTTP provider verified structured output, `store: false`, 1200 output-token cap, a one-second test timeout, one request and no SDK retry. No paid qualification call was validated.                                               |
| `pnpm exec turbo run typecheck lint --force`                                                                               | All four workspace type checks and all four lint tasks passed without cache.                                                                                                                                                                      |
| `pnpm exec turbo run build --force`                                                                                        | All four production builds passed in isolation; final UI navigation changes also passed a fresh dashboard production build.                                                                                                                       |
| `prisma migrate deploy`                                                                                                    | All 12 migrations applied in the isolated browser-validation schema.                                                                                                                                                                              |
| `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code` | No difference detected.                                                                                                                                                                                                                           |
| Complete Playwright suite                                                                                                  | 27 tests passed, including all four new communications cases, mobile width checks, accounts, switching, notes/follow-ups and financial approval regressions.                                                                                      |
| Compiled worker lifecycle                                                                                                  | Readiness changed from 503 to 200 after worker startup and returned to 503 after SIGTERM; shutdown exited successfully with zero heartbeats and zero running jobs in the isolated schema.                                                         |
| `pnpm audit --prod --json`                                                                                                 | Nonzero exit: one high `deepmerge-ts` advisory through Prisma configuration tooling; zero critical, moderate or low findings in the last audit.                                                                                                   |

`pnpm exec prettier --check` also passed for every changed TypeScript, TSX, MTS,
JSON and Markdown file; Prisma formatting and the database schema-drift check
were performed separately.

Initial failed checks were not counted as passes. Validation corrected misplaced
JSX/test registration, a test-config/root-directory mismatch, a stale email mock
and external-test egress guard, and a missing shared type import. Browser testing
found and fixed stale recovery display and workspace-boundary navigation. A
gateway test was corrected to test truly unauthenticated access in both modes,
rather than treating an authenticated production request's forwarded IP as an
authorization decision. The final source-only test configuration excludes stale
compiled tests instead of inflating the result count. An early isolated
account-email fixture escaped its mock and received Resend HTTP 401 using a
synthetic key; the module cycle was removed and the suites now block HTTP
egress outside their owned local servers. No live delivery was established.

Builds retain the existing warning that the Next.js-specific ESLint plugin is
not configured; repository ESLint checks pass. The local package configuration
also emits an unset `NPM_TOKEN` interpolation warning inside Turbo tasks.

## 8. Remaining limitations and pilot blockers

Before onboarding real contractors:

1. Complete live Twilio/Resend/OpenAI activation, approved-number ownership,
   sender verification, signature/callback testing and provider billing limits.
   No live SMS acceptance/delivery or live AI qualification was certified.
2. Verify production HTTPS, ingress restrictions/abuse controls, secret rotation,
   worker supervision, monitoring and a real backup/PITR restore drill.
3. Obtain a fix or an approved risk decision for
   [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx).
   Prisma 6's configuration dependency uses affected `deepmerge-ts` 7.
   The advisory requires cyclic JavaScript object graphs, not ordinary JSON.
   This project does not pass user-created recursive graphs to configuration
   tooling. No unsupported transitive major override was forced merely to make
   the audit green.
4. Establish Canadian messaging consent/opt-out, privacy, retention and incident
   response procedures with the business and providers. These are not supplied
   by a software test pass.
5. Assign an operator for paused/uncertain conversations and historical
   pre-migration gaps. Human verification remains necessary for ambiguous sends.

The existing application database was not migrated or deployed by this task.
Apply both new migrations and restart API/worker together before enabling the
new communications path in a real environment.
