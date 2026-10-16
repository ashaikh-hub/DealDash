import { Injectable } from '@nestjs/common';
import type { EligibilityKind } from '@dealdash/types';
import type { CardOfferActivationItem, CardOfferState, OfferProduct } from '@dealdash/validation';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { partnerRefsOf } from '../live-deals/eligibility.service';
import { PrismaService } from '../prisma/prisma.service';

type Bi = { en: string; ar: string };
interface OfferRow {
  id: string;
  organizationId: string;
  titleEn: string;
  titleAr: string;
  open: boolean;
  eligibilityKind: EligibilityKind;
  ruleSet: {
    expression: unknown;
    conditions: Array<{ attrType: string; valueRef: string }>;
  } | null;
  organization: { nameEn: string; nameAr: string };
}

const RULE = {
  select: { expression: true, conditions: { select: { attrType: true, valueRef: true } } },
} as const;
const ORG = { select: { nameEn: true, nameAr: true } } as const;

/**
 * Card-linked offers (customer experience, 2026-10-16; My benefits). An offer whose rule names card programmes (issuer, card product
 * or tier) is activated by the customer on one of the cards they added. One activation per customer and offer; it never changes
 * eligibility (the eligibility engine still decides who can use the offer) and is recorded in the customer's benefit history.
 */
