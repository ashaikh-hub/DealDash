import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { maskIban } from '@dealdash/validation';
import { encryptField } from '../common/crypto';
import type { PrismaClient } from '../generated/prisma/client';
import { AGREEMENT_V1 } from './catalog';

/** Builds a structurally valid Saudi IBAN (SA + check digits + 2-digit bank + 18-digit account). Development data only. */
export function buildSaudiIban(bank2: string, account18: string): string {
  const bban = `${bank2}${account18}`;
  const numeric = `${bban}281000`; // 'S'=28, 'A'=10, then "00" check placeholder
  let rem = 0;
  for (const ch of numeric) rem = (rem * 10 + Number(ch)) % 97;
  return `SA${String(98 - rem).padStart(2, '0')}${bban}`;
}

export const PLACEHOLDER_PDF = Buffer.from(
  '%PDF-1.4\n% DealDash development placeholder document\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
);
export const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export interface Stage2SeedInput {
  prisma: PrismaClient;
  organizations: Record<string, string>;
  branches: Record<string, string>;
  passwordHash: string;
  roles: Map<string, string>;
  fieldEncryptionKey: string;
  storageDir?: string;
  accounts: Array<{
    email?: string;
    mobile?: string;
    role: string;
    organization: string;
    audience: string;
    branch?: string;
  }>;
}

const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const hours = () =>
  Object.fromEntries(
    WEEK.map((d) => [d, { closed: false, intervals: [{ open: '09:00', close: '23:00' }] }]),
  );

/**
 * Stage 2 development data: the current agreement version, the two existing sample merchants brought to a fully
 * approved state, one merchant waiting for review (standard), one waiting for enhanced two-person review, and one
 * brand-new draft you can walk through the onboarding wizard.
 */
