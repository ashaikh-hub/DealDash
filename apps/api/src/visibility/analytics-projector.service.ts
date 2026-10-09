import { Injectable, Logger } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import { ANALYTICS_EVENTS, type AnalyticsEventName } from '@dealdash/types';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

/** An event before dimension stamping. */
export interface DraftEvent {
  key: string;
  name: AnalyticsEventName;
  occurredAt: Date;
  organizationId: string | null;
  branchId?: string | null;
  campaignId?: string | null;
  userId?: string | null;
  anonymousId?: string | null;
  city?: string | null;
  quantity?: number;
  amountMinor?: number | null;
  currency?: string | null;
  points?: number | null;
  sourceType: string;
  sourceId: string;
  financeRefType?: string | null;
  financeRefId?: string | null;
  metadata?: Record<string, unknown>;
}

interface Source {
  key: string;
  /** Rows changed at or after `since`, oldest first, with the timestamp that moves the watermark. */
  read: (since: Date, take: number) => Promise<{ ts: Date[]; events: DraftEvent[] }>;
}

/** Overlap re-read on every pass: a row committed late with an earlier timestamp is still seen (events are idempotent). */
const OVERLAP_MS = 2 * 60_000;
const EPOCH = new Date(0);

const DEAL_EVENT_MAP: Record<string, Partial<Record<string, AnalyticsEventName>>> = {
  LIVE: {
    IMPRESSION: 'LIVE_IMPRESSION',
    DETAIL_VIEW: 'LIVE_DETAIL_VIEW',
    MERCHANT_PAGE_VIEW: 'LIVE_MERCHANT_PAGE_VISIT',
    SAVE: 'LIVE_SAVE',
    DIRECTIONS_CLICK: 'LIVE_DIRECTIONS',
    CTA_CLICK: 'LIVE_ONLINE_CLICK',
  },
  HOT: {
    IMPRESSION: 'EXCLUSIVE_IMPRESSION',
    DETAIL_VIEW: 'EXCLUSIVE_VIEW',
    SAVE: 'EXCLUSIVE_SAVE',
    DIRECTIONS_CLICK: 'EXCLUSIVE_DIRECTIONS',
  },
  VOUCHER: { DETAIL_VIEW: 'VOUCHER_VIEW', CHECKOUT_STARTED: 'VOUCHER_CHECKOUT_STARTED' },
  WATCH: { CTA_CLICK: 'WATCH_ACTION' },
};
const POINTS_EVENT: Record<string, AnalyticsEventName> = {
  EARN: 'POINTS_ISSUED',
  BONUS: 'POINTS_ISSUED',
  HOLD: 'POINTS_HELD',
  RELEASE: 'POINTS_RELEASED',
  REDEEM: 'POINTS_REDEEMED',
  EXPIRE: 'POINTS_EXPIRED',
  REVERSE: 'POINTS_REVERSED',
};

/**
 * Phase 4 event framework. Projects the sources of truth (client engagement, reservations, redemptions, orders, payments, vouchers,
 * views, funding, points) into ONE governed taxonomy, incrementally and idempotently, without changing any product service.
 * Client engagement is stored as unverified; verified outcomes come only from server records. Each event is stamped with the
 * organization, legal entity, unit, branch, country, city, product and campaign it belongs to, and keeps its finance reference.
 */
