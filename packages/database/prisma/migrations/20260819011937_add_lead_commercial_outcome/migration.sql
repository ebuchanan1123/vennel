-- CreateEnum
CREATE TYPE "LeadOutcome" AS ENUM ('UNKNOWN', 'CONTACTED', 'ESTIMATE_SENT', 'BOOKED', 'WON', 'LOST');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "actualValue" DECIMAL(10,2),
ADD COLUMN     "bookedAt" TIMESTAMP(3),
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "contactedAt" TIMESTAMP(3),
ADD COLUMN     "crmExternalId" TEXT,
ADD COLUMN     "estimatedValue" DECIMAL(10,2),
ADD COLUMN     "lostReason" TEXT,
ADD COLUMN     "outcome" "LeadOutcome" NOT NULL DEFAULT 'UNKNOWN';

-- CreateIndex
CREATE INDEX "Lead_outcome_idx" ON "Lead"("outcome");
