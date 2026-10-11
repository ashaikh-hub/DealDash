import { Injectable } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

type Db = Prisma.TransactionClient | PrismaService;
interface Benefit {
  mechanic: string | null;
  value: number | null;
}
const benefitOf = (content: unknown): Benefit => {
  const c = (content ?? {}) as { mechanic?: string | null; valueNumber?: number | null };
  return {
    mechanic: c.mechanic ?? null,
    value: typeof c.valueNumber === 'number' ? c.valueNumber : null,
  };
};
const overlaps = (
  a: { startAt: Date | null; endAt: Date | null },
  b: { startAt: Date | null; endAt: Date | null },
) =>
  (a.endAt === null || b.startAt === null || a.endAt >= b.startAt) &&
  (b.endAt === null || a.startAt === null || b.endAt >= a.startAt);

/**
 * Offer conflict detection. DealDash does not block a merchant for a questionable offer; it FLAGS it for a person to decide.
 *   OVERLAP_WEAKER_EXCLUSIVE  an Exclusive Deal whose benefit is weaker than the merchant's overlapping public Live Deal
 *   DUPLICATE                 two campaigns of the same business with the same title, mechanic and value at the same time
 * Detection is idempotent (one flag per pair and type) and tenant-contained.
 */
@Injectable()
export class ConflictService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: SystemConfigService,
  ) {}

  private async flag(
    db: Db,
    organizationId: string,
    type: string,
    a: { product: string; id: string },
    b: { product: string; id: string },
    details: object,
  ) {
    // canonical pair so (a,b) and (b,a) are the same flag
    const [x, y] = a.id < b.id ? [a, b] : [b, a];
    const exists = await db.offerConflictFlag.findUnique({
      where: { type_aId_bId: { type, aId: x.id, bId: y.id } },
    });
    if (exists) return null;
    return db.offerConflictFlag.create({
      data: {
        organizationId,
        type,
        aProduct: x.product,
        aId: x.id,
        bProduct: y.product,
        bId: y.id,
        details: details as Prisma.InputJsonValue,
      },
    });
  }

  /** Checks one Exclusive Deal against the business's public and exclusive deals. Returns the flags created. */
  async detectForHotDeal(hotDealId: string, db: Db = this.prisma) {
    const cfg = await this.config.get<{ flagWeakerExclusive: boolean; equalWithinPoints: number }>(
      CONFIG_KEYS.PLATFORM_CONFLICTS,
    );
    const hot = await db.hotDeal.findUnique({ where: { id: hotDealId } });
    if (!hot) return [];
    const mine = benefitOf(hot.content);
    const out = [];
    if (cfg.flagWeakerExclusive && mine.mechanic && mine.value !== null) {
      const lives = await db.liveDeal.findMany({
        where: {
          organizationId: hot.organizationId,
          status: { in: ['LIVE', 'SCHEDULED', 'PAUSED'] },
          mechanic: mine.mechanic as never,
        },
      });
      for (const l of lives) {
        const theirs = benefitOf(l.content);
        if (theirs.value === null || !overlaps(hot, l)) continue;
        if (theirs.value - mine.value > cfg.equalWithinPoints) {
          const f = await this.flag(
            db,
            hot.organizationId,
            'OVERLAP_WEAKER_EXCLUSIVE',
            { product: 'EXCLUSIVE', id: hot.id },
            { product: 'LIVE_DEAL', id: l.id },
            { exclusive: mine, publicOffer: theirs },
          );
          if (f) out.push(f);
        }
      }
    }
    const twins = await db.hotDeal.findMany({
      where: {
        organizationId: hot.organizationId,
        id: { not: hot.id },
        titleEn: hot.titleEn,
        status: { in: ['LIVE', 'SCHEDULED', 'PENDING_REVIEW'] },
      },
    });
    for (const o of twins) {
      const theirs = benefitOf(o.content);
      if (
        hot.titleEn &&
        theirs.mechanic === mine.mechanic &&
        theirs.value === mine.value &&
        overlaps(hot, o)
      ) {
        const f = await this.flag(
          db,
          hot.organizationId,
          'DUPLICATE',
          { product: 'EXCLUSIVE', id: hot.id },
          { product: 'EXCLUSIVE', id: o.id },
          { title: hot.titleEn },
        );
        if (f) out.push(f);
      }
    }
    return out;
  }

  /** Re-checks every live exclusive deal (used by the admin "scan" action and the daily job). */
  async scan(organizationId?: string) {
    const deals = await this.prisma.hotDeal.findMany({
      where: {
        status: { in: ['LIVE', 'SCHEDULED', 'PENDING_REVIEW'] },
        ...(organizationId ? { organizationId } : {}),
      },
      select: { id: true },
    });
    let created = 0;
    for (const d of deals) created += (await this.detectForHotDeal(d.id)).length;
    return { checked: deals.length, flagged: created };
  }

  list(where: Prisma.OfferConflictFlagWhereInput) {
    return this.prisma.offerConflictFlag.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /** A person decides: ACKNOWLEDGED (the offer stands, reason recorded) or REQUIRES_CHANGE (the merchant must fix it). */
  async decide(
    actor: Actor,
    id: string,
    decision: 'ACKNOWLEDGED' | 'REQUIRES_CHANGE',
    note: string,
    meta: RequestMeta,
  ) {
    const f = await this.prisma.offerConflictFlag.findUnique({ where: { id } });
    if (!f) throw AppError.notFound();
    if (f.status !== 'OPEN')
      throw new AppError('INVALID_STATE', 'This flag was already decided', 409);
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.offerConflictFlag.updateMany({
        where: { id, status: 'OPEN' },
        data: {
          status: decision,
          decidedByUserId: actor.userId,
          decisionNote: note,
          decidedAt: new Date(),
        },
      });
      if (r.count !== 1)
        throw new AppError('VERSION_CONFLICT', 'The flag changed. Reload and try again.', 409);
      await this.audit.record(
        {
          action: 'OFFER_CONFLICT_DECIDED',
          entityType: 'OfferConflictFlag',
          entityId: id,
          actor,
          subjectOrganizationId: f.organizationId,
          reason: note,
          newState: { status: decision },
          meta,
        },
        tx,
      );
    });
    return this.prisma.offerConflictFlag.findUniqueOrThrow({ where: { id } });
  }
}
