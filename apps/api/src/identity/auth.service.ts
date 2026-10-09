import { Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { CONFIG_KEYS, type ApiEnv } from '@dealdash/config';
import type { Audience, MeView } from '@dealdash/types';
import { AuditService } from '../audit/audit.service';
import { decryptField, encryptField, safeEqual, sha256, verifyPassword } from '../common/crypto';
import { APP_ENV } from '../common/env';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../common/totp';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_PROVIDER, type SmsProvider } from '../providers/interfaces';
import { SystemConfigService } from '../system-config/system-config.service';
import { ActorService } from './actor.service';
import { SessionService } from './session.service';

const OTP_MESSAGES = {
  en: (code: string, minutes: number) =>
    `Your DealDash code is ${code}. It expires in ${minutes} minutes. Do not share it.`,
  ar: (code: string, minutes: number) =>
    `رمز ديل داش الخاص بك هو ${code}. ينتهي خلال ${minutes} دقائق. لا تشاركه مع أحد.`,
};

export interface AuthResult {
  token: string;
  sessionId: string;
  mfaRequired: boolean;
  actor: Actor;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly actors: ActorService,
    private readonly audit: AuditService,
    private readonly config: SystemConfigService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(APP_ENV) private readonly env: ApiEnv,
  ) {}

  private otpHash(target: string, code: string) {
    return sha256(`${this.env.SESSION_SECRET}:${target}:${code}`);
  }

  // ------------------------------------------------------------------ mobile OTP (customer, staff)
  async requestOtp(mobile: string, audience: 'customer' | 'staff', meta: RequestMeta) {
    const ttl = await this.config.getNumber(CONFIG_KEYS.OTP_TTL_SECONDS, 300);
    const cooldown = await this.config.getNumber(CONFIG_KEYS.OTP_RESEND_COOLDOWN_SECONDS, 30);
    const perHour = await this.config.getNumber(CONFIG_KEYS.OTP_MAX_REQUESTS_PER_HOUR, 5);
    const maxAttempts = await this.config.getNumber(CONFIG_KEYS.OTP_MAX_ATTEMPTS, 5);

    const since = new Date(Date.now() - 3600_000);
    const recent = await this.prisma.otpChallenge.findMany({
      where: { target: mobile, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: perHour + 1,
    });
    if (recent.length >= perHour)
      throw AppError.rateLimited('OTP_RATE_LIMITED', 'Too many codes requested. Try again later.');
    const latest = recent[0];
    if (latest && Date.now() - latest.createdAt.getTime() < cooldown * 1000) {
      throw AppError.rateLimited(
        'OTP_RATE_LIMITED',
        `Please wait ${cooldown} seconds before requesting another code.`,
      );
    }

    // Staff must already exist; unknown numbers get the same response (no account enumeration) but no SMS.
    let deliver = true;
    if (audience === 'staff') {
      const user = await this.prisma.user.findUnique({ where: { mobile } });
      deliver =
        !!user && user.status === 'ACTIVE' && (await this.hasRole(user.id, 'MERCHANT_STAFF'));
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.otpChallenge.create({
      data: {
        purpose: 'LOGIN',
        audience,
        target: mobile,
        codeHash: this.otpHash(mobile, code),
        maxAttempts,
        expiresAt: new Date(Date.now() + ttl * 1000),
        ip: meta.ip,
      },
    });
    if (deliver) {
      await this.sms.send({
        to: mobile,
        templateKey: 'auth.otp',
        body: OTP_MESSAGES[meta.locale](code, Math.round(ttl / 60)),
        locale: meta.locale,
      });
    }
    await this.audit.record({
      action: 'auth.otp.requested',
      entityType: 'OtpChallenge',
      entityId: mobile.slice(-4),
      meta,
    });
    return { sent: true, expiresInSeconds: ttl, resendAfterSeconds: cooldown };
  }

  async verifyOtp(
    mobile: string,
    code: string,
    audience: 'customer' | 'staff',
    meta: RequestMeta,
  ): Promise<AuthResult> {
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { target: mobile, audience, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw new AppError('OTP_INVALID', 'The code is not valid', 400);
    if (challenge.expiresAt <= new Date())
      throw new AppError('OTP_EXPIRED', 'The code has expired. Request a new one.', 400);
    if (challenge.attempts >= challenge.maxAttempts)
      throw AppError.rateLimited('OTP_LOCKED', 'Too many attempts. Request a new code.');

    const ok = safeEqual(this.otpHash(mobile, code), challenge.codeHash);
    if (!ok) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      await this.audit.record({
        action: 'auth.login.failed',
        entityType: 'User',
        entityId: mobile.slice(-4),
        reason: 'otp_mismatch',
        meta,
      });
      throw new AppError('OTP_INVALID', 'The code is not valid', 400);
    }
    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });

    let user = await this.prisma.user.findUnique({ where: { mobile } });
    if (audience === 'customer') {
      if (user && user.userType !== 'CUSTOMER')
        throw AppError.authInvalid('This number belongs to a different account type');
      user ??= await this.prisma.user.create({
        data: {
          userType: 'CUSTOMER',
          mobile,
          displayName: 'Customer',
          customer: { create: {} },
        },
      });
    } else {
      if (!user || user.status !== 'ACTIVE' || !(await this.hasRole(user.id, 'MERCHANT_STAFF'))) {
        throw new AppError('OTP_INVALID', 'The code is not valid', 400);
      }
    }
    if (user.status !== 'ACTIVE') throw AppError.authInvalid('This account is not active');
    return this.finishLogin(user.id, audience, meta, { mfaVerified: true });
  }

  // ------------------------------------------------------------------ email + password (merchant, partner, admin)
  async passwordLogin(
    email: string,
    password: string,
    audience: 'merchant' | 'partner' | 'admin',
    meta: RequestMeta,
  ): Promise<AuthResult> {
    const maxFailed = await this.config.getNumber(CONFIG_KEYS.PASSWORD_MAX_FAILED_ATTEMPTS, 5);
    const lockMinutes = await this.config.getNumber(CONFIG_KEYS.PASSWORD_LOCK_MINUTES, 15);

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      throw AppError.rateLimited('RATE_LIMITED', 'Too many failed attempts. Try again later.');
    }

    const passwordOk = await verifyPassword(password, user?.passwordHash);
    const expectedType = {
      merchant: 'MERCHANT_USER',
      partner: 'PARTNER_USER',
      admin: 'ADMIN_USER',
    }[audience];
    const eligible =
      !!user && passwordOk && user.status === 'ACTIVE' && user.userType === expectedType;

    if (!eligible) {
      if (user) {
        const failed = user.failedLoginCount + 1;
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: failed,
            lockedUntil: failed >= maxFailed ? new Date(Date.now() + lockMinutes * 60_000) : null,
          },
        });
      }
      await this.audit.record({
        action: 'auth.login.failed',
        entityType: 'User',
        entityId: user?.id ?? null,
        reason: 'password',
        meta,
      });
      throw AppError.authInvalid();
    }

    // The user must have at least one usable membership for this app.
    const result = await this.finishLogin(user.id, audience, meta, { mfaVerified: false });
    if (!result.actor.membership) {
      await this.sessions.revoke(result.sessionId);
      throw AppError.authInvalid('This account has no access to this application');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
    return result;
  }

  // ------------------------------------------------------------------ MFA
  async verifyMfa(actor: Actor, code: string, meta: RequestMeta) {
    const user = await this.prisma.user.findUnique({ where: { id: actor.userId } });
    if (!user?.mfaSecretEnc)
      throw new AppError(
        'MFA_REQUIRED',
        'Two-step verification is not set up for this account',
        401,
      );
    const secret = decryptField(user.mfaSecretEnc, this.env.FIELD_ENCRYPTION_KEY);
    if (!verifyTotp(secret, code)) {
      await this.audit.record({
        action: 'auth.mfa.failed',
        entityType: 'User',
        entityId: user.id,
        actor,
        meta,
      });
      throw new AppError('MFA_INVALID', 'The verification code is not valid', 401);
    }
    await this.sessions.markMfaVerified(actor.sessionId);
    await this.audit.record({
      action: 'auth.mfa.verified',
      entityType: 'User',
      entityId: user.id,
      actor,
      meta,
    });
  }

  async startMfaEnrollment(actor: Actor) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (user.mfaEnabled)
      throw AppError.conflict('VERSION_CONFLICT', 'Two-step verification is already enabled');
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaSecretEnc: encryptField(secret, this.env.FIELD_ENCRYPTION_KEY) },
    });
    return { secret, otpauthUri: otpauthUri(secret, user.email ?? user.id) };
  }

  async confirmMfaEnrollment(actor: Actor, code: string, meta: RequestMeta) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (!user.mfaSecretEnc) throw AppError.validation('Start enrolment first');
    if (!verifyTotp(decryptField(user.mfaSecretEnc, this.env.FIELD_ENCRYPTION_KEY), code)) {
      throw new AppError('MFA_INVALID', 'The verification code is not valid', 401);
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    await this.sessions.markMfaVerified(actor.sessionId);
    await this.audit.record({
      action: 'auth.mfa.verified',
      entityType: 'User',
      entityId: user.id,
      reason: 'enrolment',
      actor,
      meta,
    });
  }

  // ------------------------------------------------------------------ session lifecycle
  async logout(actor: Actor, meta: RequestMeta) {
    await this.sessions.revoke(actor.sessionId);
    await this.audit.record({
      action: 'auth.logout',
      entityType: 'User',
      entityId: actor.userId,
      actor,
      meta,
    });
  }

  async switchMembership(actor: Actor, organizationId: string, branchId: string | undefined) {
    const target = actor.memberships.find(
      (m) =>
        m.organizationId === organizationId && (branchId === undefined || m.branchId === branchId),
    );
    if (!target) throw AppError.notFound();
    const row = await this.prisma.organizationMembership.findFirst({
      where: {
        userId: actor.userId,
        organizationId,
        status: 'ACTIVE',
        ...(branchId ? { branchId } : {}),
      },
    });
    if (!row) throw AppError.notFound();
    await this.sessions.setActiveMembership(actor.sessionId, row.id);
  }

  toMeView(actor: Actor): MeView {
    const active = actor.membership
      ? (actor.memberships.find(
          (m) =>
            m.organizationId === actor.membership!.organizationId &&
            m.roleCode === actor.membership!.roleCode &&
            m.branchId === actor.membership!.branchId,
        ) ?? null)
      : null;
    return {
      id: actor.userId,
      userType: actor.userType,
      displayName: actor.displayName,
      locale: 'en',
      audience: actor.audience,
      mfaVerified: actor.mfaVerified,
      mfaRequired: actor.mfaRequired,
      activeMembership: active,
      memberships: actor.memberships,
      permissions: [...actor.permissions].sort(),
    };
  }

  /** Starts a session for an already-verified user (used after merchant e-mail verification). */
  startSession(userId: string, audience: Audience, meta: RequestMeta, mfaVerified = false) {
    return this.finishLogin(userId, audience, meta, { mfaVerified });
  }

  // ------------------------------------------------------------------ helpers
  private async hasRole(userId: string, roleCode: string) {
    const count = await this.prisma.organizationMembership.count({
      where: { userId, status: 'ACTIVE', role: { code: roleCode } },
    });
    return count > 0;
  }

  private async finishLogin(
    userId: string,
    audience: Audience,
    meta: RequestMeta,
    opts: { mfaVerified: boolean },
  ): Promise<AuthResult> {
    const mfaPolicy =
      audience === 'admin'
        ? await this.config.getBoolean(CONFIG_KEYS.ADMIN_MFA_REQUIRED, true)
        : false;

    const { token, session } = await this.sessions.create({
      userId,
      audience,
      ip: meta.ip,
      userAgent: meta.userAgent,
      // OTP sessions (customer, staff) need no second factor; password sessions start unverified and
      // are only gated when the policy or the user's own setting requires MFA.
      mfaVerified: opts.mfaVerified,
    });
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    const full = await this.prisma.userSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { user: true },
    });
    const actor = await this.actors.build(full, true, mfaPolicy);
    await this.audit.record({
      action: 'auth.login.succeeded',
      entityType: 'User',
      entityId: userId,
      actor,
      reason: audience,
      meta,
    });
    return {
      token,
      sessionId: session.id,
      mfaRequired: actor.mfaRequired && !actor.mfaVerified,
      actor,
    };
  }
}
