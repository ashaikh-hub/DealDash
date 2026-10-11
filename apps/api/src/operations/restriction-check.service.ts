import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Stage 8: the one read of ACTIVE governed restrictions, used by the existing enforcement points (reservation, purchase and
 * Watch & Earn entry points; staff redemption at a branch). Restrictions stop NEW actions only: an issued voucher, a held
 * reservation or an earned reward is never invalidated by them (it can still be used elsewhere or when the hold is lifted).
 */
@Injectable()
export class RestrictionCheckService {
  constructor(private readonly prisma: PrismaService) {}

  private active(kind: string, subjectType: string, subjectId: string, scope?: string) {
    const now = new Date();
    return this.prisma.operationalRestriction.findFirst({
      where: {
        kind,
        subjectType,
        subjectId,
        status: 'ACTIVE',
        startsAt: { lte: now },
        endsAt: { gt: now },
        ...(scope ? { scope: { has: scope } } : {}),
      },
      select: { id: true, reference: true, endsAt: true },
    });
  }

  /** A customer under a temporary restriction cannot start the action (NEW_RESERVATIONS / NEW_PURCHASES / NEW_VIEWS). */
  async assertCustomerAllowed(
    userId: string,
    scope: 'NEW_RESERVATIONS' | 'NEW_PURCHASES' | 'NEW_VIEWS',
  ) {
    const r = await this.active('CUSTOMER_RESTRICTION', 'USER', userId, scope);
    if (r)
      throw new AppError(
        'RESTRICTION_ACTIVE',
        `Your account is temporarily restricted until ${r.endsAt.toISOString().slice(0, 10)}. Contact support if you think this is a mistake.`,
        403,
      );
  }

  /** A merchant under a campaign hold takes no new customer exposure (reservations, purchases, views). */
  async assertMerchantOpen(organizationId: string) {
    const r = await this.active('MERCHANT_CAMPAIGN_HOLD', 'ORGANIZATION', organizationId);
    if (r)
      throw new AppError('RESTRICTION_ACTIVE', 'This merchant’s offers are paused for now', 409);
  }

  /** A branch under a redemption hold cannot redeem; the customer keeps the voucher / reservation. */
  async assertBranchRedemptionOpen(branchId: string | null | undefined) {
    if (!branchId) return;
    const r = await this.active('BRANCH_REDEMPTION_HOLD', 'BRANCH', branchId);
    if (r)
      throw new AppError(
        'BRANCH_REDEMPTION_HELD',
        'Redemption is paused at this branch. The customer keeps the offer and can use it at another branch or later.',
        409,
      );
  }
}