export async function seedStage2(input: Stage2SeedInput) {
  const { prisma, organizations, branches, passwordHash, roles, fieldEncryptionKey } = input;

  const agreement = await prisma.agreementVersion.findFirstOrThrow({
    where: { kind: 'MERCHANT', version: AGREEMENT_V1.version },
  });

  async function file(
    orgId: string,
    kind: string,
    name: string,
    mime: string,
    data: Buffer,
    userId?: string,
  ) {
    const key = `merchants/${orgId}/${kind.toLowerCase()}/seed-${name}`;
    const existing = await prisma.storedFile.findUnique({ where: { storageKey: key } });
    if (input.storageDir) {
      const p = resolve(input.storageDir, key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, data);
    }
    if (existing) return existing;
    return prisma.storedFile.create({
      data: {
        organizationId: orgId,
        ownerUserId: userId ?? null,
        kind,
        originalName: name,
        mimeType: mime,
        declaredSize: data.length,
        sizeBytes: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
        storageKey: key,
        status: 'AVAILABLE',
        completedAt: new Date(),
      },
    });
  }

  async function owner(orgId: string, email: string | undefined) {
    if (!email) return null;
    const u = await prisma.user.findUnique({ where: { email } });
    if (u) {
      await prisma.user.update({
        where: { id: u.id },
        data: { status: 'ACTIVE', emailVerifiedAt: new Date(), mobile: u.mobile ?? undefined },
      });
    }
    void orgId;
    return u;
  }

  async function fill(opts: {
    key: string;
    legal: [string, string];
    trade: [string, string];
    category: string;
    ref: string;
    status: 'DRAFT' | 'SUBMITTED' | 'APPROVED';
    risk?: 'STANDARD' | 'ENHANCED';
    ownerEmail?: string;
    full: boolean;
    bankMismatch?: boolean;
    cr: string;
    ibanAccount: string;
    mobile: string;
    orgStatus: 'ACTIVE' | 'DRAFT';
  }) {
    const orgId = organizations[opts.key]!;
    const ownerUser = await owner(orgId, opts.ownerEmail);
    const uid = ownerUser?.id;
    const logo = opts.full
      ? await file(orgId, 'LOGO', 'logo.png', 'image/png', PLACEHOLDER_PNG, uid)
      : null;
    const cover = opts.full
      ? await file(orgId, 'COVER', 'cover.png', 'image/png', PLACEHOLDER_PNG, uid)
      : null;
    await prisma.organization.update({ where: { id: orgId }, data: { status: opts.orgStatus } });
    await prisma.merchant.upsert({
      where: { organizationId: orgId },
      update: {},
      create: { organizationId: orgId, legalName: opts.legal[0] },
    });
    await prisma.merchant.update({
      where: { organizationId: orgId },
      data: opts.full
        ? {
            legalName: opts.legal[0],
            legalNameAr: opts.legal[1],
            tradeNameEn: opts.trade[0],
            tradeNameAr: opts.trade[1],
            commercialRegistrationNumber: opts.cr,
            taxNumber: '300000000000003',
            businessType: 'Limited liability company',
            registeredAddress: 'Riyadh, Saudi Arabia (sample address)',
            businessPhone: '+966110000000',
            businessEmail: opts.ownerEmail,
            categoryCode: opts.category,
            category: opts.category,
            descriptionEn: `${opts.trade[0]} is a sample merchant used for development.`,
            descriptionAr: `${opts.trade[1]} تاجر تجريبي لأغراض التطوير.`,
            logoFileId: logo!.id,
            coverFileId: cover!.id,
            riskTier: opts.risk ?? 'STANDARD',
            activatedAt: opts.orgStatus === 'ACTIVE' ? new Date() : null,
          }
        : { legalName: opts.legal[0] },
    });

    if (opts.full) {
      const rep = {
        fullName: `${opts.trade[0]} Signatory`,
        role: 'General Manager',
        mobile: opts.mobile,
        email: opts.ownerEmail ?? 'rep@example.test',
        isSignatory: true,
      };
      await prisma.merchantRepresentative.upsert({
        where: { organizationId: orgId },
        update: {},
        create: {
          organizationId: orgId,
          ...rep,
          idReferenceEnc: encryptField('1000000001', fieldEncryptionKey),
          idReferenceLast4: '0001',
        },
      });
      const iban = buildSaudiIban('80', opts.ibanAccount);
      await prisma.merchantSettlementAccount.upsert({
        where: { organizationId: orgId },
        update: {},
        create: {
          organizationId: orgId,
          bankName: 'Sample Bank',
          ibanEnc: encryptField(iban, fieldEncryptionKey),
          ibanMasked: maskIban(iban),
          accountHolderName: opts.bankMismatch ? 'Someone Else Trading' : opts.legal[0],
          verificationStatus: opts.status === 'APPROVED' ? 'VERIFIED' : 'UNVERIFIED',
        },
      });
      const doc = await file(
        orgId,
        'DOCUMENT',
        'commercial-registration.pdf',
        'application/pdf',
        PLACEHOLDER_PDF,
        uid,
      );
      if (
        !(await prisma.merchantDocument.findFirst({
          where: { organizationId: orgId, requirementCode: 'CR' },
        }))
      ) {
        await prisma.merchantDocument.create({
          data: {
            organizationId: orgId,
            requirementCode: 'CR',
            fileId: doc.id,
            expiryDate: new Date('2030-12-31'),
            status: opts.status === 'APPROVED' ? 'ACCEPTED' : 'UPLOADED',
            uploadedByUserId: uid ?? null,
          },
        });
      }
      if (!(await prisma.agreementAcceptance.findFirst({ where: { organizationId: orgId } }))) {
        await prisma.agreementAcceptance.create({
          data: {
            organizationId: orgId,
            agreementVersionId: agreement.id,
            signatoryUserId: uid ?? (await prisma.user.findFirstOrThrow()).id,
            signatoryName: rep.fullName,
            signatoryRole: rep.role,
            signatoryIdLast4: '0001',
            entityLegalName: opts.legal[0],
            signatureText: rep.fullName,
          },
        });
      }
      // Every merchant needs at least one branch with a location and hours to be complete.
    }
    const branchRows = await prisma.merchantBranch.findMany({ where: { organizationId: orgId } });
    for (const b of branchRows)
      await prisma.merchantBranch.update({
        where: { id: b.id },
        data: { hours: hours(), phone: '+966110000001' },
      });

    const snapshot = { seeded: opts.ref };
    const app = await prisma.merchantApplication.upsert({
      where: { organizationId: orgId },
      update: {},
      create: {
        organizationId: orgId,
        reference: opts.ref,
        status: opts.status,
        version: opts.status === 'DRAFT' ? 0 : 1,
        submittedAt: opts.status === 'DRAFT' ? null : new Date(),
        decidedAt: opts.status === 'APPROVED' ? new Date() : null,
      },
    });
    if (opts.status !== 'DRAFT') {
      await prisma.applicationSubmission.upsert({
        where: { applicationId_version: { applicationId: app.id, version: 1 } },
        update: {},
        create: { applicationId: app.id, version: 1, snapshot },
      });
    }
    return orgId;
  }

  // Existing Stage 1 sample merchants become fully onboarded ACTIVE merchants.
  await fill({
    key: 'merchantA',
    legal: ['Harbour Grill Trading Co.', 'شركة هاربور جريل التجارية'],
    trade: ['Harbour Grill', 'هاربور جريل'],
    category: 'restaurants',
    ref: 'DD-M-1001',
    status: 'APPROVED',
    ownerEmail: 'owner@harbourgrill.test',
    full: true,
    cr: '1010000001',
    ibanAccount: '000000000000000001',
    mobile: '+966500000201',
    orgStatus: 'ACTIVE',
  });
  await fill({
    key: 'merchantB',
    legal: ['Daily Dose Juice Co.', 'شركة ديلي دوز للعصائر'],
    trade: ['Daily Dose Juice', 'ديلي دوز جوس'],
    category: 'cafes',
    ref: 'DD-M-1002',
    status: 'APPROVED',
    ownerEmail: 'owner@dailydose.test',
    full: true,
    cr: '1010000002',
    ibanAccount: '000000000000000002',
    mobile: '+966500000202',
    orgStatus: 'ACTIVE',
  });

  // New sample merchants, created here so they only exist when seeding for development.
  async function newMerchant(
    key: string,
    nameEn: string,
    nameAr: string,
    email: string,
    mobileNo: string,
  ) {
    let org = await prisma.organization.findFirst({ where: { nameEn, type: 'MERCHANT' } });
    if (!org)
      org = await prisma.organization.create({
        data: { type: 'MERCHANT', status: 'DRAFT', nameEn, nameAr },
      });
    organizations[key] = org.id;
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user)
      user = await prisma.user.create({
        data: {
          userType: 'MERCHANT_USER',
          status: 'ACTIVE',
          email,
          displayName: `${nameEn} Owner`,
          passwordHash,
          emailVerifiedAt: new Date(),
          mobile: mobileNo,
          mobileVerifiedAt: new Date(),
        },
      });
    else
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null, status: 'ACTIVE' },
      });
    if (
      !(await prisma.organizationMembership.findFirst({
        where: { userId: user.id, organizationId: org.id },
      }))
    ) {
      await prisma.organizationMembership.create({
        data: { userId: user.id, organizationId: org.id, roleId: roles.get('MERCHANT_OWNER')! },
      });
    }
    return org.id;
  }

  async function branchFor(
    orgId: string,
    nameEn: string,
    nameAr: string,
    lat: number,
    lng: number,
  ) {
    if (!(await prisma.merchantBranch.findFirst({ where: { organizationId: orgId, nameEn } }))) {
      await prisma.merchantBranch.create({
        data: {
          organizationId: orgId,
          nameEn,
          nameAr,
          addressEn: 'Riyadh',
          addressAr: 'الرياض',
          city: 'Riyadh',
          latitude: lat,
          longitude: lng,
          hours: hours(),
          phone: '+966110000002',
        },
      });
    }
  }

  const olive = await newMerchant(
    'merchantC',
    'Olive Bakery',
    'مخبز الزيتون',
    'owner@olivebakery.test',
    '+966500000203',
  );
  await branchFor(olive, 'Olive Bakery Hittin', 'مخبز الزيتون حطين', 24.7594, 46.6097);
  await fill({
    key: 'merchantC',
    legal: ['Olive Bakery Co.', 'شركة مخبز الزيتون'],
    trade: ['Olive Bakery', 'مخبز الزيتون'],
    category: 'cafes',
    ref: 'DD-M-1003',
    status: 'SUBMITTED',
    ownerEmail: 'owner@olivebakery.test',
    full: true,
    cr: '1010000003',
    ibanAccount: '000000000000000003',
    mobile: '+966500000203',
    orgStatus: 'DRAFT',
  });

  const spice = await newMerchant(
    'merchantD',
    'Spice Route Exchange',
    'سبايس رووت',
    'owner@spiceroute.test',
    '+966500000204',
  );
  await branchFor(spice, 'Spice Route Al Nakheel', 'سبايس رووت النخيل', 24.7745, 46.7384);
  await fill({
    key: 'merchantD',
    legal: ['Spice Route Trading Co.', 'شركة سبايس رووت للتجارة'],
    trade: ['Spice Route Exchange', 'سبايس رووت'],
    category: 'retail',
    ref: 'DD-M-1004',
    status: 'SUBMITTED',
    risk: 'ENHANCED',
    ownerEmail: 'owner@spiceroute.test',
    full: true,
    bankMismatch: true,
    cr: '1010000004',
    ibanAccount: '000000000000000004',
    mobile: '+966500000204',
    orgStatus: 'DRAFT',
  });

  const fresh = await newMerchant(
    'merchantE',
    'New Cafe Draft',
    'مقهى جديد',
    'owner@newcafe.test',
    '+966500000205',
  );
  await fill({
    key: 'merchantE',
    legal: ['', ''],
    trade: ['New Cafe Draft', 'مقهى جديد'],
    category: 'cafes',
    ref: 'DD-M-1005',
    status: 'DRAFT',
    ownerEmail: 'owner@newcafe.test',
    full: false,
    cr: '',
    ibanAccount: '000000000000000005',
    mobile: '+966500000205',
    orgStatus: 'DRAFT',
  });
  void fresh;

  // Keep the application reference sequence ahead of the seeded references.
  await prisma.$executeRawUnsafe(
    `SELECT setval('merchant_application_ref_seq', GREATEST((SELECT last_value FROM merchant_application_ref_seq), 1005))`,
  );

  for (const [email, orgKey] of [
    ['owner@olivebakery.test', 'merchantC'],
    ['owner@spiceroute.test', 'merchantD'],
    ['owner@newcafe.test', 'merchantE'],
  ] as const) {
    input.accounts.push({
      email,
      role: 'MERCHANT_OWNER',
      organization: orgKey,
      audience: 'merchant',
    });
  }
  void branches;

  // Reused by the Stage 3 seed to add a few more fully onboarded merchants.
  return { fill, newMerchant, branchFor, file };
}
