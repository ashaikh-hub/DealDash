import { randomBytes } from 'node:crypto';
import { CONFIG_KEYS, DEFAULT_OPERATIONS_CONFIG, type OperationsConfig } from '@dealdash/config';
import type { SystemConfigService } from '../system-config/system-config.service';

/** The operations configuration, with defaults for any section an older stored value does not have yet. */
export async function opsConfig(config: SystemConfigService): Promise<OperationsConfig> {
  const stored = ((await config.get<Partial<OperationsConfig>>(CONFIG_KEYS.OPERATIONS)) ?? {}) as Partial<OperationsConfig>;
  const d = DEFAULT_OPERATIONS_CONFIG;
  return {
    ...d,
    ...stored,
    approvals: { ...d.approvals, ...(stored.approvals ?? {}), adjustments: { ...d.approvals.adjustments, ...(stored.approvals?.adjustments ?? {}) }, restrictions: { ...d.approvals.restrictions, ...(stored.approvals?.restrictions ?? {}) } },
    sla: { ...d.sla, ...(stored.sla ?? {}) },
    reasons: { ...d.reasons, ...(stored.reasons ?? {}) },
    risk: { rules: { ...d.risk.rules, ...(stored.risk?.rules ?? {}) } },
    restrictions: { maxDays: { ...d.restrictions.maxDays, ...(stored.restrictions?.maxDays ?? {}) }, notifySubject: { ...d.restrictions.notifySubject, ...(stored.restrictions?.notifySubject ?? {}) } },
    notifications: { ...d.notifications, ...(stored.notifications ?? {}), templates: { ...d.notifications.templates, ...(stored.notifications?.templates ?? {}) } },
    reviews: { ...d.reviews, ...(stored.reviews ?? {}) },
    caseTypes: { ...d.caseTypes, ...(stored.caseTypes ?? {}) },
    caseLifecycle: { ...d.caseLifecycle, ...(stored.caseLifecycle ?? {}) },
  };
}

/** Maker-checker decision for an amount under a configured rule. */
export function requiresSecondPerson(rule: { mode: 'ALWAYS' | 'ABOVE_THRESHOLD' | 'NEVER'; thresholdMinor?: number } | undefined, amount: number) {
  if (!rule) return true; // an unconfigured sensitive action always needs a second person
  if (rule.mode === 'ALWAYS') return true;
  if (rule.mode === 'NEVER') return false;
  return Math.abs(amount) > (rule.thresholdMinor ?? 0);
}

/**
 * The legacy direct adjustment endpoints (Stage 5 payable adjustment, Phase 5 commercial adjustment) keep working for small
 * corrections; above the configured ceiling they refuse and point to the governed workflow (maker-checker).
 */
export async function assertDirectAdjustmentAllowed(config: SystemConfigService, amountMinor: number) {
  const max = (await opsConfig(config)).approvals.directAdjustmentMaxMinor;
  if (Math.abs(amountMinor) > max) {
    const { AppError } = await import('../common/errors');
    throw new AppError('APPROVAL_REQUIRED', `Adjustments above ${max} need a second person: use Financial adjustments`, 409);
  }
}

export const ref = (prefix: string) => `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`;

export const D = 86_400_000;
