-- Customer experience gap closure (2026-10-16). Additive only: new tables, no change to existing rows.
--  * UserIdentity / SocialSignIn: Google / Apple sign-in (provider subject only, never provider tokens; the phone stays the account key)
--  * CustomerPaymentMethod / PaymentMethodSetup: saved cards = the provider's token + brand, last 4 digits, expiry. Never a card number.
--  * CardOfferActivation: card-linked offers activated on one of the customer's added cards
--  * CustomerSaving: "Log my saving", once per redeemed reservation or voucher

-- CreateTable
CREATE TABLE "UserIdentity" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "displayName" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "UserIdentity_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UserIdentity_provider" CHECK ("provider" IN ('GOOGLE', 'APPLE'))
);

-- CreateTable
CREATE TABLE "SocialSignIn" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "userId" UUID,
    "callbackUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STARTED',
    "subject" TEXT,
    "email" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "displayName" TEXT,
    "linkTokenHash" TEXT,
    "failureCode" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SocialSignIn_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SocialSignIn_intent" CHECK ("intent" IN ('SIGN_IN', 'LINK')),
    CONSTRAINT "SocialSignIn_link_has_user" CHECK ("intent" <> 'LINK' OR "userId" IS NOT NULL)
);

-- CreateTable
CREATE TABLE "CustomerPaymentMethod" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerToken" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "expMonth" INTEGER NOT NULL,
    "expYear" INTEGER NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "CustomerPaymentMethod_pkey" PRIMARY KEY ("id"),
    -- display details only: exactly four digits, never a card number
    CONSTRAINT "CustomerPaymentMethod_last4" CHECK ("last4" ~ '^[0-9]{4}$'),
    CONSTRAINT "CustomerPaymentMethod_expiry" CHECK ("expMonth" BETWEEN 1 AND 12 AND "expYear" BETWEEN 2000 AND 2100),
    CONSTRAINT "CustomerPaymentMethod_status" CHECK ("status" IN ('ACTIVE', 'REMOVED'))
);

-- CreateTable
CREATE TABLE "PaymentMethodSetup" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerSetupRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'STARTED',
    "makeDefault" BOOLEAN NOT NULL DEFAULT false,
    "paymentMethodId" UUID,
    "failureCode" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentMethodSetup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardOfferActivation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "product" TEXT NOT NULL,
    "offerId" UUID NOT NULL,
    "programId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivatedAt" TIMESTAMP(3),

    CONSTRAINT "CardOfferActivation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CardOfferActivation_product" CHECK ("product" IN ('LIVE', 'HOT', 'VOUCHER'))
);

-- CreateTable
CREATE TABLE "CustomerSaving" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" UUID NOT NULL,
    "merchantOrganizationId" UUID NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerSaving_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CustomerSaving_source" CHECK ("sourceType" IN ('RESERVATION', 'VOUCHER')),
    CONSTRAINT "CustomerSaving_amount" CHECK ("amountMinor" > 0),
    CONSTRAINT "CustomerSaving_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$')
);

-- CreateIndex
CREATE UNIQUE INDEX "UserIdentity_provider_subject_key" ON "UserIdentity"("provider", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "UserIdentity_userId_provider_key" ON "UserIdentity"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "SocialSignIn_stateHash_key" ON "SocialSignIn"("stateHash");

-- CreateIndex
CREATE UNIQUE INDEX "SocialSignIn_linkTokenHash_key" ON "SocialSignIn"("linkTokenHash");

-- CreateIndex
CREATE INDEX "SocialSignIn_status_expiresAt_idx" ON "SocialSignIn"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "CustomerPaymentMethod_userId_status_idx" ON "CustomerPaymentMethod"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPaymentMethod_provider_providerToken_key" ON "CustomerPaymentMethod"("provider", "providerToken");

-- at most ONE default card per customer
CREATE UNIQUE INDEX "CustomerPaymentMethod_one_default" ON "CustomerPaymentMethod"("userId")
  WHERE "isDefault" AND "status" = 'ACTIVE';

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethodSetup_providerSetupRef_key" ON "PaymentMethodSetup"("providerSetupRef");

-- CreateIndex
CREATE INDEX "PaymentMethodSetup_userId_createdAt_idx" ON "PaymentMethodSetup"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CardOfferActivation_userId_activatedAt_idx" ON "CardOfferActivation"("userId", "activatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CardOfferActivation_userId_product_offerId_key" ON "CardOfferActivation"("userId", "product", "offerId");

-- CreateIndex
CREATE INDEX "CustomerSaving_userId_createdAt_idx" ON "CustomerSaving"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSaving_userId_sourceType_sourceId_key" ON "CustomerSaving"("userId", "sourceType", "sourceId");
