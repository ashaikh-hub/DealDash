import { Injectable } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import type { VoucherStatus } from '@dealdash/types';
import {
  CHECKOUT_TERMS_VERSION,
  voucherIssues,
  voucherSavings,
  voucherTranslationStatus,
  type VoucherCard,
  type VoucherContent,
  type VoucherDetail,
  type VoucherView,
} from '@dealdash/validation';
import { FilesService } from '../files/files.service';
import { merchantDisplayName, type CardContext } from '../live-deals/deal-presenter.service';
import { GuardrailsService, type GuardrailResult } from '../live-deals/guardrails.service';
import { parseVoucherContent } from './voucher-content';
import { VoucherCoreService, type VoucherRow } from './voucher-core.service';

/** Remaining vouchers are shown to customers only when few are left. */
export const VOUCHER_SHOW_REMAINING_THRESHOLD = 20;

const AVAILABILITY: Record<VoucherStatus, VoucherCard['availability']> = {
  DRAFT: 'UNAVAILABLE',
  PENDING_REVIEW: 'UNAVAILABLE',
  NEEDS_CHANGES: 'UNAVAILABLE',
  REJECTED: 'UNAVAILABLE',
  SCHEDULED: 'SCHEDULED',
  ON_SALE: 'AVAILABLE',
  PAUSED: 'PAUSED',
  SOLD_OUT: 'SOLD_OUT',
  ENDED: 'ENDED',
  SUSPENDED: 'UNAVAILABLE',
};

export type VoucherDiscoverableReason =
  'STATUS_NOT_PUBLIC' | 'NOT_STARTED' | 'ENDED' | 'MERCHANT_NOT_ACTIVE' | 'NO_ACTIVE_BRANCH';

