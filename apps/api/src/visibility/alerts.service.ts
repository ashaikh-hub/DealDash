import { Inject, Injectable, Logger } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import {
  ALERT_CHANNELS,
  ALERT_CODES,
  ALERT_FREQUENCIES,
  type AlertCategory,
  type AlertChannel,
  type AlertCode,
  type AlertFrequency,
  type AlertSeverity,
  type PermissionCode,
} from '@dealdash/types';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  EMAIL_PROVIDER,
  PUSH_PROVIDER,
  SMS_PROVIDER,
  type EmailProvider,
  type PushProvider,
  type SmsProvider,
} from '../providers/interfaces';
import { SignalService } from '../subscription/signal.service';
import { SystemConfigService } from '../system-config/system-config.service';

export interface RaiseInput {
  code: AlertCode;
  organizationId: string | null;
  subjectType: string;
  subjectId: string;
  severity?: AlertSeverity;
  data?: Record<string, unknown>;
  campaignId?: string | null;
  branchId?: string | null;
  legalEntityId?: string | null;
  product?: string | null;
  country?: string | null;
  /** Override the dedupe window: ONCE = never again for this subject; otherwise the cooldown window. */
  once?: boolean;
  /** Extra discriminator (for example the milestone percent). */
  variant?: string;
  ruleId?: string | null;
}

interface AlertConfig {
  cooldownHours: number;
  escalation: { afterMinutes: number; toRoles: string[] };
  thresholds: Record<string, number>;
}

/** Who receives an alert when no rule names recipients: by audience and category. */
const DEFAULT_BUSINESS_ROLES: Record<AlertCategory, string[]> = {
  PERFORMANCE: [
    'MERCHANT_OWNER',
    'MERCHANT_ADMIN',
    'MERCHANT_CAMPAIGN_MANAGER',
    'PARTNER_ADMIN',
    'PARTNER_CAMPAIGN_MANAGER',
  ],
  INVENTORY: [
    'MERCHANT_OWNER',
    'MERCHANT_ADMIN',
    'MERCHANT_CAMPAIGN_MANAGER',
    'PARTNER_ADMIN',
    'PARTNER_CAMPAIGN_MANAGER',
  ],
  FUNDING: [
    'MERCHANT_OWNER',
    'MERCHANT_ADMIN',
    'MERCHANT_FINANCE',
    'PARTNER_ADMIN',
    'PARTNER_FINANCE_VIEWER',
  ],
  FINANCE: ['MERCHANT_OWNER', 'MERCHANT_FINANCE', 'PARTNER_ADMIN', 'PARTNER_FINANCE_VIEWER'],
  COMMERCIAL: ['MERCHANT_OWNER', 'MERCHANT_ADMIN', 'MERCHANT_CAMPAIGN_MANAGER', 'PARTNER_ADMIN'],
  INTEGRATION: ['MERCHANT_OWNER', 'MERCHANT_ADMIN', 'PARTNER_ADMIN'],
  RISK: ['MERCHANT_OWNER', 'MERCHANT_ADMIN', 'PARTNER_ADMIN'],
  SUBSCRIPTION: ['MERCHANT_OWNER', 'MERCHANT_ADMIN', 'MERCHANT_FINANCE', 'PARTNER_ADMIN'],
  OPERATIONS: ['MERCHANT_OWNER', 'MERCHANT_ADMIN', 'PARTNER_ADMIN'],
};
const DEFAULT_PLATFORM_ROLES: Record<AlertCategory, string[]> = {
  PERFORMANCE: ['DEALDASH_OPERATIONS'],
  INVENTORY: ['DEALDASH_OPERATIONS'],
  FUNDING: ['DEALDASH_FINANCE'],
  FINANCE: ['DEALDASH_FINANCE'],
  COMMERCIAL: ['DEALDASH_OPERATIONS'],
  INTEGRATION: ['DEALDASH_OPERATIONS', 'DEALDASH_PARTNER_MANAGEMENT'],
  RISK: ['DEALDASH_RISK_COMPLIANCE'],
  SUBSCRIPTION: ['DEALDASH_FINANCE'],
  OPERATIONS: ['DEALDASH_OPERATIONS'],
};

