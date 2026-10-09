import { Injectable } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import { OPEN_RECEIVABLE_STATUSES, type FinancialStatus } from '@dealdash/types';
import { PrismaService } from '../prisma/prisma.service';
import { deriveFinancialStatus, type FinancialStatusProvider, type FinancialStatusView } from '../subscription/policy';
import { SystemConfigService } from '../system-config/system-config.service';

const D = 86_400_000;

/**
 * Phase 5 financial status: the contract / hold derivation PLUS receivables and billing-account status. Overdue invoices are always
 * reported (GRACE with a reason). They turn the status to PAST_DUE only when `finance.billing.overdueDrivesPastDue` is switched on;
 * otherwise enforcement stays a human Finance decision (a financial hold or a contract status change). Consumers do not change.
 */
@Injectable()
export class ReceivablesFinancialStatusProvider implements FinancialStatusProvider {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  async statusFor(organizationId: string, opts: { at?: Date } = {}): Promise<FinancialStatusView> {
    const at = opts.at ?? new Date();
    const base = await deriveFinancialStatus(this.prisma, organizationId, at);
    const reasons = [...base.reasons];
    let status: FinancialStatus = base.status;
    let graceUntil = base.graceUntil;

    const accounts = await this.prisma.businessAccount.findMany({ where: { organizationId, status: { not: 'ACTIVE' } }, select: { status: true } });
    if (accounts.some((a) => a.status === 'SUSPENDED')) {
      reasons.push('BILLING_ACCOUNT_SUSPENDED');
      status = 'SUSPENDED';
    }
    if (accounts.some((a) => a.status === 'CREDIT_HOLD')) reasons.push('BILLING_ACCOUNT_CREDIT_HOLD');

    const oldest = await this.prisma.financeDocument.findFirst({
      where: { organizationId, type: { in: ['INVOICE', 'TAX_INVOICE', 'DEBIT_NOTE'] }, status: { in: [...OPEN_RECEIVABLE_STATUSES].filter((s) => s !== 'DISPUTED') as never }, dueAt: { lt: at } },
      orderBy: { dueAt: 'asc' },
      select: { dueAt: true },
    });
    if (oldest?.dueAt) {
      const cfg = (await this.config.get<{ overdueGraceDays?: number; overdueDrivesPastDue?: boolean }>(CONFIG_KEYS.FINANCE_BILLING)) ?? {};
      const until = new Date(oldest.dueAt.getTime() + (cfg.overdueGraceDays ?? 7) * D);
      const inGrace = until > at;
      reasons.push(inGrace ? 'INVOICES_OVERDUE_IN_GRACE' : 'INVOICES_OVERDUE_GRACE_ELAPSED');
      if (status === 'GOOD_STANDING' || status === 'GRACE') {
        status = !inGrace && cfg.overdueDrivesPastDue ? 'PAST_DUE' : 'GRACE';
        if (!graceUntil || new Date(graceUntil) > until) graceUntil = until.toISOString();
      }
    }
    return { status, reasons, graceUntil, contractId: base.contractId };
  }
}
