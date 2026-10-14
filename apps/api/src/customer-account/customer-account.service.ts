import { Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { CONFIG_KEYS, type ApiEnv } from '@dealdash/config';
import {
  CUSTOMER_NOTIFICATION_CATEGORIES,
  type CustomerNotificationCategory,
} from '@dealdash/types';
import {
  CONSENT_KINDS,
  ONBOARDING_STEPS,
  REQUIRED_ONBOARDING_STEPS,
  type ConsentKind,
  type CustomerConsentsUpdate,
  type CustomerNotificationSettings,
  type CustomerNotificationSettingsUpdate,
  type CustomerProfile,
  type CustomerProfileUpdate,
  type OnboardingStep,
} from '@dealdash/validation';
import { AuditService } from '../audit/audit.service';
import { decryptField, encryptField, safeEqual, sha256 } from '../common/crypto';
import { APP_ENV } from '../common/env';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_PROVIDER, type SmsProvider } from '../providers/interfaces';
import { SystemConfigService } from '../system-config/system-config.service';

/** customer.onboarding configuration (values are configuration, never policy in code). */
export interface OnboardingConfig {
  minimumAge: number;
  requireCompleteForActions: boolean;
  termsVersion: string;
  privacyVersion: string;
  termsUrl: string | null;
  privacyUrl: string | null;
}
const DEFAULTS: OnboardingConfig = {
  minimumAge: 18,
  requireCompleteForActions: true,
  termsVersion: '2026-10',
  privacyVersion: '2026-10',
  termsUrl: null,
  privacyUrl: null,
};

const OTP_PURPOSE = 'MOBILE_CHANGE';
const LANGUAGES = ['en', 'ar', 'ur'] as const;
type Language = (typeof LANGUAGES)[number];

/** Whole years between a YYYY-MM-DD birth date and today (UTC calendar date). */
export function ageOn(dob: string, today: Date): number {
  const [y, m, d] = dob.split('-').map(Number) as [number, number, number];
  let age = today.getUTCFullYear() - y;
  const md = (today.getUTCMonth() + 1) * 100 + today.getUTCDate();
  if (md < m * 100 + d) age--;
  return age;
}

/** A real calendar date in the past (rejects 2001-02-30 and future dates). */
export function validBirthDate(dob: string, today: Date) {
  const [y, m, d] = dob.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d &&
    y >= 1900 &&
    date.getTime() < today.getTime()
  );
}

export const maskMobile = (mobile: string | null) =>
  mobile ? `${mobile.slice(0, 4)} •••• ${mobile.slice(-4)}` : null;

/**
 * Customer account (Blueprint §5, CS-02 / CS-05 / CS-06). One profile per customer, keyed by the session (never a client id).
 *  - date of birth is field-encrypted and checked against the configured minimum age (AU-31); under it, the account is blocked and
 *    nothing but the blocked state is kept (VK-11); after a passed check it is read-only (support corrects it)
 *  - consents are append-only rows (who, what, version, when, where); Terms / Privacy are required and versioned, marketing is
 *    separate and optional per channel (NT-40, VK-23)
 *  - "ready" = profile complete + current Terms / Privacy: reserving, buying, earning and redeeming need it (configurable)
 */