/** The screen an alert's action opens, and the permission needed to see it (the screen enforces everything else). */
function actionOf(
  code: AlertCode,
  platform: boolean,
  ctx: { campaignId?: string | null; product?: string | null; subjectId: string },
): { href: string; permission: PermissionCode } {
  const action = ALERT_CODES[code].action;
  if (platform) {
    const admin: Record<string, { href: string; permission: PermissionCode }> = {
      VIEW_INTEGRATION: {
        href: '/command-centre?tab=integrations',
        permission: 'admin.operations.read',
      },
      VIEW_INVOICE: {
        href: `/finance?document=${ctx.subjectId}`,
        permission: 'admin.finance.read',
      },
      VIEW_RECONCILIATION: {
        href: '/finance?tab=reconciliation',
        permission: 'admin.finance.read',
      },
      VIEW_RISK: { href: '/risk', permission: 'admin.risk.manage' },
      VIEW_PAYMENTS: {
        href: '/command-centre?tab=transactions',
        permission: 'admin.operations.read',
      },
      VIEW_PLAN: { href: '/subscriptions', permission: 'admin.subscriptions.read' },
      VIEW_CREDIT: { href: '/finance?tab=credit', permission: 'admin.finance.read' },
      VIEW_PO: { href: '/finance?tab=po', permission: 'admin.finance.read' },
    };
    return admin[action] ?? { href: '/command-centre', permission: 'admin.operations.read' };
  }
  const campaignPath =
    ctx.product === 'WATCH'
      ? `/watch/${ctx.campaignId}`
      : ctx.product === 'VOUCHER'
        ? `/vouchers/${ctx.campaignId}`
        : ctx.product === 'EXCLUSIVE'
          ? `/deals/hot/${ctx.campaignId}`
          : `/deals/${ctx.campaignId}`;
  const m: Record<string, { href: string; permission: PermissionCode }> = {
    VIEW_PERFORMANCE: {
      href: ctx.campaignId
        ? `/performance?product=${ctx.product}&campaign=${ctx.campaignId}`
        : '/performance',
      permission: 'merchant.performance.read',
    },
    ADD_BUDGET: {
      href: ctx.campaignId ? campaignPath : '/watch',
      permission: 'merchant.watch.manage',
    },
    ADD_INVENTORY: {
      href: ctx.campaignId ? campaignPath : '/deals',
      permission: ctx.product === 'VOUCHER' ? 'merchant.vouchers.manage' : 'merchant.deals.manage',
    },
    VIEW_REWARDS: { href: '/loyalty', permission: 'merchant.loyalty.manage' },
    REVIEW_FUNDING: { href: '/commercial', permission: 'merchant.commercial.read' },
    VIEW_CREDIT: { href: '/billing?tab=credit', permission: 'merchant.finance.read' },
    VIEW_PO: { href: '/billing?tab=po', permission: 'merchant.finance.read' },
    REVIEW_QUOTATION: { href: '/commercial', permission: 'merchant.commercial.read' },
    VIEW_INVOICE: {
      href: `/billing?document=${ctx.subjectId}`,
      permission: 'merchant.finance.read',
    },
    VIEW_SETTLEMENT: { href: '/finance', permission: 'merchant.finance.read' },
    VIEW_INTEGRATION: { href: '/operations', permission: 'merchant.integrations.manage' },
    VIEW_PAYMENTS: { href: '/finance', permission: 'merchant.finance.read' },
    VIEW_RISK: { href: '/redemptions', permission: 'merchant.redemptions.read' },
    VIEW_RECONCILIATION: {
      href: '/billing?tab=reconciliation',
      permission: 'merchant.finance.read',
    },
    REVIEW_CAMPAIGN: {
      href: ctx.campaignId ? campaignPath : '/deals',
      permission: 'merchant.deals.read',
    },
    VIEW_PLAN: { href: '/plan', permission: 'merchant.subscription.read' },
  };
  return m[action] ?? { href: '/performance', permission: 'merchant.performance.read' };
}

