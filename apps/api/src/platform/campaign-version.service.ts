import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );

/**
 * Campaign versions. Approval creates version N as LIVE; a controlled amendment (a commercial change a party has accepted) creates
 * N+1 and supersedes N. A version's content is frozen (database trigger), and entitlements, redemptions, purchases, rewards and
 * financial events record the version in force when they happened, so a later amendment never rewrites what a customer was promised.
 */
@Injectable()
export class CampaignVersionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Records `content` as the new LIVE version (and supersedes the previous one). Returns the version number. */
  async recordLive(
    tx: Prisma.TransactionClient,
    p: {
      product: string;
      subjectId: string;
      organizationId: string;
      content: unknown;
      reason: 'APPROVED' | 'AMENDMENT' | 'SCHEDULED_ACTIVATION';
      quotationId?: string | null;
      userId?: string | null;
      now?: Date;
    },
  ): Promise<number> {
    const now = p.now ?? new Date();
    const hash = createHash('sha256').update(stable(p.content)).digest('hex');
    const live = await tx.campaignVersion.findFirst({
      where: { product: p.product, subjectId: p.subjectId, status: 'LIVE' },
    });
    // the same content approved twice is the same version (idempotent re-approval)
    if (live && live.contentHash === hash && p.reason !== 'AMENDMENT') return live.version;
    const last = await tx.campaignVersion.findFirst({
      where: { product: p.product, subjectId: p.subjectId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    if (live)
      await tx.campaignVersion.update({ where: { id: live.id }, data: { status: 'SUPERSEDED', effectiveUntil: now } });
    const v = await tx.campaignVersion.create({
      data: {
        product: p.product,
        subjectId: p.subjectId,
        organizationId: p.organizationId,
        version: (last?.version ?? 0) + 1,
        status: 'LIVE',
        reason: p.reason,
        content: p.content as Prisma.InputJsonValue,
        contentHash: hash,
        quotationId: p.quotationId ?? null,
        effectiveFrom: now,
        createdByUserId: p.userId ?? null,
      },
    });
    return v.version;
  }

  /** The version in force now (null for a campaign that pre-dates versioning). */
  async current(db: Db, product: string, subjectId: string): Promise<number | null> {
    const v = await db.campaignVersion.findFirst({
      where: { product, subjectId, status: 'LIVE' },
      select: { version: true },
    });
    return v?.version ?? null;
  }

  async history(product: string, subjectId: string) {
    return (
      await this.prisma.campaignVersion.findMany({
        where: { product, subjectId },
        orderBy: { version: 'desc' },
        take: 50,
      })
    ).map((v) => ({
      version: v.version,
      status: v.status,
      reason: v.reason,
      effectiveFrom: v.effectiveFrom.toISOString(),
      effectiveUntil: v.effectiveUntil?.toISOString() ?? null,
      quotationId: v.quotationId,
      contentHash: v.contentHash,
    }));
  }

  /** The exact content a past version carried (support and partner reporting read this, not the current campaign). */
  async content(product: string, subjectId: string, version: number) {
    return this.prisma.campaignVersion.findUnique({
      where: { product_subjectId_version: { product, subjectId, version } },
    });
  }
}
