import { Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { CONFIG_KEYS, type ApiEnv } from '@dealdash/config';
import type { EligibilityKind } from '@dealdash/types';
import type {
  BenefitCardView,
  BenefitEmployerStartInput,
  BenefitEmployerStartResult,
  BenefitEmployerVerifyInput,
  BenefitEmployerView,
  BenefitHistoryEvent,
  BenefitHistoryItem,
  BenefitOffer,
  BenefitOffersQuery,
  BenefitOptions,
  BenefitsOverview,
  BenefitUsageItem,
} from '@dealdash/validation';
import { AuditService } from '../audit/audit.service';
import { encryptField, hmacSha256, safeEqual, sha256 } from '../common/crypto';
import { APP_ENV } from '../common/env';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { HotDiscoveryService } from '../hot-deals/hot-discovery.service';
import { DiscoveryService } from '../live-deals/discovery.service';
import { partnerRefsOf, isPartnerBenefitRule } from '../live-deals/eligibility.service';
import { MarketService } from '../platform/markets/market.service';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_PROVIDER, type EmailProvider } from '../providers/interfaces';
import { SystemConfigService } from '../system-config/system-config.service';
import { VoucherDiscoveryService } from '../vouchers/voucher-discovery.service';

/** Configuration (customer.benefits); every value is configuration, never a decided policy in code. */
export interface BenefitsConfig {
  employerReverifyDays: number;
  reverifyNoticeDays: number;
  emailOtpTtlSeconds: number;
  emailOtpMaxAttempts: number;
  emailOtpMaxPerHour: number;
  emailOtpCooldownSeconds: number;
  allowSubdomains: boolean;
  blockedLocalParts: string[];
  blockedDomains: string[];
  maxCardEntries: number;
}
const DEFAULTS: BenefitsConfig = {
  employerReverifyDays: 180,
  reverifyNoticeDays: 14,
  emailOtpTtlSeconds: 600,
  emailOtpMaxAttempts: 5,
  emailOtpMaxPerHour: 5,
  emailOtpCooldownSeconds: 60,
  allowSubdomains: true,
  blockedLocalParts: [],
  blockedDomains: [],
  maxCardEntries: 5,
};

const DAY = 86_400_000;
const OTP_PURPOSE = 'BENEFIT_EMPLOYER';
/** Every benefit event is audited against the customer (entityType + entityId), which is also their benefit history. */
const AUDIT_ENTITY = 'CustomerBenefit';
const EVENT_OF_ACTION: Record<string, BenefitHistoryEvent> = {
  'benefit.employer.code_sent': 'EMPLOYER_CODE_SENT',
  'benefit.employer.verified': 'EMPLOYER_VERIFIED',
  'benefit.employer.renewal_due': 'EMPLOYER_RENEWAL_DUE',
  'benefit.employer.expired': 'EMPLOYER_EXPIRED',
  'benefit.employer.removed': 'EMPLOYER_REMOVED',
  'benefit.card.added': 'CARD_ADDED',
  'benefit.card.removed': 'CARD_REMOVED',
};

type Bi = { en: string; ar: string };

/** "a***@company.com": enough for the customer to recognise it, never the full address (EM-05). */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

/** EM-02: the work email's domain must be one of the employer's approved domains (subdomains when configured). */
export function domainAllowed(email: string, domains: readonly string[], allowSubdomains: boolean) {
  const domain = (email.split('@')[1] ?? '').toLowerCase();
  return domains.some((d) => {
    const want = d.toLowerCase().replace(/^@/, '');
    return domain === want || (allowSubdomains && domain.endsWith(`.${want}`));
  });
}

/**
 * Customer "My benefits" (Business Rules §5 EL, §6 EM, §7 BC). The customer's benefits are rows of the one eligibility model
 * (`EligibilityAttribute`) that every product already evaluates, so an unlocked benefit opens offers everywhere at once:
 *  - employer: chosen from ACTIVE partner programmes, proven by a work-email code (OTP_VERIFIED), one at a time (EM-08), expires and
 *    is renewed by a new code (EM-20); the address is kept hashed + encrypted and shown masked (EM-05), one account per address (EM-06)
 *  - cards: issuer / product / tier picked from ACTIVE partner card programmes (BC-01); SELF_DECLARED, never "verified" (BC-04), no
 *    card number of any kind (BC-03); removable at any time and removal locks dependent offers at once (BC-14 / EL-12)
 * Issued reservations and vouchers are never touched by a benefit change (EL-13).
 */