/** Subscription signal (Phase 4 consumer of the subscription engine's outbox) -> alert code. */
const SIGNAL_CODE: Record<string, AlertCode> = {
  BRANCH_LIMIT_80_PERCENT: 'SUBSCRIPTION_LIMIT',
  BRANCH_LIMIT_REACHED: 'SUBSCRIPTION_LIMIT',
  USER_LIMIT_APPROACHING: 'SUBSCRIPTION_LIMIT',
  USER_LIMIT_REACHED: 'SUBSCRIPTION_LIMIT',
  API_LIMIT_APPROACHING: 'SUBSCRIPTION_LIMIT',
  API_LIMIT_REACHED: 'SUBSCRIPTION_LIMIT',
  LIMIT_APPROACHING: 'SUBSCRIPTION_LIMIT',
  LIMIT_REACHED: 'SUBSCRIPTION_LIMIT',
  TRIAL_EXPIRING: 'SUBSCRIPTION_LIFECYCLE',
  PROMOTION_EXPIRING: 'SUBSCRIPTION_LIFECYCLE',
  RENEWAL_APPROACHING: 'SUBSCRIPTION_LIFECYCLE',
  CONTRACT_EXPIRING: 'SUBSCRIPTION_LIFECYCLE',
  PAYMENT_GRACE_STARTED: 'SUBSCRIPTION_LIFECYCLE',
  CONTRACT_SUSPENDED: 'SUBSCRIPTION_LIFECYCLE',
  FINANCIAL_HOLD: 'FINANCIAL_HOLD',
};

export interface RuleInput {
  name: string;
  code: AlertCode;
  enabled?: boolean;
  threshold?: number | null;
  thresholds?: number[];
  frequency?: AlertFrequency;
  severity?: AlertSeverity | null;
  channels?: AlertChannel[];
  recipientRoles?: string[];
  recipientUserIds?: string[];
  legalEntityId?: string | null;
  country?: string | null;
  branchId?: string | null;
  product?: string | null;
  campaignId?: string | null;
  escalation?: Array<{ afterMinutes: number; toRoles: string[]; channels?: AlertChannel[] }>;
}

