import { CONFIG_KEYS } from '@dealdash/config';
import type { FinancialStatus } from '@dealdash/types';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

/** The enforcement policy after resolution: contract override, then plan version, then entity type / market, then platform default. */
export interface EnforcementPolicy {
  graceDays: number;
  autoSuspendAfterGrace: boolean;
  treatElapsedGraceAsSuspended: boolean;
  blockedWhenSuspended: string[];
  blockedWhenEnded: string[];
  blockedOnFinancialHold: string[];
  liveCampaignsWhenSuspended: 'CONTINUE' | 'STOP_NEW_EXPOSURE';
}

interface EnforcementConfig extends Partial<EnforcementPolicy> {
  graceDaysByEntityType?: Record<string, number>;
  graceDaysByMarket?: Record<string, number>;
}

export const DAY_MS = 86_400_000;
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
export const addMonths = (d: Date, n: number) => {
  const r = new Date(d.getTime());
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + n);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
};

/** Start and end (exclusive) of the meter period that contains `at`. CONTRACT_TERM uses the contract dates. */
export function periodBounds(
  period: string,
  at: Date,
  term?: { from: Date; until: Date | null },
): { start: Date; end: Date } {
  const y = at.getUTCFullYear();
  const m = at.getUTCMonth();
  const d = at.getUTCDate();
  switch (period) {
    case 'DAY':
      return { start: new Date(Date.UTC(y, m, d)), end: new Date(Date.UTC(y, m, d + 1)) };
    case 'MONTH':
      return { start: new Date(Date.UTC(y, m, 1)), end: new Date(Date.UTC(y, m + 1, 1)) };
    case 'YEAR':
      return { start: new Date(Date.UTC(y, 0, 1)), end: new Date(Date.UTC(y + 1, 0, 1)) };
    case 'CONTRACT_TERM':
      return {
        start: term?.from ?? new Date(0),
        end: term?.until ?? new Date(Date.UTC(9999, 0, 1)),
      };
    default:
      return { start: new Date(Date.UTC(1970, 0, 1)), end: new Date(Date.UTC(9999, 0, 1)) };
  }
}

/** Resolves the enforcement policy for a contract. Nothing is hard-coded: every layer is data. */
export async function resolvePolicy(
  config: SystemConfigService,
  contract: { enforcement?: unknown; graceDays?: number | null; market?: string | null } | null,
  planVersion: { enforcement?: unknown; graceDays?: number | null } | null,
  entityType?: string | null,
): Promise<EnforcementPolicy> {
  const base = (await config.get<EnforcementConfig>(CONFIG_KEYS.COMMERCIAL_ENFORCEMENT)) ?? {};
  const layers: Array<Partial<EnforcementPolicy>> = [
    base,
    (planVersion?.enforcement ?? {}) as Partial<EnforcementPolicy>,
    (contract?.enforcement ?? {}) as Partial<EnforcementPolicy>,
  ];
  const merged = Object.assign({}, ...layers) as EnforcementPolicy;
  // grace: contract, then plan version, then entity type, then market, then the platform default
  const grace =
    contract?.graceDays ??
    planVersion?.graceDays ??
    (entityType ? base.graceDaysByEntityType?.[entityType] : undefined) ??
    (contract?.market ? base.graceDaysByMarket?.[contract.market] : undefined) ??
    base.graceDays ??
    0;
  return {
    graceDays: grace,
    autoSuspendAfterGrace: merged.autoSuspendAfterGrace ?? true,
    treatElapsedGraceAsSuspended: merged.treatElapsedGraceAsSuspended ?? true,
    blockedWhenSuspended: merged.blockedWhenSuspended ?? [],
    blockedWhenEnded: merged.blockedWhenEnded ?? [],
    blockedOnFinancialHold: merged.blockedOnFinancialHold ?? [],
    liveCampaignsWhenSuspended: merged.liveCampaignsWhenSuspended ?? 'CONTINUE',
  };
}

export interface FinancialStatusView {
  status: FinancialStatus;
  reasons: string[];
  graceUntil: string | null;
  contractId: string | null;
}

/** The ONE place a simple financial state is derived today. Phase 5 supplies a provider that adds AR / invoice detail. */
export interface FinancialStatusProvider {
  statusFor(organizationId: string, opts?: { at?: Date }): Promise<FinancialStatusView>;
}
export const FINANCIAL_STATUS_PROVIDER = Symbol('FINANCIAL_STATUS_PROVIDER');

const IN_FORCE = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'];

/** Default derivation from the contract lifecycle, the grace window and organization-level financial holds. */
export async function deriveFinancialStatus(
  prisma: PrismaService,
  organizationId: string,
  at = new Date(),
): Promise<FinancialStatusView> {
  const reasons: string[] = [];
  const contracts = await prisma.contract.findMany({
    where: {
      organizationId,
      status: { in: IN_FORCE },
      effectiveFrom: { lte: at },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: at } }],
    },
    orderBy: { effectiveFrom: 'desc' },
  });
  // organization-level holds only (a hold on one campaign's case stops that campaign, not the whole account)
  const hold = await prisma.financialHold.findFirst({
    where: { organizationId, status: 'ACTIVE', caseId: null },
  });
  const suspended = contracts.find((c) => c.status === 'SUSPENDED');
  const pastDue = contracts.find((c) => c.status === 'PAST_DUE');
  let status: FinancialStatus = 'GOOD_STANDING';
  let graceUntil: string | null = null;
  let contractId: string | null = contracts[0]?.id ?? null;
  if (pastDue) {
    graceUntil = pastDue.graceUntil?.toISOString() ?? null;
    contractId = pastDue.id;
    status = pastDue.graceUntil && pastDue.graceUntil > at ? 'GRACE' : 'PAST_DUE';
    reasons.push(
      status === 'GRACE' ? 'CONTRACT_PAST_DUE_IN_GRACE' : 'CONTRACT_PAST_DUE_GRACE_ELAPSED',
    );
  }
  if (hold) {
    status = 'FINANCIAL_HOLD';
    reasons.push('FINANCIAL_HOLD');
  }
  if (suspended) {
    status = 'SUSPENDED';
    contractId = suspended.id;
    reasons.push('CONTRACT_SUSPENDED');
  }
  return { status, reasons, graceUntil, contractId };
}
