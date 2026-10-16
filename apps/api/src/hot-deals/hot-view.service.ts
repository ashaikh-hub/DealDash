import { Injectable } from '@nestjs/common';
import type { HotDealStatus } from '@dealdash/types';
import {
  commitmentMethodOf,
  hotDealIssues,
  hotTranslationStatus,
  type HotDealCard,
  type HotDealContent,
  type HotDealDetail,
  type HotDealView,
} from '@dealdash/validation';
import { FilesService } from '../files/files.service';
import { merchantDisplayName, type CardContext } from '../live-deals/deal-presenter.service';
import { GuardrailsService } from '../live-deals/guardrails.service';
import { CONFIG_KEYS } from '@dealdash/config';
import { parseHotContent } from './hot-content';
import { HotCoreService, type HotRow } from './hot-core.service';

type InventoryRow = HotRow['inventory'][number];

const AVAILABILITY: Record<HotDealStatus, HotDealCard['availability']> = {
  DRAFT: 'UNAVAILABLE',
  PENDING_REVIEW: 'UNAVAILABLE',
  NEEDS_CHANGES: 'UNAVAILABLE',
  SCHEDULED: 'SCHEDULED',
  LIVE: 'AVAILABLE',
  PAUSED: 'PAUSED',
  SOLD_OUT: 'SOLD_OUT',
  EXPIRED: 'ENDED',
  CANCELLED: 'UNAVAILABLE',
  REJECTED: 'UNAVAILABLE',
  SUSPENDED: 'UNAVAILABLE',
};

export type HotDiscoverableReason =
  'STATUS_NOT_PUBLIC' | 'NOT_STARTED' | 'ENDED' | 'MERCHANT_NOT_ACTIVE' | 'NO_ACTIVE_BRANCH';

