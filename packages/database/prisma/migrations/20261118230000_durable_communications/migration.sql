ALTER TYPE "BackgroundJobKind" ADD VALUE 'INBOUND_SMS';
ALTER TYPE "BackgroundJobKind" ADD VALUE 'MISSED_CALL_RECOVERY';

CREATE TYPE "CommunicationEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "SmsDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'ACCEPTED', 'SENT', 'DELIVERED', 'FAILED', 'UNKNOWN');

CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "nextSequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Conversation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Conversation_companyId_phone_key" ON "Conversation"("companyId", "phone");

ALTER TABLE "WebhookEvent"
    ADD COLUMN "companyId" TEXT,
    ADD COLUMN "providerId" TEXT,
    ADD COLUMN "conversationId" TEXT,
    ADD COLUMN "sequence" INTEGER,
    ADD COLUMN "payload" JSONB,
    ADD COLUMN "status" "CommunicationEventStatus" NOT NULL DEFAULT 'RECEIVED',
    ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "lastError" TEXT,
    ADD COLUMN "completedAt" TIMESTAMP(3),
    ADD COLUMN "inboundMessageId" TEXT,
    ADD COLUMN "outboundMessageId" TEXT,
    ADD COLUMN "jobId" TEXT,
    ADD CONSTRAINT "WebhookEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "WebhookEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "WebhookEvent_inboundMessageId_fkey" FOREIGN KEY ("inboundMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "WebhookEvent_outboundMessageId_fkey" FOREIGN KEY ("outboundMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "WebhookEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "BackgroundJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Historical markers have no replayable payload. Do not silently resend old messages at rollout.
UPDATE "WebhookEvent" SET "status" = 'COMPLETED', "completedAt" = "createdAt";

CREATE UNIQUE INDEX "WebhookEvent_companyId_eventType_providerId_key" ON "WebhookEvent"("companyId", "eventType", "providerId");
CREATE UNIQUE INDEX "WebhookEvent_conversationId_sequence_key" ON "WebhookEvent"("conversationId", "sequence");
CREATE UNIQUE INDEX "WebhookEvent_inboundMessageId_key" ON "WebhookEvent"("inboundMessageId");
CREATE UNIQUE INDEX "WebhookEvent_outboundMessageId_key" ON "WebhookEvent"("outboundMessageId");
CREATE UNIQUE INDEX "WebhookEvent_jobId_key" ON "WebhookEvent"("jobId");
CREATE INDEX "WebhookEvent_conversationId_status_sequence_idx" ON "WebhookEvent"("conversationId", "status", "sequence");

CREATE TABLE "SmsDelivery" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fromPhone" TEXT NOT NULL,
    "toPhone" TEXT NOT NULL,
    "status" "SmsDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "providerId" TEXT,
    "providerStatus" TEXT,
    "sendStartedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SmsDelivery_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SmsDelivery_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SmsDelivery_messageId_key" ON "SmsDelivery"("messageId");
CREATE UNIQUE INDEX "SmsDelivery_providerId_key" ON "SmsDelivery"("providerId");
CREATE INDEX "SmsDelivery_status_updatedAt_idx" ON "SmsDelivery"("status", "updatedAt");