@Injectable()
export class CustomerAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: SystemConfigService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(APP_ENV) private readonly env: ApiEnv,
  ) {}

  async cfg(): Promise<OnboardingConfig> {
    const c =
      (await this.config.get<Partial<OnboardingConfig>>(CONFIG_KEYS.CUSTOMER_ONBOARDING)) ?? {};
    return { ...DEFAULTS, ...c };
  }

  private async customer(userId: string) {
    return this.prisma.customer.upsert({ where: { userId }, update: {}, create: { userId } });
  }

  private async latestConsents(userId: string) {
    const rows = await this.prisma.customerConsent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const latest = new Map<ConsentKind, (typeof rows)[number]>();
    for (const r of rows)
      if (!latest.has(r.kind as ConsentKind)) latest.set(r.kind as ConsentKind, r);
    return latest;
  }

  private consentsCurrent(
    latest: Awaited<ReturnType<CustomerAccountService['latestConsents']>>,
    cfg: OnboardingConfig,
  ) {
    const terms = latest.get('TERMS');
    const privacy = latest.get('PRIVACY');
    return (
      !!terms?.granted &&
      terms.version === cfg.termsVersion &&
      !!privacy?.granted &&
      privacy.version === cfg.privacyVersion
    );
  }

  /** The required steps still missing (wizard order) and whether the account may transact. */
  private status(
    c: Awaited<ReturnType<CustomerAccountService['customer']>>,
    latest: Awaited<ReturnType<CustomerAccountService['latestConsents']>>,
    cfg: OnboardingConfig,
  ) {
    const done: Record<OnboardingStep, boolean> = {
      DETAILS: !!c.firstName && !!c.email,
      BIRTH_DATE: !!c.ageVerifiedAt,
      GENDER: true,
      CITY: !!c.city,
      INTERESTS: true,
      CONSENTS: this.consentsCurrent(latest, cfg),
    };
    const missing = ONBOARDING_STEPS.filter(
      (s) => REQUIRED_ONBOARDING_STEPS.includes(s) && !done[s],
    );
    const everAccepted = !!latest.get('TERMS')?.granted && !!latest.get('PRIVACY')?.granted;
    return {
      missing,
      ready: c.onboardingState === 'COMPLETE' && done.CONSENTS,
      consentsOutdated: everAccepted && !done.CONSENTS,
    };
  }

  async profile(userId: string): Promise<CustomerProfile> {
    const cfg = await this.cfg();
    const [c, user, latest] = await Promise.all([
      this.customer(userId),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.latestConsents(userId),
    ]);
    const s = this.status(c, latest, cfg);
    const blocked = c.onboardingState === 'AGE_BLOCKED';
    return {
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      mobileMasked: maskMobile(user.mobile),
      dateOfBirth: c.dobEnc ? decryptField(c.dobEnc, this.env.FIELD_ENCRYPTION_KEY) : null,
      ageVerified: !!c.ageVerifiedAt,
      gender: (c.gender as CustomerProfile['gender']) ?? null,
      city: c.city,
      interests: c.interests,
      language: (LANGUAGES as readonly string[]).includes(user.locale)
        ? (user.locale as Language)
        : 'en',
      onboarding: {
        state: c.onboardingState as CustomerProfile['onboarding']['state'],
        ready: !blocked && s.ready,
        missing: blocked ? [] : s.missing,
        nextStep: blocked ? null : (s.missing[0] ?? null),
        consentsOutdated: !blocked && s.consentsOutdated,
        minimumAge: cfg.minimumAge,
      },
      consents: CONSENT_KINDS.flatMap((kind) => {
        const r = latest.get(kind);
        return r
          ? [{ kind, granted: r.granted, version: r.version, at: r.createdAt.toISOString() }]
          : [];
      }),
      documents: {
        termsVersion: cfg.termsVersion,
        privacyVersion: cfg.privacyVersion,
        termsUrl: cfg.termsUrl,
        privacyUrl: cfg.privacyUrl,
      },
    };
  }

  private assertNotBlocked(state: string) {
    if (state === 'AGE_BLOCKED')
      throw new AppError(
        'AGE_RESTRICTED',
        'DealDash is for people over the minimum age. This account cannot be used.',
        403,
      );
  }

  async updateProfile(
    actor: Actor,
    input: CustomerProfileUpdate,
    meta: RequestMeta,
  ): Promise<CustomerProfile> {
    const cfg = await this.cfg();
    const c = await this.customer(actor.userId);
    this.assertNotBlocked(c.onboardingState);
    const now = new Date();
    const data: Record<string, unknown> = {};
    if (input.firstName !== undefined) data.firstName = input.firstName;
    if (input.lastName !== undefined) data.lastName = input.lastName || null;
    if (input.email !== undefined) data.email = input.email;
    if (input.gender !== undefined) data.gender = input.gender;
    if (input.city !== undefined) {
      const cities = (await this.config.get<string[]>(CONFIG_KEYS.ENABLED_CITIES)) ?? [];
      const match = cities.find((x) => x.toLowerCase() === input.city!.toLowerCase());
      if (!match) throw AppError.validation('Choose one of the available cities', 'city');
      data.city = match;
    }
    if (input.interests !== undefined) {
      const known = await this.prisma.category.findMany({
        where: { code: { in: input.interests }, active: true },
        select: { code: true },
      });
      data.interests = [...new Set(known.map((k) => k.code))];
    }

    if (input.dateOfBirth !== undefined) {
      if (c.ageVerifiedAt)
        throw new AppError(
          'PROFILE_DOB_LOCKED',
          'Your date of birth is already confirmed. Contact support to correct it.',
          409,
          'dateOfBirth',
        );
      if (!validBirthDate(input.dateOfBirth, now))
        throw AppError.validation('Enter a valid date of birth', 'dateOfBirth');
      if (ageOn(input.dateOfBirth, now) < cfg.minimumAge) {
        // AU-31: blocked; nothing about the person is kept beyond the blocked state (no birth date, no details) (VK-11)
        await this.prisma.$transaction([
          this.prisma.customer.update({
            where: { userId: actor.userId },
            data: {
              onboardingState: 'AGE_BLOCKED',
              firstName: null,
              lastName: null,
              email: null,
              dobEnc: null,
              gender: null,
              city: null,
              interests: [],
            },
          }),
          this.prisma.user.update({
            where: { id: actor.userId },
            data: { displayName: 'Customer' },
          }),
        ]);
        await this.audit.record({
          action: 'customer.onboarding.age_blocked',
          entityType: 'Customer',
          entityId: actor.userId,
          actor,
          reason: `under the minimum age (${cfg.minimumAge})`,
          meta,
        });
        return this.profile(actor.userId);
      }
      data.dobEnc = encryptField(input.dateOfBirth, this.env.FIELD_ENCRYPTION_KEY);
      data.ageVerifiedAt = now;
    }

    if (Object.keys(data).length && c.onboardingState === 'PHONE_VERIFIED')
      data.onboardingState = 'PROFILE_IN_PROGRESS';
    await this.prisma.customer.update({ where: { userId: actor.userId }, data });

    const userData: Record<string, unknown> = {};
    const first = (data.firstName as string | undefined) ?? c.firstName;
    const last = data.lastName !== undefined ? (data.lastName as string | null) : c.lastName;
    if (first) userData.displayName = [first, last].filter(Boolean).join(' ');
    if (input.language) userData.locale = input.language;
    if (Object.keys(userData).length)
      await this.prisma.user.update({ where: { id: actor.userId }, data: userData });

    await this.audit.record({
      action: 'customer.profile.updated',
      entityType: 'Customer',
      entityId: actor.userId,
      actor,
      // which fields changed, never their values (PII)
      newState: { fields: [...Object.keys(data), ...Object.keys(userData)].sort() },
      meta,
    });
    await this.maybeComplete(actor.userId);
    return this.profile(actor.userId);
  }

  async updateConsents(
    actor: Actor,
    input: CustomerConsentsUpdate,
    meta: RequestMeta,
  ): Promise<CustomerProfile> {
    const cfg = await this.cfg();
    const c = await this.customer(actor.userId);
    this.assertNotBlocked(c.onboardingState);
    const latest = await this.latestConsents(actor.userId);
    const version = (kind: ConsentKind) =>
      kind === 'TERMS' ? cfg.termsVersion : kind === 'PRIVACY' ? cfg.privacyVersion : null;
    // only real changes are written (re-accepting the same version twice adds nothing)
    const rows = input.items.filter((i) => {
      const cur = latest.get(i.kind);
      return !cur || cur.granted !== i.granted || cur.version !== version(i.kind);
    });
    if (rows.some((r) => (r.kind === 'TERMS' || r.kind === 'PRIVACY') && !r.granted))
      throw AppError.validation(
        'Terms and Privacy cannot be withdrawn here. To stop using DealDash, request account deletion.',
        'items',
      );
    if (rows.length) {
      await this.prisma.customerConsent.createMany({
        data: rows.map((r) => ({
          userId: actor.userId,
          kind: r.kind,
          granted: r.granted,
          version: version(r.kind),
          source: input.source,
        })),
      });
      await this.audit.record({
        action: 'customer.consent.changed',
        entityType: 'Customer',
        entityId: actor.userId,
        actor,
        newState: {
          changes: rows.map((r) => ({
            kind: r.kind,
            granted: r.granted,
            version: version(r.kind),
          })),
          source: input.source,
        },
        meta,
      });
    }
    await this.maybeComplete(actor.userId);
    return this.profile(actor.userId);
  }

  /** The first time every required step is done: COMPLETE, and the welcome notification (NT-02). */
  private async maybeComplete(userId: string) {
    const cfg = await this.cfg();
    const c = await this.customer(userId);
    if (c.onboardingState === 'COMPLETE' || c.onboardingState === 'AGE_BLOCKED') return;
    const s = this.status(c, await this.latestConsents(userId), cfg);
    if (s.missing.length) return;
    const done = await this.prisma.customer.updateMany({
      where: { userId, onboardingState: { not: 'COMPLETE' } },
      data: { onboardingState: 'COMPLETE', onboardedAt: c.onboardedAt ?? new Date() },
    });
    if (!done.count) return;
    await this.prisma.notification.createMany({
      data: [
        {
          userId,
          type: 'ACCOUNT_WELCOME',
          dedupeKey: 'account:welcome',
          data: { firstName: c.firstName ?? '' },
        },
      ],
      skipDuplicates: true,
    });
    await this.audit.record({
      action: 'customer.onboarding.completed',
      entityType: 'Customer',
      entityId: userId,
      actorUserId: userId,
    });
  }

  /** Guard: reserving, buying, watching to earn and redeeming need a ready account (when configured). */
  async assertReady(userId: string) {
    const cfg = await this.cfg();
    const c = await this.prisma.customer.findUnique({ where: { userId } });
    if (c) this.assertNotBlocked(c.onboardingState);
    if (!cfg.requireCompleteForActions) return;
    const customer = c ?? (await this.customer(userId));
    const latest = await this.latestConsents(userId);
    const s = this.status(customer, latest, cfg);
    if (s.ready) return;
    if (customer.onboardingState === 'COMPLETE' && s.consentsOutdated)
      throw new AppError(
        'CONSENT_REQUIRED',
        'Our Terms or Privacy Policy changed. Please review and accept them to continue.',
        403,
      );
    throw new AppError('ONBOARDING_REQUIRED', 'Finish setting up your profile to continue.', 403);
  }

  /** Guard: everything a blocked (under-age) account must not do, even without a completed profile. */
  async assertAllowed(userId: string) {
    const c = await this.prisma.customer.findUnique({
      where: { userId },
      select: { onboardingState: true },
    });
    if (c) this.assertNotBlocked(c.onboardingState);
  }

  // ---------------------------------------------------------------- notifications (CS-06)
  async notificationSettings(userId: string): Promise<CustomerNotificationSettings> {
    const [prefs, latest] = await Promise.all([
      this.prisma.notificationPreference.findMany({
        where: { userId, category: { startsWith: 'CUSTOMER_' } },
      }),
      this.latestConsents(userId),
    ]);
    const byCat = new Map(prefs.map((p) => [p.category.replace(/^CUSTOMER_/, ''), p]));
    return {
      categories: (
        Object.keys(CUSTOMER_NOTIFICATION_CATEGORIES) as CustomerNotificationCategory[]
      ).map((category) => {
        const required = CUSTOMER_NOTIFICATION_CATEGORIES[category].required;
        const p = byCat.get(category);
        return {
          category,
          required,
          push: required || !p || (!p.muted && p.channels.includes('PUSH')),
        };
      }),
      // push is allowed until the customer withdraws the notifications consent
      pushAllowed: latest.get('NOTIFICATIONS')?.granted ?? true,
      marketing: {
        push: latest.get('MARKETING_PUSH')?.granted ?? false,
        email: latest.get('MARKETING_EMAIL')?.granted ?? false,
      },
    };
  }

  async updateNotificationSettings(
    actor: Actor,
    input: CustomerNotificationSettingsUpdate,
    meta: RequestMeta,
  ) {
    for (const c of input.categories) {
      if (CUSTOMER_NOTIFICATION_CATEGORIES[c.category].required) continue;
      const channels = c.push ? ['IN_APP', 'PUSH'] : ['IN_APP'];
      await this.prisma.notificationPreference.upsert({
        where: { userId_category: { userId: actor.userId, category: `CUSTOMER_${c.category}` } },
        update: { channels, muted: false },
        create: {
          userId: actor.userId,
          category: `CUSTOMER_${c.category}`,
          channels,
          muted: false,
        },
      });
    }
    if (input.categories.length)
      await this.audit.record({
        action: 'customer.notifications.updated',
        entityType: 'Customer',
        entityId: actor.userId,
        actor,
        newState: { categories: input.categories },
        meta,
      });
    return this.notificationSettings(actor.userId);
  }

  // ---------------------------------------------------------------- mobile number change (by code to the new number)
  private otpTarget(userId: string, mobile: string) {
    return `mobile-change:${userId}:${mobile}`;
  }
  private otpHash(target: string, code: string) {
    return sha256(`${this.env.SESSION_SECRET}:${target}:${code}`);
  }

  async mobileStart(actor: Actor, mobile: string, meta: RequestMeta) {
    const c = await this.customer(actor.userId);
    this.assertNotBlocked(c.onboardingState);
    const ttl = await this.config.getNumber(CONFIG_KEYS.OTP_TTL_SECONDS, 300);
    const cooldown = await this.config.getNumber(CONFIG_KEYS.OTP_RESEND_COOLDOWN_SECONDS, 30);
    const perHour = await this.config.getNumber(CONFIG_KEYS.OTP_MAX_REQUESTS_PER_HOUR, 5);
    const maxAttempts = await this.config.getNumber(CONFIG_KEYS.OTP_MAX_ATTEMPTS, 5);
    const recent = await this.prisma.otpChallenge.findMany({
      where: {
        purpose: OTP_PURPOSE,
        target: { startsWith: `mobile-change:${actor.userId}:` },
        createdAt: { gte: new Date(Date.now() - 3_600_000) },
      },
      orderBy: { createdAt: 'desc' },
      take: perHour + 1,
    });
    if (recent.length >= perHour)
      throw AppError.rateLimited('OTP_RATE_LIMITED', 'Too many codes requested. Try again later.');
    if (recent[0] && Date.now() - recent[0].createdAt.getTime() < cooldown * 1000)
      throw AppError.rateLimited(
        'OTP_RATE_LIMITED',
        `Please wait ${cooldown} seconds before requesting another code.`,
      );
    const target = this.otpTarget(actor.userId, mobile);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.otpChallenge.create({
      data: {
        purpose: OTP_PURPOSE,
        audience: 'customer',
        target,
        codeHash: this.otpHash(target, code),
        maxAttempts,
        expiresAt: new Date(Date.now() + ttl * 1000),
        ip: meta.ip,
      },
    });
    const minutes = Math.round(ttl / 60);
    await this.sms.send({
      to: mobile,
      templateKey: 'account.mobile_change',
      body:
        meta.locale === 'ar'
          ? `رمز ديل داش لتغيير رقم جوالك هو ${code}. ينتهي خلال ${minutes} دقائق. لا تشاركه مع أحد.`
          : `Your DealDash code to change your mobile number is ${code}. It expires in ${minutes} minutes. Do not share it.`,
      locale: meta.locale,
    });
    return { sent: true, expiresInSeconds: ttl, resendAfterSeconds: cooldown };
  }

  async mobileVerify(actor: Actor, mobile: string, code: string, meta: RequestMeta) {
    const target = this.otpTarget(actor.userId, mobile);
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { purpose: OTP_PURPOSE, target, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw new AppError('OTP_INVALID', 'The code is not valid', 400, 'code');
    if (challenge.expiresAt <= new Date())
      throw new AppError('OTP_EXPIRED', 'The code has expired. Request a new one.', 400, 'code');
    if (challenge.attempts >= challenge.maxAttempts)
      throw AppError.rateLimited('OTP_LOCKED', 'Too many attempts. Request a new code.');
    if (!safeEqual(this.otpHash(target, code), challenge.codeHash)) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw new AppError('OTP_INVALID', 'The code is not valid', 400, 'code');
    }
    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });
    // the customer proved they hold the number, so saying it is taken reveals nothing new
    const other = await this.prisma.user.findUnique({ where: { mobile }, select: { id: true } });
    if (other && other.id !== actor.userId)
      throw AppError.conflict(
        'MOBILE_IN_USE',
        'This number is already linked to another DealDash account',
      );
    await this.prisma.user.update({
      where: { id: actor.userId },
      data: { mobile, mobileVerifiedAt: new Date() },
    });
    await this.audit.record({
      action: 'customer.mobile.changed',
      entityType: 'User',
      entityId: actor.userId,
      actor,
      newState: { mobile: maskMobile(mobile) },
      meta,
    });
    return this.profile(actor.userId);
  }
}