@Injectable()
export class AnalyticsProjector {
  private readonly logger = new Logger('AnalyticsProjector');
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  private sources(): Source[] {
    const p = this.prisma;
    const orgOfOrder = async (ids: string[]) =>
      new Map(
        (
          await p.voucherOrder.findMany({
            where: { id: { in: ids } },
            select: { id: true, organizationId: true, voucherId: true, userId: true },
          })
        ).map((o) => [o.id, o]),
      );
    return [
      {
        key: 'deal_event',
        read: async (since, take) => {
          const rows = await p.dealEvent.findMany({
            where: { occurredAt: { gte: since } },
            orderBy: { occurredAt: 'asc' },
            take,
          });
          const events: DraftEvent[] = [];
          for (const r of rows) {
            const name = DEAL_EVENT_MAP[r.productType]?.[r.type];
            if (!name) continue;
            events.push({
              key: `de:${r.id}`,
              name,
              occurredAt: r.occurredAt,
              organizationId: r.merchantOrgId,
              branchId: r.branchId,
              campaignId: r.dealId,
              userId: r.userId,
              anonymousId: r.anonymousId,
              sourceType: 'DealEvent',
              sourceId: r.id,
            });
          }
          return { ts: rows.map((r) => r.occurredAt), events };
        },
      },
      {
        key: 'reservation',
        read: async (since, take) => {
          const rows = await p.reservation.findMany({
            where: { updatedAt: { gte: since } },
            orderBy: { updatedAt: 'asc' },
            take,
          });
          const events: DraftEvent[] = [];
          for (const r of rows) {
            const base = {
              organizationId: r.organizationId,
              branchId: r.branchId,
              campaignId: r.dealId,
              userId: r.userId,
              quantity: r.quantity,
              sourceType: 'Reservation',
              sourceId: r.id,
            };
            events.push({
              ...base,
              key: `res:${r.id}:issued`,
              name: 'EXCLUSIVE_CREDENTIAL_ISSUED',
              occurredAt: r.createdAt,
            });
            if (r.status === 'CANCELLED')
              events.push({
                ...base,
                key: `res:${r.id}:cancelled`,
                name: 'EXCLUSIVE_RESERVATION_CANCELLED',
                occurredAt: r.cancelledAt ?? r.updatedAt,
              });
            if (r.status === 'EXPIRED')
              events.push({
                ...base,
                key: `res:${r.id}:expired`,
                name: 'EXCLUSIVE_RESERVATION_EXPIRED',
                occurredAt: r.expiresAt,
              });
          }
          return { ts: rows.map((r) => r.updatedAt), events };
        },
      },
      {
        key: 'redemption',
        // redeemed and reversed are both read from the row's latest timestamp
        read: async (since, take) => {
          const rows = await p.redemption.findMany({
            where: { OR: [{ redeemedAt: { gte: since } }, { reversedAt: { gte: since } }] },
            orderBy: { redeemedAt: 'asc' },
            take,
          });
          const qty = new Map(
            (
              await p.reservation.findMany({
                where: { id: { in: rows.map((r) => r.reservationId) } },
                select: { id: true, quantity: true },
              })
            ).map((x) => [x.id, x.quantity]),
          );
          const util = new Map(
            (
              await p.utilizationEvent.findMany({
                where: { sourceType: 'REDEMPTION', sourceId: { in: rows.map((r) => r.id) } },
                select: { id: true, sourceId: true },
              })
            ).map((u) => [u.sourceId, u.id]),
          );
          const events: DraftEvent[] = [];
          for (const r of rows) {
            const base = {
              organizationId: r.organizationId,
              branchId: r.branchId,
              campaignId: r.dealId,
              quantity: qty.get(r.reservationId) ?? 1,
              sourceType: 'Redemption',
              sourceId: r.id,
              financeRefType: util.has(r.id) ? 'UtilizationEvent' : null,
              financeRefId: util.get(r.id) ?? null,
            };
            events.push({
              ...base,
              key: `red:${r.id}`,
              name: 'EXCLUSIVE_REDEMPTION_VERIFIED',
              occurredAt: r.redeemedAt,
            });
            if (r.reversedAt)
              events.push({
                ...base,
                key: `red:${r.id}:reversed`,
                name: 'EXCLUSIVE_REDEMPTION_REVERSED',
                occurredAt: r.reversedAt,
              });
          }
          return {
            ts: rows.map((r) =>
              r.reversedAt && r.reversedAt > r.redeemedAt ? r.reversedAt : r.redeemedAt,
            ),
            events,
          };
        },
      },
      {
        key: 'redemption_attempt',
        read: async (since, take) => {
          const rows = await p.redemptionAttempt.findMany({
            where: { createdAt: { gte: since } },
            orderBy: { createdAt: 'asc' },
            take,
          });
          const failed = rows.filter(
            (r) => r.result !== 'VALID' && r.result !== 'REDEEMED' && r.kind === 'REDEEM',
          );
          const resv = new Map(
            (
              await p.reservation.findMany({
                where: {
                  id: { in: failed.map((r) => r.reservationId).filter((x): x is string => !!x) },
                },
                select: { id: true, dealId: true },
              })
            ).map((x) => [x.id, x.dealId]),
          );
          const inst = new Map(
            (
              await p.voucherInstance.findMany({
                where: {
                  id: {
                    in: failed.map((r) => r.voucherInstanceId).filter((x): x is string => !!x),
                  },
                },
                select: { id: true, voucherId: true },
              })
            ).map((x) => [x.id, x.voucherId]),
          );
          const events: DraftEvent[] = failed.map((r) => ({
            key: `att:${r.id}`,
            name: r.voucherInstanceId
              ? 'VOUCHER_REDEMPTION_REJECTED'
              : 'EXCLUSIVE_REDEMPTION_REJECTED',
            occurredAt: r.createdAt,
            organizationId: r.organizationId,
            branchId: r.branchId,
            campaignId: r.voucherInstanceId
              ? (inst.get(r.voucherInstanceId) ?? null)
              : r.reservationId
                ? (resv.get(r.reservationId) ?? null)
                : null,
            sourceType: 'RedemptionAttempt',
            sourceId: r.id,
            metadata: { result: r.result },
          }));
          return { ts: rows.map((r) => r.createdAt), events };
        },
      },
      {
        key: 'payment',
        read: async (since, take) => {
          const rows = await p.payment.findMany({
            where: {
              updatedAt: { gte: since },
              status: {
                in: ['SUCCEEDED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'REFUND_PENDING'],
              },
            },
            orderBy: { updatedAt: 'asc' },
            take,
          });
          const orders = await orgOfOrder(rows.map((r) => r.orderId));
          const events: DraftEvent[] = [];
          for (const r of rows) {
            const o = orders.get(r.orderId);
            if (!o) continue;
            const ok = r.status !== 'FAILED';
            events.push({
              key: `pay:${r.id}:${ok ? 'ok' : 'failed'}`,
              name: ok ? 'VOUCHER_PAYMENT_SUCCEEDED' : 'VOUCHER_PAYMENT_FAILED',
              occurredAt: r.completedAt ?? r.updatedAt,
              organizationId: o.organizationId,
              campaignId: o.voucherId,
              userId: o.userId,
              amountMinor: r.amountHalalas,
              currency: r.currency,
              sourceType: 'Payment',
              sourceId: r.id,
              financeRefType: 'Payment',
              financeRefId: r.id,
              metadata: ok ? {} : { failureCode: r.failureCode },
            });
          }
          return { ts: rows.map((r) => r.updatedAt), events };
        },
      },
      {
        key: 'voucher_instance',
        read: async (since, take) => {
          const rows = await p.voucherInstance.findMany({
            where: { updatedAt: { gte: since } },
            orderBy: { updatedAt: 'asc' },
            take,
          });
          const events: DraftEvent[] = [];
          for (const r of rows) {
            const base = {
              organizationId: r.organizationId,
              campaignId: r.voucherId,
              userId: r.ownerUserId,
              sourceType: 'VoucherInstance',
              sourceId: r.id,
            };
            events.push({
              ...base,
              key: `vi:${r.id}:issued`,
              name: 'VOUCHER_ISSUED',
              occurredAt: r.issuedAt,
              amountMinor: r.purchasePriceHalalas,
              currency: 'SAR',
            });
            if (r.expiredAt)
              events.push({
                ...base,
                key: `vi:${r.id}:expired`,
                name: 'VOUCHER_EXPIRED',
                occurredAt: r.expiredAt,
              });
          }
          return { ts: rows.map((r) => r.updatedAt), events };
        },
      },
      {
        key: 'voucher_redemption',
        read: async (since, take) => {
          const rows = await p.voucherRedemption.findMany({
            where: { OR: [{ redeemedAt: { gte: since } }, { reversedAt: { gte: since } }] },
            orderBy: { redeemedAt: 'asc' },
            take,
          });
          const events: DraftEvent[] = [];
          for (const r of rows) {
            const base = {
              organizationId: r.organizationId,
              branchId: r.branchId,
              campaignId: r.voucherId,
              sourceType: 'VoucherRedemption',
              sourceId: r.id,
              financeRefType: 'MerchantPayable',
              financeRefId: r.instanceId,
            };
            events.push({
              ...base,
              key: `vr:${r.id}`,
              name: 'VOUCHER_REDEEMED',
              occurredAt: r.redeemedAt,
            });
            if (r.reversedAt)
              events.push({
                ...base,
                key: `vr:${r.id}:reversed`,
                name: 'VOUCHER_REDEMPTION_REVERSED',
                occurredAt: r.reversedAt,
              });
          }
          return {
            ts: rows.map((r) =>
              r.reversedAt && r.reversedAt > r.redeemedAt ? r.reversedAt : r.redeemedAt,
            ),
            events,
          };
        },
      },
      {
        key: 'refund',
        read: async (since, take) => {
          const rows = await p.refund.findMany({
            where: { updatedAt: { gte: since }, status: 'REFUNDED' },
            orderBy: { updatedAt: 'asc' },
            take,
          });
          const orders = await orgOfOrder(rows.map((r) => r.orderId));
          const events: DraftEvent[] = rows.map((r) => ({
            key: `rf:${r.id}`,
            name: 'VOUCHER_REFUNDED' as const,
            occurredAt: r.refundedAt ?? r.updatedAt,
            organizationId: r.organizationId,
            campaignId: orders.get(r.orderId)?.voucherId ?? null,
            userId: orders.get(r.orderId)?.userId ?? null,
            amountMinor: r.amountHalalas,
            currency: 'SAR',
            sourceType: 'Refund',
            sourceId: r.id,
            financeRefType: 'Refund',
            financeRefId: r.id,
          }));
          return { ts: rows.map((r) => r.updatedAt), events };
        },
      },
      {
        key: 'watch_view',
        read: async (since, take) => {
          const rows = await p.watchView.findMany({
            where: { OR: [{ lastEventAt: { gte: since } }, { creditedBackAt: { gte: since } }] },
            orderBy: { lastEventAt: 'asc' },
            take,
          });
          const camps = new Map(
            (
              await p.watchCampaign.findMany({
                where: { id: { in: [...new Set(rows.map((r) => r.campaignId))] } },
                select: { id: true, organizationId: true },
              })
            ).map((c) => [c.id, c.organizationId]),
          );
          const events: DraftEvent[] = [];
          for (const r of rows) {
            const base = {
              organizationId: camps.get(r.campaignId) ?? null,
              campaignId: r.campaignId,
              userId: r.userId,
              city: r.city,
              sourceType: 'WatchView',
              sourceId: r.id,
            };
            events.push({
              ...base,
              key: `wv:${r.id}:served`,
              name: 'WATCH_VIDEO_SERVED',
              occurredAt: r.startedAt,
            });
            if (r.watchedSeconds > 0)
              events.push({
                ...base,
                key: `wv:${r.id}:started`,
                name: 'WATCH_VIEW_STARTED',
                occurredAt: r.startedAt,
              });
            if (r.completedAt)
              events.push({
                ...base,
                key: `wv:${r.id}:completed`,
                name: 'WATCH_VIEW_COMPLETED',
                occurredAt: r.completedAt,
              });
            if (r.qualifiedAt && (r.status === 'QUALIFIED' || r.status === 'CREDITED_BACK'))
              events.push({
                ...base,
                key: `wv:${r.id}:qualified`,
                name: 'WATCH_QUALIFIED_VIEW',
                occurredAt: r.qualifiedAt,
                amountMinor: r.chargeHalalas,
                currency: 'SAR',
                financeRefType: r.consumptionJournalId ? 'LedgerJournal' : null,
                financeRefId: r.consumptionJournalId,
              });
            if (r.status === 'CREDITED_BACK' && r.qualifiedAt)
              events.push({
                ...base,
                key: `wv:${r.id}:credited_back`,
                name: 'WATCH_VIEW_CREDITED_BACK',
                occurredAt: r.creditedBackAt ?? r.lastEventAt,
                amountMinor: r.chargeHalalas,
                currency: 'SAR',
              });
            if (r.status === 'INVALID' || r.status === 'CAPPED')
              events.push({
                ...base,
                key: `wv:${r.id}:rejected`,
                name: 'WATCH_VIEW_REJECTED',
                occurredAt: r.lastEventAt,
                metadata: { reason: r.reason },
              });
            if (r.riskDecision === 'HOLD' || r.riskDecision === 'BLOCK')
              events.push({
                ...base,
                key: `wv:${r.id}:risk`,
                name: 'WATCH_FRAUD_HOLD',
                occurredAt: r.qualifiedAt ?? r.lastEventAt,
                metadata: { decision: r.riskDecision },
              });
          }
          return {
            ts: rows.map((r) =>
              r.creditedBackAt && r.creditedBackAt > r.lastEventAt
                ? r.creditedBackAt
                : r.lastEventAt,
            ),
            events,
          };
        },
      },
      {
        key: 'watch_funding',
        read: async (since, take) => {
          const rows = await p.watchFunding.findMany({
            where: { createdAt: { gte: since } },
            orderBy: { createdAt: 'asc' },
            take,
          });
          const events: DraftEvent[] = rows.map((r) => ({
            key: `wf:${r.id}`,
            name: 'WATCH_FUNDED' as const,
            occurredAt: r.createdAt,
            organizationId: r.organizationId,
            campaignId: r.campaignId,
            amountMinor: r.amountHalalas,
            currency: 'SAR',
            sourceType: 'WatchFunding',
            sourceId: r.id,
            financeRefType: r.journalId ? 'LedgerJournal' : null,
            financeRefId: r.journalId,
          }));
          return { ts: rows.map((r) => r.createdAt), events };
        },
      },
      {
        key: 'reward_entry',
        read: async (since, take) => {
          const rows = await p.rewardEntry.findMany({
            where: { createdAt: { gte: since } },
            orderBy: { createdAt: 'asc' },
            take,
          });
          const accounts = new Map(
            (
              await p.rewardAccount.findMany({
                where: { id: { in: [...new Set(rows.map((r) => r.accountId))] } },
                select: { id: true, userId: true },
              })
            ).map((a) => [a.id, a.userId]),
          );
          const owners = await this.campaignOwners(
            rows.map((r) => ({ product: r.sourceProduct, id: r.sourceCampaignId })),
          );
          const events: DraftEvent[] = [];
          for (const r of rows) {
            const name = POINTS_EVENT[r.type];
            if (!name) continue;
            const owner =
              r.fundingOrganizationId ??
              (r.sourceCampaignId ? (owners.get(r.sourceCampaignId) ?? null) : null);
            events.push({
              key: `pe:${r.id}`,
              name,
              occurredAt: r.createdAt,
              organizationId: owner,
              campaignId: r.sourceCampaignId,
              userId: accounts.get(r.accountId) ?? null,
              points: Math.abs(r.points),
              sourceType: 'RewardEntry',
              sourceId: r.id,
              financeRefType: r.financialRef ? 'FinancialRef' : null,
              financeRefId: r.financialRef,
              metadata: { fundingSource: r.fundingSource, sourceProduct: r.sourceProduct },
            });
          }
          return { ts: rows.map((r) => r.createdAt), events };
        },
      },
      {
        key: 'reward_redemption',
        read: async (since, take) => {
          const rows = await p.rewardRedemption.findMany({
            where: { createdAt: { gte: since } },
            orderBy: { createdAt: 'asc' },
            take,
          });
          const accounts = new Map(
            (
              await p.rewardAccount.findMany({
                where: { id: { in: [...new Set(rows.map((r) => r.accountId))] } },
                select: { id: true, userId: true },
              })
            ).map((a) => [a.id, a.userId]),
          );
          const items = new Map(
            (
              await p.rewardCatalogueItem.findMany({
                where: { id: { in: [...new Set(rows.map((r) => r.itemId))] } },
                select: { id: true, ownerOrganizationId: true },
              })
            ).map((i) => [i.id, i.ownerOrganizationId]),
          );
          const events: DraftEvent[] = rows.map((r) => ({
            key: `rr:${r.id}`,
            name: 'REWARD_ALLOCATED' as const,
            occurredAt: r.createdAt,
            organizationId: items.get(r.itemId) ?? null,
            userId: accounts.get(r.accountId) ?? null,
            points: r.pointsCost,
            sourceType: 'RewardRedemption',
            sourceId: r.id,
          }));
          return { ts: rows.map((r) => r.createdAt), events };
        },
      },
    ];
  }

  /** Which business owns a campaign (for points earned through it). */
  private async campaignOwners(refs: Array<{ product: string | null; id: string | null }>) {
    const ids = (product: string) => [
      ...new Set(refs.filter((r) => r.product === product && r.id).map((r) => r.id!)),
    ];
    const out = new Map<string, string>();
    const p = this.prisma;
    for (const c of await p.watchCampaign.findMany({
      where: { id: { in: ids('WATCH') } },
      select: { id: true, organizationId: true },
    }))
      out.set(c.id, c.organizationId);
    for (const c of await p.hotDeal.findMany({
      where: { id: { in: ids('EXCLUSIVE') } },
      select: { id: true, organizationId: true },
    }))
      out.set(c.id, c.organizationId);
    for (const c of await p.voucher.findMany({
      where: { id: { in: ids('VOUCHER') } },
      select: { id: true, organizationId: true },
    }))
      out.set(c.id, c.organizationId);
    for (const c of await p.liveDeal.findMany({
      where: { id: { in: ids('LIVE') } },
      select: { id: true, organizationId: true },
    }))
      out.set(c.id, c.organizationId);
    return out;
  }

  /** Branch -> unit, legal entity, country and city (the unit tree; nearest ancestor wins). */
  private async dimensions(events: DraftEvent[]) {
    const branchIds = [...new Set(events.map((e) => e.branchId).filter((x): x is string => !!x))];
    const orgIds = [
      ...new Set(events.map((e) => e.organizationId).filter((x): x is string => !!x)),
    ];
    const branches = new Map(
      (
        await this.prisma.merchantBranch.findMany({
          where: { id: { in: branchIds } },
          select: { id: true, city: true, country: true },
        })
      ).map((b) => [b.id, b]),
    );
    const units = await this.prisma.organizationUnit.findMany({
      where: { organizationId: { in: orgIds } },
      select: {
        id: true,
        path: true,
        branchId: true,
        legalEntityId: true,
        country: true,
        city: true,
      },
    });
    const byId = new Map(units.map((u) => [u.id, u]));
    const unitOfBranch = new Map(units.filter((u) => u.branchId).map((u) => [u.branchId!, u]));
    // the organization's first legal entity: the default for events that have no branch (orders, views, funding)
    const firstLe = new Map<string, string>();
    for (const le of await this.prisma.legalEntity.findMany({
      where: { organizationId: { in: orgIds }, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, organizationId: true },
    }))
      if (!firstLe.has(le.organizationId)) firstLe.set(le.organizationId, le.id);
    const orgCountry = new Map(
      (
        await this.prisma.legalEntity.findMany({
          where: { organizationId: { in: orgIds } },
          orderBy: { createdAt: 'asc' },
          select: { organizationId: true, country: true },
        })
      )
        .reverse()
        .map((l) => [l.organizationId, l.country]),
    );
    return (e: DraftEvent) => {
      const b = e.branchId ? branches.get(e.branchId) : undefined;
      const u = e.branchId ? unitOfBranch.get(e.branchId) : undefined;
      let legalEntityId: string | null = null;
      let country: string | null = b?.country ?? null;
      let city: string | null = e.city ?? b?.city ?? null;
      if (u) {
        const chain = u.path.split('/').filter(Boolean).reverse();
        for (const id of chain) {
          const x = byId.get(id);
          if (!x) continue;
          legalEntityId ??= x.legalEntityId;
          country ??= x.country;
          city ??= x.city;
        }
      }
      if (!legalEntityId && e.organizationId) legalEntityId = firstLe.get(e.organizationId) ?? null;
      if (!country && e.organizationId) country = orgCountry.get(e.organizationId) ?? null;
      return { unitId: u?.id ?? null, legalEntityId, country, city };
    };
  }

  /** True when a source returned a full batch in the last pass (more rows are waiting). */
  private lastPassFull = false;

  /** Source keys (one watermark each). */
  sourceKeys(): string[] {
    return this.sources().map((s) => s.key);
  }

  /** Passes until no source has a full batch waiting (bounded). Returns the number of new events. */
  async catchUp(maxPasses = 50): Promise<number> {
    let total = 0;
    for (let i = 0; i < maxPasses; i++) {
      total += await this.project();
      if (!this.lastPassFull) break;
    }
    return total;
  }

  /** Runs every source once (bounded batch each). Returns the number of new events. */
  async project(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const cfg = await this.config.get<{ projectorBatch?: number }>(
        CONFIG_KEYS.VISIBILITY_ANALYTICS,
      );
      const take = cfg?.projectorBatch ?? 2000;
      let created = 0;
      this.lastPassFull = false;
      for (const s of this.sources()) {
        const wm = await this.prisma.analyticsWatermark.findUnique({ where: { source: s.key } });
        const since = wm ? new Date(wm.cursorAt.getTime() - OVERLAP_MS) : EPOCH;
        const { ts, events } = await s.read(since, take);
        if (ts.length >= take) this.lastPassFull = true;
        if (events.length) created += await this.write(events);
        if (ts.length) {
          const max = new Date(Math.max(...ts.map((t) => t.getTime())));
          if (!wm || max > wm.cursorAt)
            await this.prisma.analyticsWatermark.upsert({
              where: { source: s.key },
              update: { cursorAt: max },
              create: { source: s.key, cursorAt: max },
            });
        }
      }
      return created;
    } catch (e) {
      this.logger.warn(`Projection pass failed: ${(e as Error).message}`);
      throw e;
    } finally {
      this.running = false;
    }
  }