/** Whether customers can find the voucher RIGHT NOW (dates read directly, so it never depends on a sweep having run). */
export function voucherDiscoverable(
  v: Pick<VoucherRow, 'status' | 'saleStartAt' | 'saleEndAt' | 'organization' | 'branches'>,
  now: Date,
): { visible: boolean; reason: VoucherDiscoverableReason | null } {
  if (v.status !== 'ON_SALE' && v.status !== 'SOLD_OUT')
    return { visible: false, reason: 'STATUS_NOT_PUBLIC' };
  if (v.saleStartAt && v.saleStartAt.getTime() > now.getTime())
    return { visible: false, reason: 'NOT_STARTED' };
  if (v.saleEndAt && v.saleEndAt.getTime() <= now.getTime())
    return { visible: false, reason: 'ENDED' };
  if (v.organization.status !== 'ACTIVE') return { visible: false, reason: 'MERCHANT_NOT_ACTIVE' };
  if (!v.branches.some((b) => b.branch.status === 'ACTIVE'))
    return { visible: false, reason: 'NO_ACTIVE_BRANCH' };
  return { visible: true, reason: null };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Builds the merchant/admin view of a Voucher and the customer-facing card/detail shapes. */
@Injectable()
export class VoucherViewService {
  constructor(
    private readonly core: VoucherCoreService,
    private readonly files: FilesService,
    private readonly guardrails: GuardrailsService,
  ) {}

  // ---------------------------------------------------------------- guardrails (pilot: every voucher goes to manual review)
  async guardrail(content: VoucherContent, trust: Parameters<GuardrailsService['evaluate']>[1]) {
    const base: GuardrailResult = await this.guardrails.evaluate(
      {
        mechanic: null,
        valueNumber: null,
        title: content.title,
        description: content.description,
        terms: { textEn: content.terms.textEn, textAr: content.terms.textAr },
      },
      trust,
      { auto: CONFIG_KEYS.VOUCHER_AUTO_PUBLISH, rules: CONFIG_KEYS.VOUCHER_GUARDRAILS },
    );
    const reasons = [...base.reasons];
    const limits = await this.core.limits();
    const s = voucherSavings(content.faceValueHalalas, content.sellingPriceHalalas);
    if (s.savingsPercent > limits.reviewAboveDiscountPercent) reasons.push('DISCOUNT_ABOVE_RANGE');
    if (content.faceValueHalalas > limits.maxFaceValueHalalas / 2) reasons.push('HIGH_FACE_VALUE');
    if (content.totalQty > limits.maxQtyPerVoucher / 2) reasons.push('LARGE_INVENTORY');
    const uniq = [...new Set(reasons)];
    return {
      outcome: uniq.length ? ('MANUAL_REVIEW' as const) : ('AUTO_PUBLISH' as const),
      reasons: uniq,
    };
  }

  // ---------------------------------------------------------------- merchant / admin view
  merchantActions(status: VoucherStatus, pausedBy: string | null): string[] {
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
        out.add('end');
        break;
      case 'ON_SALE':
      case 'SOLD_OUT':
        out.add('edit_minor');
        out.add('pause');
        out.add('end');
        out.add('stock');
        break;
      case 'PAUSED':
        out.add('edit_minor');
        if (pausedBy === 'MERCHANT') out.add('resume');
        out.add('end');
        out.add('stock');
        break;
      default:
        break;
    }
    return [...out];
  }

  stockOf(v: Pick<VoucherRow, 'totalQty' | 'heldQty' | 'soldQty'>) {
    return {
      total: v.totalQty,
      held: v.heldQty,
      sold: v.soldQty,
      remaining: Math.max(0, v.totalQty - v.heldQty - v.soldQty),
    };
  }

  async build(v: VoucherRow, now = new Date()): Promise<VoucherView> {
    const content = parseVoucherContent(v.content);
    const latest = await this.core.prisma.voucherHistory.findFirst({
      where: { voucherId: v.id, byDealDash: true },
      orderBy: { createdAt: 'desc' },
    });
    const urls = await this.files.signedUrls(content.media.map((m) => m.fileId));
    const trust = await this.core.merchantTrust(v.organizationId);
    const limits = await this.core.limits();
    return {
      id: v.id,
      organizationId: v.organizationId,
      status: v.status,
      version: v.version,
      content,
      media: content.media.map((m) => ({
        fileId: m.fileId,
        url: urls.get(m.fileId) ?? null,
        altEn: m.altEn,
        altAr: m.altAr,
      })),
      stock: this.stockOf(v),
      category: v.category
        ? {
            id: v.category.id,
            code: v.category.code,
            nameEn: v.category.nameEn,
            nameAr: v.category.nameAr,
            icon: v.category.icon,
            sortOrder: v.category.sortOrder,
            active: v.category.active,
          }
        : null,
      savings: voucherSavings(content.faceValueHalalas, content.sellingPriceHalalas),
      pausedBy: v.pausedBy,
      submittedAt: iso(v.submittedAt),
      publishedAt: iso(v.publishedAt),
      endedAt: iso(v.endedAt),
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
      translation: voucherTranslationStatus(content),
      issues: voucherIssues(content, { now, limits }),
      guardrail: await this.guardrail(content, trust),
      discoverable: voucherDiscoverable(v, now),
      latestDecision: latest ? this.historyView(latest, true) : null,
      allowedActions: this.merchantActions(v.status, v.pausedBy),
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
  private activeBranches(v: VoucherRow, city?: string) {
    return v.branches.filter(
      (b) =>
        b.branch.status === 'ACTIVE' &&
        (!city || b.branch.city.toLowerCase() === city.toLowerCase()),
    );
  }

  async cards(
    rows: VoucherRow[],
    ctx: Map<string, CardContext>,
    now = new Date(),
  ): Promise<VoucherCard[]> {
    const urls = await this.files.signedUrls(
      rows.flatMap((r) => [
        parseVoucherContent(r.content).media[0]?.fileId,
        r.organization.merchant?.logoFileId,
      ]),
    );
    return rows.map((r) =>
      this.card(r, parseVoucherContent(r.content), ctx.get(r.id) ?? {}, urls, now),
    );
  }

  card(
    r: VoucherRow,
    c: VoucherContent,
    cx: CardContext,
    urls: Map<string, string>,
    now: Date,
  ): VoucherCard {
    const branches = this.activeBranches(r, cx.city);
    const nearest =
      (branches.find((b) => b.branchId === cx.nearest?.branchId) ?? branches[0])?.branch ?? null;
    const first = c.media[0];
    const stock = this.stockOf(r);
    const s = voucherSavings(r.faceValueHalalas, r.sellingPriceHalalas);
    return {
      id: r.id,
      merchantId: r.organizationId,
      merchantName: merchantDisplayName(r.organization),
      merchantLogoUrl: r.organization.merchant?.logoFileId
        ? (urls.get(r.organization.merchant.logoFileId) ?? null)
        : null,
      title: c.title,
      shortDescription: c.shortDescription,
      category: r.category
        ? { code: r.category.code, name: { en: r.category.nameEn, ar: r.category.nameAr } }
        : null,
      imageUrl: first ? (urls.get(first.fileId) ?? null) : null,
      imageAlt: { en: first?.altEn || c.title.en, ar: first?.altAr || c.title.ar },
      faceValueHalalas: r.faceValueHalalas,
      sellingPriceHalalas: r.sellingPriceHalalas,
      reportedSavingsHalalas: s.savingsHalalas,
      reportedSavingsPercent: s.savingsPercent,
      currency: 'SAR',
      validity: c.validity,
      saleEndsAt: iso(r.saleEndAt),
      remaining: stock.remaining <= VOUCHER_SHOW_REMAINING_THRESHOLD ? stock.remaining : null,
      soldOut: r.status === 'SOLD_OUT' || stock.remaining <= 0,
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
      branchCount: branches.length,
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
    r: VoucherRow,
    c: VoucherContent,
    cx: CardContext,
    distances: Map<string, number>,
    extra: { remainingForMe: number | null; limitReached: boolean },
    now = new Date(),
  ): Promise<VoucherDetail> {
    const urls = await this.files.signedUrls([
      ...c.media.map((m) => m.fileId),
      r.organization.merchant?.logoFileId,
    ]);
    const base = this.card(r, c, cx, urls, now);
    const branches = this.activeBranches(r)
      .map((x) => {
        const b = x.branch;
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
        };
      })
      .sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
    const stock = this.stockOf(r);
    const locked = (cx.outcome?.result ?? 'ELIGIBLE') !== 'ELIGIBLE';
    let blockedReason: VoucherDetail['blockedReason'] = null;
    if (r.status === 'SOLD_OUT' || (r.status === 'ON_SALE' && stock.remaining <= 0))
      blockedReason = 'SOLD_OUT';
    else if (r.status !== 'ON_SALE') blockedReason = 'NOT_ON_SALE';
    else if (r.saleEndAt && r.saleEndAt.getTime() <= now.getTime()) blockedReason = 'ENDED';
    else if (locked) blockedReason = 'LOCKED';
    else if (extra.limitReached) blockedReason = 'LIMIT_REACHED';
    return {
      ...base,
      description: c.description,
      redemptionRules: c.redemptionRules,
      terms: { blocks: c.terms.blocks, text: { en: c.terms.textEn, ar: c.terms.textAr } },
      media: c.media
        .filter((m) => urls.has(m.fileId))
        .map((m) => ({
          url: urls.get(m.fileId)!,
          alt: { en: m.altEn || c.title.en, ar: m.altAr || c.title.ar },
        })),
      branches: branches as VoucherDetail['branches'],
      perCustomerLimit: r.perCustomerLimit,
      remainingForMe: extra.remainingForMe,
      termsVersion: CHECKOUT_TERMS_VERSION,
      canBuy: blockedReason === null,
      blockedReason,
    };
  }
}