@Injectable()
export class CardOffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async offer(product: OfferProduct, id: string, now: Date): Promise<OfferRow | null> {
    const select = {
      id: true,
      organizationId: true,
      titleEn: true,
      titleAr: true,
      status: true,
      eligibilityKind: true,
      ruleSet: RULE,
      organization: ORG,
    } as const;
    const notEnded = (end: Date | null) => !end || end.getTime() > now.getTime();
    if (product === 'LIVE') {
      const r = await this.prisma.liveDeal.findUnique({
        where: { id },
        select: { ...select, endAt: true },
      });
      return r ? { ...r, open: r.status === 'LIVE' && notEnded(r.endAt) } : null;
    }
    if (product === 'HOT') {
      const r = await this.prisma.hotDeal.findUnique({
        where: { id },
        select: { ...select, endAt: true },
      });
      return r
        ? { ...r, open: (r.status === 'LIVE' || r.status === 'SOLD_OUT') && notEnded(r.endAt) }
        : null;
    }
    const r = await this.prisma.voucher.findUnique({
      where: { id },
      select: { ...select, saleEndAt: true },
    });
    return r ? { ...r, open: r.status === 'ON_SALE' && notEnded(r.saleEndAt) } : null;
  }

  /** The ACTIVE card programmes that open this offer (none = not a card offer). */
  private async programsFor(o: OfferRow) {
    const refs = partnerRefsOf(
      o.eligibilityKind,
      o.ruleSet?.conditions ?? [],
      o.ruleSet?.expression,
    );
    if (!refs.productCodes.length && !refs.tiers.length && !refs.organizationIds.length) return [];
    return this.prisma.partnerCardProgram.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          ...(refs.productCodes.length ? [{ productCode: { in: refs.productCodes } }] : []),
          ...(refs.tiers.length
            ? [{ tier: { in: refs.tiers, mode: 'insensitive' as const } }]
            : []),
          ...(refs.organizationIds.length
            ? [{ partnerOrganizationId: { in: refs.organizationIds } }]
            : []),
        ],
      },
    });
  }

  /** The programmes of the cards the customer has added (My benefits). */
  private async myPrograms(userId: string) {
    const rows = await this.prisma.eligibilityAttribute.findMany({
      where: { userId, attrType: 'CARD_PRODUCT', status: 'VERIFIED', programId: { not: null } },
      select: { programId: true },
    });
    return new Set(rows.map((r) => r.programId!));
  }

  private async names(ids: string[]) {
    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, nameEn: true, nameAr: true },
    });
    return new Map(orgs.map((o) => [o.id, { en: o.nameEn, ar: o.nameAr } as Bi]));
  }

  async state(
    userId: string | null,
    product: OfferProduct,
    offerId: string,
    now = new Date(),
  ): Promise<CardOfferState> {
    const o = await this.offer(product, offerId, now);
    if (!o) throw AppError.notFound();
    const programs = await this.programsFor(o);
    const empty: CardOfferState = {
      state: 'NOT_CARD_OFFER',
      cards: [],
      issuers: [],
      activation: null,
    };
    if (!programs.length) return empty;
    const issuerNames = await this.names(programs.map((p) => p.partnerOrganizationId));
    const issuers = [...new Set(programs.map((p) => p.partnerOrganizationId))]
      .filter((id) => issuerNames.has(id))
      .map((id) => ({ id, name: issuerNames.get(id)! }));
    if (!userId) return { ...empty, state: o.open ? 'NEEDS_CARD' : 'UNAVAILABLE', issuers };
    const mine = await this.myPrograms(userId);
    const cards = programs
      .filter((p) => mine.has(p.id))
      .map((p) => ({ programId: p.id, name: { en: p.nameEn, ar: p.nameAr } }));
    const act = await this.prisma.cardOfferActivation.findUnique({
      where: { userId_product_offerId: { userId, product, offerId } },
    });
    if (act?.status === 'ACTIVE') {
      const program = await this.prisma.partnerCardProgram.findUnique({
        where: { id: act.programId },
      });
      return {
        state: 'ACTIVATED',
        cards,
        issuers,
        activation: {
          programId: act.programId,
          cardName: { en: program?.nameEn ?? '', ar: program?.nameAr ?? '' },
          activatedAt: act.activatedAt.toISOString(),
        },
      };
    }
    if (!o.open) return { state: 'UNAVAILABLE', cards, issuers, activation: null };
    return { state: cards.length ? 'AVAILABLE' : 'NEEDS_CARD', cards, issuers, activation: null };
  }

  async activate(
    actor: Actor,
    product: OfferProduct,
    offerId: string,
    programId: string,
    meta: RequestMeta,
  ) {
    const now = new Date();
    const s = await this.state(actor.userId, product, offerId, now);
    if (s.state === 'ACTIVATED') return s;
    if (s.state !== 'AVAILABLE' || !s.cards.some((c) => c.programId === programId))
      throw new AppError(
        'OFFER_ACTIVATION_NOT_ALLOWED',
        s.state === 'NEEDS_CARD'
          ? 'Add an eligible card to activate this offer'
          : 'This offer cannot be activated',
        422,
      );
    const o = (await this.offer(product, offerId, now))!;
    try {
      await this.prisma.cardOfferActivation.upsert({
        where: { userId_product_offerId: { userId: actor.userId, product, offerId } },
        update: { status: 'ACTIVE', programId, activatedAt: now, deactivatedAt: null },
        create: { userId: actor.userId, product, offerId, programId, activatedAt: now },
      });
    } catch (e) {
      // a double tap activated it first
      if ((e as { code?: string }).code !== 'P2002') throw e;
    }
    // the benefit history (My benefits) is the customer's own audited events
    await this.audit.record({
      action: 'benefit.offer.activated',
      entityType: 'CustomerBenefit',
      entityId: actor.userId,
      actorUserId: actor.userId,
      subjectOrganizationId: o.organizationId,
      newState: { name: { en: o.titleEn, ar: o.titleAr }, product, offerId, programId },
      source: 'APP',
      meta,
    });
    return this.state(actor.userId, product, offerId, now);
  }

  /** Activation history: every card offer the customer activated, with whether it is still usable. */
  async list(userId: string, now = new Date()): Promise<CardOfferActivationItem[]> {
    const rows = await this.prisma.cardOfferActivation.findMany({
      where: { userId },
      orderBy: { activatedAt: 'desc' },
      take: 100,
    });
    if (!rows.length) return [];
    const mine = await this.myPrograms(userId);
    const programs = await this.prisma.partnerCardProgram.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.programId))] } },
    });
    const programName = new Map(programs.map((p) => [p.id, { en: p.nameEn, ar: p.nameAr }]));
    const out: CardOfferActivationItem[] = [];
    for (const r of rows) {
      const o = await this.offer(r.product as OfferProduct, r.offerId, now);
      if (!o) continue;
      out.push({
        product: r.product as OfferProduct,
        offerId: r.offerId,
        title: { en: o.titleEn, ar: o.titleAr },
        merchantName: { en: o.organization.nameEn, ar: o.organization.nameAr },
        cardName: programName.get(r.programId) ?? { en: '', ar: '' },
        activatedAt: r.activatedAt.toISOString(),
        status: !mine.has(r.programId) ? 'CARD_REMOVED' : o.open ? 'ACTIVE' : 'ENDED',
      });
    }
    return out;
  }
}
