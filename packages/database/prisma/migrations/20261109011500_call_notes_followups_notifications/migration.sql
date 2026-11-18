CREATE TYPE "CallNoteSource" AS ENUM ('TEXT', 'VOICE');
CREATE TYPE "CallNoteReviewStatus" AS ENUM ('DRAFT', 'EXTRACTED', 'REVIEWED');
CREATE TYPE "FollowUpType" AS ENUM ('CALL_CUSTOMER', 'SEND_ESTIMATE', 'CONFIRM_APPOINTMENT', 'REQUEST_INFORMATION', 'FOLLOW_UP_QUOTE', 'PREPARE_INVOICE', 'CUSTOM');
CREATE TYPE "FollowUpStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');
CREATE TYPE "FollowUpSource" AS ENUM ('MANUAL', 'AI', 'AUTOMATION');
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DISMISSED');
CREATE TYPE "BackgroundJobKind" AS ENUM ('OWNER_EMAIL', 'LEAD_FOLLOW_UP_SUGGESTIONS');
CREATE TYPE "BackgroundJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'CANCELLED');
ALTER TABLE "Company" ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'UTC';

CREATE TABLE "CallNote" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "customerId" TEXT, "leadId" TEXT,
  "originalText" TEXT NOT NULL, "text" TEXT NOT NULL,
  "source" "CallNoteSource" NOT NULL DEFAULT 'TEXT',
  "direction" "MessageDirection" NOT NULL DEFAULT 'INBOUND',
  "occurredAt" TIMESTAMP(3) NOT NULL, "phone" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "reviewStatus" "CallNoteReviewStatus" NOT NULL DEFAULT 'DRAFT',
  "extraction" JSONB, "extractionRevision" INTEGER, "confirmedData" JSONB,
  "confirmedFields" TEXT[], "reviewedAt" TIMESTAMP(3), "isArchived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CallNote_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CallNoteAudit" (
  "id" TEXT NOT NULL, "noteId" TEXT NOT NULL, "revision" INTEGER NOT NULL,
  "action" TEXT NOT NULL, "actor" TEXT NOT NULL, "details" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CallNoteAudit_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "FollowUpTask" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "customerId" TEXT NOT NULL,
  "leadId" TEXT, "callNoteId" TEXT, "assignedUserId" TEXT,
  "type" "FollowUpType" NOT NULL, "title" TEXT NOT NULL, "dueAt" TIMESTAMP(3) NOT NULL,
  "status" "FollowUpStatus" NOT NULL DEFAULT 'PENDING',
  "priority" "UrgencyLevel" NOT NULL DEFAULT 'NORMAL', "notes" TEXT,
  "source" "FollowUpSource" NOT NULL DEFAULT 'MANUAL', "revision" INTEGER NOT NULL DEFAULT 1,
  "sourceSuggestionId" TEXT, "completedAt" TIMESTAMP(3), "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FollowUpTask_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "FollowUpAudit" (
  "id" TEXT NOT NULL, "taskId" TEXT NOT NULL, "revision" INTEGER NOT NULL,
  "actor" TEXT NOT NULL, "action" TEXT NOT NULL, "details" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FollowUpAudit_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "FollowUpSuggestion" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "customerId" TEXT, "leadId" TEXT,
  "callNoteId" TEXT, "sourceKey" TEXT NOT NULL, "type" "FollowUpType" NOT NULL,
  "title" TEXT NOT NULL, "dueAt" TIMESTAMP(3), "dueText" TEXT,
  "priority" "UrgencyLevel" NOT NULL DEFAULT 'NORMAL', "evidence" TEXT,
  "source" "FollowUpSource" NOT NULL, "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FollowUpSuggestion_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "NotificationPreference" (
  "companyId" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT false,
  "recipientEmail" TEXT, "consentedAt" TIMESTAMP(3), "newLeads" BOOLEAN NOT NULL DEFAULT true,
  "humanAttention" BOOLEAN NOT NULL DEFAULT true, "overdueFollowUps" BOOLEAN NOT NULL DEFAULT true,
  "documentReview" BOOLEAN NOT NULL DEFAULT true, "documentReminderHours" INTEGER NOT NULL DEFAULT 24,
  "optOutToken" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("companyId")
);
CREATE TABLE "BackgroundJob" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "kind" "BackgroundJobKind" NOT NULL,
  "eventKey" TEXT NOT NULL, "payload" JSONB NOT NULL, "deliveryPayload" JSONB,
  "status" "BackgroundJobStatus" NOT NULL DEFAULT 'PENDING',
  "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempts" INTEGER NOT NULL DEFAULT 0, "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "leaseToken" TEXT, "leaseUntil" TIMESTAMP(3), "firstAttemptAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3), "lastError" TEXT, "providerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "JobAttempt" (
  "id" TEXT NOT NULL, "jobId" TEXT NOT NULL, "attempt" INTEGER NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" TIMESTAMP(3),
  "outcome" TEXT, "error" TEXT, "providerId" TEXT,
  CONSTRAINT "JobAttempt_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WorkerHeartbeat" (
  "id" TEXT NOT NULL, "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CallNote_companyId_occurredAt_idx" ON "CallNote"("companyId", "occurredAt");
CREATE INDEX "CallNote_customerId_idx" ON "CallNote"("customerId");
CREATE INDEX "CallNote_leadId_idx" ON "CallNote"("leadId");
CREATE INDEX "CallNoteAudit_noteId_createdAt_idx" ON "CallNoteAudit"("noteId", "createdAt");
CREATE UNIQUE INDEX "FollowUpTask_sourceSuggestionId_key" ON "FollowUpTask"("sourceSuggestionId");
CREATE INDEX "FollowUpTask_companyId_status_dueAt_idx" ON "FollowUpTask"("companyId", "status", "dueAt");
CREATE INDEX "FollowUpTask_customerId_idx" ON "FollowUpTask"("customerId");
CREATE INDEX "FollowUpTask_leadId_idx" ON "FollowUpTask"("leadId");
CREATE INDEX "FollowUpTask_callNoteId_idx" ON "FollowUpTask"("callNoteId");
CREATE INDEX "FollowUpAudit_taskId_createdAt_idx" ON "FollowUpAudit"("taskId", "createdAt");
CREATE INDEX "FollowUpSuggestion_companyId_status_idx" ON "FollowUpSuggestion"("companyId", "status");
CREATE INDEX "FollowUpSuggestion_customerId_idx" ON "FollowUpSuggestion"("customerId");
CREATE INDEX "FollowUpSuggestion_leadId_idx" ON "FollowUpSuggestion"("leadId");
CREATE INDEX "FollowUpSuggestion_callNoteId_idx" ON "FollowUpSuggestion"("callNoteId");
CREATE UNIQUE INDEX "FollowUpSuggestion_companyId_sourceKey_key" ON "FollowUpSuggestion"("companyId", "sourceKey");
CREATE UNIQUE INDEX "NotificationPreference_optOutToken_key" ON "NotificationPreference"("optOutToken");
CREATE INDEX "BackgroundJob_status_dueAt_idx" ON "BackgroundJob"("status", "dueAt");
CREATE INDEX "BackgroundJob_leaseUntil_idx" ON "BackgroundJob"("leaseUntil");
CREATE UNIQUE INDEX "BackgroundJob_companyId_eventKey_key" ON "BackgroundJob"("companyId", "eventKey");
CREATE UNIQUE INDEX "JobAttempt_jobId_attempt_key" ON "JobAttempt"("jobId", "attempt");
ALTER TABLE "CallNote" ADD CONSTRAINT "CallNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CallNote" ADD CONSTRAINT "CallNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CallNote" ADD CONSTRAINT "CallNote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CallNoteAudit" ADD CONSTRAINT "CallNoteAudit_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "CallNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_callNoteId_fkey" FOREIGN KEY ("callNoteId") REFERENCES "CallNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_sourceSuggestionId_fkey" FOREIGN KEY ("sourceSuggestionId") REFERENCES "FollowUpSuggestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FollowUpAudit" ADD CONSTRAINT "FollowUpAudit_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "FollowUpTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FollowUpSuggestion" ADD CONSTRAINT "FollowUpSuggestion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FollowUpSuggestion" ADD CONSTRAINT "FollowUpSuggestion_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FollowUpSuggestion" ADD CONSTRAINT "FollowUpSuggestion_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FollowUpSuggestion" ADD CONSTRAINT "FollowUpSuggestion_callNoteId_fkey" FOREIGN KEY ("callNoteId") REFERENCES "CallNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BackgroundJob" ADD CONSTRAINT "BackgroundJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobAttempt" ADD CONSTRAINT "JobAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "BackgroundJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