/**
 * Alerts: target milestones, early warnings and subscription signals become deduplicated alert events, routed by rules and personal
 * preferences to in-app, task inbox, email, push and SMS (provider interfaces), with escalation and digests. Fatigue control: one
 * alert per subject per cooldown window, digests, critical-only. An alert's action only opens a screen; every financially material
 * step is still controlled there (RBAC, scope, maker-checker, commercial acceptance, finance approval, audit).
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger('Alerts');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly audit: AuditService,
    private readonly signals: SignalService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  async settings(): Promise<AlertConfig> {
    const c = (await this.config.get<Partial<AlertConfig>>(CONFIG_KEYS.VISIBILITY_ALERTS)) ?? {};
    return {
      cooldownHours: c.cooldownHours ?? 24,
      escalation: c.escalation ?? { afterMinutes: 240, toRoles: [] },
      thresholds: c.thresholds ?? {},
    };
  }

  /** Threshold for a code: the business's own rule wins, then the platform default rule, then configuration. */
  async threshold(
    organizationId: string | null,
    code: AlertCode,
    configKey: string,
  ): Promise<number> {
    const rule = await this.prisma.alertRule.findFirst({
      where: {
        code,
        enabled: true,
        threshold: { not: null },
        OR: [{ organizationId }, { organizationId: null }],
      },
      orderBy: { organizationId: { sort: 'asc', nulls: 'last' } },
    });
    if (rule?.threshold !== null && rule?.threshold !== undefined) return rule.threshold;
    return (await this.settings()).thresholds[configKey] ?? 0;
  }

  private async rulesFor(i: RaiseInput) {
    const rows = await this.prisma.alertRule.findMany({
      where: { code: i.code, OR: [{ organizationId: i.organizationId }, { organizationId: null }] },
    });
    const matches = (r: (typeof rows)[number]) =>
      (!r.campaignId || r.campaignId === i.campaignId) &&
      (!r.branchId || r.branchId === i.branchId) &&
      (!r.legalEntityId || r.legalEntityId === i.legalEntityId) &&
      (!r.product || r.product === i.product) &&
      (!r.country || r.country === i.country);
    const own = rows.filter((r) => r.organizationId === i.organizationId && matches(r));
    // a business's own rules replace the platform defaults for the same code
    return own.length ? own : rows.filter((r) => r.organizationId === null && matches(r));
  }

  // ---------------------------------------------------------------- raise and deliver
  async raise(i: RaiseInput): Promise<{ id: string; created: boolean } | null> {
    const def = ALERT_CODES[i.code];
    const rules = await this.rulesFor(i);
    if (rules.length && rules.every((r) => !r.enabled)) return null;
    const active = rules.filter((r) => r.enabled);
    const cfg = await this.settings();
    const windowKey = i.once
      ? 'once'
      : String(Math.floor(Date.now() / (cfg.cooldownHours * 3_600_000)));
    const dedupeKey = `${i.code}:${i.organizationId ?? 'platform'}:${i.subjectType}:${i.subjectId}${i.variant ? `:${i.variant}` : ''}:${windowKey}`;
    const existing = await this.prisma.alertEvent.findUnique({
      where: { dedupeKey },
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };
    const severity: AlertSeverity =
      (active.find((r) => r.severity)?.severity as AlertSeverity | undefined) ??
      i.severity ??
      def.severity;
    const act = actionOf(i.code, i.organizationId === null, {
      campaignId: i.campaignId,
      product: i.product,
      subjectId: i.subjectId,
    });
    const steps = this.escalationSteps(active, severity, cfg);
    let row;
    try {
      row = await this.prisma.alertEvent.create({
        data: {
          ruleId: i.ruleId ?? active[0]?.id ?? null,
          organizationId: i.organizationId,
          code: i.code,
          category: def.category,
          severity,
          dedupeKey,
          subjectType: i.subjectType,
          subjectId: i.subjectId,
          legalEntityId: i.legalEntityId ?? null,
          branchId: i.branchId ?? null,
          campaignId: i.campaignId ?? null,
          product: i.product ?? null,
          data: (i.data ?? {}) as Prisma.InputJsonValue,
          action: def.action,
          actionHref: act.href,
          actionPermission: act.permission,
          nextEscalationAt: steps[0] ? new Date(Date.now() + steps[0].afterMinutes * 60_000) : null,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        return {
          id: (await this.prisma.alertEvent.findUniqueOrThrow({ where: { dedupeKey } })).id,
          created: false,
        };
      throw e;
    }
    await this.deliver(row.id, 0, active, null);
    return { id: row.id, created: true };
  }

  private escalationSteps(
    rules: Array<{ escalation: Prisma.JsonValue }>,
    severity: AlertSeverity,
    cfg: AlertConfig,
  ) {
    const own = rules.flatMap((r) =>
      Array.isArray(r.escalation)
        ? (r.escalation as Array<{
            afterMinutes: number;
            toRoles: string[];
            channels?: AlertChannel[];
          }>)
        : [],
    );
    if (own.length) return own;
    // default: only CRITICAL alerts escalate on their own
    return severity === 'CRITICAL' && cfg.escalation.toRoles.length
      ? [
          {
            afterMinutes: cfg.escalation.afterMinutes,
            toRoles: cfg.escalation.toRoles,
            channels: ['IN_APP', 'TASK_INBOX'] as AlertChannel[],
          },
        ]
      : [];
  }

  /** Organization-wide members (never branch-bound or scoped members) holding one of the roles. */
  private async members(organizationId: string | null, roles: string[]) {
    if (!roles.length) return [];
    const where: Prisma.OrganizationMembershipWhereInput = {
      status: 'ACTIVE',
      branchId: null,
      scoped: false,
      role: { code: { in: roles } },
    };
    if (organizationId) where.organizationId = organizationId;
    else where.organization = { type: 'DEALDASH' };
    const rows = await this.prisma.organizationMembership.findMany({
      where,
      select: { userId: true },
    });
    return [...new Set(rows.map((r) => r.userId))];
  }

  private async deliver(
    alertId: string,
    level: number,
    rules: Array<{
      channels: string[];
      recipientRoles: string[];
      recipientUserIds: string[];
      frequency: string;
    }>,
    step: { toRoles: string[]; channels?: AlertChannel[] } | null,
  ) {
    const a = await this.prisma.alertEvent.findUniqueOrThrow({ where: { id: alertId } });
    const cat = a.category as AlertCategory;
    let roles: string[];
    let channels: AlertChannel[];
    let userIds: string[] = [];
    let frequency: AlertFrequency = 'IMMEDIATE';
    if (step) {
      roles = step.toRoles;
      channels = step.channels ?? ['IN_APP', 'TASK_INBOX'];
    } else if (rules.length) {
      roles = [...new Set(rules.flatMap((r) => r.recipientRoles))];
      userIds = [...new Set(rules.flatMap((r) => r.recipientUserIds))];
      channels = [...new Set(rules.flatMap((r) => r.channels))] as AlertChannel[];
      if (!roles.length && !userIds.length)
        roles = a.organizationId ? DEFAULT_BUSINESS_ROLES[cat] : DEFAULT_PLATFORM_ROLES[cat];
      frequency =
        (rules.find((r) => r.frequency !== 'IMMEDIATE')?.frequency as AlertFrequency) ??
        'IMMEDIATE';
    } else {
      roles = a.organizationId ? DEFAULT_BUSINESS_ROLES[cat] : DEFAULT_PLATFORM_ROLES[cat];
      channels = a.severity === 'CRITICAL' ? ['IN_APP', 'TASK_INBOX'] : ['IN_APP'];
    }
    // explicit recipients must still belong to the organization
    if (userIds.length && a.organizationId) {
      const ok = await this.prisma.organizationMembership.findMany({
        where: { organizationId: a.organizationId, status: 'ACTIVE', userId: { in: userIds } },
        select: { userId: true },
      });
      userIds = ok.map((m) => m.userId);
    }
    const recipients = [...new Set([...(await this.members(a.organizationId, roles)), ...userIds])];
    if (channels.includes('TASK_INBOX'))
      await this.prisma.approvalTask
        .create({
          data: {
            kind: 'ALERT',
            status: 'OPEN',
            priority:
              a.severity === 'CRITICAL' ? 'CRITICAL' : a.severity === 'WARNING' ? 'HIGH' : 'NORMAL',
            title: `Alert: ${a.code}`,
            detail: a.code,
            organizationId: a.organizationId,
            product: a.product,
            entityType: 'AlertEvent',
            entityId: a.id,
            branchId: a.branchId,
            requiredPermission:
              a.actionPermission ??
              (a.organizationId ? 'merchant.performance.read' : 'admin.operations.read'),
            dedupeKey: `alert:${a.id}:${level}`,
          },
        })
        .catch((e: { code?: string }) => {
          if (e.code !== 'P2002') throw e;
        });
    const prefs = await this.prisma.notificationPreference.findMany({
      where: { userId: { in: recipients } },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: recipients }, status: 'ACTIVE' },
      select: { id: true, email: true, mobile: true, locale: true },
    });
    for (const u of users) {
      const pref =
        prefs.find((p) => p.userId === u.id && p.category === cat) ??
        prefs.find((p) => p.userId === u.id && p.category === 'ALL');
      const freq = (pref?.frequency as AlertFrequency | undefined) ?? frequency;
      const wanted = (
        pref
          ? (pref.channels as AlertChannel[]).filter((c) => channels.includes(c) || c === 'IN_APP')
          : channels
      ).filter((c) => c !== 'TASK_INBOX');
      const record = (channel: AlertChannel, status: string, error?: string) =>
        this.prisma.alertDelivery
          .create({
            data: {
              alertId: a.id,
              userId: u.id,
              channel,
              level,
              status,
              error: error ?? null,
              sentAt: status === 'SENT' ? new Date() : null,
            },
          })
          .catch((e: { code?: string }) => {
            if (e.code !== 'P2002') throw e;
          });
      if (pref?.muted && level === 0) {
        await record('IN_APP', 'SKIPPED_PREFERENCE');
        continue;
      }
      if (freq === 'CRITICAL_ONLY' && a.severity !== 'CRITICAL' && level === 0) {
        await record('IN_APP', 'SKIPPED_SEVERITY');
        continue;
      }
      if (freq === 'DIGEST' && level === 0) {
        await record('IN_APP', 'QUEUED_DIGEST');
        continue;
      }
      for (const ch of wanted.length ? wanted : (['IN_APP'] as AlertChannel[])) {
        try {
          if (ch === 'IN_APP')
            await this.prisma.notification.upsert({
              where: { userId_dedupeKey: { userId: u.id, dedupeKey: `alert:${a.id}:${level}` } },
              update: {},
              create: {
                userId: u.id,
                type: 'ALERT',
                dedupeKey: `alert:${a.id}:${level}`,
                data: {
                  alertId: a.id,
                  code: a.code,
                  severity: a.severity,
                  category: a.category,
                  level,
                  href: a.actionHref,
                  ...(a.data as object),
                } as Prisma.InputJsonValue,
              },
            });
          else if (ch === 'EMAIL' && u.email)
            await this.email.send({
              to: u.email,
              templateKey: `alert.${a.code}`,
              subject: `DealDash alert: ${a.code}`,
              body: `${a.code} (${a.severity})`,
              locale: u.locale === 'ar' ? 'ar' : 'en',
            });
          else if (ch === 'PUSH')
            await this.push.send({
              userId: u.id,
              title: 'DealDash',
              body: a.code,
              data: { alertId: a.id },
            });
          else if (ch === 'SMS' && u.mobile)
            await this.sms.send({
              to: u.mobile,
              templateKey: `alert.${a.code}`,
              body: `DealDash: ${a.code}`,
              locale: u.locale === 'ar' ? 'ar' : 'en',
            });
          else continue;
          await record(ch, 'SENT');
        } catch (e) {
          await record(ch, 'FAILED', (e as Error).message.slice(0, 200));
        }
      }
    }
  }

  /** Escalates open, unacknowledged alerts whose escalation time has come. */
  async escalate(now = new Date()): Promise<number> {
    const due = await this.prisma.alertEvent.findMany({
      where: { status: 'OPEN', nextEscalationAt: { lte: now } },
      take: 200,
    });
    const cfg = await this.settings();
    let n = 0;
    for (const a of due) {
      const rules = a.ruleId
        ? await this.prisma.alertRule.findMany({ where: { id: a.ruleId } })
        : [];
      const steps = this.escalationSteps(rules, a.severity as AlertSeverity, cfg);
      const step = steps[a.escalationLevel];
      const next = steps[a.escalationLevel + 1];
      const res = await this.prisma.alertEvent.updateMany({
        where: { id: a.id, status: 'OPEN', escalationLevel: a.escalationLevel },
        data: {
          escalationLevel: a.escalationLevel + 1,
          nextEscalationAt: next ? new Date(now.getTime() + next.afterMinutes * 60_000) : null,
        },
      });
      if (res.count !== 1) continue;
      if (step) await this.deliver(a.id, a.escalationLevel + 1, [], step);
      n++;
    }
    return n;
  }

  /** Sends one digest notification per person for the alerts queued since the last digest. */
  async sendDigests(): Promise<number> {
    const queued = await this.prisma.alertDelivery.findMany({
      where: { status: 'QUEUED_DIGEST' },
      include: { alert: { select: { code: true, severity: true } } },
      take: 2000,
    });
    const byUser = new Map<string, typeof queued>();
    for (const d of queued)
      if (d.userId) byUser.set(d.userId, [...(byUser.get(d.userId) ?? []), d]);
    for (const [userId, ds] of byUser) {
      const key = `digest:${ds.map((d) => d.id).sort()[0]}`;
      await this.prisma.notification.upsert({
        where: { userId_dedupeKey: { userId, dedupeKey: key } },
        update: {},
        create: {
          userId,
          type: 'ALERT',
          dedupeKey: key,
          data: {
            digest: true,
            count: ds.length,
            codes: [...new Set(ds.map((d) => d.alert.code))],
          } as Prisma.InputJsonValue,
        },
      });
      await this.prisma.alertDelivery.updateMany({
        where: { id: { in: ds.map((d) => d.id) } },
        data: { status: 'SENT', sentAt: new Date() },
      });
    }
    return byUser.size;
  }

  /** Turns the subscription engine's signals into alerts (Phase 4 is the consumer of that outbox). */
  async consumeSignals(): Promise<number> {
    const rows = await this.signals.list({ unconsumed: true, limit: 500 });
    let n = 0;
    for (const s of rows) {
      const code = SIGNAL_CODE[s.type];
      if (code) {
        await this.raise({
          code,
          organizationId: s.organizationId,
          subjectType: 'CommercialSignal',
          subjectId: s.id,
          data: { signal: s.type, metricKey: s.metricKey, ...(s.payload as object) },
          legalEntityId: s.legalEntityId,
          once: true,
        });
        n++;
      }
      await this.signals.markConsumed([s.id]);
    }
    return n;
  }

  // ---------------------------------------------------------------- reading and acting
  async list(f: {
    organizationId: string | null;
    platform?: boolean;
    status?: string;
    category?: string;
    take?: number;
  }) {
    const where: Prisma.AlertEventWhereInput = {
      ...(f.platform ? {} : { organizationId: f.organizationId }),
      ...(f.status ? { status: f.status } : {}),
      ...(f.category ? { category: f.category } : {}),
    };
    if (f.platform && f.organizationId) where.organizationId = f.organizationId;
    const rows = await this.prisma.alertEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(f.take ?? 100, 300),
    });
    return rows.map((a) => this.view(a));
  }

  view(a: Prisma.AlertEventGetPayload<object>) {
    return {
      id: a.id,
      organizationId: a.organizationId,
      code: a.code,
      category: a.category,
      severity: a.severity,
      status: a.status,
      subjectType: a.subjectType,
      subjectId: a.subjectId,
      campaignId: a.campaignId,
      branchId: a.branchId,
      product: a.product,
      data: a.data as Record<string, unknown>,
      action: a.action,
      actionHref: a.actionHref,
      actionPermission: a.actionPermission,
      escalationLevel: a.escalationLevel,
      acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
      resolvedAt: a.resolvedAt?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
    };
  }

  async setStatus(
    actor: Actor,
    alertId: string,
    organizationId: string | null,
    status: 'ACKNOWLEDGED' | 'RESOLVED',
    meta: RequestMeta,
  ) {
    const a = await this.prisma.alertEvent.findUnique({ where: { id: alertId } });
    if (!a || (organizationId !== null && a.organizationId !== organizationId))
      throw AppError.notFound();
    if (a.status === 'RESOLVED')
      throw new AppError('INVALID_STATE', 'This alert is already resolved', 409);
    await this.prisma.$transaction(async (tx) => {
      await tx.alertEvent.update({
        where: { id: alertId },
        data:
          status === 'ACKNOWLEDGED'
            ? {
                status,
                acknowledgedById: actor.userId,
                acknowledgedAt: new Date(),
                nextEscalationAt: null,
              }
            : { status, resolvedAt: new Date(), nextEscalationAt: null },
      });
      await tx.approvalTask.updateMany({
        where: { entityType: 'AlertEvent', entityId: alertId, status: 'OPEN' },
        data: {
          status: 'DONE',
          resolvedAt: new Date(),
          resolvedByUserId: actor.userId,
          resolution: status,
        },
      });
      await this.audit.record(
        {
          action: `ALERT_${status}`,
          entityType: 'AlertEvent',
          entityId: alertId,
          actor,
          subjectOrganizationId: a.organizationId,
          newState: { status },
          meta,
        },
        tx,
      );
    });
    return this.view(await this.prisma.alertEvent.findUniqueOrThrow({ where: { id: alertId } }));
  }

  // ---------------------------------------------------------------- rules
  async listRules(organizationId: string | null) {
    return this.prisma.alertRule.findMany({
      where: { organizationId },
      orderBy: [{ code: 'asc' }, { createdAt: 'asc' }],
    });
  }

  private async validateRule(organizationId: string | null, b: RuleInput) {
    if (!ALERT_CODES[b.code])
      throw new AppError('ALERT_RULE_INVALID', `Unknown alert "${b.code}"`, 422);
    for (const c of b.channels ?? [])
      if (!(ALERT_CHANNELS as readonly string[]).includes(c))
        throw new AppError('ALERT_RULE_INVALID', `Unknown channel "${c}"`, 422);
    if (b.frequency && !(ALERT_FREQUENCIES as readonly string[]).includes(b.frequency))
      throw new AppError('ALERT_RULE_INVALID', 'Unknown frequency', 422);
    for (const t of b.thresholds ?? [])
      if (t < 1 || t > 1000)
        throw new AppError(
          'ALERT_RULE_INVALID',
          'A milestone is a percent between 1 and 1000',
          422,
        );
    const roles = await this.prisma.role.findMany({
      where: {
        code: {
          in: [...(b.recipientRoles ?? []), ...(b.escalation ?? []).flatMap((s) => s.toRoles)],
        },
      },
      select: { code: true },
    });
    const known = new Set(roles.map((r) => r.code));
    const prefix = organizationId
      ? (await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).type
      : 'DEALDASH';
    for (const r of [
      ...(b.recipientRoles ?? []),
      ...(b.escalation ?? []).flatMap((s) => s.toRoles),
    ]) {
      if (!known.has(r)) throw new AppError('ALERT_RULE_INVALID', `Unknown role "${r}"`, 422);
      // a business can only address its own roles
      if (organizationId && !r.startsWith(prefix === 'PARTNER' ? 'PARTNER_' : 'MERCHANT_'))
        throw new AppError('ALERT_RULE_INVALID', `Role "${r}" is not a role of this business`, 422);
    }
    if (organizationId && b.recipientUserIds?.length) {
      const ok = await this.prisma.organizationMembership.count({
        where: { organizationId, status: 'ACTIVE', userId: { in: b.recipientUserIds } },
      });
      if (ok < new Set(b.recipientUserIds).size)
        throw new AppError(
          'ALERT_RULE_INVALID',
          'A recipient is not a member of this business',
          422,
        );
    }
    if (organizationId && b.campaignId) {
      const owned = await Promise.all([
        this.prisma.liveDeal.count({ where: { id: b.campaignId, organizationId } }),
        this.prisma.hotDeal.count({ where: { id: b.campaignId, organizationId } }),
        this.prisma.voucher.count({ where: { id: b.campaignId, organizationId } }),
        this.prisma.watchCampaign.count({ where: { id: b.campaignId, organizationId } }),
      ]);
      if (!owned.some(Boolean))
        throw new AppError('ALERT_RULE_INVALID', 'The campaign is not one of this business', 422);
    }
    if (
      organizationId &&
      b.branchId &&
      !(await this.prisma.merchantBranch.count({ where: { id: b.branchId, organizationId } }))
    )
      throw new AppError('ALERT_RULE_INVALID', 'The branch is not one of this business', 422);
    if (
      organizationId &&
      b.legalEntityId &&
      !(await this.prisma.legalEntity.count({ where: { id: b.legalEntityId, organizationId } }))
    )
      throw new AppError('ALERT_RULE_INVALID', 'The legal entity is not one of this business', 422);
  }

  async createRule(actor: Actor, organizationId: string | null, b: RuleInput, meta: RequestMeta) {
    await this.validateRule(organizationId, b);
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.alertRule.create({
        data: {
          organizationId,
          name: b.name,
          code: b.code,
          enabled: b.enabled ?? true,
          threshold: b.threshold ?? null,
          thresholds: b.thresholds ?? [],
          frequency: b.frequency ?? 'IMMEDIATE',
          severity: b.severity ?? null,
          channels: b.channels?.length ? b.channels : ['IN_APP'],
          recipientRoles: b.recipientRoles ?? [],
          recipientUserIds: b.recipientUserIds ?? [],
          legalEntityId: b.legalEntityId ?? null,
          country: b.country ?? null,
          branchId: b.branchId ?? null,
          product: b.product ?? null,
          campaignId: b.campaignId ?? null,
          escalation: (b.escalation ?? []) as unknown as Prisma.InputJsonValue,
          createdByUserId: actor.userId,
        },
      });
      await this.audit.record(
        {
          action: 'ALERT_RULE_CREATED',
          entityType: 'AlertRule',
          entityId: r.id,
          actor,
          subjectOrganizationId: organizationId,
          newState: {
            code: r.code,
            threshold: r.threshold,
            frequency: r.frequency,
            channels: r.channels,
          },
          meta,
        },
        tx,
      );
      return r;
    });
  }

  async updateRule(
    actor: Actor,
    organizationId: string | null,
    id: string,
    b: RuleInput,
    meta: RequestMeta,
  ) {
    const r = await this.prisma.alertRule.findUnique({ where: { id } });
    if (!r || r.organizationId !== organizationId) throw AppError.notFound();
    await this.validateRule(organizationId, b);
    return this.prisma.$transaction(async (tx) => {
      const u = await tx.alertRule.update({
        where: { id },
        data: {
          name: b.name,
          enabled: b.enabled ?? r.enabled,
          threshold: b.threshold ?? null,
          thresholds: b.thresholds ?? r.thresholds,
          frequency: b.frequency ?? r.frequency,
          severity: b.severity ?? null,
          channels: b.channels?.length ? b.channels : r.channels,
          recipientRoles: b.recipientRoles ?? r.recipientRoles,
          recipientUserIds: b.recipientUserIds ?? r.recipientUserIds,
          escalation: (b.escalation ?? r.escalation) as unknown as Prisma.InputJsonValue,
        },
      });
      await this.audit.record(
        {
          action: 'ALERT_RULE_UPDATED',
          entityType: 'AlertRule',
          entityId: id,
          actor,
          subjectOrganizationId: organizationId,
          previousState: { enabled: r.enabled, threshold: r.threshold, frequency: r.frequency },
          newState: { enabled: u.enabled, threshold: u.threshold, frequency: u.frequency },
          meta,
        },
        tx,
      );
      return u;
    });
  }

  // ---------------------------------------------------------------- notification preferences (a person's own)
  async preferences(userId: string) {
    return this.prisma.notificationPreference.findMany({
      where: { userId },
      orderBy: { category: 'asc' },
    });
  }

  async setPreference(
    userId: string,
    b: { category: string; channels: AlertChannel[]; frequency: AlertFrequency; muted: boolean },
  ) {
    return this.prisma.notificationPreference.upsert({
      where: { userId_category: { userId, category: b.category } },
      update: { channels: b.channels, frequency: b.frequency, muted: b.muted },
      create: {
        userId,
        category: b.category,
        channels: b.channels,
        frequency: b.frequency,
        muted: b.muted,
      },
    });
  }

  logError(msg: string) {
    this.logger.warn(msg);
  }
}
