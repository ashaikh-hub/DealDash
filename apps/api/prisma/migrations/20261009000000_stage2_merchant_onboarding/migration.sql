-- CreateEnum
CREATE TYPE "TrustLevel" AS ENUM ('NEW', 'STANDARD', 'TRUSTED');

-- CreateEnum
CREATE TYPE "RiskTier" AS ENUM ('STANDARD', 'ENHANCED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'RESUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DecisionType" AS ENUM ('CLAIMED', 'REQUEST_CHANGES', 'APPROVE_RECOMMENDED', 'APPROVE', 'REJECT', 'RISK_TIER_CHANGED', 'RESUBMITTED');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('PENDING', 'AVAILABLE', 'REJECTED');

-- CreateEnum
CREATE TYPE "AcceptanceStatus" AS ENUM ('ACCEPTED', 'SUPERSEDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "mobileVerifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "businessEmail" TEXT,
ADD COLUMN     "businessPhone" TEXT,
ADD COLUMN     "businessType" TEXT,
ADD COLUMN     "categoryCode" TEXT,
ADD COLUMN     "commercialRegistrationNumber" TEXT,
ADD COLUMN     "coverFileId" UUID,
ADD COLUMN     "descriptionAr" TEXT,
ADD COLUMN     "descriptionEn" TEXT,
ADD COLUMN     "galleryFileIds" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "legalNameAr" TEXT,
ADD COLUMN     "logoFileId" UUID,
ADD COLUMN     "registeredAddress" TEXT,
ADD COLUMN     "riskTier" "RiskTier" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "subCategory" TEXT,
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedReason" TEXT,
ADD COLUMN     "taxNumber" TEXT,
ADD COLUMN     "tradeNameAr" TEXT,
ADD COLUMN     "tradeNameEn" TEXT,
ADD COLUMN     "trustLevel" "TrustLevel" NOT NULL DEFAULT 'NEW';

-- AlterTable
ALTER TABLE "MerchantBranch" ADD COLUMN     "holidayHours" JSONB,
ADD COLUMN     "hours" JSONB,
ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "subjectOrganizationId" UUID;

-- CreateTable
CREATE TABLE "MerchantApplication" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" UUID,
    "assignedToUserId" UUID,
    "firstApproverUserId" UUID,
    "awaitingSecondReview" BOOLEAN NOT NULL DEFAULT false,
    "rejectionReason" TEXT,
    "rejectionReasonAr" TEXT,
    "appealable" BOOLEAN NOT NULL DEFAULT true,
    "requestedChanges" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationDecision" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "decision" "DecisionType" NOT NULL,
    "message" TEXT,
    "messageAr" TEXT,
    "sections" JSONB NOT NULL DEFAULT '[]',
    "documentIds" JSONB NOT NULL DEFAULT '[]',
    "decidedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationSubmission" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationNote" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "authorUserId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantRepresentative" (
    "organizationId" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "idReferenceEnc" TEXT NOT NULL,
    "idReferenceLast4" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "isSignatory" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantRepresentative_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "MerchantSettlementAccount" (
    "organizationId" UUID NOT NULL,
    "bankName" TEXT NOT NULL,
    "ibanEnc" TEXT NOT NULL,
    "ibanMasked" TEXT NOT NULL,
    "accountHolderName" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedByUserId" UUID,
    "verifiedAt" TIMESTAMP(3),
    "payoutHold" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantSettlementAccount_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "ownerUserId" UUID,
    "kind" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "declaredSize" INTEGER NOT NULL,
    "sizeBytes" INTEGER,
    "sha256" TEXT,
    "storageKey" TEXT NOT NULL,
    "status" "FileStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantDocument" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "requirementCode" TEXT NOT NULL,
    "fileId" UUID NOT NULL,
    "expiryDate" DATE,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "reviewerNote" TEXT,
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "uploadedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementVersion" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'MERCHANT',
    "version" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "bodyEn" TEXT NOT NULL,
    "bodyAr" TEXT NOT NULL,
    "placeholder" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgreementVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementAcceptance" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "agreementVersionId" UUID NOT NULL,
    "signatoryUserId" UUID NOT NULL,
    "signatoryName" TEXT NOT NULL,
    "signatoryRole" TEXT NOT NULL,
    "signatoryIdLast4" TEXT NOT NULL,
    "entityLegalName" TEXT NOT NULL,
    "signatureText" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    "method" TEXT NOT NULL DEFAULT 'CLICK_ACCEPT',
    "status" "AcceptanceStatus" NOT NULL DEFAULT 'ACCEPTED',

    CONSTRAINT "AgreementAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "mobile" TEXT,
    "roleId" UUID NOT NULL,
    "branchId" UUID,
    "tokenHash" TEXT,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedByUserId" UUID NOT NULL,
    "createdUserId" UUID,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantApplication_organizationId_key" ON "MerchantApplication"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantApplication_reference_key" ON "MerchantApplication"("reference");

-- CreateIndex
CREATE INDEX "MerchantApplication_status_submittedAt_idx" ON "MerchantApplication"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "MerchantApplication_assignedToUserId_idx" ON "MerchantApplication"("assignedToUserId");

-- CreateIndex
CREATE INDEX "ApplicationDecision_applicationId_createdAt_idx" ON "ApplicationDecision"("applicationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationSubmission_applicationId_version_key" ON "ApplicationSubmission"("applicationId", "version");

-- CreateIndex
CREATE INDEX "ApplicationNote_applicationId_createdAt_idx" ON "ApplicationNote"("applicationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoredFile_storageKey_key" ON "StoredFile"("storageKey");

-- CreateIndex
CREATE INDEX "StoredFile_organizationId_kind_idx" ON "StoredFile"("organizationId", "kind");

-- CreateIndex
CREATE INDEX "MerchantDocument_organizationId_requirementCode_idx" ON "MerchantDocument"("organizationId", "requirementCode");

-- CreateIndex
CREATE UNIQUE INDEX "AgreementVersion_kind_version_key" ON "AgreementVersion"("kind", "version");

-- CreateIndex
CREATE INDEX "AgreementAcceptance_organizationId_status_idx" ON "AgreementAcceptance"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_organizationId_status_idx" ON "Invitation"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Merchant_commercialRegistrationNumber_idx" ON "Merchant"("commercialRegistrationNumber");

-- CreateIndex
CREATE INDEX "Merchant_trustLevel_riskTier_idx" ON "Merchant"("trustLevel", "riskTier");

-- CreateIndex
CREATE INDEX "AuditLog_subjectOrganizationId_occurredAt_idx" ON "AuditLog"("subjectOrganizationId", "occurredAt");

-- AddForeignKey
ALTER TABLE "MerchantApplication" ADD CONSTRAINT "MerchantApplication_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationDecision" ADD CONSTRAINT "ApplicationDecision_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "MerchantApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationSubmission" ADD CONSTRAINT "ApplicationSubmission_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "MerchantApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationNote" ADD CONSTRAINT "ApplicationNote_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "MerchantApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantRepresentative" ADD CONSTRAINT "MerchantRepresentative_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Merchant"("organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantSettlementAccount" ADD CONSTRAINT "MerchantSettlementAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Merchant"("organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantDocument" ADD CONSTRAINT "MerchantDocument_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementAcceptance" ADD CONSTRAINT "AgreementAcceptance_agreementVersionId_fkey" FOREIGN KEY ("agreementVersionId") REFERENCES "AgreementVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reference numbers for applications (DD-M-1001, DD-M-1002, ...).
CREATE SEQUENCE IF NOT EXISTS merchant_application_ref_seq START 1001;

-- Data-quality guards.
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_declared_size_positive" CHECK ("declaredSize" > 0);
ALTER TABLE "MerchantApplication" ADD CONSTRAINT "MerchantApplication_version_nonneg" CHECK ("version" >= 0);
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_contact_present" CHECK ("email" IS NOT NULL OR "mobile" IS NOT NULL);