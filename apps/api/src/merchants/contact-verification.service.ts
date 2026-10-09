import { Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { CONFIG_KEYS, type ApiEnv } from '@dealdash/config';
import { AppError } from '../common/errors';
import { safeEqual, sha256 } from '../common/crypto';
import { APP_ENV } from '../common/env';
import type { RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import {
  EMAIL_PROVIDER,
  SMS_PROVIDER,
  type EmailProvider,
  type SmsProvider,
} from '../providers/interfaces';
import { SystemConfigService } from '../system-config/system-config.service';

export type VerificationPurpose = 'EMAIL_VERIFY' | 'MERCHANT_MOBILE';

const TEXT = {
  email: {
    en: (code: string) => ({
      subject: 'Your DealDash verification code',
      body: `Your DealDash for Business verification code is ${code}. It expires in a few minutes.`,
    }),
    ar: (code: string) => ({
      subject: 'رمز التحقق من ديل داش',
      body: `رمز التحقق الخاص بك في ديل داش للأعمال هو ${code}. تنتهي صلاحيته خلال دقائق.`,
    }),
  },
  sms: {
    en: (code: string) => `Your DealDash for Business code is ${code}. Do not share it.`,
    ar: (code: string) => `رمز ديل داش للأعمال هو ${code}. لا تشاركه مع أحد.`,
  },
};

/** E-mail and mobile verification codes for merchant onboarding (same limits and hashing rules as login OTPs). */
@Injectable()
export class ContactVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(APP_ENV) private readonly env: ApiEnv,
  ) {}

  private hash(purpose: string, target: string, code: string) {
    return sha256(`${this.env.SESSION_SECRET}:${purpose}:${target}:${code}`);
  }

  async send(purpose: VerificationPurpose, target: string, meta: RequestMeta) {
    const ttl = await this.config.getNumber(CONFIG_KEYS.OTP_TTL_SECONDS, 300);
    const cooldown = await this.config.getNumber(CONFIG_KEYS.OTP_RESEND_COOLDOWN_SECONDS, 30);
    const perHour = await this.config.getNumber(CONFIG_KEYS.OTP_MAX_REQUESTS_PER_HOUR, 5);
    const maxAttempts = await this.config.getNumber(CONFIG_KEYS.OTP_MAX_ATTEMPTS, 5);

    const recent = await this.prisma.otpChallenge.findMany({
      where: { target, purpose, createdAt: { gte: new Date(Date.now() - 3600_000) } },
      orderBy: { createdAt: 'desc' },
      take: perHour + 1,
    });
    if (recent.length >= perHour)
      throw AppError.rateLimited('OTP_RATE_LIMITED', 'Too many codes requested. Try again later.');
    if (recent[0] && Date.now() - recent[0].createdAt.getTime() < cooldown * 1000) {
      throw AppError.rateLimited(
        'OTP_RATE_LIMITED',
        `Please wait ${cooldown} seconds before requesting another code.`,
      );
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.otpChallenge.create({
      data: {
        purpose,
        audience: 'merchant',
        target,
        codeHash: this.hash(purpose, target, code),
        maxAttempts,
        expiresAt: new Date(Date.now() + ttl * 1000),
        ip: meta.ip,
      },
    });
    if (purpose === 'EMAIL_VERIFY') {
      const m = TEXT.email[meta.locale](code);
      await this.email.send({
        to: target,
        templateKey: 'merchant.email_verify',
        subject: m.subject,
        body: m.body,
        locale: meta.locale,
      });
    } else {
      await this.sms.send({
        to: target,
        templateKey: 'merchant.mobile_verify',
        body: TEXT.sms[meta.locale](code),
        locale: meta.locale,
      });
    }
    return { expiresInSeconds: ttl, resendAfterSeconds: cooldown };
  }

  /** Verifies and consumes a code. Throws the standard OTP errors. */
  async check(purpose: VerificationPurpose, target: string, code: string) {
    const c = await this.prisma.otpChallenge.findFirst({
      where: { target, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!c) throw new AppError('OTP_INVALID', 'The code is not valid', 400);
    if (c.expiresAt <= new Date())
      throw new AppError('OTP_EXPIRED', 'The code has expired. Request a new one.', 400);
    if (c.attempts >= c.maxAttempts)
      throw AppError.rateLimited('OTP_LOCKED', 'Too many attempts. Request a new code.');
    if (!safeEqual(this.hash(purpose, target, code), c.codeHash)) {
      await this.prisma.otpChallenge.update({
        where: { id: c.id },
        data: { attempts: { increment: 1 } },
      });
      throw new AppError('OTP_INVALID', 'The code is not valid', 400);
    }
    await this.prisma.otpChallenge.update({
      where: { id: c.id },
      data: { consumedAt: new Date() },
    });
  }
}
