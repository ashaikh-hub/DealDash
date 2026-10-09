import { Injectable } from '@nestjs/common';
import type { LiveDealStatus } from '@dealdash/types';
import {
  liveDealIssues,
  translationStatus,
  type LiveDealContent,
  type LiveDealView,
} from '@dealdash/validation';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import { parseContent } from './deal-content';
import { DealCoreService, OPEN_REVISION_STATUSES, type DealRow } from './deal-core.service';
import { GuardrailsService } from './guardrails.service';

export type DiscoverableReason =
  'STATUS_NOT_PUBLIC' | 'NOT_STARTED' | 'ENDED' | 'MERCHANT_NOT_ACTIVE' | 'NO_ACTIVE_BRANCH';

/**
 * Whether customers can find the deal RIGHT NOW. Uses the dates directly, so correctness never depends on the
 * background sweep having run. Mirrors the SQL used by discovery (see DiscoveryService.visibleSql).
 */
export function computeDiscoverable(
  deal: Pick<DealRow, 'status' | 'startAt' | 'endAt' | 'organization' | 'branches'>,
  now: Date,
): { visible: boolean; reason: DiscoverableReason | null } {
  if (deal.status !== 'LIVE' && deal.status !== 'SCHEDULED')
    return { visible: false, reason: 'STATUS_NOT_PUBLIC' };
  if (deal.startAt && deal.startAt.getTime() > now.getTime())
    return { visible: false, reason: 'NOT_STARTED' };
  if (deal.endAt && deal.endAt.getTime() <= now.getTime())
    return { visible: false, reason: 'ENDED' };
  if (deal.organization.status !== 'ACTIVE')
    return { visible: false, reason: 'MERCHANT_NOT_ACTIVE' };
  if (!deal.branches.some((b) => b.branch.status === 'ACTIVE'))
    return { visible: false, reason: 'NO_ACTIVE_BRANCH' };
  return { visible: true, reason: null };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Builds the merchant-facing (and admin base) view of a deal. */
@Injectable()
export class DealViewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: DealCoreService,
    private readonly files: FilesService,
    private readonly guardrails: GuardrailsService,
  ) {}

  async mediaViews(content: LiveDealContent, urls: Map<string, string>) {
    return content.media.map((m) => ({
      fileId: m.fileId,
      url: urls.get(m.fileId) ?? null,
      altEn: m.altEn,
      altAr: m.altAr,
    }));
  }

  /** Action names the merchant UI may offer (the API re-checks every one of them). */
  merchantActions(
    status: LiveDealStatus,
    pausedBy: string | null,
    revisionStatus: string | null,
  ): string[] {
    const out = new Set<string>();
    const revisionPending = revisionStatus === 'PENDING_REVIEW';
    switch (status) {
      case 'DRAFT':
      case 'NEEDS_CHANGES':
        out.add('edit');
        out.add('submit');
        break;
      case 'SCHEDULED':
      case 'LIVE':
        if (!revisionPending) out.add('edit');
        out.add('pause');
        out.add('end');
        break;
      case 'PAUSED':
        if (!revisionPending) out.add('edit');
        if (pausedBy === 'MERCHANT') out.add('resume');
        out.add('end');
        break;
      default:
        break;
    }
    if (revisionStatus === 'DRAFT' || revisionStatus === 'NEEDS_CHANGES') {
      out.add('submit');
      out.add('discard_revision');
    }
    if (revisionPending) out.add('discard_revision');
    return [...out];
  }

  async build(deal: DealRow, now = new Date()): Promise<LiveDealView> {
    const content = parseContent(deal.content);
    const [revisionRow, latest] = await Promise.all([
      this.prisma.liveDealRevision.findFirst({
        where: { dealId: deal.id, status: { in: [...OPEN_REVISION_STATUSES] } },
      }),
      this.prisma.liveDealHistory.findFirst({
        where: { dealId: deal.id, byDealDash: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const revisionContent = revisionRow ? parseContent(revisionRow.content) : null;
    const urls = await this.files.signedUrls([
      ...content.media.map((m) => m.fileId),
      ...(revisionContent?.media.map((m) => m.fileId) ?? []),
    ]);
    const trust = await this.core.merchantTrust(deal.organizationId);
    const guardrailTarget = revisionContent ?? content;
    return {
      id: deal.id,
      organizationId: deal.organizationId,
      status: deal.status,
      version: deal.version,
      content,
      media: await this.mediaViews(content, urls),
      branches: deal.branches.map((b) => ({
        id: b.branch.id,
        nameEn: b.branch.nameEn,
        nameAr: b.branch.nameAr,
        status: b.branch.status,
      })),
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
      translation: translationStatus(revisionContent ?? content),
      issues: liveDealIssues(revisionContent ?? content, { now }),
      guardrail: await this.guardrails.evaluate(guardrailTarget, trust),
      discoverable: computeDiscoverable(deal, now),
      revision:
        revisionRow && revisionContent
          ? {
              id: revisionRow.id,
              number: revisionRow.number,
              status: revisionRow.status,
              content: revisionContent,
              media: await this.mediaViews(revisionContent, urls),
              materialFields: (revisionRow.materialFields as string[]) ?? [],
              submittedAt: iso(revisionRow.submittedAt),
              decidedAt: iso(revisionRow.decidedAt),
            }
          : null,
      latestDecision: latest ? this.historyView(latest, true) : null,
      allowedActions: this.merchantActions(deal.status, deal.pausedBy, revisionRow?.status ?? null),
    };
  }

  /** History entry. Merchants never see which DealDash employee acted (privacy): staff show as "DealDash". */
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
}
