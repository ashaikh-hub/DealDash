import { seedSubscriptionCatalog } from './subscription-catalog';
import { CONFIG_DEFAULTS } from '@dealdash/config';
import {
  PERMISSION_CODES,
  ROLE_CODES,
  ROLE_PERMISSIONS,
  ROLE_SCOPE_BY_CODE,
} from '@dealdash/types';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { seedCategories } from '../live-deals/categories.service';

type Db = PrismaClient | Prisma.TransactionClient;

/** Current merchant agreement version. PLACEHOLDER text only: final terms need Saudi counsel (VALIDATE-KSA). */
export const AGREEMENT_V1 = {
  version: '1.0',
  titleEn: 'DealDash Merchant Agreement (draft text)',
  titleAr: 'اتفاقية التاجر مع ديل داش (نص تجريبي)',
  bodyEn:
    'PLACEHOLDER: this is development text only and is not a legal agreement. The final merchant terms will be written and approved by qualified counsel in Saudi Arabia before launch (VALIDATE-KSA).\n\n1. The merchant provides accurate business information.\n2. The merchant honours the offers it publishes.\n3. DealDash may suspend an account that breaks the rules.',
  bodyAr:
    'نص تجريبي: هذا النص للتطوير فقط وليس اتفاقية قانونية. ستتم كتابة شروط التاجر النهائية واعتمادها من مستشار قانوني مؤهل في المملكة قبل الإطلاق.\n\n١. يقدّم التاجر معلومات تجارية دقيقة.\n٢. يلتزم التاجر بالعروض التي ينشرها.\n٣. يجوز لديل داش إيقاف الحساب عند مخالفة القواعد.',
};

const titleCase = (code: string) =>
  code
    .toLowerCase()
    .split('_')
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');

/**
 * Seeds the permission catalogue, roles, role-permission matrix and default configuration.
 * Idempotent: safe to run on every start and in tests. The matrix lives in @dealdash/types.
 */
export async function seedCatalog(db: Db) {
  for (const code of PERMISSION_CODES) {
    await db.permission.upsert({
      where: { code },
      update: {},
      create: { code, description: code },
    });
  }
  const permissions = new Map((await db.permission.findMany()).map((p) => [p.code, p.id]));

  for (const code of ROLE_CODES) {
    const role = await db.role.upsert({
      where: { code },
      update: { scope: ROLE_SCOPE_BY_CODE[code] },
      create: { code, scope: ROLE_SCOPE_BY_CODE[code], name: titleCase(code) },
    });
    const wanted = new Set(ROLE_PERMISSIONS[code].map((c) => permissions.get(c)!));
    const current = await db.rolePermission.findMany({ where: { roleId: role.id } });
    const currentIds = new Set(current.map((c) => c.permissionId));
    const toAdd = [...wanted].filter((id) => !currentIds.has(id));
    const toRemove = [...currentIds].filter((id) => !wanted.has(id));
    if (toAdd.length)
      await db.rolePermission.createMany({
        data: toAdd.map((permissionId) => ({ roleId: role.id, permissionId })),
      });
    if (toRemove.length)
      await db.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { in: toRemove } },
      });
  }

  for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
    await db.systemConfiguration.upsert({
      where: { key },
      update: {},
      create: {
        key,
        value: value as Prisma.InputJsonValue,
        description: 'Initial value (Stage 1 default)',
      },
    });
  }

  // Markets. KSA is the only enabled market for the pilot; other markets exist as disabled configuration so the model is exercised.
  // Tax, payment, settlement, residency and legal text are VALIDATE-KSA placeholders, never statements of fact.
  const markets = [
    { code: 'SA', nameEn: 'Saudi Arabia', nameAr: 'المملكة العربية السعودية', currency: 'SAR', enabled: true },
    { code: 'AE', nameEn: 'United Arab Emirates', nameAr: 'الإمارات العربية المتحدة', currency: 'AED', enabled: false },
    { code: 'QA', nameEn: 'Qatar', nameAr: 'قطر', currency: 'QAR', enabled: false },
  ];
  for (const m of markets)
    await db.countryConfiguration.upsert({
      where: { code: m.code },
      update: {},
      create: {
        ...m,
        languages: ['ar', 'en'],
        taxProfile: { status: 'NOT_CONFIGURED_VALIDATE' },
        paymentProvider: m.enabled ? 'MOCK_PAYMENT' : null,
        settlement: { status: 'NOT_CONFIGURED_VALIDATE' },
        residency: { status: 'NOT_CONFIGURED_VALIDATE' },
      },
    });

  // Stage 3: configurable discovery categories (development defaults, editable by operations).
  await seedCategories(db);

  // Subscription / licensing engine: the plan catalog, price book and add-ons (Pakistan configuration; data, editable by DealDash Admin).
  await seedSubscriptionCatalog(db);

  // The agreement version merchants accept during onboarding (versioned; new versions are added, never edited).
  await db.agreementVersion.upsert({
    where: { kind_version: { kind: 'MERCHANT', version: AGREEMENT_V1.version } },
    update: {},
    create: { kind: 'MERCHANT', ...AGREEMENT_V1, placeholder: true, active: true },
  });
}
