import { randomBytes } from 'node:crypto';
import type { RoleCode } from '@dealdash/types';
import { encryptField, hashPassword } from '../common/crypto';
import { generateTotpSecret } from '../common/totp';
import type { PrismaClient } from '../generated/prisma/client';
import { seedCatalog } from './catalog';
import { seedStage2 } from './stage2-seed';
import { seedStage3 } from './stage3-seed';
import { seedStage4 } from './stage4-seed';
import { seedStage5 } from './stage5-seed';
import { seedStage6 } from './stage6-seed';

export interface SeedAccount {
  email?: string;
  mobile?: string;
  role: RoleCode;
  organization: string;
  audience: 'customer' | 'merchant' | 'staff' | 'partner' | 'admin';
  branch?: string;
}

export interface SeedResult {
  password: string;
  passwordWasGenerated: boolean;
  organizations: Record<string, string>;
  branches: Record<string, string>;
  accounts: SeedAccount[];
}

/**
 * Small, realistic development data: DealDash admin org, two sample merchants (one with two branches),
 * a sample bank partner, a sample employer, and representative users for each role.
 * The shared development password comes from SEED_USER_PASSWORD (the CLI seed requires it and never prints it).
 */
export async function seedDev(
  prisma: PrismaClient,
  opts: { password?: string; fieldEncryptionKey: string; storageDir?: string },
): Promise<SeedResult> {
  await seedCatalog(prisma);

  const passwordWasGenerated = !opts.password;
  const password = opts.password ?? `Dd-${randomBytes(9).toString('base64url')}`;
  const passwordHash = await hashPassword(password);
  const roles = new Map((await prisma.role.findMany()).map((r) => [r.code, r.id]));
  const accounts: SeedAccount[] = [];
  const organizations: Record<string, string> = {};
  const branches: Record<string, string> = {};

  async function org(
    key: string,
    type: 'DEALDASH' | 'MERCHANT' | 'PARTNER',
    nameEn: string,
    nameAr: string,
  ) {
    const existing = await prisma.organization.findFirst({ where: { nameEn, type } });
    if (existing) return (organizations[key] = existing.id);
    const o = await prisma.organization.create({ data: { type, nameEn, nameAr } });
    return (organizations[key] = o.id);
  }

  async function user(args: {
    email?: string;
    mobile?: string;
    displayName: string;
    userType: 'MERCHANT_USER' | 'PARTNER_USER' | 'ADMIN_USER' | 'CUSTOMER';
    role?: RoleCode;
    orgKey?: string;
    branchKey?: string;
    audience: SeedAccount['audience'];
    mfa?: boolean;
  }) {
    const where = args.email ? { email: args.email } : { mobile: args.mobile! };
    let u = await prisma.user.findUnique({ where });
    if (!u) {
      u = await prisma.user.create({
        data: {
          userType: args.userType,
          email: args.email,
          mobile: args.mobile,
          displayName: args.displayName,
          passwordHash: args.email ? passwordHash : null,
          ...(args.mfa
            ? {
                mfaEnabled: true,
                mfaSecretEnc: encryptField(generateTotpSecret(), opts.fieldEncryptionKey),
              }
            : {}),
          ...(args.userType === 'CUSTOMER'
            ? { customer: { create: { city: 'Riyadh', onboardingState: 'COMPLETE' } } }
            : {}),
        },
      });
    } else if (args.email) {
      u = await prisma.user.update({
        where: { id: u.id },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      });
    }
    if (args.role && args.orgKey) {
      const organizationId = organizations[args.orgKey]!;
      const branchId = args.branchKey ? branches[args.branchKey] : null;
      const exists = await prisma.organizationMembership.findFirst({
        where: {
          userId: u.id,
          organizationId,
          roleId: roles.get(args.role)!,
          branchId: branchId ?? null,
        },
      });
      if (!exists) {
        await prisma.organizationMembership.create({
          data: {
            userId: u.id,
            organizationId,
            roleId: roles.get(args.role)!,
            branchId: branchId ?? null,
          },
        });
      }
    }
    accounts.push({
      email: args.email,
      mobile: args.mobile,
      role: args.role ?? 'CUSTOMER',
      organization: args.orgKey ?? '-',
      audience: args.audience,
      branch: args.branchKey,
    });
    return u;
  }

  async function branch(
    key: string,
    orgKey: string,
    data: {
      nameEn: string;
      nameAr: string;
      addressEn: string;
      addressAr: string;
      latitude: number;
      longitude: number;
    },
  ) {
    const organizationId = organizations[orgKey]!;
    const existing = await prisma.merchantBranch.findFirst({
      where: { organizationId, nameEn: data.nameEn },
    });
    if (existing) return (branches[key] = existing.id);
    const b = await prisma.merchantBranch.create({
      data: { organizationId, city: 'Riyadh', ...data },
    });
    return (branches[key] = b.id);
  }

  // --- DealDash
  await org('dealdash', 'DEALDASH', 'DealDash', 'ديل داش');
  const admins: Array<[string, RoleCode, string]> = [
    ['super', 'DEALDASH_SUPER_ADMIN', 'Super Admin'],
    ['operations', 'DEALDASH_OPERATIONS', 'Operations'],
    ['merchant-management', 'DEALDASH_MERCHANT_MANAGEMENT', 'Merchant Management'],
    ['partner-management', 'DEALDASH_PARTNER_MANAGEMENT', 'Partner Management'],
    ['support', 'DEALDASH_SUPPORT', 'Support'],
    ['finance', 'DEALDASH_FINANCE', 'Finance'],
    ['risk', 'DEALDASH_RISK_COMPLIANCE', 'Risk and Compliance'],
    ['marketing', 'DEALDASH_MARKETING_OPS', 'Marketing Operations'],
    ['analyst', 'DEALDASH_ANALYST', 'Analyst'],
  ];
  for (const [slug, role, name] of admins) {
    await user({
      email: `${slug}@dealdash.test`,
      displayName: name,
      userType: 'ADMIN_USER',
      role,
      orgKey: 'dealdash',
      audience: 'admin',
      mfa: true,
    });
  }

  // --- Merchant A (two branches) and Merchant B (one branch)
  await org('merchantA', 'MERCHANT', 'Harbour Grill', 'هاربور جريل');
  await prisma.merchant.upsert({
    where: { organizationId: organizations.merchantA! },
    update: {},
    create: {
      organizationId: organizations.merchantA!,
      legalName: 'Harbour Grill Trading Co.',
      category: 'Restaurants',
    },
  });
  await org('merchantB', 'MERCHANT', 'Daily Dose Juice', 'ديلي دوز جوس');
  await prisma.merchant.upsert({
    where: { organizationId: organizations.merchantB! },
    update: {},
    create: {
      organizationId: organizations.merchantB!,
      legalName: 'Daily Dose Juice Co.',
      category: 'Cafes',
    },
  });

  await branch('olaya', 'merchantA', {
    nameEn: 'Harbour Grill Olaya',
    nameAr: 'هاربور جريل العليا',
    addressEn: 'Olaya Street, Riyadh',
    addressAr: 'شارع العليا، الرياض',
    latitude: 24.6908,
    longitude: 46.6853,
  });
  await branch('malqa', 'merchantA', {
    nameEn: 'Harbour Grill Al Malqa',
    nameAr: 'هاربور جريل الملقا',
    addressEn: 'Al Malqa, Riyadh',
    addressAr: 'الملقا، الرياض',
    latitude: 24.8094,
    longitude: 46.6336,
  });
  await branch('kafd', 'merchantB', {
    nameEn: 'Daily Dose KAFD',
    nameAr: 'ديلي دوز المركز المالي',
    addressEn: 'KAFD, Riyadh',
    addressAr: 'المركز المالي، الرياض',
    latitude: 24.7664,
    longitude: 46.6432,
  });

  const merchantRoles: Array<[string, RoleCode, string]> = [
    ['owner', 'MERCHANT_OWNER', 'Owner'],
    ['admin', 'MERCHANT_ADMIN', 'Admin'],
    ['finance', 'MERCHANT_FINANCE', 'Finance'],
    ['campaigns', 'MERCHANT_CAMPAIGN_MANAGER', 'Campaign Manager'],
  ];
  for (const [slug, role, name] of merchantRoles) {
    await user({
      email: `${slug}@harbourgrill.test`,
      displayName: `Harbour Grill ${name}`,
      userType: 'MERCHANT_USER',
      role,
      orgKey: 'merchantA',
      audience: 'merchant',
    });
  }
  await user({
    mobile: '+966500000100',
    displayName: 'Harbour Grill Olaya Staff',
    userType: 'MERCHANT_USER',
    role: 'MERCHANT_STAFF',
    orgKey: 'merchantA',
    branchKey: 'olaya',
    audience: 'staff',
  });
  await user({
    email: 'owner@dailydose.test',
    displayName: 'Daily Dose Owner',
    userType: 'MERCHANT_USER',
    role: 'MERCHANT_OWNER',
    orgKey: 'merchantB',
    audience: 'merchant',
  });

  // --- Partners
  await org('bank', 'PARTNER', 'Riyad Bank (sample)', 'بنك الرياض (تجريبي)');
  await prisma.partner.upsert({
    where: { organizationId: organizations.bank! },
    update: {},
    create: { organizationId: organizations.bank!, partnerType: 'BANK', legalName: 'Sample Bank' },
  });
  await org('employer', 'PARTNER', 'Sample Employer Co.', 'شركة صاحب العمل (تجريبي)');
  await prisma.partner.upsert({
    where: { organizationId: organizations.employer! },
    update: {},
    create: {
      organizationId: organizations.employer!,
      partnerType: 'EMPLOYER',
      legalName: 'Sample Employer Company',
    },
  });

  const partnerRoles: Array<[string, RoleCode, string]> = [
    ['admin', 'PARTNER_ADMIN', 'Admin'],
    ['campaigns', 'PARTNER_CAMPAIGN_MANAGER', 'Campaign Manager'],
    ['benefits', 'PARTNER_BENEFITS_MANAGER', 'Benefits Manager'],
    ['analyst', 'PARTNER_ANALYST', 'Analyst'],
    ['finance', 'PARTNER_FINANCE_VIEWER', 'Finance Viewer'],
    ['readonly', 'PARTNER_READ_ONLY', 'Read-only'],
  ];
  for (const [slug, role, name] of partnerRoles) {
    await user({
      email: `${slug}@bank.test`,
      displayName: `Bank ${name}`,
      userType: 'PARTNER_USER',
      role,
      orgKey: 'bank',
      audience: 'partner',
    });
  }
  await user({
    email: 'admin@employer.test',
    displayName: 'Employer Admin',
    userType: 'PARTNER_USER',
    role: 'PARTNER_ADMIN',
    orgKey: 'employer',
    audience: 'partner',
  });

  // --- Customer
  await user({
    mobile: '+966500000001',
    displayName: 'Sample Customer',
    userType: 'CUSTOMER',
    audience: 'customer',
  });

  const stage2 = await seedStage2({
    prisma,
    organizations,
    branches,
    passwordHash,
    roles,
    fieldEncryptionKey: opts.fieldEncryptionKey,
    storageDir: opts.storageDir,
    accounts,
  });

  await seedStage3({
    prisma,
    organizations,
    branches,
    passwordHash,
    roles,
    storageDir: opts.storageDir,
    accounts,
    helpers: stage2,
  });

  await seedStage4({
    prisma,
    organizations,
    roles,
    storageDir: opts.storageDir,
    accounts,
  });

  await seedStage5({ prisma, organizations, storageDir: opts.storageDir });

  await seedStage6({ prisma, organizations, storageDir: opts.storageDir });

  return { password, passwordWasGenerated, organizations, branches, accounts };
}
