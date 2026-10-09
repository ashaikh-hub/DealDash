import { Inject, Injectable } from '@nestjs/common';
import type { ApiEnv } from '@dealdash/config';
import { CONFIG_KEYS } from '@dealdash/config';
import type { Audience } from '@dealdash/types';
import { APP_ENV } from '../common/env';
import { hmacSha256, randomToken, sha256 } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

const TOUCH_INTERVAL_MS = 60_000;

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    @Inject(APP_ENV) private readonly env: ApiEnv,
  ) {}

  /** Opaque, random session token; only its hash is stored. Revocable server-side. */
  async create(args: {
    userId: string;
    audience: Audience;
    ip: string | null;
    userAgent: string | null;
    mfaVerified: boolean;
    activeMembershipId?: string | null;
  }) {
    const token = randomToken(32);
    const hours = await this.config.getNumber(CONFIG_KEYS.SESSION_ABSOLUTE_HOURS, 336);
    const session = await this.prisma.userSession.create({
      data: {
        userId: args.userId,
        audience: args.audience,
        tokenHash: sha256(token),
        mfaVerified: args.mfaVerified,
        activeMembershipId: args.activeMembershipId ?? null,
        ip: args.ip,
        userAgent: args.userAgent ? args.userAgent.slice(0, 300) : null,
        expiresAt: new Date(Date.now() + hours * 3600_000),
      },
    });
    return { token, session };
  }

  async resolve(token: string) {
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
    if (session.user.status !== 'ACTIVE') return null;

    const idleMinutes = await this.config.getNumber(CONFIG_KEYS.SESSION_IDLE_MINUTES, 60);
    if (Date.now() - session.lastSeenAt.getTime() > idleMinutes * 60_000) {
      await this.prisma.userSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      return null;
    }
    if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.userSession.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      });
    }
    return session;
  }

  revoke(sessionId: string) {
    return this.prisma.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  revokeAllForUser(userId: string) {
    return this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  markMfaVerified(sessionId: string) {
    return this.prisma.userSession.update({
      where: { id: sessionId },
      data: { mfaVerified: true },
    });
  }

  setActiveMembership(sessionId: string, membershipId: string) {
    return this.prisma.userSession.update({
      where: { id: sessionId },
      data: { activeMembershipId: membershipId },
    });
  }

  /** CSRF token bound to the session (double-submit without needing a readable cookie). */
  csrfFor(sessionId: string): string {
    return hmacSha256(this.env.SESSION_SECRET, `csrf:${sessionId}`).slice(0, 48);
  }
}
