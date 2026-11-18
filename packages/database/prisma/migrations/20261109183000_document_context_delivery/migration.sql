ALTER TYPE "BackgroundJobKind" ADD VALUE 'DOCUMENT_EMAIL';
ALTER TABLE "BillingDocument" ADD COLUMN "callNoteId" TEXT,
  ADD COLUMN "contextSnapshot" JSONB, ADD COLUMN "preparationHash" TEXT, ADD COLUMN "preparationKey" TEXT;
ALTER TABLE "Company" ADD COLUMN "documentEmailEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "documentReplyTo" TEXT, ADD COLUMN "documentSenderName" TEXT;

CREATE TABLE "DocumentDelivery" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "documentId" TEXT NOT NULL,
  "documentRevision" INTEGER NOT NULL, "requestKey" TEXT NOT NULL, "recipientEmail" TEXT NOT NULL,
  "senderName" TEXT NOT NULL, "senderEmail" TEXT NOT NULL, "replyTo" TEXT,
  "documentSnapshot" JSONB NOT NULL, "previewHash" TEXT NOT NULL,
  "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "approvedBy" TEXT NOT NULL,
  "jobId" TEXT NOT NULL, "providerId" TEXT, "acceptedAt" TIMESTAMP(3),
  CONSTRAINT "DocumentDelivery_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "DocumentDeliveryEvent" (
  "id" TEXT NOT NULL, "providerId" TEXT NOT NULL, "deliveryId" TEXT, "type" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL, "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentDeliveryEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DocumentDelivery_jobId_key" ON "DocumentDelivery"("jobId");
CREATE UNIQUE INDEX "DocumentDelivery_providerId_key" ON "DocumentDelivery"("providerId");
CREATE INDEX "DocumentDelivery_companyId_documentId_approvedAt_idx" ON "DocumentDelivery"("companyId", "documentId", "approvedAt");
CREATE UNIQUE INDEX "DocumentDelivery_companyId_requestKey_key" ON "DocumentDelivery"("companyId", "requestKey");
CREATE INDEX "DocumentDeliveryEvent_providerId_idx" ON "DocumentDeliveryEvent"("providerId");
CREATE INDEX "DocumentDeliveryEvent_deliveryId_occurredAt_idx" ON "DocumentDeliveryEvent"("deliveryId", "occurredAt");
CREATE INDEX "BillingDocument_callNoteId_idx" ON "BillingDocument"("callNoteId");
CREATE UNIQUE INDEX "BillingDocument_companyId_preparationKey_key" ON "BillingDocument"("companyId", "preparationKey");
ALTER TABLE "BillingDocument" ADD CONSTRAINT "BillingDocument_callNoteId_fkey" FOREIGN KEY ("callNoteId") REFERENCES "CallNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DocumentDelivery" ADD CONSTRAINT "DocumentDelivery_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentDelivery" ADD CONSTRAINT "DocumentDelivery_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "BillingDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentDelivery" ADD CONSTRAINT "DocumentDelivery_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "BackgroundJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentDeliveryEvent" ADD CONSTRAINT "DocumentDeliveryEvent_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "DocumentDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
