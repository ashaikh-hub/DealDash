import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { isAllowedBrowserOrigin, type ApiEnv } from '@dealdash/config';
import type {
  LinkedIdentities,
  SocialCallbackResult,
  SocialCompleteResult,
  SocialProvider,
  SocialStartInput,
} from '@dealdash/validation';
import { AuditService } from '../audit/audit.service';
import { sha256 } from '../common/crypto';
import { APP_ENV } from '../common/env';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { SOCIAL_AUTH_PROVIDER, type SocialAuthProvider } from '../providers/interfaces';
import { AuthService, type AuthResult } from './auth.service';

/** How long a started sign-in (and a verified profile waiting for the phone number) stays usable. */
const ATTEMPT_MINUTES = 15;
const PROVIDERS: SocialProvider[] = ['GOOGLE', 'APPLE'];

/**
 * Customer sign-in with Google / Apple (customer experience, 2026-10-16). Production client ids / keys are an EXTERNAL dependency: the
 * development provider stands in until they exist. Rules:
 *  - the state sent to the provider is random, single use, stored only hashed, and expires (no replay, no CSRF on the callback)
 *  - the callback page must be one of DealDash's own app addresses (no open redirect)
 *  - an identity is keyed by the provider's stable subject; DealDash keeps no provider tokens
 *  - the phone number stays the account key: a provider account seen for the first time is finished by confirming a phone number by
 *    SMS code. That links it to the existing account with that number, or creates the account (one person, one account).
 *  - a signed-in customer can link or unlink a provider; a provider account linked to someone else is never moved silently.
 */
