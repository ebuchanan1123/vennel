CREATE TYPE "DocumentKind" AS ENUM ('ESTIMATE', 'INVOICE');
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'FINALIZED');

ALTER TABLE "Company" ADD COLUMN "nextDocumentNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Lead" ADD COLUMN "customerId" TEXT;

CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CatalogService" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'job',
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "keywords" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CatalogService_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT,
    "leadId" TEXT,
    "kind" "DocumentKind" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "number" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "notes" TEXT,
    "dueDate" DATE,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "aiDraft" JSONB,
    "customerSnapshot" JSONB,
    "businessName" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "sourceEstimateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillingDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocumentItem" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "serviceId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "suggestionReason" TEXT,
    "position" INTEGER NOT NULL,
    CONSTRAINT "DocumentItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Customer_companyId_isArchived_idx" ON "Customer"("companyId", "isArchived");
CREATE UNIQUE INDEX "Customer_companyId_phone_key" ON "Customer"("companyId", "phone");
CREATE UNIQUE INDEX "Customer_companyId_email_key" ON "Customer"("companyId", "email");
CREATE INDEX "CatalogService_companyId_isActive_idx" ON "CatalogService"("companyId", "isActive");
CREATE UNIQUE INDEX "BillingDocument_sourceEstimateId_key" ON "BillingDocument"("sourceEstimateId");
CREATE INDEX "BillingDocument_companyId_status_idx" ON "BillingDocument"("companyId", "status");
CREATE INDEX "BillingDocument_customerId_idx" ON "BillingDocument"("customerId");
CREATE INDEX "BillingDocument_leadId_idx" ON "BillingDocument"("leadId");
CREATE UNIQUE INDEX "BillingDocument_companyId_number_key" ON "BillingDocument"("companyId", "number");
CREATE INDEX "DocumentItem_serviceId_idx" ON "DocumentItem"("serviceId");
CREATE UNIQUE INDEX "DocumentItem_documentId_position_key" ON "DocumentItem"("documentId", "position");
CREATE INDEX "Lead_customerId_idx" ON "Lead"("customerId");

ALTER TABLE "Lead" ADD CONSTRAINT "Lead_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogService" ADD CONSTRAINT "CatalogService_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingDocument" ADD CONSTRAINT "BillingDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingDocument" ADD CONSTRAINT "BillingDocument_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingDocument" ADD CONSTRAINT "BillingDocument_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BillingDocument" ADD CONSTRAINT "BillingDocument_sourceEstimateId_fkey" FOREIGN KEY ("sourceEstimateId") REFERENCES "BillingDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentItem" ADD CONSTRAINT "DocumentItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "BillingDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentItem" ADD CONSTRAINT "DocumentItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "CatalogService"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
