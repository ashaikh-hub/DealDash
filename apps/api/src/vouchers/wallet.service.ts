import { Injectable } from '@nestjs/common';
import type { WalletState } from '@dealdash/types';
import type { WalletDetail, WalletItem } from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import { FilesService } from '../files/files.service';
import { formatManualCode } from '../hot-deals/hot-content';
import { merchantDisplayName } from '../live-deals/deal-presenter.service';
import { parseVoucherContent, voucherQrText } from './voucher-content';
import { VoucherCoreService } from './voucher-core.service';
import { VoucherEventsService } from './voucher-events.service';
import { RefundsService } from './refunds.service';

const INCLUDE = {
  voucher: {
    include: {
      organization: { include: { merchant: true } },
      branches: { include: { branch: true } },
    },
  },
  order: { select: { reference: true } },
  refunds: { orderBy: { createdAt: 'desc' as const }, take: 1 },
} satisfies Prisma.VoucherInstanceInclude;
type Row = Prisma.VoucherInstanceGetPayload<{ include: typeof INCLUDE }>;

/** My Vouchers: the customer's own instruments, their state, and (only while redeemable) the QR and manual code. */
@Injectable()
export class WalletService {
  constructor(
    private readonly core: VoucherCoreService,
    private readonly files: FilesService,
    private readonly events: VoucherEventsService,
    private readonly refunds: RefundsService,
  ) {}

  private get prisma() {
    return this.core.prisma;
  }

  /** Customer-facing state. A refund in progress reads "refund pending", never an alarming or ambiguous status. */
  stateOf(r: Row, now: Date): WalletState {
    const refund = r.refunds[0];
    switch (r.status) {
      case 'REDEEMED':
        return 'USED';
      case 'REFUNDED':
        return 'REFUNDED';
      case 'EXPIRED':
        return 'EXPIRED';
      case 'VOIDED':
        return refund && ['APPROVED', 'PROCESSING', 'FAILED'].includes(refund.status)
          ? 'REFUND_PENDING'
          : 'VOIDED';
      default:
        return r.expiresAt.getTime() <= now.getTime() ? 'EXPIRED' : 'ACTIVE';
    }
  }

  private async item(r: Row, urls: Map<string, string>, now: Date): Promise<WalletItem> {
    const c = parseVoucherContent(r.voucher.content);
    const first = c.media[0];
    return {
      id: r.id,
      reference: r.reference,
      state: this.stateOf(r, now),
      voucherId: r.voucherId,
      title: c.title,
      merchantName: merchantDisplayName(r.voucher.organization),
      imageUrl: first ? (urls.get(first.fileId) ?? null) : null,
      purchasePriceHalalas: r.purchasePriceHalalas,
      faceValueHalalas: r.faceValueHalalas,
      currency: r.voucher.currency,
      validFrom: r.validFrom ? r.validFrom.toISOString() : null,
      expiresAt: r.expiresAt.toISOString(),
      issuedAt: r.issuedAt.toISOString(),
      redeemedAt: r.redeemedAt ? r.redeemedAt.toISOString() : null,
      branchCount: r.voucher.branches.length,
    };
  }

  async list(
    userId: string,
    tab: 'active' | 'used' | 'expired' | 'refunded',
    limit: number,
    now = new Date(),
  ) {
    const where: Prisma.VoucherInstanceWhereInput =
      tab === 'active'
        ? { status: 'ACTIVE', expiresAt: { gt: now } }
        : tab === 'used'
          ? { status: 'REDEEMED' }
          : tab === 'expired'
            ? { OR: [{ status: 'EXPIRED' }, { status: 'ACTIVE', expiresAt: { lte: now } }] }
            : { status: { in: ['REFUNDED', 'VOIDED'] } };
    const rows = await this.prisma.voucherInstance.findMany({
      where: { ownerUserId: userId, ...where },
      include: INCLUDE,
      orderBy: tab === 'active' ? { expiresAt: 'asc' } : { updatedAt: 'desc' },
      take: limit,
    });
    const urls = await this.files.signedUrls(
      rows.map((r) => parseVoucherContent(r.voucher.content).media[0]?.fileId),
    );
    return Promise.all(rows.map((r) => this.item(r, urls, now)));
  }