/** Whether customers can find the deal RIGHT NOW (dates read directly, so it never depends on the sweep having run). */
export function hotDiscoverable(
  deal: Pick<HotRow, 'status' | 'startAt' | 'endAt' | 'organization' | 'inventory'>,
  now: Date,
): { visible: boolean; reason: HotDiscoverableReason | null } {
  if (deal.status !== 'LIVE' && deal.status !== 'SOLD_OUT')
    return { visible: false, reason: 'STATUS_NOT_PUBLIC' };
  if (deal.startAt && deal.startAt.getTime() > now.getTime())
    return { visible: false, reason: 'NOT_STARTED' };
  if (deal.endAt && deal.endAt.getTime() <= now.getTime())
    return { visible: false, reason: 'ENDED' };
  if (deal.organization.status !== 'ACTIVE')
    return { visible: false, reason: 'MERCHANT_NOT_ACTIVE' };
  if (!deal.inventory.some((i) => i.branch.status === 'ACTIVE'))
    return { visible: false, reason: 'NO_ACTIVE_BRANCH' };
  return { visible: true, reason: null };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Builds the merchant/admin view of an Exclusive Deal and the customer-facing card/detail shapes. */
@Injectable()
export class HotViewService {
  constructor(
    private readonly core: HotCoreService,
    private readonly files: FilesService,
    private readonly guardrails: GuardrailsService,
  ) {}

  // ---------------------------------------------------------------- merchant / admin view
  merchantActions(status: HotDealStatus, pausedBy: string | null, tracked: boolean): string[] {
    const out = new Set<string>();
    switch (status) {
      case 'DRAFT':
      case 'NEEDS_CHANGES':
        out.add('edit');
        out.add('submit');
        break;
      case 'SCHEDULED':
        out.add('edit_minor');
        out.add('pause');
        out.add('cancel');
        break;
      case 'LIVE':
        out.add('edit_minor');
        out.add('pause');
        out.add('cancel');
        if (tracked) out.add('stock');
        break;
      case 'SOLD_OUT':
        out.add('edit_minor');
        out.add('pause');
        out.add('cancel');
        if (tracked) out.add('stock');
        break;
      case 'PAUSED':
        out.add('edit_minor');
        if (pausedBy === 'MERCHANT') out.add('resume');
        out.add('cancel');
        if (tracked) out.add('stock');
        break;
      default:
        break;
    }
    return [...out];
  }

  inventoryRows(deal: HotRow) {
    return deal.inventory.map((i) => ({
      branchId: i.branchId,
      branchName: { en: i.branch.nameEn, ar: i.branch.nameAr },
      branchStatus: i.branch.status,
      tracked: i.tracked,
      stock: { total: i.total, available: i.available, reserved: i.reserved, redeemed: i.redeemed },
      released: i.released,
    }));
  }

  async build(deal: HotRow, now = new Date()): Promise<HotDealView> {
    const content = parseHotContent(deal.content);
    const latest = await this.core.prisma.hotDealHistory.findFirst({
      where: { dealId: deal.id, byDealDash: true },
      orderBy: { createdAt: 'desc' },
    });
    const urls = await this.files.signedUrls(content.media.map((m) => m.fileId));
    const trust = await this.core.merchantTrust(deal.organizationId);
    const limits = await this.core.limits();
    // the merchant sees the reservation-commitment problems before submitting (RC-21), with the same codes as the refusal
    const issues = [
      ...hotDealIssues(content, { now, limits }),
      ...(await this.core.commitmentIssues(deal.organizationId, content)),
    ];
    return {
      id: deal.id,
      organizationId: deal.organizationId,
      status: deal.status,
      version: deal.version,
      content,
      media: content.media.map((m) => ({
        fileId: m.fileId,
        url: urls.get(m.fileId) ?? null,
        altEn: m.altEn,
        altAr: m.altAr,
      })),
      inventory: this.inventoryRows(deal),
      category: deal.category
        ? {
            id: deal.category.id,
            code: deal.category.code,
            nameEn: deal.category.nameEn,
            nameAr: deal.category.nameAr,
            icon: deal.category.icon,
            sortOrder: deal.category.sortOrder,
            active: deal.category.active,
          }
        : null,
      pausedBy: deal.pausedBy,
      submittedAt: iso(deal.submittedAt),
      publishedAt: iso(deal.publishedAt),
      endedAt: iso(deal.endedAt),
      createdAt: deal.createdAt.toISOString(),
      updatedAt: deal.updatedAt.toISOString(),
      translation: hotTranslationStatus(content),
      issues,
      guardrail: await this.guardrails.evaluate(content, trust, {
        auto: CONFIG_KEYS.HOT_DEAL_AUTO_PUBLISH,
        rules: CONFIG_KEYS.HOT_DEAL_GUARDRAILS,
      }),
      discoverable: hotDiscoverable(deal, now),
      latestDecision: latest ? this.historyView(latest, true) : null,
      allowedActions: this.merchantActions(
        deal.status,
        deal.pausedBy,
        deal.inventory.some((i) => i.tracked),
      ),
      serverNow: now.toISOString(),
    };
  }

  /** History entry. Merchants never see which DealDash employee acted: staff show as "DealDash". */
  historyView(
    h: {
      id: string;
      action: string;
      fromStatus: string | null;
      toStatus: string | null;
      reason: string | null;
      reasonAr: string | null;
      fields: unknown;
      actorRole: string | null;
      actorName: string | null;
      byDealDash: boolean;
      createdAt: Date;
    },
    forMerchant: boolean,
  ) {
    return {
      id: h.id,
      action: h.action as never,
      fromStatus: (h.fromStatus ?? null) as never,
      toStatus: (h.toStatus ?? null) as never,
      reason: h.reason,
      reasonAr: h.reasonAr,
      fields: (h.fields as string[]) ?? [],
      actorRole: forMerchant && h.byDealDash ? 'DEALDASH' : h.actorRole,
      actorName: forMerchant && h.byDealDash ? null : h.actorName,
      byDealDash: h.byDealDash,
      createdAt: h.createdAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------- customer shapes
  private activeInventory(inv: readonly InventoryRow[], city?: string) {
    return inv.filter(
      (i) =>
        i.branch.status === 'ACTIVE' &&
        (!city || i.branch.city.toLowerCase() === city.toLowerCase()),
    );
  }

  async cards(
    rows: HotRow[],
    ctx: Map<string, CardContext>,
    contentOf: (r: HotRow) => HotDealContent = (r) => parseHotContent(r.content),
    now = new Date(),
  ): Promise<HotDealCard[]> {
    const urls = await this.files.signedUrls(
      rows.flatMap((r) => [contentOf(r).media[0]?.fileId, r.organization.merchant?.logoFileId]),
    );
    const threshold = await this.core.showRemainingThreshold();
    return rows.map((r) => this.card(r, contentOf(r), ctx.get(r.id) ?? {}, urls, threshold, now));
  }

  card(
    r: HotRow,
    c: HotDealContent,
    cx: CardContext,
    urls: Map<string, string>,
    threshold: number,
    now: Date,
  ): HotDealCard {
    const inv = this.activeInventory(r.inventory, cx.city);
    const nearestInv = inv.find((i) => i.branchId === cx.nearest?.branchId) ?? inv[0] ?? null;
    const nearest = nearestInv?.branch ?? null;
    const first = c.media[0];
    const showStock = c.limitType !== 'TIME' || c.reservationsEnabled;
    const totalAvailable = inv.reduce((n, i) => n + (i.tracked ? i.available : 0), 0);
    const nearestAvail = nearestInv && nearestInv.tracked ? nearestInv.available : null;
    return {
      id: r.id,
      merchantId: r.organizationId,
      merchantName: merchantDisplayName(r.organization),
      merchantLogoUrl: r.organization.merchant?.logoFileId
        ? (urls.get(r.organization.merchant.logoFileId) ?? null)
        : null,
      title: c.title,
      offerLabel: c.offerLabel,
      shortDescription: c.shortDescription,
      category: r.category
        ? { code: r.category.code, name: { en: r.category.nameEn, ar: r.category.nameAr } }
        : null,
      imageUrl: first ? (urls.get(first.fileId) ?? null) : null,
      imageAlt: { en: first?.altEn || c.title.en, ar: first?.altAr || c.title.ar },
      limitType: c.limitType,
      reservationsEnabled: c.reservationsEnabled,
      // display only: how the customer reserves (walk-in = null); the amount and terms are on the detail
      reservationMethod: commitmentMethodOf(c),
      startsAt: c.startAt,
      endsAt: c.endAt,
      remaining:
        showStock && nearestAvail !== null && nearestAvail <= threshold ? nearestAvail : null,
      remainingTotal:
        showStock && inv.some((i) => i.tracked) && totalAvailable <= threshold
          ? totalAvailable
          : null,
      soldOut: r.status === 'SOLD_OUT',
      distanceMeters: cx.nearest?.distanceMeters ?? null,
      nearestBranch:
        nearest && nearest.latitude !== null && nearest.longitude !== null
          ? {
              id: nearest.id,
              name: { en: nearest.nameEn, ar: nearest.nameAr },
              area: { en: nearest.addressEn, ar: nearest.addressAr },
              latitude: Number(nearest.latitude),
              longitude: Number(nearest.longitude),
            }
          : null,
      branchCount: inv.length,
      eligibility: {
        result: cx.outcome?.result ?? 'ELIGIBLE',
        kind: c.eligibility.kind,
        message: cx.outcome?.message ?? null,
        unlockAction: cx.outcome?.unlockAction ?? null,
      },
      availability: AVAILABILITY[r.status],
      serverNow: now.toISOString(),
    };
  }

  async detail(
    r: HotRow,
    c: HotDealContent,
    cx: CardContext,
    distances: Map<string, number>,
    extra: {
      remainingForMe: number | null;
      myReservations: HotDealDetail['myReservations'];
      restriction: HotDealDetail['restriction'];
    },
    now = new Date(),
  ): Promise<HotDealDetail> {
    const urls = await this.files.signedUrls([
      ...c.media.map((m) => m.fileId),
      r.organization.merchant?.logoFileId,
    ]);
    const threshold = await this.core.showRemainingThreshold();
    const base = this.card(r, c, cx, urls, threshold, now);
    const hold = await this.core.holdMinutes(r);
    const branches = this.activeInventory(r.inventory)
      .map((i) => {
        const b = i.branch;
        const reservable = c.reservationsEnabled && i.tracked;
        const soldOut = reservable && i.available <= 0;
        return {
          id: b.id,
          name: { en: b.nameEn, ar: b.nameAr },
          address: { en: b.addressEn, ar: b.addressAr },
          city: b.city,
          latitude: b.latitude === null ? null : Number(b.latitude),
          longitude: b.longitude === null ? null : Number(b.longitude),
          phone: b.phone ?? null,
          hours: b.hours ?? null,
          distanceMeters: distances.get(b.id) ?? null,
          stock:
            reservable && i.available <= threshold
              ? { available: i.available, total: i.total }
              : null,
          canReserve: reservable && !soldOut && r.status === 'LIVE',
          blockedReason: soldOut ? ('SOLD_OUT' as const) : null,
        };
      })
      .sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
    return {
      ...base,
      description: c.description,
      terms: { blocks: c.terms.blocks, text: { en: c.terms.textEn, ar: c.terms.textAr } },
      media: c.media
        .filter((m) => urls.has(m.fileId))
        .map((m) => ({
          url: urls.get(m.fileId)!,
          alt: { en: m.altEn || c.title.en, ar: m.altAr || c.title.ar },
        })),
      branches: branches as HotDealDetail['branches'],
      holdMinutes: hold,
      unitsTotal: c.reservationsEnabled
        ? this.activeInventory(r.inventory)
            .filter((i) => i.tracked)
            .reduce((n, i) => n + i.total, 0) || null
        : null,
      perCustomerLimit: c.perCustomerLimit,
      commitment: await this.commitmentTerms(r.organizationId, c),
      ...extra,
    };
  }

  /** RC-81: the terms a customer sees and accepts before reserving (null for walk-in deals). */
  async commitmentTerms(
    organizationId: string,
    c: HotDealContent,
  ): Promise<HotDealDetail['commitment']> {
    const method = commitmentMethodOf(c);
    // walk-in and FREE deals carry no payment terms at all (the Stage 4 free promise: nothing about payment is shown)
    if (!method || method === 'FREE') return null;
    const policy = await this.core.reservationPolicy.forDeal(organizationId, c);
    return {
      method,
      amountMinor: c.commitment.amountMinor,
      currency: policy.currency,
      depositRefundable: method === 'DEPOSIT' ? c.commitment.depositRefundable : null,
      depositLateRefund:
        method === 'DEPOSIT'
          ? c.commitment.depositRefundable === true && c.commitment.depositLateRefund === true
          : null,
      depositCredited: method === 'DEPOSIT' ? c.commitment.depositCredited !== false : null,
      cancelCutoffMinutes: c.commitment.cancelCutoffMinutes,
      noShowRefundPercent:
        method === 'FULL_PREPAYMENT'
          ? (c.commitment.noShowRefundPercent ?? policy.fields.prepaymentRefundDefaultPercent)
          : method === 'CARD_PREAUTH'
            ? (c.commitment.noShowRefundPercent ?? 0)
            : null,
      paymentWindowMinutes: policy.fields.paymentWindowMinutes,
      preauthOnRedemption: method === 'CARD_PREAUTH' ? policy.fields.preauthOnRedemption : null,
      preauthImmediateCapture:
        method === 'CARD_PREAUTH' ? policy.fields.preauthImmediateCapture : null,
    };
  }
}