@Injectable()
export class BenefitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: SystemConfigService,
    private readonly markets: MarketService,
    private readonly live: DiscoveryService,
    private readonly hot: HotDiscoveryService,
    private readonly vouchers: VoucherDiscoveryService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(APP_ENV) private readonly env: ApiEnv,
  ) {}

  private async cfg(): Promise<BenefitsConfig> {
    const c = (await this.config.get<Partial<BenefitsConfig>>(CONFIG_KEYS.CUSTOMER_BENEFITS)) ?? {};
    return { ...DEFAULTS, ...c };
  }

  private contactHash(email: string) {
    return hmacSha256(this.env.FIELD_ENCRYPTION_KEY, `work-email:${email.toLowerCase()}`);
  }

  private otpTarget(userId: string, programId: string, hash: string) {
    return `benefit:${userId}:${programId}:${hash}`;
  }

  private otpHash(target: string, code: string) {
    return sha256(`${this.env.SESSION_SECRET}:${target}:${code}`);
  }

  /** The customer's city (profile, else the requested one, else the first enabled city) and its market. */
  private async marketFor(userId: string, city?: string) {
    const c = await this.prisma.customer.findUnique({ where: { userId }, select: { city: true } });
    return this.markets.marketOfCity(city ?? c?.city ?? null);
  }

  private async record(
    userId: string,
    action: keyof typeof EVENT_OF_ACTION,
    name: Bi,
    extra: Record<string, unknown>,
    meta?: RequestMeta,
    system = false,
  ) {
    await this.audit.record({
      action,
      entityType: AUDIT_ENTITY,
      entityId: userId,
      actorUserId: system ? null : userId,
      newState: { name, ...extra },
      source: system ? 'SYSTEM' : 'APP',
      meta,
    });
  }

  private async notify(userId: string, dedupeKey: string, event: BenefitHistoryEvent, name: Bi) {
    const r = await this.prisma.notification.createMany({
      data: [{ userId, type: 'BENEFIT_UPDATED', dedupeKey, data: { event, name } }],
      skipDuplicates: true,
    });
    return r.count > 0;
  }

  // ---------------------------------------------------------------- reference data
  private async activeEmployerProgram(programId: string) {
    const p = await this.prisma.partnerEmployerProgram.findFirst({
      where: { id: programId, status: 'ACTIVE' },
    });
    if (!p)
      throw new AppError('BENEFIT_PROGRAM_UNAVAILABLE', 'This employer is not available', 422);
    const org = await this.prisma.organization.findFirst({
      where: { id: p.partnerOrganizationId, type: 'PARTNER', status: 'ACTIVE' },
    });
    if (!org)
      throw new AppError('BENEFIT_PROGRAM_UNAVAILABLE', 'This employer is not available', 422);
    return { program: p, partner: org };
  }

  private async activeCardProgram(programId: string) {
    const p = await this.prisma.partnerCardProgram.findFirst({
      where: { id: programId, status: 'ACTIVE' },
    });
    if (!p) throw new AppError('BENEFIT_PROGRAM_UNAVAILABLE', 'This card is not available', 422);
    const org = await this.prisma.organization.findFirst({
      where: { id: p.partnerOrganizationId, type: 'PARTNER', status: 'ACTIVE' },
    });
    if (!org) throw new AppError('BENEFIT_PROGRAM_UNAVAILABLE', 'This card is not available', 422);
    return { program: p, issuer: org };
  }

  /** EM-01 / BC-01: what the customer may choose: ACTIVE programmes of ACTIVE partners in the customer's market. */
  async options(userId: string, city?: string): Promise<BenefitOptions> {
    const market = await this.marketFor(userId, city);
    const [employers, cards] = await Promise.all([
      this.prisma.partnerEmployerProgram.findMany({
        where: { status: 'ACTIVE', market },
        orderBy: { nameEn: 'asc' },
      }),
      this.prisma.partnerCardProgram.findMany({
        where: { status: 'ACTIVE', market },
        orderBy: [{ issuerName: 'asc' }, { nameEn: 'asc' }],
      }),
    ]);
    const orgs = await this.prisma.organization.findMany({
      where: {
        id: { in: [...employers, ...cards].map((p) => p.partnerOrganizationId) },
        type: 'PARTNER',
        status: 'ACTIVE',
      },
    });
    const byId = new Map(
      orgs.map((o) => [o.id, { id: o.id, name: { en: o.nameEn, ar: o.nameAr } }]),
    );
    return {
      employers: employers
        .filter((p) => byId.has(p.partnerOrganizationId))
        .map((p) => ({
          programId: p.id,
          name: { en: p.nameEn, ar: p.nameAr },
          partner: byId.get(p.partnerOrganizationId)!,
          domains: p.domains,
        })),
      cards: cards
        .filter((p) => byId.has(p.partnerOrganizationId))
        .map((p) => ({
          programId: p.id,
          name: { en: p.nameEn, ar: p.nameAr },
          issuer: byId.get(p.partnerOrganizationId)!,
          scheme: p.scheme,
          tier: p.tier,
        })),
    };
  }

  // ---------------------------------------------------------------- employer (work-email code)
  async employerStart(
    actor: Actor,
    input: BenefitEmployerStartInput,
    meta: RequestMeta,
  ): Promise<BenefitEmployerStartResult> {
    const cfg = await this.cfg();
    const { program, partner } = await this.activeEmployerProgram(input.programId);
    const email = input.email.toLowerCase();
    const [local = '', domain = ''] = email.split('@');
    if (
      cfg.blockedLocalParts.map((x) => x.toLowerCase()).includes(local) ||
      cfg.blockedDomains.map((x) => x.toLowerCase()).includes(domain)
    )
      throw new AppError(
        'BENEFIT_EMAIL_NOT_ALLOWED',
        'Use your own work email, not a shared or personal address',
        422,
        'email',
      );
    if (!domainAllowed(email, program.domains, cfg.allowSubdomains))
      throw new AppError(
        'BENEFIT_EMAIL_DOMAIN',
        'This email is not one of your employer’s work domains',
        422,
        'email',
      );
    const hash = this.contactHash(email);
    await this.assertEmailFree(actor.userId, hash);

    // EM-03 request limits: per customer, across programmes
    const since = new Date(Date.now() - 3_600_000);
    const recent = await this.prisma.otpChallenge.findMany({
      where: {
        purpose: OTP_PURPOSE,
        target: { startsWith: `benefit:${actor.userId}:` },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: cfg.emailOtpMaxPerHour + 1,
    });
    if (recent.length >= cfg.emailOtpMaxPerHour)
      throw AppError.rateLimited('OTP_RATE_LIMITED', 'Too many codes requested. Try again later.');
    const latest = recent[0];
    if (latest && Date.now() - latest.createdAt.getTime() < cfg.emailOtpCooldownSeconds * 1000)
      throw AppError.rateLimited(
        'OTP_RATE_LIMITED',
        `Please wait ${cfg.emailOtpCooldownSeconds} seconds before requesting another code.`,
      );

    const target = this.otpTarget(actor.userId, program.id, hash);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.otpChallenge.create({
      data: {
        purpose: OTP_PURPOSE,
        audience: 'customer',
        target,
        codeHash: this.otpHash(target, code),
        maxAttempts: cfg.emailOtpMaxAttempts,
        expiresAt: new Date(Date.now() + cfg.emailOtpTtlSeconds * 1000),
        ip: meta.ip,
      },
    });
    const minutes = Math.round(cfg.emailOtpTtlSeconds / 60);
    await this.email.send({
      to: email,
      templateKey: 'benefit.employer_code',
      subject:
        meta.locale === 'ar' ? 'رمز تأكيد جهة العمل في ديل داش' : 'Your DealDash work email code',
      body:
        meta.locale === 'ar'
          ? `رمز ديل داش لتأكيد جهة عملك ${partner.nameAr}: ${code}. صالح لمدة ${minutes} دقيقة. لا تشاركه مع أحد.`
          : `Your DealDash code to confirm you work at ${partner.nameEn}: ${code}. It is valid for ${minutes} minutes. Do not share it.`,
      locale: meta.locale,
    });

    // EL-10: the benefit is Pending until the code is confirmed (an already verified employer stays usable meanwhile)
    const existing = await this.prisma.eligibilityAttribute.findUnique({
      where: {
        userId_attrType_valueRef: {
          userId: actor.userId,
          attrType: 'EMPLOYER',
          valueRef: partner.id,
        },
      },
    });
    if (!existing)
      await this.prisma.eligibilityAttribute.create({
        data: {
          userId: actor.userId,
          attrType: 'EMPLOYER',
          valueRef: partner.id,
          level: 'SELF_DECLARED',
          status: 'PENDING',
          source: 'WORK_EMAIL_OTP',
          programId: program.id,
          contactMasked: maskEmail(email),
        },
      });
    else if (existing.status !== 'VERIFIED')
      await this.prisma.eligibilityAttribute.update({
        where: { id: existing.id },
        data: { status: 'PENDING', programId: program.id, contactMasked: maskEmail(email) },
      });

    await this.record(
      actor.userId,
      'benefit.employer.code_sent',
      { en: partner.nameEn, ar: partner.nameAr },
      { programId: program.id, partnerId: partner.id },
      meta,
    );
    return {
      maskedEmail: maskEmail(email),
      expiresInSeconds: cfg.emailOtpTtlSeconds,
      resendAfterSeconds: cfg.emailOtpCooldownSeconds,
    };
  }

  /** EM-06: one active customer account per work email. A second account is refused (and the attempt is audited for risk). */
  private async assertEmailFree(userId: string, hash: string) {
    const other = await this.prisma.eligibilityAttribute.findFirst({
      where: {
        attrType: 'EMPLOYER',
        contactHash: hash,
        status: { in: ['VERIFIED', 'REVERIFICATION_DUE'] },
        userId: { not: userId },
      },
      select: { id: true },
    });
    if (other) {
      await this.audit.record({
        action: 'benefit.employer.email_in_use',
        entityType: AUDIT_ENTITY,
        entityId: userId,
        actorUserId: userId,
        reason: 'work email already linked to another account (EM-06)',
        source: 'RISK',
      });
      throw new AppError(
        'BENEFIT_EMAIL_IN_USE',
        'This work email is already linked to another DealDash account',
        409,
        'email',
      );
    }
  }

  async employerVerify(actor: Actor, input: BenefitEmployerVerifyInput, meta: RequestMeta) {
    const cfg = await this.cfg();
    const { program, partner } = await this.activeEmployerProgram(input.programId);
    const email = input.email.toLowerCase();
    const hash = this.contactHash(email);
    const target = this.otpTarget(actor.userId, program.id, hash);
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { purpose: OTP_PURPOSE, target, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw new AppError('OTP_INVALID', 'The code is not valid', 400, 'code');
    if (challenge.expiresAt <= new Date())
      throw new AppError('OTP_EXPIRED', 'The code has expired. Request a new one.', 400, 'code');
    if (challenge.attempts >= challenge.maxAttempts)
      throw AppError.rateLimited('OTP_LOCKED', 'Too many attempts. Request a new code.');
    if (!safeEqual(this.otpHash(target, input.code), challenge.codeHash)) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      if (challenge.attempts + 1 >= challenge.maxAttempts)
        await this.prisma.eligibilityAttribute.updateMany({
          where: {
            userId: actor.userId,
            attrType: 'EMPLOYER',
            valueRef: partner.id,
            status: 'PENDING',
          },
          data: { status: 'FAILED' },
        });
      throw new AppError('OTP_INVALID', 'The code is not valid', 400, 'code');
    }
    await this.assertEmailFree(actor.userId, hash);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + cfg.employerReverifyDays * DAY);
    const attr = await this.prisma.$transaction(async (tx) => {
      await tx.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: now } });
      // EM-08: one active verified employer at a time: a new employer replaces the current one
      await tx.eligibilityAttribute.updateMany({
        where: {
          userId: actor.userId,
          attrType: 'EMPLOYER',
          valueRef: { not: partner.id },
          status: { not: 'REVOKED' },
        },
        data: { status: 'REVOKED', contactEnc: null, contactHash: null },
      });
      return tx.eligibilityAttribute.upsert({
        where: {
          userId_attrType_valueRef: {
            userId: actor.userId,
            attrType: 'EMPLOYER',
            valueRef: partner.id,
          },
        },
        // the proof is the OTP level itself (EL-05); verificationSource is reserved for trusted CARD sources (FD-S7-3 CHECK)
        update: {
          level: 'OTP_VERIFIED',
          status: 'VERIFIED',
          source: 'WORK_EMAIL_OTP',
          verifiedAt: now,
          expiresAt,
          programId: program.id,
          contactHash: hash,
          contactEnc: encryptField(email, this.env.FIELD_ENCRYPTION_KEY),
          contactMasked: maskEmail(email),
        },
        create: {
          userId: actor.userId,
          attrType: 'EMPLOYER',
          valueRef: partner.id,
          level: 'OTP_VERIFIED',
          status: 'VERIFIED',
          source: 'WORK_EMAIL_OTP',
          verifiedAt: now,
          expiresAt,
          programId: program.id,
          contactHash: hash,
          contactEnc: encryptField(email, this.env.FIELD_ENCRYPTION_KEY),
          contactMasked: maskEmail(email),
        },
      });
    });
    const name = { en: partner.nameEn, ar: partner.nameAr };
    await this.record(
      actor.userId,
      'benefit.employer.verified',
      name,
      { programId: program.id, partnerId: partner.id, expiresAt: expiresAt.toISOString() },
      meta,
    );
    await this.notify(
      actor.userId,
      `benefit:employer:verified:${attr.id}:${now.getTime()}`,
      'EMPLOYER_VERIFIED',
      name,
    );
    return this.overview(actor.userId);
  }

  /** EL-12 / EM-21: the customer removes the employer; dependent offers lock at once, issued rights stay (EL-13). */
  async employerRemove(actor: Actor, meta: RequestMeta) {
    const rows = await this.prisma.eligibilityAttribute.findMany({
      where: { userId: actor.userId, attrType: 'EMPLOYER', status: { not: 'REVOKED' } },
    });
    if (!rows.length) return this.overview(actor.userId);
    await this.prisma.eligibilityAttribute.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      // data minimisation: the address is no longer needed once the link is gone (retention: VK-11)
      data: { status: 'REVOKED', contactEnc: null, contactHash: null },
    });
    const names = await this.partnerNames(rows.map((r) => r.valueRef));
    for (const r of rows) {
      const name = names.get(r.valueRef) ?? { en: '', ar: '' };
      await this.record(
        actor.userId,
        'benefit.employer.removed',
        name,
        { partnerId: r.valueRef },
        meta,
      );
      await this.notify(
        actor.userId,
        `benefit:employer:removed:${r.id}:${Date.now()}`,
        'EMPLOYER_REMOVED',
        name,
      );
    }
    return this.overview(actor.userId);
  }

  // ---------------------------------------------------------------- cards (added, never verified)
  async cardAdd(actor: Actor, programId: string, meta: RequestMeta) {
    const cfg = await this.cfg();
    const { program, issuer } = await this.activeCardProgram(programId);
    const mine = await this.prisma.eligibilityAttribute.findMany({
      where: {
        userId: actor.userId,
        attrType: 'CARD_PRODUCT',
        status: 'VERIFIED',
        programId: { not: null },
      },
    });
    if (mine.some((m) => m.programId === program.id)) return this.overview(actor.userId);
    if (mine.length >= cfg.maxCardEntries)
      throw new AppError(
        'BENEFIT_CARD_LIMIT',
        `You can add up to ${cfg.maxCardEntries} cards. Remove one first.`,
        422,
      );
    const now = new Date();
    const row = (attrType: 'CARD' | 'CARD_PRODUCT' | 'CARD_TIER', valueRef: string) => ({
      where: { userId_attrType_valueRef: { userId: actor.userId, attrType, valueRef } },
      update: {
        level: 'SELF_DECLARED' as const,
        status: 'VERIFIED' as const,
        source: 'CUSTOMER_SELECTION',
        verifiedAt: now,
        expiresAt: null,
        ...(attrType === 'CARD_PRODUCT' ? { programId: program.id } : {}),
      },
      create: {
        userId: actor.userId,
        attrType,
        valueRef,
        // BC-04: a customer's selection is never "verified": SELF_DECLARED with no verification source or evidence
        level: 'SELF_DECLARED' as const,
        status: 'VERIFIED' as const,
        source: 'CUSTOMER_SELECTION',
        verifiedAt: now,
        ...(attrType === 'CARD_PRODUCT' ? { programId: program.id } : {}),
      },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.eligibilityAttribute.upsert(row('CARD', issuer.id));
      await tx.eligibilityAttribute.upsert(row('CARD_PRODUCT', program.productCode));
      await tx.eligibilityAttribute.upsert(row('CARD_TIER', program.tier.toLowerCase()));
    });
    const name = { en: program.nameEn, ar: program.nameAr };
    await this.record(
      actor.userId,
      'benefit.card.added',
      name,
      { programId: program.id, issuerId: issuer.id },
      meta,
    );
    await this.notify(
      actor.userId,
      `benefit:card:added:${program.id}:${now.getTime()}`,
      'CARD_ADDED',
      name,
    );
    return this.overview(actor.userId);
  }

  /** BC-14 / EL-12: removing a card locks the offers that depended on it at once (other cards keep what they still cover). */
  async cardRemove(actor: Actor, programId: string, meta: RequestMeta) {
    const target = await this.prisma.eligibilityAttribute.findFirst({
      where: { userId: actor.userId, attrType: 'CARD_PRODUCT', programId, status: 'VERIFIED' },
    });
    if (!target) return this.overview(actor.userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.eligibilityAttribute.update({
        where: { id: target.id },
        data: { status: 'REVOKED' },
      });
      const remaining = await tx.eligibilityAttribute.findMany({
        where: {
          userId: actor.userId,
          attrType: 'CARD_PRODUCT',
          status: 'VERIFIED',
          programId: { not: null },
        },
      });
      const programs = await tx.partnerCardProgram.findMany({
        where: { id: { in: remaining.map((r) => r.programId!) } },
      });
      const keepIssuers = new Set(programs.map((p) => p.partnerOrganizationId));
      const keepTiers = new Set(programs.map((p) => p.tier.toLowerCase()));
      const derived = await tx.eligibilityAttribute.findMany({
        where: {
          userId: actor.userId,
          attrType: { in: ['CARD', 'CARD_TIER'] },
          status: 'VERIFIED',
          source: 'CUSTOMER_SELECTION',
        },
      });
      const revoke = derived.filter((d) =>
        d.attrType === 'CARD' ? !keepIssuers.has(d.valueRef) : !keepTiers.has(d.valueRef),
      );
      if (revoke.length)
        await tx.eligibilityAttribute.updateMany({
          where: { id: { in: revoke.map((r) => r.id) } },
          data: { status: 'REVOKED' },
        });
    });
    const program = await this.prisma.partnerCardProgram.findUnique({ where: { id: programId } });
    const name = { en: program?.nameEn ?? '', ar: program?.nameAr ?? '' };
    await this.record(actor.userId, 'benefit.card.removed', name, { programId }, meta);
    await this.notify(
      actor.userId,
      `benefit:card:removed:${programId}:${Date.now()}`,
      'CARD_REMOVED',
      name,
    );
    return this.overview(actor.userId);
  }

  // ---------------------------------------------------------------- views
  private async partnerNames(ids: string[]) {
    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, nameEn: true, nameAr: true },
    });
    return new Map(orgs.map((o) => [o.id, { en: o.nameEn, ar: o.nameAr }]));
  }

  private async employerView(userId: string, now: Date): Promise<BenefitEmployerView | null> {
    const cfg = await this.cfg();
    const row = await this.prisma.eligibilityAttribute.findFirst({
      where: { userId, attrType: 'EMPLOYER', status: { not: 'REVOKED' } },
      orderBy: { updatedAt: 'desc' },
    });
    if (!row) return null;
    const program = row.programId
      ? await this.prisma.partnerEmployerProgram.findUnique({ where: { id: row.programId } })
      : null;
    const names = await this.partnerNames([row.valueRef]);
    const expired = row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime();
    const renewFrom = row.expiresAt
      ? new Date(row.expiresAt.getTime() - cfg.reverifyNoticeDays * DAY)
      : null;
    const status =
      row.status === 'VERIFIED' && expired
        ? 'EXPIRED'
        : row.status === 'VERIFIED' && renewFrom && renewFrom.getTime() <= now.getTime()
          ? 'REVERIFICATION_DUE'
          : row.status;
    return {
      programId: program?.id ?? row.programId ?? row.valueRef,
      programName: program
        ? { en: program.nameEn, ar: program.nameAr }
        : (names.get(row.valueRef) ?? { en: '', ar: '' }),
      partner: { id: row.valueRef, name: names.get(row.valueRef) ?? { en: '', ar: '' } },
      maskedEmail: row.contactMasked,
      status,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      renewFrom: renewFrom?.toISOString() ?? null,
    };
  }

  private async cardViews(userId: string): Promise<BenefitCardView[]> {
    const rows = await this.prisma.eligibilityAttribute.findMany({
      where: { userId, attrType: 'CARD_PRODUCT', status: 'VERIFIED', programId: { not: null } },
      orderBy: { createdAt: 'asc' },
    });
    const programs = await this.prisma.partnerCardProgram.findMany({
      where: { id: { in: rows.map((r) => r.programId!) } },
    });
    const names = await this.partnerNames(programs.map((p) => p.partnerOrganizationId));
    const byId = new Map(programs.map((p) => [p.id, p]));
    return rows.flatMap((r) => {
      const p = byId.get(r.programId!);
      if (!p) return [];
      return [
        {
          programId: p.id,
          name: { en: p.nameEn, ar: p.nameAr },
          issuer: {
            id: p.partnerOrganizationId,
            name: names.get(p.partnerOrganizationId) ?? { en: p.issuerName, ar: p.issuerName },
          },
          scheme: p.scheme,
          tier: p.tier,
          addedAt: (r.verifiedAt ?? r.createdAt).toISOString(),
        },
      ];
    });
  }

  async overview(userId: string, city?: string, now = new Date()): Promise<BenefitsOverview> {
    const cfg = await this.cfg();
    const [employer, cards, unlocked, available, active, used, expired] = await Promise.all([
      this.employerView(userId, now),
      this.cardViews(userId),
      this.offers(userId, { tab: 'unlocked', city }),
      this.offers(userId, { tab: 'available', city }),
      this.usage(userId, 'active'),
      this.usage(userId, 'used'),
      this.usage(userId, 'expired'),
    ]);
    return {
      employer,
      cards,
      maxCards: cfg.maxCardEntries,
      counts: {
        unlocked: unlocked.length,
        available: available.length,
        active: active.length,
        used: used.length,
        expired: expired.length,
      },
    };
  }

  /**
   * Partner-benefit offers across Live Deals, Exclusive Deals and Vouchers, through the products' own discovery (same visibility,
   * same eligibility engine), with the partners behind each one. `unlocked` = usable now; `available` = could be unlocked.
   */
  async offers(userId: string, q: BenefitOffersQuery): Promise<BenefitOffer[]> {
    const benefit = q.tab === 'unlocked' ? 'unlocked' : 'locked';
    const base = { city: q.city, lat: q.lat, lng: q.lng, limit: 20, benefit } as const;
    const [live, hot, vouchers] = await Promise.all([
      this.live.list({ ...base }, userId),
      this.hot.list({ ...base }, userId),
      this.vouchers.list({ ...base }, userId),
    ]);
    const attribution = await this.attribution([
      ...live.items.map((c) => ({ product: 'LIVE' as const, id: c.id })),
      ...hot.items.map((c) => ({ product: 'HOT' as const, id: c.id })),
      ...vouchers.items.map((c) => ({ product: 'VOUCHER' as const, id: c.id })),
    ]);
    return [
      ...live.items.map((card) => ({
        product: 'LIVE' as const,
        partners: attribution.get(card.id) ?? [],
        card,
      })),
      ...hot.items.map((card) => ({
        product: 'HOT' as const,
        partners: attribution.get(card.id) ?? [],
        card,
      })),
      ...vouchers.items.map((card) => ({
        product: 'VOUCHER' as const,
        partners: attribution.get(card.id) ?? [],
        card,
      })),
    ];
  }

  /** Which partners an offer's rule names (employers, issuers, schemes; card products / tiers resolve to their issuer). */
  private async attribution(items: Array<{ product: 'LIVE' | 'HOT' | 'VOUCHER'; id: string }>) {
    const ids = (p: string) => items.filter((i) => i.product === p).map((i) => i.id);
    const select = {
      id: true,
      eligibilityKind: true,
      ruleSet: {
        select: { expression: true, conditions: { select: { attrType: true, valueRef: true } } },
      },
    } as const;
    const rows: Array<{
      id: string;
      eligibilityKind: EligibilityKind;
      ruleSet: {
        expression: unknown;
        conditions: Array<{ attrType: string; valueRef: string }>;
      } | null;
    }> = [
      ...(await this.prisma.liveDeal.findMany({ where: { id: { in: ids('LIVE') } }, select })),
      ...(await this.prisma.hotDeal.findMany({ where: { id: { in: ids('HOT') } }, select })),
      ...(await this.prisma.voucher.findMany({ where: { id: { in: ids('VOUCHER') } }, select })),
    ];
    return this.partnersOfRules(rows);
  }

  private async partnersOfRules(
    rows: Array<{
      id: string;
      eligibilityKind: EligibilityKind;
      ruleSet: {
        expression: unknown;
        conditions: Array<{ attrType: string; valueRef: string }>;
      } | null;
    }>,
  ) {
    const refs = new Map(
      rows.map((r) => [
        r.id,
        partnerRefsOf(r.eligibilityKind, r.ruleSet?.conditions ?? [], r.ruleSet?.expression),
      ]),
    );
    const all = [...refs.values()];
    const products = all.flatMap((r) => r.productCodes);
    const tiers = all.flatMap((r) => r.tiers);
    const programs =
      products.length || tiers.length
        ? await this.prisma.partnerCardProgram.findMany({
            where: {
              OR: [{ productCode: { in: products } }, { tier: { in: tiers } }],
              status: 'ACTIVE',
            },
            select: { productCode: true, tier: true, partnerOrganizationId: true },
          })
        : [];
    const names = await this.partnerNames([
      ...all.flatMap((r) => r.organizationIds),
      ...programs.map((p) => p.partnerOrganizationId),
    ]);
    const out = new Map<string, Array<{ id: string; name: Bi }>>();
    for (const [id, r] of refs) {
      const orgIds = new Set([
        ...r.organizationIds,
        ...programs
          .filter(
            (p) => r.productCodes.includes(p.productCode) || r.tiers.includes(p.tier.toLowerCase()),
          )
          .map((p) => p.partnerOrganizationId),
      ]);
      out.set(
        id,
        [...orgIds].filter((o) => names.has(o)).map((o) => ({ id: o, name: names.get(o)! })),
      );
    }
    return out;
  }

  /** The customer's own reservations and vouchers that came from partner-benefit offers, with their redemption status. */
  async usage(userId: string, tab: 'active' | 'used' | 'expired'): Promise<BenefitUsageItem[]> {
    const now = new Date();
    const resStatus =
      tab === 'active'
        ? (['HELD'] as const)
        : tab === 'used'
          ? (['REDEEMED'] as const)
          : (['EXPIRED', 'CANCELLED'] as const);
    const vStatus =
      tab === 'active'
        ? (['ACTIVE'] as const)
        : tab === 'used'
          ? (['REDEEMED'] as const)
          : (['EXPIRED', 'REFUNDED', 'VOIDED'] as const);
    const ruleSelect = {
      id: true,
      eligibilityKind: true,
      titleEn: true,
      titleAr: true,
      organization: { select: { nameEn: true, nameAr: true } },
      ruleSet: {
        select: { expression: true, conditions: { select: { attrType: true, valueRef: true } } },
      },
    } as const;
    const [reservations, instances] = await Promise.all([
      this.prisma.reservation.findMany({
        where: {
          userId,
          status: { in: [...resStatus] },
          deal: { eligibilityKind: { notIn: ['PUBLIC', 'GEOGRAPHY'] } },
          ...(tab === 'active' ? { expiresAt: { gt: now } } : {}),
        },
        include: { deal: { select: ruleSelect } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.voucherInstance.findMany({
        where: {
          ownerUserId: userId,
          status: { in: [...vStatus] },
          voucher: { eligibilityKind: { notIn: ['PUBLIC', 'GEOGRAPHY'] } },
        },
        include: { voucher: { select: ruleSelect } },
        orderBy: { issuedAt: 'desc' },
        take: 50,
      }),
    ]);
    const isBenefit = (d: {
      eligibilityKind: EligibilityKind;
      ruleSet: {
        expression: unknown;
        conditions: Array<{ attrType: string; valueRef: string }>;
      } | null;
    }) =>
      isPartnerBenefitRule(d.eligibilityKind, d.ruleSet?.conditions ?? [], d.ruleSet?.expression);
    const res = reservations.filter((r) => isBenefit(r.deal));
    const vou = instances.filter((v) => isBenefit(v.voucher));
    const partners = await this.partnersOfRules([
      ...res.map((r) => r.deal),
      ...vou.map((v) => v.voucher),
    ]);
    const items: BenefitUsageItem[] = [
      ...res.map((r) => ({
        kind: 'RESERVATION' as const,
        id: r.id,
        reference: r.reference,
        title: { en: r.deal.titleEn, ar: r.deal.titleAr },
        merchantName: { en: r.deal.organization.nameEn, ar: r.deal.organization.nameAr },
        partners: partners.get(r.deal.id) ?? [],
        status: r.status,
        validUntil: r.expiresAt.toISOString(),
        redeemedAt: r.redeemedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      ...vou.map((v) => ({
        kind: 'VOUCHER' as const,
        id: v.id,
        reference: v.reference,
        title: { en: v.voucher.titleEn, ar: v.voucher.titleAr },
        merchantName: { en: v.voucher.organization.nameEn, ar: v.voucher.organization.nameAr },
        partners: partners.get(v.voucher.id) ?? [],
        status: v.status,
        validUntil: v.expiresAt.toISOString(),
        redeemedAt: v.redeemedAt?.toISOString() ?? null,
        createdAt: v.issuedAt.toISOString(),
      })),
    ];
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Benefit history: the customer's own audited benefit events (codes, confirmations, renewals, expiries, cards). */
  async history(userId: string): Promise<BenefitHistoryItem[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        entityType: AUDIT_ENTITY,
        entityId: userId,
        action: { in: Object.keys(EVENT_OF_ACTION) },
      },
      orderBy: { occurredAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => {
      const s = (r.newState ?? {}) as { name?: Bi };
      return {
        event: EVENT_OF_ACTION[r.action]!,
        name: s.name ?? { en: '', ar: '' },
        at: r.occurredAt.toISOString(),
      };
    });
  }

  // ---------------------------------------------------------------- job: expiry and renewal reminders (EM-20)
  async sweep(now = new Date()) {
    const cfg = await this.cfg();
    const expired = await this.prisma.eligibilityAttribute.findMany({
      where: { attrType: 'EMPLOYER', status: 'VERIFIED', expiresAt: { lte: now } },
      take: 500,
    });
    for (const a of expired) {
      const done = await this.prisma.eligibilityAttribute.updateMany({
        where: { id: a.id, status: 'VERIFIED' },
        data: { status: 'EXPIRED' },
      });
      if (!done.count) continue;
      const name = (await this.partnerNames([a.valueRef])).get(a.valueRef) ?? { en: '', ar: '' };
      await this.record(
        a.userId,
        'benefit.employer.expired',
        name,
        { partnerId: a.valueRef },
        undefined,
        true,
      );
      await this.notify(
        a.userId,
        `benefit:employer:expired:${a.id}:${a.expiresAt!.getTime()}`,
        'EMPLOYER_EXPIRED',
        name,
      );
    }
    const due = await this.prisma.eligibilityAttribute.findMany({
      where: {
        attrType: 'EMPLOYER',
        status: 'VERIFIED',
        expiresAt: { gt: now, lte: new Date(now.getTime() + cfg.reverifyNoticeDays * DAY) },
      },
      take: 500,
    });
    for (const a of due) {
      const name = (await this.partnerNames([a.valueRef])).get(a.valueRef) ?? { en: '', ar: '' };
      // one reminder per verification period (the dedupe key carries the expiry)
      const sent = await this.notify(
        a.userId,
        `benefit:employer:renew:${a.id}:${a.expiresAt!.getTime()}`,
        'EMPLOYER_RENEWAL_DUE',
        name,
      );
      if (sent)
        await this.record(
          a.userId,
          'benefit.employer.renewal_due',
          name,
          { partnerId: a.valueRef },
          undefined,
          true,
        );
    }
    return { expired: expired.length, reminded: due.length };
  }
}