  async detail(userId: string, id: string, now = new Date()): Promise<WalletDetail> {
    const r = await this.prisma.voucherInstance.findFirst({
      where: { id, ownerUserId: userId },
      include: INCLUDE,
    });
    if (!r) throw AppError.notFound();
    const c = parseVoucherContent(r.voucher.content);
    const urls = await this.files.signedUrls(c.media.map((m) => m.fileId));
    const base = await this.item(r, urls, now);
    const state = base.state;
    const refund = r.refunds[0] ?? null;
    const policy = await this.core.refundPolicy();
    const windowEnd = new Date(r.issuedAt.getTime() + policy.windowHours * 3_600_000);
    const within = now.getTime() <= windowEnd.getTime();
    const openRefund = !!refund && refund.status !== 'REJECTED';
    let canRequestRefund = false;
    let refundNote: WalletDetail['refundNote'] = null;
    if (state === 'ACTIVE' && !openRefund) {
      if (within) canRequestRefund = true;
      else if (policy.outsideWindow === 'REVIEW') {
        canRequestRefund = true;
        refundNote = 'REVIEW_REQUIRED';
      } else refundNote = 'WINDOW_PASSED';
    } else if (state === 'USED') refundNote = 'REDEEMED';
    else if (state !== 'ACTIVE' || openRefund) refundNote = 'NOT_AVAILABLE';
    const openCase = await this.prisma.supportCase.count({
      where: { voucherInstanceId: r.id, status: { not: 'RESOLVED' } },
    });
    // wallet view analytics, at most once per half hour per voucher and customer
    const recent = await this.prisma.dealEvent.findFirst({
      where: {
        type: 'WALLET_VIEWED',
        productType: 'VOUCHER',
        dealId: r.voucherId,
        userId,
        occurredAt: { gte: new Date(now.getTime() - 30 * 60_000) },
      },
      select: { id: true },
    });
    if (!recent) {
      const sent = await this.events.record(
        null,
        'WALLET_VIEWED',
        { voucherId: r.voucherId, organizationId: r.organizationId },
        userId,
        'voucher.wallet_viewed',
        { instanceId: r.id },
      );
      sent();
    }
    return {
      ...base,
      description: c.description,
      redemptionRules: c.redemptionRules,
      terms: { blocks: c.terms.blocks, text: { en: c.terms.textEn, ar: c.terms.textAr } },
      merchantId: r.organizationId,
      branches: r.voucher.branches
        .filter((b) => b.branch.status === 'ACTIVE')
        .map((b) => ({
          id: b.branch.id,
          name: { en: b.branch.nameEn, ar: b.branch.nameAr },
          address: { en: b.branch.addressEn, ar: b.branch.addressAr },
          city: b.branch.city,
          latitude: b.branch.latitude === null ? null : Number(b.branch.latitude),
          longitude: b.branch.longitude === null ? null : Number(b.branch.longitude),
          phone: b.branch.phone ?? null,
          hours: b.branch.hours ?? null,
          distanceMeters: null,
        })),
      orderReference: r.order.reference,
      // the code is shown only while the voucher can actually be redeemed
      code:
        state === 'ACTIVE'
          ? { qr: voucherQrText(r.qrToken), manual: formatManualCode(r.manualCode) }
          : null,
      refund: refund ? this.refunds.view(refund) : null,
      canRequestRefund,
      refundWindowEndsAt: state === 'ACTIVE' ? windowEnd.toISOString() : null,
      refundNote,
      supportCaseOpen: openCase > 0,
      serverNow: now.toISOString(),
    };
  }
}
