CREATE TYPE "BusinessRole" AS ENUM ('OWNER', 'STAFF');
ALTER TYPE "BackgroundJobKind" ADD VALUE 'AUTH_EMAIL';
ALTER TABLE "BackgroundJob" ADD COLUMN "userId" TEXT, ALTER COLUMN "companyId" DROP NOT NULL;
ALTER TABLE "BillingDocument" ADD COLUMN "billingProfile" JSONB;
ALTER TABLE "Company" ADD COLUMN "billingAddress" TEXT,
  ADD COLUMN "businessEmail" TEXT, ADD COLUMN "businessPhone" TEXT,
  ADD COLUMN "createRequestKey" TEXT, ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN "defaultTaxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3), ADD COLUMN "onboardingStep" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "onboardingTestedAt" TIMESTAMP(3), ADD COLUMN "taxRegistrationNumber" TEXT,
  ALTER COLUMN "twilioPhoneNumber" DROP NOT NULL, ALTER COLUMN "forwardToPhoneNumber" DROP NOT NULL;

CREATE TABLE "User" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "email" TEXT NOT NULL,
  "emailVerified" BOOLEAN NOT NULL DEFAULT false, "image" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Session" (
  "id" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "token" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "ipAddress" TEXT, "userAgent" TEXT, "userId" TEXT NOT NULL,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Account" (
  "id" TEXT NOT NULL, "accountId" TEXT NOT NULL, "providerId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "accessToken" TEXT, "refreshToken" TEXT, "idToken" TEXT,
  "accessTokenExpiresAt" TIMESTAMP(3), "refreshTokenExpiresAt" TIMESTAMP(3),
  "scope" TEXT, "password" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Verification" (
  "id" TEXT NOT NULL, "identifier" TEXT NOT NULL, "value" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "RateLimit" (
  "id" TEXT NOT NULL, "key" TEXT NOT NULL, "count" INTEGER NOT NULL, "lastRequest" BIGINT NOT NULL,
  CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "BusinessMembership" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "role" "BusinessRole" NOT NULL DEFAULT 'STAFF', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "BusinessMembership_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "BusinessInvitation" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "email" TEXT NOT NULL,
  "role" "BusinessRole" NOT NULL DEFAULT 'STAFF', "tokenHash" TEXT NOT NULL, "invitedBy" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "acceptedAt" TIMESTAMP(3), "acceptedBy" TEXT, "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "BusinessInvitation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "BusinessMembershipAudit" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "actorId" TEXT NOT NULL, "action" TEXT NOT NULL,
  "details" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BusinessMembershipAudit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Account_userId_idx" ON "Account"("userId");
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");
CREATE UNIQUE INDEX "RateLimit_key_key" ON "RateLimit"("key");
CREATE INDEX "BusinessMembership_userId_idx" ON "BusinessMembership"("userId");
CREATE UNIQUE INDEX "BusinessMembership_companyId_userId_key" ON "BusinessMembership"("companyId", "userId");
CREATE UNIQUE INDEX "BusinessInvitation_tokenHash_key" ON "BusinessInvitation"("tokenHash");
CREATE INDEX "BusinessInvitation_companyId_email_idx" ON "BusinessInvitation"("companyId", "email");
CREATE INDEX "BusinessMembershipAudit_companyId_createdAt_idx" ON "BusinessMembershipAudit"("companyId", "createdAt");
CREATE UNIQUE INDEX "BackgroundJob_userId_eventKey_key" ON "BackgroundJob"("userId", "eventKey");
CREATE UNIQUE INDEX "Company_createRequestKey_key" ON "Company"("createRequestKey");
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BackgroundJob" ADD CONSTRAINT "BackgroundJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessMembership" ADD CONSTRAINT "BusinessMembership_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessMembership" ADD CONSTRAINT "BusinessMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessInvitation" ADD CONSTRAINT "BusinessInvitation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessMembershipAudit" ADD CONSTRAINT "BusinessMembershipAudit_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
