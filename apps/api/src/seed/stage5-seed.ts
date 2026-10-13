import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { VoucherInstanceStatus, VoucherStatus } from '@dealdash/types';
import { voucherContentSchema } from '@dealdash/validation';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { EligibilityService } from '../live-deals/eligibility.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  denormalizeVoucher,
  instanceExpiry,
  newManualCode,
  newQrToken,
  newRef,
} from '../vouchers/voucher-content';
import { makeDevImagePng, type Rgb } from './png';

/** Stage 5 sample data is Saudi Arabia (KSA market fixture): its money is SAR. New data takes the market's currency. */
const SEED_CURRENCY = 'SAR';

export interface Stage5SeedInput {
  prisma: PrismaClient;
  organizations: Record<string, string>;
  storageDir?: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const bi = (en: string, ar: string) => ({ en, ar });

type Org = 'merchantA' | 'merchantB' | 'najd' | 'bloom' | 'pulse' | 'page';
interface VoucherSeed {
  key: string;
  org: Org;
  category: string;
  status: VoucherStatus;
  title: { en: string; ar: string };
  short: { en: string; ar: string };
  description: { en: string; ar: string };
  rules: { en: string; ar: string };
  terms: { en: string; ar: string };
  face: number;
  price: number;
  qty: number;
  perCustomer?: number;
  branches: string[];
  validityDays?: number;
  employerOnly?: boolean;
  pausedBy?: 'MERCHANT' | 'DEALDASH';
  feedback?: { en: string; ar: string };
  palette: [Rgb, Rgb];
}

const TERMS = bi(
  'One voucher per visit. Not redeemable for cash. Valid at the listed branches only.',
  'قسيمة واحدة لكل زيارة. لا تُستبدل بنقد. صالحة في الفروع المحددة فقط.',
);
const RULES = bi(
  'Show the QR code (or the 8-character code) to the cashier before ordering.',
  'اعرض رمز QR (أو الرمز المكوّن من 8 أحرف) للكاشير قبل الطلب.',
);

const VOUCHERS: VoucherSeed[] = [
  {
    key: 'najd-100',
    org: 'najd',
    category: 'dining',
    status: 'ON_SALE',
    title: bi('SAR 100 dining voucher', 'قسيمة طعام بقيمة 100 ريال'),
    short: bi(
      'Pay SAR 80, spend SAR 100 on any dish',
      'ادفع 80 ريالاً واستخدم 100 ريال على أي طبق',
    ),
    description: bi(
      'A SAR 100 voucher for Najd Kitchen. Use it on anything on the menu: kabsa, grills, starters and desserts.',
      'قسيمة بقيمة 100 ريال في نجد كيتشن. استخدمها على أي صنف في القائمة: الكبسة والمشويات والمقبلات والحلويات.',
    ),
    rules: RULES,
    terms: TERMS,
    face: 10_000,
    price: 8_000,
    qty: 60,
    perCustomer: 3,
    branches: ['Najd Kitchen Al Nakheel', 'Najd Kitchen Hittin'],
    palette: [
      [255, 122, 89],
      [88, 24, 69],
    ],
  },
  {
    key: 'bloom-200',
    org: 'bloom',
    category: 'beauty_wellness',
    status: 'ON_SALE',
    title: bi('SAR 200 beauty and spa voucher', 'قسيمة تجميل وسبا بقيمة 200 ريال'),
    short: bi(
      'Pay SAR 150, enjoy SAR 200 of treatments',
      'ادفع 150 ريالاً واستمتع بخدمات بقيمة 200 ريال',
    ),
    description: bi(
      'A SAR 200 voucher for any treatment at Bloom Beauty Studio: facials, manicures, massage and more.',
      'قسيمة بقيمة 200 ريال لأي خدمة في استوديو بلوم للجمال: عناية بالبشرة ومانيكير ومساج وغيرها.',
    ),
    rules: RULES,
    terms: TERMS,
    face: 20_000,
    price: 15_000,
    qty: 40,
    perCustomer: 2,
    branches: ['Bloom Beauty Olaya'],
    validityDays: 60,
    palette: [
      [255, 143, 177],
      [110, 40, 98],
    ],
  },
  {
    key: 'pulse-150',
    org: 'pulse',
    category: 'fitness',
    status: 'ON_SALE',
    title: bi('SAR 150 fitness voucher', 'قسيمة لياقة بقيمة 150 ريال'),
    short: bi('Pay SAR 120 for classes or a day pass', 'ادفع 120 ريالاً لحصص أو تذكرة يوم'),
    description: bi(
      'A SAR 150 voucher for classes, day passes or personal training at Pulse Fitness.',
      'قسيمة بقيمة 150 ريال للحصص أو تذاكر اليوم أو التدريب الشخصي في بالس فتنس.',
    ),
    rules: RULES,
    terms: TERMS,
    face: 15_000,
    price: 12_000,
    qty: 30,
    perCustomer: 2,
    branches: ['Pulse Fitness Al Malqa'],
    palette: [
      [45, 212, 191],
      [15, 23, 42],
    ],
  },
  {
    key: 'page-employer',
    org: 'page',
    category: 'shopping',
    status: 'ON_SALE',
    title: bi('SAR 100 bookshop voucher for employees', 'قسيمة مكتبة بقيمة 100 ريال للموظفين'),
    short: bi('Employer benefit: pay SAR 70', 'ميزة جهة العمل: ادفع 70 ريالاً'),
    description: bi(
      'A SAR 100 voucher for any book or stationery at Page & Co Books, for verified employees of partner companies.',
      'قسيمة بقيمة 100 ريال لأي كتاب أو قرطاسية في بيج آند كو للكتب، لموظفي الشركات الشريكة بعد التحقق.',
    ),
    rules: RULES,
    terms: TERMS,
    face: 10_000,
    price: 7_000,
    qty: 25,
    perCustomer: 1,
    branches: [],
    employerOnly: true,
    palette: [
      [96, 165, 250],
      [30, 27, 75],
    ],
  },
  {
    key: 'grill-sold-out',
    org: 'merchantA',
    category: 'dining',
    status: 'SOLD_OUT',
    title: bi('SAR 120 grill voucher', 'قسيمة مشويات بقيمة 120 ريال'),
    short: bi('Pay SAR 90, grill night for two', 'ادفع 90 ريالاً لأمسية مشويات لشخصين'),
    description: bi(
      'A SAR 120 voucher at Harbour Grill. Sold out for now.',
      'قسيمة بقيمة 120 ريال في هاربور جريل. نفدت حالياً.',
    ),
    rules: RULES,
    terms: TERMS,
    face: 12_000,
    price: 9_000,
    qty: 3,
    perCustomer: 1,
    branches: [],
    palette: [
      [226, 170, 104],
      [74, 44, 32],
    ],
  },
  {
    key: 'najd-feast',
    org: 'najd',
    category: 'dining',
    status: 'PENDING_REVIEW',
    title: bi('SAR 300 family feast voucher', 'قسيمة وليمة عائلية بقيمة 300 ريال'),
    short: bi('Pay SAR 220 for a family feast', 'ادفع 220 ريالاً لوليمة عائلية'),
    description: bi(
      'A SAR 300 voucher for a family feast at Najd Kitchen.',
      'قسيمة بقيمة 300 ريال لوليمة عائلية في نجد كيتشن.',
    ),
    rules: RULES,
    terms: TERMS,
    face: 30_000,
    price: 22_000,
    qty: 20,
    perCustomer: 2,
    branches: ['Najd Kitchen Al Nakheel'],
    palette: [
      [255, 122, 89],
      [88, 24, 69],
    ],
  },
  {
    key: 'bloom-needs',
    org: 'bloom',
    category: 'beauty_wellness',
    status: 'NEEDS_CHANGES',
    title: bi('SAR 500 bridal package voucher', 'قسيمة باقة العروس بقيمة 500 ريال'),
    short: bi('Pay SAR 300 (60% off)', 'ادفع 300 ريال (خصم 40%)'),
    description: bi('A SAR 500 bridal package voucher.', 'قسيمة باقة العروس بقيمة 500 ريال.'),
    rules: RULES,
    terms: TERMS,
    face: 50_000,
    price: 30_000,
    qty: 10,
    branches: ['Bloom Beauty Olaya'],
    feedback: bi(
      'Please list exactly what the bridal package includes and the booking notice needed.',
      'يرجى ذكر ما تتضمنه باقة العروس بالتحديد ومدة الحجز المسبق المطلوبة.',
    ),
    palette: [
      [255, 143, 177],
      [110, 40, 98],
    ],
  },
  {
    key: 'pulse-draft',
    org: 'pulse',
    category: 'fitness',
    status: 'DRAFT',
    title: bi('SAR 400 three-month pass', 'تذكرة ثلاثة أشهر بقيمة 400 ريال'),
    short: bi('', ''),
    description: bi('', ''),
    rules: bi('', ''),
    terms: bi('', ''),
    face: 40_000,
    price: 32_000,
    qty: 15,
    branches: ['Pulse Fitness Al Malqa'],
    palette: [
      [45, 212, 191],
      [15, 23, 42],
    ],
  },
  {
    key: 'najd-paused',
    org: 'najd',
    category: 'dining',
    status: 'PAUSED',
    title: bi('SAR 50 lunch voucher', 'قسيمة غداء بقيمة 50 ريال'),
    short: bi('Pay SAR 40 for lunch', 'ادفع 40 ريالاً للغداء'),
    description: bi(
      'A SAR 50 lunch voucher, paused by the merchant.',
      'قسيمة غداء بقيمة 50 ريال، أوقفها التاجر مؤقتاً.',
    ),
    rules: RULES,
    terms: TERMS,
    face: 5_000,
    price: 4_000,
    qty: 30,
    branches: ['Najd Kitchen Al Nakheel'],
    pausedBy: 'MERCHANT',
    palette: [
      [255, 122, 89],
      [88, 24, 69],
    ],
  },
  {
    key: 'bloom-suspended',
    org: 'bloom',
    category: 'beauty_wellness',
    status: 'SUSPENDED',
    title: bi('SAR 100 nails voucher', 'قسيمة أظافر بقيمة 100 ريال'),
    short: bi('Pay SAR 70 for nails', 'ادفع 70 ريالاً للأظافر'),
    description: bi(
      'A SAR 100 nails voucher, suspended by DealDash pending review.',
      'قسيمة أظافر بقيمة 100 ريال، علّقتها ديل داش بانتظار المراجعة.',
    ),
    rules: RULES,
    terms: TERMS,
    face: 10_000,
    price: 7_000,
    qty: 20,
    branches: ['Bloom Beauty Olaya'],
    palette: [
      [255, 143, 177],
      [110, 40, 98],
    ],
  },
  {
    key: 'pulse-rejected',
    org: 'pulse',
    category: 'fitness',
    status: 'REJECTED',
    title: bi('SAR 1000 lifetime pass', 'تذكرة مدى الحياة بقيمة 1000 ريال'),
    short: bi('Pay SAR 100 for a lifetime pass', 'ادفع 100 ريال لتذكرة مدى الحياة'),
    description: bi(
      'A lifetime pass. Rejected: the value claim is not supported.',
      'تذكرة مدى الحياة. مرفوضة: ادعاء القيمة غير مدعوم.',
    ),
    rules: RULES,
    terms: TERMS,
    face: 100_000,
    price: 10_000,
    qty: 100,
    branches: ['Pulse Fitness Al Malqa'],
    palette: [
      [45, 212, 191],
      [15, 23, 42],
    ],
  },
];

type SaleState = 'ACTIVE' | 'REDEEMED' | 'REFUNDED' | 'EXPIRED' | 'REFUND_REVIEW';
interface Sale {
  voucher: string;
  who: number;
  state: SaleState;
  hoursAgo: number;
}
const SALES: Sale[] = [
  { voucher: 'najd-100', who: 0, state: 'ACTIVE', hoursAgo: 2 },
  { voucher: 'najd-100', who: 1, state: 'REDEEMED', hoursAgo: 30 },
  { voucher: 'najd-100', who: 2, state: 'REFUNDED', hoursAgo: 20 },
  { voucher: 'najd-100', who: 3, state: 'REFUND_REVIEW', hoursAgo: 72 },
  { voucher: 'najd-100', who: 4, state: 'EXPIRED', hoursAgo: 24 * 40 },
  { voucher: 'bloom-200', who: 0, state: 'ACTIVE', hoursAgo: 5 },
  { voucher: 'bloom-200', who: 1, state: 'REDEEMED', hoursAgo: 50 },
  { voucher: 'pulse-150', who: 2, state: 'ACTIVE', hoursAgo: 8 },
  { voucher: 'grill-sold-out', who: 0, state: 'ACTIVE', hoursAgo: 10 },
  { voucher: 'grill-sold-out', who: 1, state: 'REDEEMED', hoursAgo: 12 },
  { voucher: 'grill-sold-out', who: 3, state: 'ACTIVE', hoursAgo: 9 },
  { voucher: 'najd-paused', who: 1, state: 'ACTIVE', hoursAgo: 40 },
  { voucher: 'bloom-suspended', who: 2, state: 'ACTIVE', hoursAgo: 60 },
];

const FEE_BPS = 1000;

/**
 * Stage 5 development data: vouchers in every lifecycle state, and demo sales that cover every customer-facing state
 * (active, used, refunded, refund under review, expired) with the matching payments, refunds, ledger journals and merchant
 * payable events. A live ACTIVE voucher for the sample customer lets you scan a real QR in the Staff app right away.
 * Idempotent per run (a reset re-creates it) and clearly development data. No real payment provider is involved.
 */
export async function seedStage5(input: Stage5SeedInput) {
  const { prisma, organizations } = input;
  if ((await prisma.voucher.count()) > 0) return;
  const now = Date.now();
  const operations = await prisma.user.findUnique({ where: { email: 'operations@dealdash.test' } });
  const category = new Map((await prisma.category.findMany()).map((c) => [c.code, c.id]));
  const eligibility = new EligibilityService(prisma as unknown as PrismaService);
  const employerId = organizations.employer!;
  const customers: string[] = [];
  for (const mobile of [
    '+966500000001',
    '+966500000002',
    '+966500000400',
    '+966500000401',
    '+966500000402',
  ]) {
    const u = await prisma.user.findUnique({ where: { mobile } });
    if (u) customers.push(u.id);
  }
  if (!customers.length || !operations) return;

  async function image(orgId: string, name: string, palette: [Rgb, Rgb], seed: number) {
    const key = `merchants/${orgId}/deal_image/seed-${name}`;
    const data = makeDevImagePng(960, 600, palette[0], palette[1], seed);
    if (input.storageDir) {
      const p = resolve(input.storageDir, key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, data);
    }
    const row = {
      organizationId: orgId,
      kind: 'DEAL_IMAGE',
      originalName: `${name}.png`,
      mimeType: 'image/png',
      declaredSize: data.length,
      sizeBytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
      storageKey: key,
      status: 'AVAILABLE' as const,
      completedAt: new Date(),
    };
    return prisma.storedFile.upsert({ where: { storageKey: key }, update: row, create: row });
  }

  const account = async (tx: Prisma.TransactionClient, family: string, orgId: string | null) => {
    const found = await tx.ledgerAccount.findFirst({
      where: { family: family as never, organizationId: orgId, currency: SEED_CURRENCY },
    });
    return (
      found ??
      tx.ledgerAccount.create({
        data: { family: family as never, organizationId: orgId, currency: SEED_CURRENCY },
      })
    );
  };
  async function journal(
    type: 'SALE' | 'REDEMPTION' | 'REFUND' | 'EXPIRY',
    key: string,
    sourceType: string,
    sourceId: string,
    at: Date,
    lines: Array<{ family: string; org: string | null; amount: number }>,
  ) {
    return prisma.$transaction(async (tx) => {
      const j = await tx.ledgerJournal.create({
        data: {
          type,
          currency: SEED_CURRENCY,
          sourceType,
          sourceId,
          idempotencyKey: key,
          postedAt: at,
          postedByRole: 'SEED',
          feeRuleVersion: type === 'REDEMPTION' ? 1 : null,
        },
      });
      for (const l of lines.filter((x) => x.amount !== 0))
        await tx.ledgerEntry.create({
          data: {
            journalId: j.id,
            accountId: (await account(tx, l.family, l.org)).id,
            amountHalalas: l.amount,
            createdAt: at,
          },
        });
      return j.id;
    });
  }

  const made = new Map<
    string,
    { id: string; orgId: string; seed: VoucherSeed; branchIds: string[]; sold: number }
  >();
  let idx = 0;
  for (const d of VOUCHERS) {
    idx++;
    const orgId = organizations[d.org]!;
    if (!orgId) continue;
    const branchRows = d.branches.length
      ? await prisma.merchantBranch.findMany({
          where: { organizationId: orgId, nameEn: { in: d.branches } },
        })
      : await prisma.merchantBranch.findMany({
          where: { organizationId: orgId, status: 'ACTIVE' },
          take: 1,
        });
    if (!branchRows.length) continue;
    const file = await image(orgId, `voucher-${d.key}`, d.palette, 60 + idx * 5);
    const content = voucherContentSchema.parse({
      categoryId: category.get(d.category),
      title: d.title,
      shortDescription: d.short,
      description: d.description,
      redemptionRules: d.rules,
      media: [
        {
          fileId: file.id,
          altEn: `${d.title.en} (illustration)`,
          altAr: `${d.title.ar} (صورة توضيحية)`,
        },
      ],
      faceValueHalalas: d.face,
      sellingPriceHalalas: d.price,
      totalQty: d.qty,
      perCustomerLimit: d.perCustomer ?? 1,
      validity: { type: 'DAYS_FROM_PURCHASE', days: d.validityDays ?? 30, validUntil: null },
      saleStartAt: new Date(now - 10 * DAY).toISOString(),
      saleEndAt: new Date(now + (d.key === 'najd-paused' ? 5 : 30) * DAY).toISOString(),
      branchIds: branchRows.map((b) => b.id),
      eligibility: d.employerOnly
        ? { kind: 'EMPLOYER', valueRefs: [employerId] }
        : { kind: 'PUBLIC', valueRefs: [] },
      terms: { textEn: d.terms.en, textAr: d.terms.ar },
    });
    const owner = await prisma.organizationMembership.findFirst({
      where: { organizationId: orgId, role: { code: 'MERCHANT_OWNER' } },
    });
    const ruleSetId = await eligibility.syncRuleSet(
      prisma as unknown as Prisma.TransactionClient,
      null,
      orgId,
      content.eligibility,
    );
    const published = ['SCHEDULED', 'ON_SALE', 'PAUSED', 'SOLD_OUT', 'ENDED', 'SUSPENDED'].includes(
      d.status,
    );
    const sold = SALES.filter((s) => s.voucher === d.key).length;
    const v = await prisma.voucher.create({
      data: {
        organizationId: orgId,
        currency: SEED_CURRENCY,
        status: d.status,
        pausedBy: d.status === 'PAUSED' ? (d.pausedBy ?? 'MERCHANT') : null,
        content: content as unknown as Prisma.InputJsonValue,
        ...denormalizeVoucher(content),
        totalQty: d.qty,
        soldQty: sold,
        eligibilityRuleSetId: ruleSetId,
        submittedAt:
          d.status === 'DRAFT'
            ? null
            : new Date(now - (d.status === 'PENDING_REVIEW' ? 2 : 9) * HOUR),
        publishedAt: published ? new Date(now - 10 * DAY) : null,
        createdByUserId: owner?.userId ?? operations.id,
        updatedByUserId: owner?.userId ?? null,
        createdAt: new Date(now - 11 * DAY),
        branches: { create: branchRows.map((b) => ({ branchId: b.id })) },
      },
    });
    const log = async (
      action: Prisma.VoucherHistoryUncheckedCreateInput['action'],
      to: VoucherStatus,
      at: Date,
      byDealDash: boolean,
      reason?: string,
      reasonAr?: string,
    ) => {
      await prisma.voucherHistory.create({
        data: {
          voucherId: v.id,
          action,
          toStatus: to,
          reason: reason ?? null,
          reasonAr: reasonAr ?? null,
          actorUserId: byDealDash ? operations.id : (owner?.userId ?? null),
          actorRole: byDealDash ? 'DEALDASH_OPERATIONS' : 'MERCHANT_OWNER',
          actorName: byDealDash ? 'Operations' : 'Merchant owner',
          byDealDash,
          createdAt: at,
        },
      });
    };
    await log('CREATE', 'DRAFT', new Date(now - 11 * DAY), false);
    if (d.status !== 'DRAFT')
      await log(
        'SUBMIT',
        'PENDING_REVIEW',
        new Date(now - 10 * DAY - HOUR),
        false,
        'PILOT_MANUAL_REVIEW',
      );
    if (d.status === 'NEEDS_CHANGES')
      await log(
        'REQUEST_CHANGES',
        'NEEDS_CHANGES',
        new Date(now - HOUR),
        true,
        d.feedback?.en,
        d.feedback?.ar,
      );
    if (d.status === 'REJECTED')
      await log(
        'REJECT',
        'REJECTED',
        new Date(now - 2 * HOUR),
        true,
        'The value claim is not supported by the merchant.',
      );
    if (published)
      await log(
        'APPROVE',
        'ON_SALE',
        new Date(now - 10 * DAY),
        true,
        'Offer is clear and limits are reasonable.',
      );
    if (d.status === 'SUSPENDED')
      await log(
        'SUSPEND',
        'SUSPENDED',
        new Date(now - 3 * HOUR),
        true,
        'Pending a customer complaint review.',
      );
    made.set(d.key, { id: v.id, orgId, seed: d, branchIds: branchRows.map((b) => b.id), sold: 0 });
  }

  // ---------------------------------------------------------------- demo sales
  const staffUser = await prisma.user.findUnique({ where: { mobile: '+966500000102' } });
  let n = 0;
  for (const s of SALES) {
    const m = made.get(s.voucher);
    if (!m) continue;
    n++;
    const userId = customers[s.who % customers.length]!;
    const at = new Date(now - s.hoursAgo * HOUR);
    const content = voucherContentSchema.parse(
      (await prisma.voucher.findUniqueOrThrow({ where: { id: m.id } })).content as Record<
        string,
        unknown
      >,
    );
    const price = m.seed.price;
    const order = await prisma.voucherOrder.create({
      data: {
        reference: newRef('ORD'),
        currency: SEED_CURRENCY,
        userId,
        voucherId: m.id,
        organizationId: m.orgId,
        unitPriceHalalas: price,
        faceValueHalalas: m.seed.face,
        totalHalalas: price,
        status: 'PAID',
        holdExpiresAt: new Date(at.getTime() + 10 * 60_000),
        termsVersion: '2026-10-v1',
        termsAcceptedAt: at,
        paidAt: at,
        createdAt: at,
      },
    });
    const pay = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: 'mock',
        currency: SEED_CURRENCY,
        providerReference: `seed-pay-${n}`,
        status: s.state === 'REFUNDED' ? 'REFUNDED' : 'SUCCEEDED',
        amountHalalas: price,
        idempotencyKey: `seed:${order.id}`,
        methodType: 'mock_card',
        createdAt: at,
        completedAt: at,
      },
    });
    const expiresAt =
      s.state === 'EXPIRED'
        ? new Date(now - 10 * DAY)
        : instanceExpiry(
            {
              validityType: 'DAYS_FROM_PURCHASE',
              validityDays: content.validity.days,
              validUntil: null,
            },
            at,
            'Asia/Riyadh', // Saudi sample data (KSA market fixture)
          );
    const status: VoucherInstanceStatus =
      s.state === 'REDEEMED'
        ? 'REDEEMED'
        : s.state === 'REFUNDED'
          ? 'REFUNDED'
          : s.state === 'EXPIRED'
            ? 'EXPIRED'
            : 'ACTIVE';
    const inst = await prisma.voucherInstance.create({
      data: {
        reference: newRef('VC'),
        voucherId: m.id,
        orderId: order.id,
        organizationId: m.orgId,
        ownerUserId: userId,
        status,
        purchasePriceHalalas: price,
        faceValueHalalas: m.seed.face,
        expiresAt,
        qrToken: newQrToken(),
        manualCode: newManualCode(),
        issuedAt: at,
        redeemedAt: s.state === 'REDEEMED' ? new Date(at.getTime() + 3 * HOUR) : null,
        refundedAt: s.state === 'REFUNDED' ? new Date(at.getTime() + HOUR) : null,
        expiredAt: s.state === 'EXPIRED' ? expiresAt : null,
      },
    });
    const sale = await journal('SALE', `sale:${pay.id}`, 'Payment', pay.id, at, [
      { family: 'PSP_CLEARING', org: null, amount: price },
      { family: 'MERCHANT_HELD', org: m.orgId, amount: -price },
    ]);
    await prisma.merchantPayableEvent.createMany({
      data: [
        {
          organizationId: m.orgId,
          voucherId: m.id,
          currency: SEED_CURRENCY,
          type: 'SOLD',
          amountHalalas: price,
          journalId: sale,
          note: `payment ${pay.id}`,
          createdAt: at,
        },
        {
          organizationId: m.orgId,
          voucherId: m.id,
          currency: SEED_CURRENCY,
          instanceId: inst.id,
          type: 'ISSUED',
          amountHalalas: price,
          note: `order ${order.reference}`,
          createdAt: at,
        },
      ],
    });
    if (s.state === 'REDEEMED') {
      const redeemedAt = inst.redeemedAt!;
      const red = await prisma.voucherRedemption.create({
        data: {
          instanceId: inst.id,
          voucherId: m.id,
          branchId: m.branchIds[0]!,
          organizationId: m.orgId,
          staffUserId: staffUser?.id ?? operations.id,
          source: 'QR',
          reference: newRef('RV'),
          redeemedAt,
        },
      });
      const fee = Math.round((price * FEE_BPS) / 10_000);
      const j = await journal(
        'REDEMPTION',
        `redemption:${red.id}`,
        'VoucherRedemption',
        red.id,
        redeemedAt,
        [
          { family: 'MERCHANT_HELD', org: m.orgId, amount: price },
          { family: 'PLATFORM_REVENUE', org: null, amount: -fee },
          { family: 'MERCHANT_SETTLEMENT_ELIGIBLE', org: m.orgId, amount: -(price - fee) },
        ],
      );
      await prisma.merchantPayableEvent.createMany({
        data: [
          {
            organizationId: m.orgId,
            voucherId: m.id,
            currency: SEED_CURRENCY,
            instanceId: inst.id,
            type: 'REDEEMED',
            amountHalalas: price,
            journalId: j,
            createdAt: redeemedAt,
          },
          {
            organizationId: m.orgId,
            voucherId: m.id,
            currency: SEED_CURRENCY,
            instanceId: inst.id,
            type: 'ELIGIBLE',
            amountHalalas: price - fee,
            feeHalalas: fee,
            journalId: j,
            note: 'settlement-eligible after redemption (fee rule v1)',
            createdAt: redeemedAt,
          },
        ],
      });
    }
    if (s.state === 'REFUNDED' || s.state === 'REFUND_REVIEW') {
      const refund = await prisma.refund.create({
        data: {
          reference: newRef('RF'),
          currency: SEED_CURRENCY,
          orderId: order.id,
          paymentId: pay.id,
          instanceId: inst.id,
          organizationId: m.orgId,
          amountHalalas: price,
          status: s.state === 'REFUNDED' ? 'REFUNDED' : 'UNDER_REVIEW',
          kind: 'CUSTOMER_REQUEST',
          reasonCode: 'CHANGED_MIND',
          reason: s.state === 'REFUNDED' ? 'Plans changed' : 'I booked another restaurant',
          requestedByUserId: userId,
          requestedByRole: 'CUSTOMER',
          decidedAt: s.state === 'REFUNDED' ? new Date(at.getTime() + HOUR) : null,
          decisionNote: s.state === 'REFUNDED' ? 'Within the refund window' : null,
          idempotencyKey: `seed-refund:${inst.id}`,
          createdAt: new Date(at.getTime() + HOUR),
          refundedAt: s.state === 'REFUNDED' ? new Date(at.getTime() + HOUR) : null,
        },
      });
      if (s.state === 'REFUNDED') {
        const j = await journal(
          'REFUND',
          `refund:${refund.id}`,
          'Refund',
          refund.id,
          refund.refundedAt!,
          [
            { family: 'MERCHANT_HELD', org: m.orgId, amount: price },
            { family: 'PSP_CLEARING', org: null, amount: -price },
          ],
        );
        await prisma.merchantPayableEvent.create({
          data: {
            organizationId: m.orgId,
            voucherId: m.id,
            currency: SEED_CURRENCY,
            instanceId: inst.id,
            type: 'REFUNDED',
            amountHalalas: price,
            journalId: j,
            note: refund.reference,
            createdAt: refund.refundedAt!,
          },
        });
      }
    }
    if (s.state === 'EXPIRED') {
      const j = await journal(
        'EXPIRY',
        `expiry:${inst.id}`,
        'VoucherInstance',
        inst.id,
        expiresAt,
        [
          { family: 'MERCHANT_HELD', org: m.orgId, amount: price },
          { family: 'EXPIRED_VALUE', org: m.orgId, amount: -price },
        ],
      );
      await prisma.merchantPayableEvent.create({
        data: {
          organizationId: m.orgId,
          voucherId: m.id,
          currency: SEED_CURRENCY,
          instanceId: inst.id,
          type: 'EXPIRED',
          amountHalalas: price,
          journalId: j,
          note: 'expired unredeemed (treatment of expired value: VALIDATE-KSA)',
          createdAt: expiresAt,
        },
      });
    }
    await prisma.dealEvent.createMany({
      data: [
        {
          type: 'CHECKOUT_STARTED',
          productType: 'VOUCHER',
          dealId: m.id,
          merchantOrgId: m.orgId,
          userId,
          anonymousId: `user:${userId}`,
          occurredAt: at,
        },
        {
          type: 'PAYMENT_SUCCEEDED',
          productType: 'VOUCHER',
          dealId: m.id,
          merchantOrgId: m.orgId,
          userId,
          anonymousId: `user:${userId}`,
          occurredAt: at,
        },
        {
          type: 'VOUCHER_ISSUED',
          productType: 'VOUCHER',
          dealId: m.id,
          merchantOrgId: m.orgId,
          userId,
          anonymousId: `user:${userId}`,
          occurredAt: at,
        },
      ],
    });
  }
  // synthetic discovery signals so the merchant funnel is not empty (impressions and detail views only)
  for (const m of made.values()) {
    if (!['ON_SALE', 'SOLD_OUT', 'PAUSED'].includes(m.seed.status)) continue;
    const rows = Array.from({ length: 24 }, (_, i) => ({
      type: (i % 3 === 0 ? 'DETAIL_VIEW' : 'IMPRESSION') as 'DETAIL_VIEW' | 'IMPRESSION',
      productType: 'VOUCHER',
      dealId: m.id,
      merchantOrgId: m.orgId,
      anonymousId: `seed-anon-${i}`,
      occurredAt: new Date(now - (i + 1) * 2 * HOUR),
    }));
    await prisma.dealEvent.createMany({ data: rows });
  }
}