@Injectable()
export class SocialAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    @Inject(SOCIAL_AUTH_PROVIDER) private readonly provider: SocialAuthProvider,
    @Inject(APP_ENV) private readonly env: ApiEnv,
  ) {}

  private hash(value: string) {
    return sha256(`${this.env.SESSION_SECRET}:social:${value}`);
  }

  available(): SocialProvider[] {
    return PROVIDERS.filter((p) => this.provider.available(p));
  }

  async start(input: SocialStartInput, actor: Actor | undefined, meta: RequestMeta) {
    if (!this.provider.available(input.provider))
      throw new AppError(
        'SOCIAL_SIGN_IN_UNAVAILABLE',
        'This sign-in option is not available yet. Use your phone number.',
        503,
      );
    let origin: string;
    try {
      origin = new URL(input.callbackUrl).origin;
    } catch {
      throw AppError.validation('Invalid callback address', 'callbackUrl');
    }
    if (!isAllowedBrowserOrigin(this.env, origin))
      throw AppError.validation('Invalid callback address', 'callbackUrl');
    const linking = input.intent === 'LINK';
    if (linking && actor?.userType !== 'CUSTOMER') throw AppError.authInvalid();
    const state = randomBytes(24).toString('base64url');
    await this.prisma.socialSignIn.create({
      data: {
        provider: input.provider,
        stateHash: this.hash(state),
        intent: input.intent,
        userId: linking ? actor!.userId : null,
        callbackUrl: input.callbackUrl,
        expiresAt: new Date(Date.now() + ATTEMPT_MINUTES * 60_000),
      },
    });
    await this.audit.record({
      action: 'auth.social.started',
      entityType: 'SocialSignIn',
      entityId: null,
      actor: actor ?? null,
      reason: `${input.provider}:${input.intent}`,
      meta,
    });
    return {
      authorizeUrl: this.provider.authorizeUrl({
        provider: input.provider,
        state,
        callbackUrl: input.callbackUrl,
      }),
    };
  }

  /**
   * The customer is back from the provider. Returns what happened; on SIGNED_IN the caller sets the session cookie from `session`.
   * The attempt is consumed whatever the outcome (a state is never accepted twice).
   */
  async callback(
    input: { state: string; code?: string; error?: string },
    actor: Actor | undefined,
    meta: RequestMeta,
  ): Promise<{ result: Omit<SocialCallbackResult, 'csrfToken'>; session: AuthResult | null }> {
    const attempt = await this.prisma.socialSignIn.findUnique({
      where: { stateHash: this.hash(input.state) },
    });
    if (!attempt || attempt.status !== 'STARTED' || attempt.expiresAt <= new Date())
      throw new AppError(
        'SOCIAL_SIGN_IN_EXPIRED',
        'This sign-in has expired. Please start again.',
        400,
      );
    const provider = attempt.provider as SocialProvider;
    const intent = attempt.intent as 'SIGN_IN' | 'LINK';
    const base = { provider, intent, linkToken: null, profile: null };
    const finish = async (
      status: 'CANCELLED' | 'FAILED' | 'CONFLICT' | 'LINKED' | 'COMPLETED',
      failureCode?: string,
    ) => {
      await this.prisma.socialSignIn.update({
        where: { id: attempt.id },
        data: { status, failureCode: failureCode ?? null, completedAt: new Date() },
      });
      await this.audit.record({
        action: `auth.social.${status.toLowerCase()}`,
        entityType: 'SocialSignIn',
        entityId: attempt.id,
        actorUserId: attempt.userId,
        reason: failureCode ? `${provider}:${failureCode}` : provider,
        meta,
      });
    };

    // the customer said no on the provider's screen, or the provider reported an error
    if (input.error || !input.code) {
      const cancelled = input.error === 'access_denied' || input.error === 'user_cancelled';
      await finish(cancelled ? 'CANCELLED' : 'FAILED', input.error ?? 'NO_CODE');
      return { result: { ...base, status: cancelled ? 'CANCELLED' : 'FAILED' }, session: null };
    }
    const profile = await this.provider
      .exchange({ provider, code: input.code, callbackUrl: attempt.callbackUrl })
      .catch(() => null);
    if (!profile) {
      await finish('FAILED', 'CODE_REJECTED');
      return { result: { ...base, status: 'FAILED' }, session: null };
    }
    const existing = await this.prisma.userIdentity.findUnique({
      where: { provider_subject: { provider, subject: profile.subject } },
    });

    // ---- linking from Account settings (the same signed-in customer must finish it)
    if (intent === 'LINK') {
      if (!actor || actor.userId !== attempt.userId) throw AppError.authInvalid();
      if (existing && existing.userId !== actor.userId) {
        await finish('CONFLICT', 'LINKED_ELSEWHERE');
        return { result: { ...base, status: 'CONFLICT' }, session: null };
      }
      const mine = await this.prisma.userIdentity.findUnique({
        where: { userId_provider: { userId: actor.userId, provider } },
      });
      if (mine && mine.subject !== profile.subject) {
        await finish('CONFLICT', 'OTHER_ACCOUNT_LINKED');
        return { result: { ...base, status: 'CONFLICT' }, session: null };
      }
      if (!mine)
        await this.prisma.userIdentity.create({
          data: {
            userId: actor.userId,
            provider,
            subject: profile.subject,
            email: profile.email,
            emailVerified: profile.emailVerified,
            displayName: profile.name,
          },
        });
      await finish('LINKED');
      return { result: { ...base, status: 'LINKED' }, session: null };
    }

    // ---- sign-in: a known identity signs straight in
    if (existing) {
      const user = await this.prisma.user.findUnique({ where: { id: existing.userId } });
      if (!user || user.status !== 'ACTIVE' || user.userType !== 'CUSTOMER') {
        await finish('FAILED', 'ACCOUNT_INACTIVE');
        return { result: { ...base, status: 'FAILED' }, session: null };
      }
      await this.prisma.userIdentity.update({
        where: { id: existing.id },
        data: { lastUsedAt: new Date() },
      });
      await finish('COMPLETED');
      const session = await this.auth.startSession(user.id, 'customer', meta, true);
      return { result: { ...base, status: 'SIGNED_IN' }, session };
    }

    // ---- first time with this provider account: finish with a phone number
    const linkToken = randomBytes(24).toString('base64url');
    await this.prisma.socialSignIn.update({
      where: { id: attempt.id },
      data: {
        status: 'NEEDS_PHONE',
        subject: profile.subject,
        email: profile.email,
        emailVerified: profile.emailVerified,
        displayName: profile.name,
        linkTokenHash: this.hash(linkToken),
        // the phone step gets a fresh window
        expiresAt: new Date(Date.now() + ATTEMPT_MINUTES * 60_000),
      },
    });
    return {
      result: {
        ...base,
        status: 'NEEDS_PHONE',
        linkToken,
        profile: { name: profile.name, email: profile.email },
      },
      session: null,
    };
  }

  /**
   * Phone step after a first Google / Apple sign-in: the SMS code proves the number (the same checks as phone sign-in). The provider
   * account is then linked to the account with that number, or to the new account the code created.
   */
  async complete(
    input: { linkToken: string; mobile: string; code: string },
    meta: RequestMeta,
  ): Promise<{ result: Omit<SocialCompleteResult, 'csrfToken'>; session: AuthResult }> {
    const attempt = await this.prisma.socialSignIn.findUnique({
      where: { linkTokenHash: this.hash(input.linkToken) },
    });
    if (
      !attempt ||
      attempt.status !== 'NEEDS_PHONE' ||
      attempt.expiresAt <= new Date() ||
      !attempt.subject
    )
      throw new AppError(
        'SOCIAL_SIGN_IN_EXPIRED',
        'This sign-in has expired. Please start again.',
        400,
      );
    const provider = attempt.provider as SocialProvider;
    const before = await this.prisma.user.findUnique({
      where: { mobile: input.mobile },
      select: { id: true },
    });
    // the same verification as phone sign-in (rate limits, attempts, account type), which also creates a new customer
    const session = await this.auth.verifyOtp(input.mobile, input.code, 'customer', meta);
    const userId = session.actor.userId;
    const subject = attempt.subject;
    let account: SocialCompleteResult['account'] = before ? 'EXISTING' : 'NEW';
    const [taken, mine] = await Promise.all([
      this.prisma.userIdentity.findUnique({
        where: { provider_subject: { provider, subject } },
      }),
      this.prisma.userIdentity.findUnique({ where: { userId_provider: { userId, provider } } }),
    ]);
    if ((taken && taken.userId !== userId) || (mine && mine.subject !== subject))
      account = 'NOT_LINKED';
    else if (!mine) {
      try {
        await this.prisma.userIdentity.create({
          data: {
            userId,
            provider,
            subject,
            email: attempt.email,
            emailVerified: attempt.emailVerified,
            displayName: attempt.displayName,
            lastUsedAt: new Date(),
          },
        });
      } catch (e) {
        // a concurrent completion linked it first
        if ((e as { code?: string }).code !== 'P2002') throw e;
      }
    }
    await this.prisma.socialSignIn.update({
      where: { id: attempt.id },
      data: {
        status: account === 'NOT_LINKED' ? 'CONFLICT' : 'COMPLETED',
        userId,
        linkTokenHash: null,
        completedAt: new Date(),
      },
    });
    // a new account starts with the name / e-mail the provider confirmed (the customer can change them in the set-up)
    if (account !== 'NOT_LINKED') await this.prefillProfile(userId, attempt);
    await this.audit.record({
      action: account === 'NOT_LINKED' ? 'auth.social.not_linked' : 'auth.social.linked',
      entityType: 'User',
      entityId: userId,
      actor: session.actor,
      reason: `${provider}:${account}`,
      meta,
    });
    return { result: { account, provider }, session };
  }

  private async prefillProfile(
    userId: string,
    a: { displayName: string | null; email: string | null; emailVerified: boolean },
  ) {
    const c = await this.prisma.customer.findUnique({ where: { userId } });
    if (!c) return;
    const [first, ...rest] = (a.displayName ?? '').trim().split(/\s+/).filter(Boolean);
    const data: { firstName?: string; lastName?: string; email?: string } = {};
    if (!c.firstName && first) data.firstName = first.slice(0, 60);
    if (!c.lastName && rest.length) data.lastName = rest.join(' ').slice(0, 60);
    if (!c.email && a.email && a.emailVerified) data.email = a.email.slice(0, 254);
    if (Object.keys(data).length) await this.prisma.customer.update({ where: { userId }, data });
  }

  async identities(userId: string): Promise<LinkedIdentities> {
    const rows = await this.prisma.userIdentity.findMany({
      where: { userId },
      orderBy: { linkedAt: 'asc' },
    });
    return {
      items: rows.map((r) => ({
        provider: r.provider as SocialProvider,
        email: r.email,
        linkedAt: r.linkedAt.toISOString(),
      })),
      available: this.available(),
    };
  }

  /** Unlinking is always safe: the phone number remains the way into the account. */
  async unlink(actor: Actor, provider: SocialProvider, meta: RequestMeta) {
    const r = await this.prisma.userIdentity.deleteMany({
      where: { userId: actor.userId, provider },
    });
    if (r.count)
      await this.audit.record({
        action: 'auth.social.unlinked',
        entityType: 'User',
        entityId: actor.userId,
        actor,
        reason: provider,
        meta,
      });
    return this.identities(actor.userId);
  }
}
