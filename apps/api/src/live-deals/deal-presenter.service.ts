import { Injectable } from '@nestjs/common';
import type { LiveDealStatus } from '@dealdash/types';
import type { DealCard, DealDetail, LiveDealContent, PublicBranch } from '@dealdash/validation';
import { FilesService } from '../files/files.service';
import type { DealRow } from './deal-core.service';
import type { EligibilityOutcome } from './eligibility.service';

type Branch = DealRow['branches'][number]['branch'];

export interface CardContext {
  outcome?: EligibilityOutcome;
  /** Distance to the nearest participating branch and which branch that is. */
  nearest?: { distanceMeters: number | null; branchId: string | null };
  saved?: boolean;
  /** The browsing city: counts and the fallback pin only consider branches in it. */
  city?: string;
}

const AVAILABILITY: Record<LiveDealStatus, DealCard['availability']> = {
  DRAFT: 'UNAVAILABLE',
  PENDING_REVIEW: 'UNAVAILABLE',
  NEEDS_CHANGES: 'UNAVAILABLE',
  SCHEDULED: 'SCHEDULED',
  LIVE: 'AVAILABLE',
  PAUSED: 'PAUSED',
  EXPIRED: 'ENDED',
  REJECTED: 'UNAVAILABLE',
  SUSPENDED: 'UNAVAILABLE',
};

export const merchantDisplayName = (org: DealRow['organization']) => ({
  en: org.merchant?.tradeNameEn || org.nameEn,
  ar: org.merchant?.tradeNameAr || org.nameAr,
});

/** Turns deal rows into the customer-facing shapes (bilingual text; the client picks the language). */
@Injectable()
export class DealPresenterService {
  constructor(private readonly files: FilesService) {}

  publicBranch(b: Branch, distanceMeters: number | null): PublicBranch {
    return {
      id: b.id,
      name: { en: b.nameEn, ar: b.nameAr },
      address: { en: b.addressEn, ar: b.addressAr },
      city: b.city,
      latitude: b.latitude === null ? null : Number(b.latitude),
      longitude: b.longitude === null ? null : Number(b.longitude),
      phone: b.phone ?? null,
      hours: b.hours ?? null,
      distanceMeters,
    };
  }

  /** Cards for many deals at once (one batch of signed image URLs). `contentOf` lets previews show unpublished content. */
  async cards(
    rows: DealRow[],
    ctx: Map<string, CardContext>,
    contentOf: (row: DealRow) => LiveDealContent,
  ): Promise<DealCard[]> {
    const urls = await this.files.signedUrls(
      rows.flatMap((r) => [contentOf(r).media[0]?.fileId, r.organization.merchant?.logoFileId]),
    );
    return rows.map((r) => this.card(r, contentOf(r), ctx.get(r.id) ?? {}, urls));
  }

  card(r: DealRow, c: LiveDealContent, cx: CardContext, urls: Map<string, string>): DealCard {
    const activeBranches = r.branches
      .map((b) => b.branch)
      .filter(
        (b) =>
          b.status === 'ACTIVE' && (!cx.city || b.city.toLowerCase() === cx.city.toLowerCase()),
      );
    const nearest =
      activeBranches.find((b) => b.id === cx.nearest?.branchId) ?? activeBranches[0] ?? null;
    const first = c.media[0];
    return {
      id: r.id,
      merchantId: r.organizationId,
      merchantName: merchantDisplayName(r.organization),
      merchantLogoUrl: this.urlOf(urls, r.organization.merchant?.logoFileId),
      title: c.title,
      offerLabel: c.offerLabel,
      shortDescription: c.shortDescription,
      category: r.category
        ? { code: r.category.code, name: { en: r.category.nameEn, ar: r.category.nameAr } }
        : null,
      mechanic: c.mechanic,
      imageUrl: first ? (urls.get(first.fileId) ?? null) : null,
      imageAlt: {
        en: first?.altEn || c.title.en,
        ar: first?.altAr || c.title.ar,
      },
      startsAt: c.startAt,
      endsAt: c.endAt,
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
      branchCount: activeBranches.length,
      eligibility: {
        result: cx.outcome?.result ?? 'ELIGIBLE',
        kind: c.eligibility.kind,
        message: cx.outcome?.message ?? null,
        unlockAction: cx.outcome?.unlockAction ?? null,
      },
      saved: cx.saved ?? false,
      availability: AVAILABILITY[r.status],
    };
  }

  /**
   * Full detail. `branches` are the participating branches to show (active ones in discovery; the chosen ones in previews);
   * `distances` maps branch id to metres when the customer shared a location.
   */
  async detail(
    r: DealRow,
    c: LiveDealContent,
    cx: CardContext,
    branches: Branch[],
    distances: Map<string, number>,
  ): Promise<DealDetail> {
    const urls = await this.files.signedUrls([
      ...c.media.map((m) => m.fileId),
      r.organization.merchant?.logoFileId,
    ]);
    const base = this.card(r, c, cx, urls);
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
      branches: branches
        .map((b) => this.publicBranch(b, distances.get(b.id) ?? null))
        .sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity)),
      redemption: { mode: c.redemptionMode },
    };
  }

  urlOf(urls: Map<string, string>, id: string | null | undefined): string | null {
    return id ? (urls.get(id) ?? null) : null;
  }
}
