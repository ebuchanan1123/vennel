ALTER TYPE "BackgroundJobKind" ADD VALUE 'SMS_STATUS_RECONCILIATION';

CREATE TABLE "SmsDeliveryReview" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "providerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SmsDeliveryReview_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SmsDeliveryReview_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "SmsDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SmsDeliveryReview_deliveryId_createdAt_idx" ON "SmsDeliveryReview"("deliveryId", "createdAt");

CREATE TABLE "ProviderUsage" (
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "used" INTEGER NOT NULL,
    CONSTRAINT "ProviderUsage_pkey" PRIMARY KEY ("companyId", "kind", "windowStart"),
    CONSTRAINT "ProviderUsage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProviderUsage_used_check" CHECK ("used" >= 0)
);
