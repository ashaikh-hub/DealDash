-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "approvalRef" TEXT,
ADD COLUMN     "correlationId" TEXT,
ADD COLUMN     "scope" TEXT,
ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "LegalEntity" ADD COLUMN     "address" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'SAR',
ADD COLUMN     "taxProfile" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "MerchantBranch" ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'SA';

-- AlterTable
ALTER TABLE "OrganizationMembership" ADD COLUMN     "scoped" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "OrganizationUnit" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "parentId" UUID,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "legalEntityId" UUID,
    "operatorLegalEntityId" UUID,
    "settlementLegalEntityId" UUID,
    "country" TEXT,
    "city" TEXT,
    "branchId" UUID,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleAssignment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "scopeKind" TEXT NOT NULL,
    "scopeRef" TEXT,
    "scopeProduct" TEXT,
    "envelopeKind" TEXT,
    "envelopeRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "grantedByUserId" UUID NOT NULL,
    "grantedByRole" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" UUID,

    CONSTRAINT "RoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "legalEntityId" UUID,
    "name" TEXT NOT NULL,
    "reference" TEXT,
    "planCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractEntitlement" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "limitValue" INTEGER,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),

    CONSTRAINT "ContractEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CountryConfiguration" (
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "taxProfile" JSONB NOT NULL DEFAULT '{}',
    "paymentProvider" TEXT,
    "settlement" JSONB NOT NULL DEFAULT '{}',
    "legalTextVersion" TEXT,
    "residency" JSONB NOT NULL DEFAULT '{}',
    "notificationProviders" JSONB NOT NULL DEFAULT '{}',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CountryConfiguration_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationUnit_branchId_key" ON "OrganizationUnit"("branchId");

-- CreateIndex
CREATE INDEX "OrganizationUnit_organizationId_parentId_idx" ON "OrganizationUnit"("organizationId", "parentId");

-- CreateIndex
CREATE INDEX "OrganizationUnit_organizationId_kind_idx" ON "OrganizationUnit"("organizationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationUnit_organizationId_code_key" ON "OrganizationUnit"("organizationId", "code");

-- CreateIndex
CREATE INDEX "RoleAssignment_organizationId_userId_status_idx" ON "RoleAssignment"("organizationId", "userId", "status");

-- CreateIndex
CREATE INDEX "RoleAssignment_membershipId_status_idx" ON "RoleAssignment"("membershipId", "status");

-- CreateIndex
CREATE INDEX "Contract_organizationId_status_idx" ON "Contract"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ContractEntitlement_contractId_kind_key_idx" ON "ContractEntitlement"("contractId", "kind", "key");

-- CreateIndex
CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog"("correlationId");

-- AddForeignKey
ALTER TABLE "OrganizationUnit" ADD CONSTRAINT "OrganizationUnit_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "OrganizationMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractEntitlement" ADD CONSTRAINT "ContractEntitlement_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ================================================================ hand-written guarantees (Phase 1)
CREATE INDEX "OrganizationUnit_path_idx" ON "OrganizationUnit" ("organizationId", "path" text_pattern_ops);
ALTER TABLE "OrganizationUnit" ADD CONSTRAINT "OrganizationUnit_path_ends_with_id" CHECK ("path" LIKE '%/' || "id"::text || '/');
ALTER TABLE "OrganizationUnit" ADD CONSTRAINT "OrganizationUnit_not_own_parent" CHECK ("parentId" IS NULL OR "parentId" <> "id");
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_scope_valid" CHECK (
  "scopeKind" IN ('ORGANIZATION', 'LEGAL_ENTITY', 'UNIT', 'COUNTRY', 'BRANCH', 'PRODUCT', 'CAMPAIGN')
  AND ("scopeKind" = 'ORGANIZATION' OR "scopeRef" IS NOT NULL)
  AND ("scopeKind" <> 'CAMPAIGN' OR "scopeProduct" IS NOT NULL)
  AND ("envelopeKind" IS NULL) = ("envelopeRef" IS NULL)
  AND "status" IN ('ACTIVE', 'REVOKED')
  AND ("validUntil" IS NULL OR "validUntil" > "validFrom"));
-- the same grant cannot be active twice
CREATE UNIQUE INDEX "RoleAssignment_one_active" ON "RoleAssignment" ("membershipId", "roleId", "scopeKind", COALESCE("scopeRef", ''), COALESCE("scopeProduct", ''), COALESCE("envelopeKind", ''), COALESCE("envelopeRef", '')) WHERE "status" = 'ACTIVE';
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_dates" CHECK ("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom");
ALTER TABLE "ContractEntitlement" ADD CONSTRAINT "ContractEntitlement_dates" CHECK ("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom");
ALTER TABLE "ContractEntitlement" ADD CONSTRAINT "ContractEntitlement_kind" CHECK ("kind" IN ('PRODUCT', 'FEATURE', 'LIMIT') AND ("kind" <> 'LIMIT' OR "limitValue" IS NOT NULL));
-- at most one open contract per organisation and legal entity at a time
CREATE UNIQUE INDEX "Contract_one_active" ON "Contract" ("organizationId", COALESCE("legalEntityId", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "status" = 'ACTIVE' AND "effectiveUntil" IS NULL;