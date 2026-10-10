import type { PrismaClient } from '../generated/prisma/client';

/**
 * Stage 7 development data (idempotent): the sample bank operates in Saudi Arabia (and holds a UAE legal entity), with a Bank
 * Enterprise contract, a prepaid billing account, a merchant network (one registered merchant, one referenced merchant with an
 * outlet), a card programme (BIN prefix only) and a saved eligibility rule; the sample employer has a Corporate contract and a
 * work-email employer programme. Nothing here is a price or a legal position.
 */
export async function seedStage7(args: {
  prisma: PrismaClient;
  organizations: Record<string, string>;
}) {
  const { prisma, organizations } = args;
  const bank = organizations.bank;
  const employer = organizations.employer;
  if (!bank || !employer) return;
  const admin = await prisma.organizationMembership.findFirst({
    where: { organizationId: bank, role: { code: 'PARTNER_ADMIN' } },
    select: { userId: true },
  });
  const creator = admin?.userId;
  if (!creator) return;

  for (const org of [bank, employer])
    await prisma.partner.update({
      where: { organizationId: org },
      data: {
        lifecycle: 'ACTIVE',
        requestedMarkets: ['SA'],
        contacts: { primary: { name: 'Partnerships team', email: 'partnerships@example.test' } },
        signatory: {
          name: 'Authorised signatory',
          email: 'signatory@example.test',
          title: 'Director',
        },
      },
    });

  // the same grandfathering as the migration: sample partners the earlier stage seeds create as active organizations operate
  await prisma.partner.updateMany({
    where: { lifecycle: 'DRAFT', organization: { status: 'ACTIVE' } },
    data: { lifecycle: 'ACTIVE', lifecycleReason: 'Development sample partner (grandfathered at Stage 7)' },
  });

  const le = async (organizationId: string, legalName: string, country: string, currency: string) =>
    (await prisma.legalEntity.findFirst({ where: { organizationId, legalName } })) ??
    prisma.legalEntity.create({ data: { organizationId, legalName, country, currency } });
  const bankSa = await le(bank, 'Sample Bank (Saudi Arabia)', 'SA', 'SAR');
  await le(bank, 'Sample Bank (UAE branch)', 'AE', 'AED');
  const empSa = await le(employer, 'Sample Employer Company', 'SA', 'SAR');
  for (const [org, entity] of [
    [bank, bankSa.id],
    [employer, empSa.id],
  ] as const)
    if (
      !(await prisma.businessAccount.findFirst({
        where: { organizationId: org, legalEntityId: entity, currency: 'SAR' },
      }))
    )
      await prisma.businessAccount.create({
        data: {
          organizationId: org,
          legalEntityId: entity,
          currency: 'SAR',
          fundingMode: 'PREPAID',
          name: 'Main account',
        },
      });

  const contract = async (
    organizationId: string,
    kind: string,
    name: string,
    products: string[],
    features: string[],
  ) => {
    if (await prisma.contract.findFirst({ where: { organizationId, kind, status: 'ACTIVE' } }))
      return;
    await prisma.contract.create({
      data: {
        organizationId,
        name,
        kind,
        market: 'SA',
        currency: 'SAR',
        status: 'ACTIVE',
        createdByUserId: creator,
        developmentFixture: true,
        entitlements: {
          create: [
            ...products.map((key) => ({ kind: 'PRODUCT', key })),
            ...features.map((key) => ({ kind: 'FEATURE', key })),
          ],
        },
      },
    });
  };
  await contract(
    bank,
    'BANK_ENTERPRISE',
    'Bank Enterprise (development)',
    ['LIVE_DEAL', 'MEMBER_BENEFIT', 'EXCLUSIVE', 'VOUCHER', 'WATCH', 'LOYALTY'],
    [
      'BANK_MERCHANT_NETWORK',
      'CARDHOLDER_ELIGIBILITY',
      'BANK_FUNDED_CAMPAIGNS',
      'API_ACCESS',
      'BULK_IMPORT',
      'ADVANCED_REPORTING',
      'AI_COPILOT',
    ],
  );
  await contract(
    employer,
    'CORPORATE_PARTNER',
    'Corporate Partner (development)',
    ['MEMBER_BENEFIT', 'EXCLUSIVE', 'VOUCHER', 'LOYALTY'],
    ['EMPLOYEE_PROGRAMS', 'BULK_IMPORT', 'AI_COPILOT'],
  );

  // merchant network: the registered sample merchant, and a referenced network merchant with one outlet
  const source = `PARTNER-PORTAL:${bank.slice(0, 8)}`;
  const merchantA = organizations.merchantA;
  if (merchantA) {
    const master =
      (await prisma.masterMerchant.findFirst({ where: { organizationId: merchantA } })) ??
      (await prisma.masterMerchant.create({
        data: {
          registration: 'REGISTERED',
          organizationId: merchantA,
          nameEn: (await prisma.organization.findUniqueOrThrow({ where: { id: merchantA } }))
            .nameEn,
          normalizedName: `registered-${merchantA}`,
          country: 'SA',
        },
      }));
    await prisma.externalEntityReference.upsert({
      where: {
        sourceSystem_entityType_sourceRecordId: {
          sourceSystem: source,
          entityType: 'MERCHANT',
          sourceRecordId: `REG-${merchantA}`,
        },
      },
      update: {},
      create: {
        entityType: 'MERCHANT',
        entityId: master.id,
        sourceSystem: source,
        sourceRecordId: `REG-${merchantA}`,
        sourceOrganizationId: bank,
        importMethod: 'MANUAL',
        sourceOwner: source,
        editableBy: 'DEALDASH',
        lastSyncAt: new Date(),
        lastSuccessfulSyncAt: new Date(),
      },
    });
  }
  const refKey = {
    sourceSystem_entityType_sourceRecordId: {
      sourceSystem: source,
      entityType: 'MERCHANT',
      sourceRecordId: 'SB-NET-001',
    },
  };
  if (!(await prisma.externalEntityReference.findUnique({ where: refKey }))) {
    const m = await prisma.masterMerchant.create({
      data: {
        registration: 'REFERENCED',
        nameEn: 'Corner Bakery Riyadh (network)',
        nameAr: 'مخبز الزاوية الرياض (من الشبكة)',
        normalizedName: 'corner bakery riyadh network',
        country: 'SA',
        categoryCode: 'bakery',
      },
    });
    await prisma.externalEntityReference.create({
      data: {
        entityType: 'MERCHANT',
        entityId: m.id,
        sourceSystem: source,
        sourceRecordId: 'SB-NET-001',
        sourceOrganizationId: bank,
        importMethod: 'MANUAL',
        sourceOwner: source,
        lastSyncAt: new Date(),
        lastSuccessfulSyncAt: new Date(),
      },
    });
    const b = await prisma.masterBranch.create({
      data: {
        merchantId: m.id,
        nameEn: 'Corner Bakery Olaya',
        city: 'Riyadh',
        country: 'SA',
        normalizedKey: 'corner bakery olaya|riyadh',
      },
    });
    await prisma.externalEntityReference.create({
      data: {
        entityType: 'BRANCH',
        entityId: b.id,
        sourceSystem: source,
        sourceRecordId: 'SB-NET-001-B1',
        sourceOrganizationId: bank,
        importMethod: 'MANUAL',
        sourceOwner: source,
        lastSyncAt: new Date(),
        lastSuccessfulSyncAt: new Date(),
      },
    });
  }

  // card programme (limited BIN prefix, never a card number) and a saved rule over it
  if (
    !(await prisma.partnerCardProgram.findUnique({
      where: { partnerOrganizationId_code: { partnerOrganizationId: bank, code: 'SB-PLATINUM' } },
    }))
  )
    await prisma.partnerCardProgram.create({
      data: {
        partnerOrganizationId: bank,
        code: 'SB-PLATINUM',
        nameEn: 'Sample Bank Platinum',
        nameAr: 'بلاتينيوم البنك التجريبي',
        scheme: 'visa',
        issuerName: 'Sample Bank',
        productCode: 'SB-PLATINUM',
        tier: 'platinum',
        binPrefixes: ['412345'],
        market: 'SA',
        status: 'ACTIVE',
        createdByUserId: creator,
      },
    });
  if (
    !(await prisma.eligibilityRuleSet.findFirst({
      where: { ownerOrganizationId: bank, name: 'Platinum card holders' },
    }))
  )
    await prisma.eligibilityRuleSet.create({
      data: {
        ownerOrganizationId: bank,
        kind: 'COMPOSITE',
        name: 'Platinum card holders',
        expression: {
          op: 'AND',
          children: [
            { op: 'ATTR', attr: 'CARD', values: [bank] },
            { op: 'ATTR', attr: 'CARD_TIER', values: ['platinum'] },
          ],
        },
      },
    });
  if (
    !(await prisma.partnerEmployerProgram.findUnique({
      where: { partnerOrganizationId_code: { partnerOrganizationId: employer, code: 'STAFF' } },
    }))
  )
    await prisma.partnerEmployerProgram.create({
      data: {
        partnerOrganizationId: employer,
        code: 'STAFF',
        nameEn: 'Employee benefits',
        nameAr: 'مزايا الموظفين',
        domains: ['employer.example'],
        market: 'SA',
        status: 'ACTIVE',
        createdByUserId: creator,
      },
    });
}
