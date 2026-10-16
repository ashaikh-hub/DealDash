import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  CONFIG_DEFAULTS,
  CONFIG_KEYS,
  GOVERNED_SCALARS,
  LAUNCH_ACTIONS,
  launchControlsSchema,
  operationsConfigSchema,
  reservationNoShowSchema,
  reservationPolicySchema,
  type LaunchAction,
  type LaunchControls,
} from '@dealdash/config';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { ref } from './ops-util';

/** rewards.rules: the fields operations may change (others are kept as they are). */
const rewardsRulesSchema = z
  .object({
    expiryDays: z.number().int().min(1).max(3650).nullable(),
    expiryReminderDays: z.number().int().min(0).max(90),
    lifetimeBalanceCap: z.number().int().min(1).nullable(),
    negativeBalancePolicy: z.enum(['ALLOW_NEGATIVE', 'HOLD_AT_ZERO']),
    adjustmentCheckerThresholdPoints: z.number().int().min(0),
    refundReversalRounding: z.enum(['FLOOR', 'NEAREST', 'CEIL']),
  })
  .passthrough();

/** The governed configurations and how each is validated. Nothing else can be changed from the controls screen. */
function schemaFor(key: string): z.ZodTypeAny | null {
  if (key === CONFIG_KEYS.OPERATIONS) return operationsConfigSchema;
  if (key === CONFIG_KEYS.LAUNCH_CONTROLS) return launchControlsSchema;
  if (key === CONFIG_KEYS.REWARDS_RULES) return rewardsRulesSchema;
  // 2026-10-15 reservation commitment model: baseline and market / category / merchant overrides (RC-10..RC-12)
  if (key === CONFIG_KEYS.RESERVATION_POLICY) return reservationPolicySchema;
  // RC-52 strike values (no-shows before new reservations are blocked), edited from the reservation policy screen
  if (key === CONFIG_KEYS.RESERVATION_NOSHOW) return reservationNoShowSchema;
  const s = (GOVERNED_SCALARS as Record<string, { min: number; max: number }>)[key];
  return s ? z.number().int().min(s.min).max(s.max) : null;
}
export const GOVERNED_KEYS = [
  CONFIG_KEYS.OPERATIONS,
  CONFIG_KEYS.LAUNCH_CONTROLS,
  CONFIG_KEYS.REWARDS_RULES,
  CONFIG_KEYS.RESERVATION_POLICY,
  CONFIG_KEYS.RESERVATION_NOSHOW,
  ...Object.keys(GOVERNED_SCALARS),
];

type Row = Prisma.ConfigChangeRequestGetPayload<object>;

/**
 * Stage 9 (B7): structured, governed rules and controls. Operators propose a change to one section; it is validated against the
 * configuration schema, then a DIFFERENT person with the configuration permission approves or rejects it. An approved change applies
 * at once, or at its effective time (scheduled), as a new configuration version with both values in the audit. A request made against
 * an older version is never applied over a newer one (superseded). Rollback restores an earlier version through the same approval.
 * Emergency market stops are the one exception: immediate, single-person, reason-recorded (they only ever stop NEW actions).
 */