  /** Writes events idempotently (an existing key is skipped). Also used by services that emit events directly. */
  async write(events: DraftEvent[]): Promise<number> {
    if (!events.length) return 0;
    const dim = await this.dimensions(events);
    const data: Prisma.AnalyticsEventCreateManyInput[] = events.map((e) => {
      const d = ANALYTICS_EVENTS[e.name];
      const x = dim(e);
      return {
        idempotencyKey: e.key,
        name: e.name,
        product: d.product,
        eventClass: d.cls,
        verified: d.serverOnly,
        occurredAt: e.occurredAt,
        organizationId: e.organizationId,
        legalEntityId: x.legalEntityId,
        unitId: x.unitId,
        branchId: e.branchId ?? null,
        campaignId: e.campaignId ?? null,
        country: x.country,
        city: x.city,
        userId: e.userId ?? null,
        anonymousId: e.anonymousId ?? null,
        quantity: e.quantity ?? 1,
        amountMinor: e.amountMinor ?? null,
        currency: e.currency ?? null,
        points: e.points ?? null,
        sourceType: e.sourceType,
        sourceId: e.sourceId,
        financeRefType: e.financeRefType ?? null,
        financeRefId: e.financeRefId ?? null,
        metadata: (e.metadata ?? {}) as Prisma.InputJsonValue,
      };
    });
    let n = 0;
    for (let i = 0; i < data.length; i += 500)
      n += (
        await this.prisma.analyticsEvent.createMany({
          data: data.slice(i, i + 500),
          skipDuplicates: true,
        })
      ).count;
    return n;
  }
}