@Injectable()
export class ConfigGovernanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly audit: AuditService,
  ) {}

  private async current(key: string) {
    const row = await this.prisma.systemConfiguration.findUnique({ where: { key } });
    return {
      value: row ? row.value : (CONFIG_DEFAULTS as Record<string, unknown>)[key],
      version: row?.version ?? 0,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  view(r: Row, actor?: Actor) {
    return {
      id: r.id,
      reference: r.reference,
      key: r.key,
      section: r.section,
      value: r.value,
      baseVersion: r.baseVersion,
      reason: r.reason,
      effectiveFrom: r.effectiveFrom?.toISOString() ?? null,
      status: r.status,
      restoresVersion: r.restoresVersion,
      requestedByUserId: r.requestedByUserId,
      decidedByUserId: r.decidedByUserId,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decisionReason: r.decisionReason,
      appliedVersion: r.appliedVersion,
      appliedAt: r.appliedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      canDecide:
        !!actor &&
        r.status === 'PENDING_APPROVAL' &&
        r.requestedByUserId !== actor.userId &&
        actor.permissions.has('admin.config.manage'),
      canCancel: !!actor && r.status === 'PENDING_APPROVAL' && r.requestedByUserId === actor.userId,
    };
  }

  /** Every governed configuration: current value, version and open requests. */
  async overview(actor: Actor) {
    const out = [];
    for (const key of GOVERNED_KEYS) {
      const cur = await this.current(key);
      const scalar = (
        GOVERNED_SCALARS as Record<string, { group: string; min: number; max: number }>
      )[key];
      out.push({
        key,
        ...cur,
        kind: scalar ? 'SCALAR' : 'OBJECT',
        group: scalar?.group ?? null,
        min: scalar?.min ?? null,
        max: scalar?.max ?? null,
      });
    }
    const open = await this.prisma.configChangeRequest.findMany({
      where: { status: { in: ['PENDING_APPROVAL', 'SCHEDULED'] } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const recent = await this.prisma.configChangeRequest.findMany({
      where: { status: { notIn: ['PENDING_APPROVAL', 'SCHEDULED'] } },
      orderBy: { updatedAt: 'desc' },
      take: 30,
    });
    return {
      configs: out,
      open: open.map((r) => this.view(r, actor)),
      recent: recent.map((r) => this.view(r, actor)),
    };
  }

  private validate(key: string, value: unknown) {
    const schema = schemaFor(key);
    if (!schema)
      throw AppError.validation('This setting is not edited from the controls screen', 'key');
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      const i = parsed.error.issues[0]!;
      throw AppError.validation(
        `${i.path.join('.') || key}: ${i.message}`,
        i.path.join('.') || 'value',
      );
    }
    return parsed.data as unknown;
  }

  async request(
    actor: Actor,
    b: {
      key: string;
      section: string;
      value: unknown;
      baseVersion: number;
      reason: string;
      effectiveFrom?: string | null;
      restoresVersion?: number | null;
    },
    meta: RequestMeta,
  ) {
    const value = this.validate(b.key, b.value);
    const cur = await this.current(b.key);
    if (b.baseVersion !== cur.version)
      throw new AppError(
        'CONFIG_CHANGE_STALE',
        'This setting changed since you opened it. Reload and make the change again.',
        409,
      );
    if (JSON.stringify(value) === JSON.stringify(cur.value))
      throw AppError.validation('Nothing would change', 'value');
    const effectiveFrom = b.effectiveFrom ? new Date(b.effectiveFrom) : null;
    if (effectiveFrom && effectiveFrom.getTime() < Date.now() - 60_000)
      throw AppError.validation('The effective time is in the past', 'effectiveFrom');
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.configChangeRequest.create({
        data: {
          reference: ref('CFG'),
          key: b.key,
          section: b.section,
          value: value as Prisma.InputJsonValue,
          baseVersion: cur.version,
          reason: b.reason,
          effectiveFrom,
          restoresVersion: b.restoresVersion ?? null,
          requestedByUserId: actor.userId,
        },
      });
      await this.audit.record(
        {
          action: 'CONFIG_CHANGE_REQUESTED',
          entityType: 'ConfigChangeRequest',
          entityId: r.id,
          actor,
          reason: b.reason,
          newState: {
            key: b.key,
            section: b.section,
            baseVersion: cur.version,
            effectiveFrom: effectiveFrom?.toISOString() ?? null,
            restoresVersion: b.restoresVersion ?? null,
          },
          meta,
        },
        tx,
      );
      return r;
    });
    return this.view(row, actor);
  }

  async decide(actor: Actor, id: string, approve: boolean, reason: string, meta: RequestMeta) {
    const r = await this.prisma.configChangeRequest.findUnique({ where: { id } });
    if (!r) throw AppError.notFound();
    if (r.status !== 'PENDING_APPROVAL')
      throw new AppError('INVALID_STATE', 'This request was already decided', 409);
    if (r.requestedByUserId === actor.userId)
      throw new AppError('CHECKER_REQUIRED', 'A different person must approve this change', 403);
    const now = new Date();
    const scheduled = approve && r.effectiveFrom && r.effectiveFrom > now;
    const upd = await this.prisma.configChangeRequest.updateMany({
      where: { id, status: 'PENDING_APPROVAL' },
      data: {
        status: approve ? (scheduled ? 'SCHEDULED' : 'PENDING_APPROVAL') : 'REJECTED',
        decidedByUserId: actor.userId,
        decidedAt: now,
        decisionReason: reason,
      },
    });
    if (upd.count !== 1)
      throw new AppError('VERSION_CONFLICT', 'The request changed. Reload and try again.', 409);
    await this.audit.record({
      action: approve ? 'CONFIG_CHANGE_APPROVED' : 'CONFIG_CHANGE_REJECTED',
      entityType: 'ConfigChangeRequest',
      entityId: id,
      actor,
      reason,
      approvalRef: r.requestedByUserId,
      newState: { key: r.key, section: r.section, scheduled: !!scheduled },
      meta,
    });
    if (approve && !scheduled) await this.apply(id, actor, meta);
    return this.view(
      await this.prisma.configChangeRequest.findUniqueOrThrow({ where: { id } }),
      actor,
    );
  }

  async cancel(actor: Actor, id: string, meta: RequestMeta) {
    const upd = await this.prisma.configChangeRequest.updateMany({
      where: { id, status: 'PENDING_APPROVAL', requestedByUserId: actor.userId },
      data: { status: 'CANCELLED' },
    });
    if (upd.count !== 1)
      throw new AppError('INVALID_STATE', 'Only your own pending request can be withdrawn', 409);
    await this.audit.record({
      action: 'CONFIG_CHANGE_CANCELLED',
      entityType: 'ConfigChangeRequest',
      entityId: id,
      actor,
      meta,
    });
    return this.view(
      await this.prisma.configChangeRequest.findUniqueOrThrow({ where: { id } }),
      actor,
    );
  }

  /** Applies an approved request as a new configuration version, unless the configuration moved on since (then: superseded). */
  private async apply(id: string, actor: Actor, meta: RequestMeta) {
    const r = await this.prisma.configChangeRequest.findUniqueOrThrow({ where: { id } });
    const cur = await this.current(r.key);
    if (cur.version !== r.baseVersion) {
      await this.prisma.configChangeRequest.update({
        where: { id },
        data: {
          status: 'SUPERSEDED',
          decisionReason:
            `${r.decisionReason ?? ''} (the setting changed to version ${cur.version} before this applied)`.trim(),
        },
      });
      await this.audit.record({
        action: 'CONFIG_CHANGE_SUPERSEDED',
        entityType: 'ConfigChangeRequest',
        entityId: id,
        actor,
        newState: { key: r.key, baseVersion: r.baseVersion, currentVersion: cur.version },
        meta,
      });
      return;
    }
    const saved = await this.config.set(
      r.key,
      this.validate(r.key, r.value),
      `${r.reference}: ${r.reason}`,
      actor,
      meta,
    );
    await this.prisma.configChangeRequest.update({
      where: { id },
      data: { status: 'APPLIED', appliedVersion: saved.version, appliedAt: new Date() },
    });
  }

  /** Job: applies approved requests whose effective time has come (as the approver). */
  async applyDue(now = new Date()) {
    const due = await this.prisma.configChangeRequest.findMany({
      where: { status: 'SCHEDULED', effectiveFrom: { lte: now } },
      orderBy: { effectiveFrom: 'asc' },
      take: 20,
    });
    for (const r of due) {
      const actor: Actor = {
        userId: r.decidedByUserId!,
        userType: 'ADMIN_USER',
        displayName: 'Scheduled configuration change',
        audience: 'admin',
        sessionId: 'job',
        mfaVerified: true,
        mfaRequired: true,
        membership: null,
        memberships: [],
        permissions: new Set(),
        viaCookie: false,
      };
      await this.apply(r.id, actor, {
        requestId: `job:${r.reference}`,
        ip: null,
        userAgent: 'ops.config job',
        locale: 'en',
      });
    }
    return due.length;
  }

  /** Version history of one governed configuration, with the values (from the audit), for review and rollback. */
  async history(key: string) {
    if (!schemaFor(key)) throw AppError.notFound();
    const rows = await this.prisma.auditLog.findMany({
      where: { entityType: 'SystemConfiguration', entityId: key, action: 'config.updated' },
      orderBy: { occurredAt: 'desc' },
      take: 50,
    });
    const out: Array<{
      at: string | null;
      version: number | null;
      actorUserId: string | null;
      actorRole: string | null;
      reason: string | null;
      value: unknown;
    }> = rows.map((a) => {
      const n = a.newState as { value?: unknown; version?: number } | null;
      return {
        at: a.occurredAt.toISOString(),
        version: n?.version ?? null,
        actorUserId: a.actorUserId,
        actorRole: a.actorRole,
        reason: a.reason,
        value: n?.value ?? null,
      };
    });
    // the first version was created by the catalog defaults (no audit row of its own): it is the previous value of the oldest change
    const oldest = rows.at(-1)?.previousState as
      { value?: unknown; version?: number } | null | undefined;
    if (oldest?.version && !out.some((x) => x.version === oldest.version))
      out.push({
        at: null,
        version: oldest.version,
        actorUserId: null,
        actorRole: null,
        reason: 'Initial value',
        value: oldest.value ?? null,
      });
    return out;
  }

  /** Rollback: proposes the value of an earlier version again (same approval path; nothing is rewritten). */
  async rollback(actor: Actor, key: string, version: number, reason: string, meta: RequestMeta) {
    const h = (await this.history(key)).find((x) => x.version === version);
    if (!h || h.value === null)
      throw AppError.validation('That version is not in the history', 'version');
    const cur = await this.current(key);
    return this.request(
      actor,
      {
        key,
        section: `ROLLBACK_TO_V${version}`,
        value: h.value,
        baseVersion: cur.version,
        reason,
        restoresVersion: version,
      },
      meta,
    );
  }

  /** Emergency market stop: immediate (one person, reason, audit). Stops refuse NEW actions only; issued rights stay valid. */
  async setStop(
    actor: Actor,
    b: { market: string; action: LaunchAction; stopped: boolean; reason: string },
    meta: RequestMeta,
  ) {
    if (!(LAUNCH_ACTIONS as readonly string[]).includes(b.action))
      throw AppError.validation('Unknown action', 'action');
    const cur = (await this.current(CONFIG_KEYS.LAUNCH_CONTROLS)).value as LaunchControls;
    const market = b.market.toUpperCase();
    const next: LaunchControls = {
      ...cur,
      stops: {
        ...cur.stops,
        [market]: {
          NEW_PURCHASES: false,
          NEW_RESERVATIONS: false,
          NEW_VIEWS: false,
          NEW_CAMPAIGNS: false,
          ...cur.stops[market],
          [b.action]: b.stopped,
        },
      },
    };
    await this.config.set(
      CONFIG_KEYS.LAUNCH_CONTROLS,
      this.validate(CONFIG_KEYS.LAUNCH_CONTROLS, next),
      `${b.stopped ? 'EMERGENCY STOP' : 'STOP LIFTED'} ${market} ${b.action}: ${b.reason}`,
      actor,
      meta,
    );
    await this.audit.record({
      action: b.stopped ? 'LAUNCH_STOP_PLACED' : 'LAUNCH_STOP_LIFTED',
      entityType: 'SystemConfiguration',
      entityId: CONFIG_KEYS.LAUNCH_CONTROLS,
      actor,
      reason: b.reason,
      market,
      newState: { market, action: b.action, stopped: b.stopped },
      meta,
    });
    return (await this.current(CONFIG_KEYS.LAUNCH_CONTROLS)).value;
  }
}
