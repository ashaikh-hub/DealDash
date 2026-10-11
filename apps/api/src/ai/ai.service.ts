import { randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { CONFIG_KEYS } from '@dealdash/config';
import {
  AI_AGENTS,
  AI_MVP_MAX_AUTONOMY,
  type AiAgent,
  type AiDraftKind,
  type AiStatementKind,
  type AlertCode,
  type PermissionCode,
  type TargetMetric,
} from '@dealdash/types';
import { AuditService } from '../audit/audit.service';
import { ReceivablesService } from '../billing/receivables.service';
import { ReconciliationService } from '../billing/reconciliation.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { Prisma } from '../generated/prisma/client';
import { HotDiscoveryService } from '../hot-deals/hot-discovery.service';
import { ReservationsService } from '../hot-deals/reservations.service';
import { DiscoveryService } from '../live-deals/discovery.service';
import { EntitlementService } from '../platform/entitlement.service';
import { MarketService } from '../platform/markets/market.service';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AlertsService } from '../visibility/alerts.service';
import { OperationsCentreService } from '../visibility/operations-centre.service';
import { DisputeService } from '../operations/dispute.service';
import { ReconciliationOpsService } from '../ops/reconciliation-ops.service';
import { SlaService } from '../ops/sla.service';
import { ReportingService, type VisProduct } from '../visibility/reporting.service';
import { TargetsService } from '../visibility/targets.service';
import { VoucherDiscoveryService } from '../vouchers/voucher-discovery.service';
import { WalletService } from '../vouchers/wallet.service';
import {
  AI_PROVIDER,
  grounded,
  numbersIn,
  resolveLocale,
  usableOffer,
  type AiProvider,
} from './ai-provider';

export interface AiGovernance {
  enabled: boolean;
  customerAgentEnabled: boolean;
  maxAutonomyLevel: number;
  boundedAutonomyEnabled: boolean;
  provider: string;
  model: string;
  estimatedCostPerRequestMinor: number;
  commercialTreatment: string;
  businessFeature: string;
}

export interface AskInput {
  message: string;
  locale?: string;
  autonomy?: number;
  organizationId?: string | null;
  context?: {
    city?: string;
    lat?: number;
    lng?: number;
    category?: string;
    customerUserId?: string;
    caseId?: string;
  };
}

export interface Statement {
  kind: AiStatementKind;
  text: string;
  sources: string[];
}

export interface Item {
  product: string;
  id: string;
  title: string;
  merchant: string | null;
  why: string[];
  reportedSavings: { amount: string; percent: number; basis: 'MERCHANT_REPORTED' } | null;
  endsAt: string | null;
  distanceMeters: number | null;
  href: string;
  action: { kind: 'VIEW' | 'RESERVE' | 'BUY' | 'UNLOCK'; requiresConfirmation: boolean };
}

export interface DraftOut {
  id: string;
  kind: AiDraftKind;
  title: string;
  status: string;
  label: 'AI_DRAFTED';
  requiresApprovalBy: string;
  payload: unknown;
}

interface Ctx {
  id: string;
  actor: Actor;
  agent: AiAgent;
  organizationId: string | null;
  locale: 'en' | 'ar';
  autonomy: number;
  allowed: Set<string>;
  statements: Statement[];
  items: Item[];
  drafts: DraftOut[];
  actions: Array<{
    label: string;
    href: string;
    requiresConfirmation: boolean;
    permission: string | null;
  }>;
  calls: Array<{
    tool: string;
    tier: 'READ' | 'DRAFT' | 'EXECUTE';
    state: string;
    input: unknown;
    output: unknown;
  }>;
  handoff: { available: boolean; reason: string | null } | null;
  dropped: number;
}

const D = 86_400_000;
const AUDIENCE_AGENTS: Record<string, AiAgent[]> = {
  customer: ['CUSTOMER_BEST_DEAL'],
  merchant: ['MERCHANT_GROWTH'],
  partner: ['PARTNER_CAMPAIGN'],
  admin: ['OPERATIONS_SUPPORT', 'ADMIN_FINANCE'],
};
const USE_PERMISSION: Record<string, PermissionCode> = {
  customer: 'customer.ai.use',
  merchant: 'merchant.ai.use',
  partner: 'partner.ai.use',
  admin: 'admin.ai.use',
};
const APPROVE_PERMISSION: Record<string, PermissionCode> = {
  merchant: 'merchant.ai.approve',
  partner: 'partner.ai.approve',
  admin: 'admin.ai.manage',
};
const DEFAULT_GOVERNANCE: AiGovernance = {
  enabled: true,
  customerAgentEnabled: true,
  maxAutonomyLevel: 3,
  boundedAutonomyEnabled: false,
  provider: 'BUILTIN',
  model: 'dealdash-rules-v1',
  estimatedCostPerRequestMinor: 0,
  commercialTreatment: 'INCLUDED_FEATURE',
  businessFeature: 'AI_COPILOT',
};
const PRODUCT_TARGET: Partial<Record<VisProduct, { metric: TargetMetric; key: string }>> = {
  EXCLUSIVE: { metric: 'REDEMPTIONS', key: 'exclusive.verified_redemptions' },
  VOUCHER: { metric: 'VOUCHER_SALES', key: 'voucher.sales_value' },
  WATCH: { metric: 'QUALIFIED_VIEWS', key: 'watch.qualified_views' },
  LIVE: { metric: 'IMPRESSIONS', key: 'live.impressions' },
};
const PRODUCT_NAME: Record<string, [string, string]> = {
  LIVE: ['Live Deals', 'العروض المباشرة'],
  EXCLUSIVE: ['Exclusive Deals', 'العروض الحصرية'],
  VOUCHER: ['Vouchers', 'القسائم'],
  WATCH: ['Watch & Earn', 'شاهد واكسب'],
  LOYALTY: ['Loyalty', 'برنامج الولاء'],
};

/**
 * Governed AI agents. Agent -> authorised tool -> the EXISTING service, called as the requesting person (RBAC, scope, entitlement and
 * business rules all apply) -> audit. No tool reads the database around a service's rules for business data; nothing is published,
 * paid, reserved, redeemed or committed by an agent. Drafts wait for a person with the right permission; only then a tool executes,
 * again as that person. Every interaction, tool call, draft, approval and execution is recorded (append-only) and metered.
 */
@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementService,
    private readonly reporting: ReportingService,
    private readonly targets: TargetsService,
    private readonly alerts: AlertsService,
    private readonly ops: OperationsCentreService,
    private readonly receivables: ReceivablesService,
    private readonly reconciliation: ReconciliationService,
    private readonly moduleRef: ModuleRef,
    private readonly markets: MarketService,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
  ) {}

  async governance(): Promise<AiGovernance> {
    return {
      ...DEFAULT_GOVERNANCE,
      ...((await this.config.get<Partial<AiGovernance>>(CONFIG_KEYS.AI_GOVERNANCE)) ?? {}),
    };
  }

  private svc<T>(type: new (...args: never[]) => T): T {
    return this.moduleRef.get(type, { strict: false });
  }

  // ---------------------------------------------------------------- governance
  /** Who may use which agent, for which organization, at which autonomy level. Throws; the caller records the denial. */
  async authorize(
    actor: Actor,
    agent: AiAgent,
    input: AskInput,
    g: AiGovernance,
  ): Promise<{ organizationId: string | null; autonomy: number }> {
    if (!(AI_AGENTS as readonly string[]).includes(agent)) throw AppError.notFound();
    if (!g.enabled) throw new AppError('AI_NOT_ENTITLED', 'AI assistance is switched off', 403);
    if (!AUDIENCE_AGENTS[actor.audience]?.includes(agent))
      throw new AppError('AI_NOT_ENTITLED', 'This assistant is not available here', 403);
    if (!actor.permissions.has(USE_PERMISSION[actor.audience]!)) throw AppError.forbidden();
    const autonomy = input.autonomy ?? 1;
    if (autonomy >= 5)
      throw new AppError(
        'AI_AUTONOMY_EXCEEDED',
        'Fully autonomous financial or commercial action is not available',
        403,
      );
    if (autonomy === 4 && !g.boundedAutonomyEnabled)
      throw new AppError(
        'AI_AUTONOMY_EXCEEDED',
        'Bounded autonomy is not enabled: every action needs a person to approve it',
        403,
      );
    if (autonomy > Math.min(g.maxAutonomyLevel, AI_MVP_MAX_AUTONOMY) && autonomy !== 4)
      throw new AppError('AI_AUTONOMY_EXCEEDED', 'This autonomy level is not allowed', 403);
    if (agent === 'CUSTOMER_BEST_DEAL') {
      if (!g.customerAgentEnabled)
        throw new AppError('AI_NOT_ENTITLED', 'The deal assistant is not available right now', 403);
      return { organizationId: null, autonomy: Math.min(autonomy, 1) };
    }
    if (actor.audience === 'admin')
      return { organizationId: input.organizationId ?? null, autonomy };
    const m = actor.membership;
    if (!m || !input.organizationId || m.organizationId !== input.organizationId)
      throw AppError.notFound();
    const e = await this.entitlements.effective(m.organizationId);
    if (!e.features.includes(g.businessFeature))
      throw new AppError(
        'AI_NOT_ENTITLED',
        `Your contract does not include ${g.businessFeature}`,
        403,
      );
    // AI must also be switched on in the business's market (product availability is per country)
    await this.markets.requireAvailable(m.organizationId, 'AI_ASSISTANT');
    return { organizationId: m.organizationId, autonomy };
  }

  // ---------------------------------------------------------------- the conversation turn
  async ask(actor: Actor, agent: AiAgent, input: AskInput) {
    const g = await this.governance();
    const { locale, localeNote } = resolveLocale(input.locale);
    let auth: { organizationId: string | null; autonomy: number };
    try {
      auth = await this.authorize(actor, agent, input, g);
    } catch (e) {
      await this.record(
        null,
        actor,
        agent,
        input,
        locale,
        'DENIED',
        { error: (e as AppError).code ?? 'DENIED' },
        g,
        'DENIED',
      );
      throw e;
    }
    const { intent } = this.provider.classify(agent, input.message);
    const ctx: Ctx = {
      id: randomUUID(),
      actor,
      agent,
      organizationId: auth.organizationId,
      locale,
      autonomy: auth.autonomy,
      allowed: new Set(),
      statements: [],
      items: [],
      drafts: [],
      actions: [],
      calls: [],
      handoff: null,
      dropped: 0,
    };
    try {
      await this.route(ctx, intent, input);
    } catch (e) {
      await this.record(
        ctx,
        actor,
        agent,
        input,
        locale,
        intent,
        { error: (e as AppError).code ?? 'ERROR' },
        g,
        e instanceof AppError && e.getStatus() < 500 ? 'DENIED' : 'ERROR',
      );
      throw e;
    }
    // grounding: a statement whose numbers did not come from a tool result is never shown
    const statements = ctx.statements.filter((s) => {
      const ok = grounded(s.text, ctx.allowed);
      if (!ok) ctx.dropped++;
      return ok;
    });
    const answer = {
      interactionId: ctx.id,
      agent,
      intent,
      label: 'AI_SUGGESTED' as const,
      locale,
      localeNote,
      autonomyLevel: ctx.autonomy,
      statements,
      items: ctx.items,
      drafts: ctx.drafts,
      actions: ctx.actions,
      handoff: ctx.handoff,
      grounding: { checked: ctx.statements.length, dropped: ctx.dropped },
      disclaimer: this.t(
        ctx,
        'AI suggestions can be incomplete. Figures come from your DealDash data; forecasts and targets are estimates, never guarantees.',
        'قد تكون اقتراحات الذكاء الاصطناعي غير مكتملة. الأرقام مأخوذة من بياناتك في DealDash، والتوقعات والأهداف تقديرات وليست ضمانات.',
      ),
    };
    await this.record(ctx, actor, agent, input, locale, intent, answer, g, 'ANSWERED');
    return answer;
  }

  private async record(
    ctx: Ctx | null,
    actor: Actor,
    agent: AiAgent,
    input: AskInput,
    locale: string,
    intent: string,
    answer: unknown,
    g: AiGovernance,
    status: 'ANSWERED' | 'DENIED' | 'ERROR',
  ) {
    const id = ctx?.id ?? randomUUID();
    const org =
      ctx?.organizationId ??
      (actor.audience === 'customer' ? null : (actor.membership?.organizationId ?? null));
    await this.prisma.$transaction(async (tx) => {
      await tx.aiInteraction.create({
        data: {
          id,
          agent,
          userId: actor.userId,
          organizationId: org,
          roleCode: actor.membership?.roleCode ?? null,
          scope: {
            branchId: actor.membership?.branchId ?? null,
            scoped: actor.membership?.scoped ?? false,
          } as Prisma.InputJsonValue,
          locale,
          request: input.message.slice(0, 2000),
          intent,
          autonomyLevel: Math.min(5, Math.max(0, ctx?.autonomy ?? input.autonomy ?? 1)),
          status,
          answer: answer as Prisma.InputJsonValue,
          provider: g.provider,
          model: g.model,
          unitsIn: input.message.length,
          unitsOut: JSON.stringify(answer).length,
          toolCalls: ctx?.calls.length ?? 0,
          estimatedCostMinor: g.estimatedCostPerRequestMinor,
        },
      });
      if (ctx?.calls.length)
        await tx.aiAction.createMany({
          data: ctx.calls.map((c) => ({
            interactionId: id,
            tool: c.tool,
            tier: c.tier,
            state: c.state,
            input: c.input as Prisma.InputJsonValue,
            outputSummary: c.output as Prisma.InputJsonValue,
            actorUserId: actor.userId,
            organizationId: org,
          })),
        });
      const usage: Prisma.AiUsageRecordCreateManyInput[] = [
        {
          interactionId: id,
          organizationId: org,
          agent,
          kind: agent === 'OPERATIONS_SUPPORT' ? 'SUPPORT_ASSIST' : 'REQUEST',
          units: 1,
          provider: g.provider,
          model: g.model,
          estimatedCostMinor: g.estimatedCostPerRequestMinor,
        },
      ];
      if (ctx?.calls.length)
        usage.push({
          interactionId: id,
          organizationId: org,
          agent,
          kind: 'TOOL_CALL',
          units: ctx.calls.length,
          provider: g.provider,
          model: g.model,
          estimatedCostMinor: 0,
        });
      if (ctx?.drafts.length)
        usage.push({
          interactionId: id,
          organizationId: org,
          agent,
          kind: 'DRAFT',
          units: ctx.drafts.length,
          provider: g.provider,
          model: g.model,
          estimatedCostMinor: 0,
        });
      await tx.aiUsageRecord.createMany({ data: usage });
    });
  }

  // ---------------------------------------------------------------- helpers
  /** Text that came from a tool result (a title, a merchant or legal name, an eligibility message): its numbers are grounded. */
  private src(ctx: Ctx, text: string | null | undefined) {
    for (const n of numbersIn(text ?? '')) {
      ctx.allowed.add(n);
      ctx.allowed.add(String(Number(n)));
    }
    return text ?? '';
  }
  private t(ctx: Ctx, en: string, ar: string) {
    return ctx.locale === 'ar' ? ar : en;
  }
  private n(ctx: Ctx, v: number) {
    ctx.allowed.add(String(v));
    return String(v);
  }
  private money(ctx: Ctx, minor: number, currency = 'SAR') {
    const s = (minor / 100).toFixed(2);
    ctx.allowed.add(s);
    ctx.allowed.add(String(Number(s)));
    return `${currency} ${s}`;
  }
  private pct(ctx: Ctx, bps: number) {
    const s = (bps / 100).toFixed(1);
    ctx.allowed.add(s);
    ctx.allowed.add(String(Number(s)));
    return `${s}%`;
  }
  private date(ctx: Ctx, iso: string | null) {
    if (!iso) return '';
    const d = iso.slice(0, 10);
    for (const p of d.split('-')) {
      ctx.allowed.add(p);
      ctx.allowed.add(String(Number(p)));
    }
    return d;
  }
  private say(ctx: Ctx, kind: AiStatementKind, en: string, ar: string, sources: string[]) {
    ctx.statements.push({ kind, text: this.t(ctx, en, ar), sources });
  }

  /** Every tool call: permission check as the requesting person, then the existing service, then the audit record. */
  private async tool<T>(
    ctx: Ctx,
    name: string,
    tier: 'READ' | 'DRAFT' | 'EXECUTE',
    permission: PermissionCode | null,
    input: unknown,
    run: () => Promise<T>,
    summary: (r: T) => unknown = () => ({}),
  ): Promise<T> {
    if (permission && !ctx.actor.permissions.has(permission)) {
      ctx.calls.push({
        tool: name,
        tier,
        state: 'DENIED',
        input,
        output: { reason: 'PERMISSION' },
      });
      throw new AppError('AI_TOOL_DENIED', 'You do not have access to this information', 403);
    }
    try {
      const r = await run();
      ctx.calls.push({
        tool: name,
        tier,
        state: tier === 'DRAFT' ? 'DRAFTED' : 'SUGGESTED',
        input,
        output: summary(r),
      });
      return r;
    } catch (e) {
      ctx.calls.push({
        tool: name,
        tier,
        state: 'DENIED',
        input,
        output: { error: (e as AppError).code ?? 'ERROR' },
      });
      throw e;
    }
  }

  private async route(ctx: Ctx, intent: string, input: AskInput) {
    switch (ctx.agent) {
      case 'CUSTOMER_BEST_DEAL':
        return this.customer(ctx, intent, input);
      case 'MERCHANT_GROWTH':
      case 'PARTNER_CAMPAIGN':
        return this.business(ctx, intent, input);
      case 'OPERATIONS_SUPPORT':
        return this.operations(ctx, intent, input);
      case 'ADMIN_FINANCE':
        return this.finance(ctx);
    }
  }

  // ---------------------------------------------------------------- 1. Customer Best-Deal agent
  private async customer(ctx: Ctx, intent: string, input: AskInput) {
    const userId = ctx.actor.userId;
    if (intent === 'TRANSACT') {
      // never executed by the agent: payment, purchase, reservation, points spending and redemption need the customer's own confirmation
      this.say(
        ctx,
        'OBSERVED_FACT',
        'I can’t buy, reserve, pay, spend points or redeem for you. I can find the offer; you confirm it yourself in the app.',
        'لا يمكنني الشراء أو الحجز أو الدفع أو صرف النقاط أو الاستبدال نيابةً عنك. يمكنني إيجاد العرض، وأنت تؤكده بنفسك في التطبيق.',
        [],
      );
      return this.bestDeals(ctx, input);
    }
    if (intent === 'MY_POINTS') {
      const acc = await this.tool(
        ctx,
        'loyalty.balance',
        'READ',
        'customer.ai.use',
        {},
        () =>
          this.prisma.rewardAccount.findUnique({
            where: { userId },
            select: { id: true, availableBalance: true, heldBalance: true },
          }),
        (r) => ({ found: !!r }),
      );
      const bal = acc?.availableBalance ?? 0;
      this.say(
        ctx,
        'OBSERVED_FACT',
        `You have ${this.n(ctx, bal)} points available.`,
        `لديك ${this.n(ctx, bal)} نقطة متاحة.`,
        ['loyalty.balance'],
      );
      if (acc) {
        const soon = await this.tool(
          ctx,
          'loyalty.expiring',
          'READ',
          'customer.ai.use',
          { days: 30 },
          () =>
            this.prisma.rewardLot.aggregate({
              where: {
                accountId: acc.id,
                remaining: { gt: 0 },
                expiresAt: { gt: new Date(), lte: new Date(Date.now() + 30 * D) },
              },
              _sum: { remaining: true },
            }),
          (r) => ({ points: r._sum.remaining ?? 0 }),
        );
        const pts = soon._sum.remaining ?? 0;
        if (pts > 0)
          this.say(
            ctx,
            'OBSERVED_FACT',
            `${this.n(ctx, pts)} of them expire within ${this.n(ctx, 30)} days.`,
            `تنتهي صلاحية ${this.n(ctx, pts)} منها خلال ${this.n(ctx, 30)} يومًا.`,
            ['loyalty.expiring'],
          );
      }
      ctx.actions.push({
        label: this.t(ctx, 'Open my points', 'افتح نقاطي'),
        href: '/points',
        requiresConfirmation: false,
        permission: null,
      });
      ctx.actions.push({
        label: this.t(ctx, 'Spend points (you confirm)', 'اصرف النقاط (بتأكيدك)'),
        href: '/rewards',
        requiresConfirmation: true,
        permission: null,
      });
      return;
    }
    if (intent === 'MY_VOUCHERS') {
      const wallet = this.svc(WalletService);
      const items = await this.tool(
        ctx,
        'wallet.active',
        'READ',
        'customer.ai.use',
        { tab: 'active' },
        () => wallet.list(userId, 'active', 20),
        (r) => ({ count: (r as unknown[]).length }),
      );
      const list = items as unknown as Array<{
        id: string;
        title: { en: string; ar: string };
        expiresAt: string;
        merchantName: { en: string; ar: string };
      }>;
      this.say(
        ctx,
        'OBSERVED_FACT',
        `You have ${this.n(ctx, list.length)} active vouchers.`,
        `لديك ${this.n(ctx, list.length)} قسيمة نشطة.`,
        ['wallet.active'],
      );
      const soon = list
        .filter((v) => new Date(v.expiresAt).getTime() - Date.now() < 7 * D)
        .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
      for (const v of soon.slice(0, 3)) {
        this.src(ctx, `${v.title.en} ${v.title.ar} ${v.merchantName.en} ${v.merchantName.ar}`);
        this.say(
          ctx,
          'RECOMMENDATION',
          `Use “${v.title.en}” at ${v.merchantName.en} before ${this.date(ctx, v.expiresAt)}.`,
          `استخدم «${v.title.ar}» لدى ${v.merchantName.ar} قبل ${this.date(ctx, v.expiresAt)}.`,
          ['wallet.active'],
        );
      }
      ctx.actions.push({
        label: this.t(ctx, 'Open my wallet', 'افتح محفظتي'),
        href: '/wallet',
        requiresConfirmation: false,
        permission: null,
      });
      return;
    }
    if (intent === 'MY_RESERVATIONS') {
      const res = this.svc(ReservationsService);
      const list = await this.tool(
        ctx,
        'reservations.active',
        'READ',
        'customer.ai.use',
        { tab: 'active' },
        () => res.listMine(userId, 'active', 10),
        (r) => ({ count: r.length }),
      );
      this.say(
        ctx,
        'OBSERVED_FACT',
        `You have ${this.n(ctx, list.length)} active reservations.`,
        `لديك ${this.n(ctx, list.length)} حجز نشط.`,
        ['reservations.active'],
      );
      ctx.actions.push({
        label: this.t(ctx, 'Open my reservations', 'افتح حجوزاتي'),
        href: '/reservations',
        requiresConfirmation: false,
        permission: null,
      });
      return;
    }
    return this.bestDeals(ctx, input);
  }

  /** Offers the customer is ELIGIBLE for and that are AVAILABLE now, ranked, each with the reason; locked offers only as unlock hints. */
  private async bestDeals(ctx: Ctx, input: AskInput) {
    const c = input.context ?? {};
    const userId = ctx.actor.userId;
    const params = {
      city: c.city,
      lat: c.lat,
      lng: c.lng,
      category: c.category,
      limit: 20,
      eligibility: 'all' as const,
    };
    type Card = {
      id: string;
      title: { en: string; ar: string };
      merchantName: { en: string; ar: string };
      endsAt?: string | null;
      distanceMeters: number | null;
      eligibility?: { result: string; kind: string; message: { en: string; ar: string } | null };
      availability?: string;
      soldOut?: boolean;
      reportedSavingsHalalas?: number;
      reportedSavingsPercent?: number;
      saleEndsAt?: string | null;
      reservationsEnabled?: boolean;
    };
    const live = await this.tool(
      ctx,
      'deals.live',
      'READ',
      'customer.ai.use',
      params,
      () => this.svc(DiscoveryService).list(params, userId),
      (r) => ({ count: r.items.length }),
    );
    const exclusive = await this.tool(
      ctx,
      'deals.exclusive',
      'READ',
      'customer.ai.use',
      params,
      () => this.svc(HotDiscoveryService).list(params, userId),
      (r) => ({ count: r.items.length }),
    );
    const vouchers = await this.tool(
      ctx,
      'vouchers.catalog',
      'READ',
      'customer.ai.use',
      params,
      () => this.svc(VoucherDiscoveryService).list(params, userId),
      (r) => ({ count: r.items.length }),
    );
    const usable = (x: Card) => usableOffer(x);
    const locked = [
      ...(live.items as unknown as Card[]),
      ...(exclusive.items as unknown as Card[]),
    ].filter((x) => x.eligibility?.result === 'LOCKED_UNLOCKABLE');
    const pick: Array<{ product: string; card: Card }> = [
      ...(exclusive.items as unknown as Card[])
        .filter(usable)
        .sort((a, b) => (a.endsAt ?? '9').localeCompare(b.endsAt ?? '9'))
        .map((card) => ({ product: 'EXCLUSIVE', card })),
      ...(vouchers.items as unknown as Card[])
        .filter(usable)
        .sort((a, b) => (b.reportedSavingsPercent ?? 0) - (a.reportedSavingsPercent ?? 0))
        .map((card) => ({ product: 'VOUCHER', card })),
      ...(live.items as unknown as Card[])
        .filter(usable)
        .sort((a, b) => (a.distanceMeters ?? 1e12) - (b.distanceMeters ?? 1e12))
        .map((card) => ({ product: 'LIVE', card })),
    ].slice(0, 6);
    const href = (p: string, id: string) =>
      p === 'EXCLUSIVE' ? `/exclusive/${id}` : p === 'VOUCHER' ? `/vouchers/${id}` : `/deals/${id}`;
    for (const { product, card } of pick) {
      const why: string[] = [
        this.t(
          ctx,
          card.eligibility && card.eligibility.kind !== 'PUBLIC'
            ? 'You are eligible through your membership'
            : 'Open to everyone, available now',
          card.eligibility && card.eligibility.kind !== 'PUBLIC'
            ? 'أنت مؤهل من خلال عضويتك'
            : 'متاح للجميع الآن',
        ),
      ];
      if (card.distanceMeters !== null && card.distanceMeters !== undefined)
        why.push(
          this.t(
            ctx,
            `About ${this.n(ctx, Math.round(card.distanceMeters / 100) / 10)} km away`,
            `على بعد ${this.n(ctx, Math.round(card.distanceMeters / 100) / 10)} كم تقريبًا`,
          ),
        );
      const ends = card.endsAt ?? card.saleEndsAt ?? null;
      if (ends && new Date(ends).getTime() - Date.now() < 2 * D)
        why.push(this.t(ctx, `Ends ${this.date(ctx, ends)}`, `ينتهي ${this.date(ctx, ends)}`));
      ctx.items.push({
        product,
        id: card.id,
        title: this.src(ctx, this.t(ctx, card.title.en, card.title.ar)),
        merchant: card.merchantName
          ? this.src(ctx, this.t(ctx, card.merchantName.en, card.merchantName.ar))
          : null,
        why,
        // savings only where the merchant states a face value; never computed or promised by the assistant
        reportedSavings:
          product === 'VOUCHER' && card.reportedSavingsHalalas
            ? {
                amount: this.money(ctx, card.reportedSavingsHalalas),
                percent: card.reportedSavingsPercent ?? 0,
                basis: 'MERCHANT_REPORTED',
              }
            : null,
        endsAt: ends,
        distanceMeters: card.distanceMeters ?? null,
        href: href(product, card.id),
        action: {
          kind:
            product === 'VOUCHER'
              ? 'BUY'
              : product === 'EXCLUSIVE' && card.reservationsEnabled
                ? 'RESERVE'
                : 'VIEW',
          requiresConfirmation:
            product === 'VOUCHER' || (product === 'EXCLUSIVE' && !!card.reservationsEnabled),
        },
      });
    }
    if (!pick.length)
      this.say(
        ctx,
        'OBSERVED_FACT',
        'I could not find an offer you can use right now here. Try another area or category.',
        'لم أجد عرضًا يمكنك استخدامه الآن هنا. جرّب منطقة أو فئة أخرى.',
        ['deals.live', 'deals.exclusive', 'vouchers.catalog'],
      );
    else {
      this.say(
        ctx,
        'OBSERVED_FACT',
        `${this.n(ctx, pick.length)} offers you can use now.`,
        `${this.n(ctx, pick.length)} عروض يمكنك استخدامها الآن.`,
        ['deals.live', 'deals.exclusive', 'vouchers.catalog'],
      );
      const top = ctx.items[0]!;
      this.say(
        ctx,
        'RECOMMENDATION',
        `Start with “${top.title}”: ${top.why.join('; ')}.`,
        `ابدأ بـ «${top.title}»: ${top.why.join('؛ ')}.`,
        ['deals.live', 'deals.exclusive', 'vouchers.catalog'],
      );
      if (ctx.items.some((i) => i.reportedSavings))
        this.say(
          ctx,
          'OBSERVED_FACT',
          'Voucher savings are as stated by the merchant; what you save depends on what you buy.',
          'التوفير في القسائم كما يذكره التاجر، وما توفره فعليًا يعتمد على ما تشتريه.',
          ['vouchers.catalog'],
        );
    }
    if (locked.length) {
      const l = locked[0]!;
      this.src(ctx, `${l.eligibility?.message?.en ?? ''} ${l.eligibility?.message?.ar ?? ''}`);
      this.say(
        ctx,
        'RECOMMENDATION',
        `${this.n(ctx, locked.length)} more offers unlock when you ${l.eligibility?.message?.en ?? 'verify your membership'}.`,
        `${this.n(ctx, locked.length)} عروض إضافية تُفتح عند ${l.eligibility?.message?.ar ?? 'توثيق عضويتك'}.`,
        ['deals.live', 'deals.exclusive'],
      );
    }
  }

  // ---------------------------------------------------------------- 2. Merchant Growth / 3. Partner Campaign copilot
  private async business(ctx: Ctx, intent: string, input: AskInput) {
    const orgId = ctx.organizationId!;
    const partner = ctx.agent === 'PARTNER_CAMPAIGN';
    const perm = (p: string) => `${partner ? 'partner' : 'merchant'}.${p}` as PermissionCode;
    const access = await this.tool(
      ctx,
      'performance.access',
      'READ',
      perm('performance.read'),
      { orgId },
      () => this.reporting.resolve(ctx.actor, orgId),
      (a) => ({ scoped: !!a.branchAllowList, advanced: a.advanced }),
    );
    const now = new Date();
    const from30 = new Date(now.getTime() - 30 * D);
    const ov = await this.tool(
      ctx,
      'performance.overview',
      'READ',
      perm('performance.read'),
      { days: 30 },
      () => this.reporting.overview(access, from30, now),
      (r) => ({ products: r.products.length }),
    );
    const recent = await this.tool(
      ctx,
      'performance.trend',
      'READ',
      perm('performance.read'),
      { days: 7 },
      () => this.reporting.overview(access, new Date(now.getTime() - 7 * D), now),
    );
    const prior = await this.tool(
      ctx,
      'performance.trend.prior',
      'READ',
      perm('performance.read'),
      { days: 7, offset: 7 },
      () =>
        this.reporting.overview(
          access,
          new Date(now.getTime() - 14 * D),
          new Date(now.getTime() - 7 * D),
        ),
    );
    const metric = (o: typeof ov, p: string, k: string) =>
      (o.products.find((x) => x.product === p)?.metrics[k] ?? null) as number | null;
    const active = ov.products.filter((p) => p.entitled);

    if (intent === 'DRAFT_TARGETS' && !partner)
      return this.draftTargets(
        ctx,
        active.map((p) => p.product as VisProduct),
        (p, k) => metric(ov, p, k),
        input,
      );
    if (intent === 'DRAFT_ALERTS' && !partner) return this.draftAlerts(ctx);
    if (intent === 'CAMPAIGN_PLAN' || intent === 'CAMPAIGN_PORTFOLIO')
      return this.draftPlan(
        ctx,
        input,
        active.map((p) => p.product),
        (p, k) => metric(ov, p, k),
      );
    if (intent === 'ALERTS') {
      const list = await this.tool(
        ctx,
        'alerts.open',
        'READ',
        perm('performance.read'),
        { status: 'OPEN' },
        () => this.alerts.list({ organizationId: orgId, status: 'OPEN', take: 20 }),
        (r) => ({ count: r.length }),
      );
      const visible = access.branchAllowList
        ? list.filter((a) => !a.branchId || access.branchAllowList!.has(a.branchId))
        : list;
      this.say(
        ctx,
        'OBSERVED_FACT',
        `${this.n(ctx, visible.length)} open alerts.`,
        `${this.n(ctx, visible.length)} تنبيهات مفتوحة.`,
        ['alerts.open'],
      );
      for (const a of visible.slice(0, 5))
        ctx.actions.push({
          label: `${a.code} → ${a.action ?? 'VIEW'}`,
          href: a.actionHref ?? '/performance',
          requiresConfirmation: a.action === 'ADD_BUDGET' || a.action === 'ADD_INVENTORY',
          permission: a.actionPermission ?? null,
        });
      return;
    }
    // PERFORMANCE_SUMMARY
    for (const p of active) {
      const name = PRODUCT_NAME[p.product]!;
      const facts: Array<[string, string, string]> = [];
      const add = (k: string, en: string, ar: string, fmt: 'n' | 'money' | 'pct' = 'n') => {
        const v = p.metrics[k];
        if (v === null || v === undefined) return;
        const s =
          fmt === 'money' ? this.money(ctx, v) : fmt === 'pct' ? this.pct(ctx, v) : this.n(ctx, v);
        facts.push([k, `${en} ${s}`, `${ar} ${s}`]);
      };
      if (p.product === 'LIVE') {
        add('live.impressions', 'impressions', 'مرات الظهور');
        add('live.detail_views', 'detail views', 'مشاهدات التفاصيل');
        add('live.directions', 'direction requests (not visits)', 'طلبات الاتجاهات (ليست زيارات)');
      }
      if (p.product === 'EXCLUSIVE') {
        add(
          'exclusive.credentials_issued',
          'reservations / codes issued',
          'الحجوزات / الرموز الصادرة',
        );
        add('exclusive.verified_redemptions', 'verified redemptions', 'عمليات الاسترداد الموثقة');
        add('exclusive.redemption_rate', 'redemption rate', 'نسبة الاسترداد', 'pct');
      }
      if (p.product === 'VOUCHER') {
        add('voucher.purchases', 'purchases', 'عمليات الشراء');
        add('voucher.redeemed', 'redeemed', 'المستردة');
        add('voucher.sales_value', 'sales', 'المبيعات', 'money');
      }
      if (p.product === 'WATCH') {
        add('watch.qualified_views', 'qualified views', 'المشاهدات المؤهلة');
        add('watch.spend', 'spend', 'الإنفاق', 'money');
        add('watch.remaining_budget', 'budget remaining', 'الميزانية المتبقية', 'money');
      }
      if (p.product === 'LOYALTY') {
        add('loyalty.points_issued', 'points issued', 'النقاط الممنوحة');
        add('loyalty.points_redeemed', 'points redeemed', 'النقاط المستبدلة');
        add(
          'loyalty.points_remaining',
          'points outstanding (liability)',
          'النقاط القائمة (التزام)',
        );
      }
      if (!facts.length) continue;
      this.say(
        ctx,
        'OBSERVED_FACT',
        `${name[0]}, last 30 days: ${facts.map((f) => f[1]).join(', ')}.`,
        `${name[1]} خلال آخر 30 يومًا: ${facts.map((f) => f[2]).join('، ')}.`,
        ['performance.overview'],
      );
      ctx.allowed.add('30');
      const key = PRODUCT_TARGET[p.product as VisProduct]?.key;
      if (key) {
        const a = metric(recent, p.product, key) ?? 0;
        const b = metric(prior, p.product, key) ?? 0;
        if (a || b) {
          const dir = a > b ? ['up', 'ارتفاع'] : a < b ? ['down', 'انخفاض'] : ['flat', 'ثبات'];
          // money metrics (voucher sales) are shown as money, never as a bare minor-unit number
          const fmt = (v: number) =>
            key === 'voucher.sales_value' ? this.money(ctx, v) : this.n(ctx, v);
          this.say(
            ctx,
            'CALCULATED_TREND',
            `${name[0]}: last 7 days ${fmt(a)} vs ${fmt(b)} the 7 days before (${dir[0]}).`,
            `${name[1]}: آخر 7 أيام ${fmt(a)} مقابل ${fmt(b)} في الأيام السبعة السابقة (${dir[1]}).`,
            ['performance.trend', 'performance.trend.prior'],
          );
          ctx.allowed.add('7');
        }
      }
    }
    const issued = metric(ov, 'EXCLUSIVE', 'exclusive.credentials_issued') ?? 0;
    const rate = metric(ov, 'EXCLUSIVE', 'exclusive.redemption_rate');
    if (issued >= 5 && rate !== null && rate < 5000) {
      this.say(
        ctx,
        'HYPOTHESIS',
        'Many reservations are not being redeemed; customers may be reserving without visiting.',
        'كثير من الحجوزات لا يتم استردادها؛ قد يحجز العملاء دون الزيارة.',
        ['performance.overview'],
      );
      this.say(
        ctx,
        'RECOMMENDATION',
        'Consider a shorter hold time or clearer redemption instructions. Any change goes through your normal review and acceptance.',
        'فكّر في مدة حجز أقصر أو تعليمات استرداد أوضح. أي تغيير يمر بالمراجعة والقبول المعتادين.',
        ['performance.overview'],
      );
    }
    const remaining = metric(ov, 'EXCLUSIVE', 'exclusive.inventory_remaining');
    if (remaining === 0 && issued > 0)
      this.say(
        ctx,
        'RECOMMENDATION',
        'Your Exclusive Deal inventory is used up. You can add inventory; extra inventory needs your acceptance of the updated quotation.',
        'نفد مخزون عروضك الحصرية. يمكنك إضافة مخزون، ويتطلب ذلك قبولك لعرض السعر المحدَّث.',
        ['performance.overview'],
      );
    if (!ctx.statements.length)
      this.say(
        ctx,
        'OBSERVED_FACT',
        'There is no activity in the last 30 days yet.',
        'لا يوجد نشاط خلال آخر 30 يومًا حتى الآن.',
        ['performance.overview'],
      );
    ctx.actions.push({
      label: this.t(ctx, 'Open performance', 'افتح الأداء'),
      href: '/performance',
      requiresConfirmation: false,
      permission: perm('performance.read'),
    });
  }

  private needDraftLevel(ctx: Ctx) {
    if (ctx.autonomy < 2) {
      this.say(
        ctx,
        'RECOMMENDATION',
        'Ask again with drafting enabled and I will prepare this for your review.',
        'اطلب مرة أخرى مع تفعيل الصياغة وسأجهز ذلك لمراجعتك.',
        [],
      );
      return false;
    }
    return true;
  }

  private async createDraft(
    ctx: Ctx,
    kind: AiDraftKind,
    title: string,
    payload: unknown,
    requiredPermission: PermissionCode,
  ) {
    const d = await this.tool(
      ctx,
      `draft.${kind.toLowerCase()}`,
      'DRAFT',
      null,
      { kind },
      () =>
        this.prisma.aiDraft.create({
          data: {
            interactionId: ctx.id,
            agent: ctx.agent,
            kind,
            organizationId: ctx.organizationId,
            title,
            payload: payload as Prisma.InputJsonValue,
            requiredPermission,
            createdByUserId: ctx.actor.userId,
          },
        }),
      (r) => ({ draftId: r.id }),
    );
    ctx.drafts.push({
      id: d.id,
      kind,
      title,
      status: d.status,
      label: 'AI_DRAFTED',
      requiresApprovalBy: requiredPermission,
      payload,
    });
    return d;
  }

  private async draftTargets(
    ctx: Ctx,
    products: VisProduct[],
    metric: (p: string, k: string) => number | null,
    input: AskInput,
  ) {
    void input;
    const proposals = products
      .map((p) => ({ p, def: PRODUCT_TARGET[p] }))
      .filter((x) => x.def)
      .map(({ p, def }) => {
        const actual = metric(p, def!.key) ?? 0;
        return {
          product: p,
          metric: def!.metric,
          last30: actual,
          targetValue: Math.max(1, Math.ceil(actual * 1.1)),
        };
      })
      .filter((x) => x.last30 > 0);
    if (!proposals.length) {
      this.say(
        ctx,
        'OBSERVED_FACT',
        'There is not enough activity in the last 30 days to suggest targets.',
        'لا يوجد نشاط كافٍ خلال آخر 30 يومًا لاقتراح أهداف.',
        ['performance.overview'],
      );
      ctx.allowed.add('30');
      return;
    }
    for (const x of proposals) {
      const fmt = (v: number) =>
        x.metric === 'VOUCHER_SALES' ? this.money(ctx, v) : this.n(ctx, v);
      this.say(
        ctx,
        'RECOMMENDATION',
        `${PRODUCT_NAME[x.product]![0]}: target ${fmt(x.targetValue)} for the next 30 days (last 30 days: ${fmt(x.last30)}). A target, not a guaranteed result.`,
        `${PRODUCT_NAME[x.product]![1]}: هدف ${fmt(x.targetValue)} للأيام الثلاثين القادمة (آخر 30 يومًا: ${fmt(x.last30)}). هدف وليس نتيجة مضمونة.`,
        ['performance.overview'],
      );
    }
    ctx.allowed.add('30');
    if (!this.needDraftLevel(ctx)) return;
    const start = new Date();
    const end = new Date(start.getTime() + 30 * D);
    await this.createDraft(
      ctx,
      'CAMPAIGN_TARGETS',
      this.t(ctx, 'Targets for the next 30 days', 'أهداف الأيام الثلاثين القادمة'),
      {
        targets: proposals.map((x) => ({
          name: `${PRODUCT_NAME[x.product]![0]} target (AI draft)`,
          metric: x.metric,
          product: x.product,
          targetValue: x.targetValue,
          periodStart: start.toISOString(),
          periodEnd: end.toISOString(),
        })),
      },
      'merchant.targets.manage',
    );
  }

  private async draftAlerts(ctx: Ctx) {
    const rules: Array<{ name: string; code: AlertCode; channels: string[] }> = [
      {
        name: 'Budget running out',
        code: 'BUDGET_PROJECTED_EXHAUST',
        channels: ['IN_APP', 'EMAIL'],
      },
      { name: 'Inventory running out', code: 'INVENTORY_PROJECTED_EXHAUST', channels: ['IN_APP'] },
      { name: 'Behind target', code: 'CAMPAIGN_BEHIND_TARGET', channels: ['IN_APP'] },
      {
        name: 'Invoice overdue',
        code: 'INVOICE_OVERDUE',
        channels: ['IN_APP', 'EMAIL', 'TASK_INBOX'],
      },
    ];
    this.say(
      ctx,
      'RECOMMENDATION',
      `I suggest ${this.n(ctx, rules.length)} alert rules: budget, inventory, behind-target and overdue invoices.`,
      `أقترح ${this.n(ctx, rules.length)} قواعد تنبيه: الميزانية والمخزون والتأخر عن الهدف والفواتير المتأخرة.`,
      [],
    );
    if (!this.needDraftLevel(ctx)) return;
    await this.createDraft(
      ctx,
      'ALERT_RULES',
      this.t(ctx, 'Recommended alert rules', 'قواعد التنبيه المقترحة'),
      { rules },
      'merchant.alerts.manage',
    );
  }

  /** A campaign plan for an objective: recommended product mix from what the business already runs. A DRAFT only: nothing is created or published. */
  private async draftPlan(
    ctx: Ctx,
    input: AskInput,
    products: string[],
    metric: (p: string, k: string) => number | null,
  ) {
    const objective = input.message.slice(0, 300);
    // compare like with like: verified outcomes only (never money against counts, never engagement against outcomes)
    const OUTCOME: Record<string, { key: string; en: string; ar: string }> = {
      EXCLUSIVE: {
        key: 'exclusive.verified_redemptions',
        en: 'verified redemptions',
        ar: 'عملية استرداد موثّقة',
      },
      VOUCHER: { key: 'voucher.purchases', en: 'voucher purchases', ar: 'عملية شراء قسيمة' },
      WATCH: { key: 'watch.qualified_views', en: 'qualified views', ar: 'مشاهدة مؤهلة' },
    };
    const mix = products
      .filter((p) => p !== 'LOYALTY')
      .map((p) => ({ product: p, last30: OUTCOME[p] ? (metric(p, OUTCOME[p]!.key) ?? 0) : 0 }));
    const best = [...mix].filter((m) => OUTCOME[m.product]).sort((a, b) => b.last30 - a.last30)[0];
    this.say(
      ctx,
      'OBSERVED_FACT',
      `You can run: ${mix.map((m) => PRODUCT_NAME[m.product]![0]).join(', ')}.`,
      `يمكنك تشغيل: ${mix.map((m) => PRODUCT_NAME[m.product]![1]).join('، ')}.`,
      ['performance.overview'],
    );
    if (best && best.last30 > 0) {
      const o = OUTCOME[best.product]!;
      this.say(
        ctx,
        'HYPOTHESIS',
        `${PRODUCT_NAME[best.product]![0]} brought the most verified outcomes in the last 30 days (${this.n(ctx, best.last30)} ${o.en}), so it may be the strongest lever for this objective.`,
        `حقق ${PRODUCT_NAME[best.product]![1]} أكثر النتائج الموثّقة خلال آخر 30 يومًا (${this.n(ctx, best.last30)} ${o.ar})، لذا قد يكون الأقوى لتحقيق هذا الهدف.`,
        ['performance.overview'],
      );
    }
    ctx.allowed.add('30');
    this.say(
      ctx,
      'RECOMMENDATION',
      'The objective is a target, not a guaranteed result. The plan creates nothing: you build the campaign, accept its quotation and it is reviewed before going live.',
      'الهدف المحدد هدف وليس نتيجة مضمونة. الخطة لا تنشئ شيئًا: أنت تبني الحملة وتقبل عرض سعرها وتتم مراجعتها قبل النشر.',
      [],
    );
    if (!this.needDraftLevel(ctx)) return;
    const kind: AiDraftKind =
      ctx.agent === 'PARTNER_CAMPAIGN' ? 'CAMPAIGN_PORTFOLIO' : 'CAMPAIGN_PLAN';
    await this.createDraft(
      ctx,
      kind,
      this.t(ctx, 'Campaign plan (draft)', 'خطة حملة (مسودة)'),
      {
        objective,
        objectiveIsTarget: true,
        guaranteed: false,
        recommendedProducts: mix,
        publishes: false,
        increasesExposure: false,
        budget: { decidedBy: 'YOU', committedByPlan: 0 },
      },
      ctx.agent === 'PARTNER_CAMPAIGN' ? 'partner.ai.approve' : 'merchant.ai.approve',
    );
  }

  // ---------------------------------------------------------------- 4. Operations & Support
  private async operations(ctx: Ctx, intent: string, input: AskInput) {
    ctx.handoff = { available: true, reason: null };
    // ---- Stage 8: case work, reconciliation variance and queue priority (explain / recommend / draft only)
    if (input.context?.caseId) return this.caseWork(ctx, input.context.caseId);
    if (intent === 'CASE_SUMMARY') {
      this.say(
        ctx,
        'RECOMMENDATION',
        'Open the case first; I then summarise it, list missing evidence and draft replies.',
        'افتح الحالة أولًا ثم ألخصها وأحدد الأدلة الناقصة وأصيغ الردود.',
        [],
      );
      return;
    }
    if (intent === 'RECON_VARIANCE') return this.reconVariance(ctx);
    if (intent === 'QUEUE_PRIORITY') return this.queuePriority(ctx);
    const customerUserId = input.context?.customerUserId;
    if (intent === 'CUSTOMER_CASE' || customerUserId) {
      if (!customerUserId) {
        this.say(
          ctx,
          'RECOMMENDATION',
          'Open the customer first; I then summarise their journey.',
          'افتح ملف العميل أولًا ثم ألخّص رحلته.',
          [],
        );
        return;
      }
      const tl = await this.tool(
        ctx,
        'support.timeline',
        'READ',
        'admin.customers.read',
        { customerUserId },
        () => this.ops.customerTimeline(customerUserId, { take: 50 }),
        (r) => ({ items: r.items.length }),
      );
      const by = new Map<string, number>();
      for (const i of tl.items) by.set(i.kind, (by.get(i.kind) ?? 0) + 1);
      this.say(
        ctx,
        'OBSERVED_FACT',
        `Recent activity: ${[...by].map(([k, v]) => `${k.toLowerCase()} ${this.n(ctx, v)}`).join(', ')}.`,
        `النشاط الأخير: ${[...by].map(([k, v]) => `${k.toLowerCase()} ${this.n(ctx, v)}`).join('، ')}.`,
        ['support.timeline'],
      );
      const problems = tl.items.filter((i) =>
        /FAIL|REJECT|REFUND|DISPUTE|CANCEL/.test(`${i.kind} ${i.event} ${i.status ?? ''}`),
      );
      if (problems.length)
        this.say(
          ctx,
          'HYPOTHESIS',
          `${this.n(ctx, problems.length)} recent items may explain the contact (failed, refused, refunded or disputed).`,
          `${this.n(ctx, problems.length)} عناصر حديثة قد تفسر التواصل (فاشلة أو مرفوضة أو مستردة أو متنازع عليها).`,
          ['support.timeline'],
        );
      this.say(
        ctx,
        'RECOMMENDATION',
        'Confirm the facts with the customer; refunds, adjustments and goodwill points are decided by a person in the normal tools.',
        'تحقق من الوقائع مع العميل؛ الاسترداد والتسويات ونقاط التعويض يقررها موظف عبر الأدوات المعتادة.',
        [],
      );
      if (ctx.autonomy >= 2)
        await this.createDraft(
          ctx,
          'SUPPORT_HANDOFF',
          this.t(ctx, 'Hand over to a support specialist', 'تحويل إلى أخصائي دعم'),
          {
            customerUserId,
            summary: [...by].map(([k, v]) => ({ kind: k, count: v })),
            problems: problems
              .slice(0, 10)
              .map((p) => ({ kind: p.kind, event: p.event, at: p.at, status: p.status })),
          },
          'admin.customers.read',
        );
      return;
    }
    const cc = await this.tool(
      ctx,
      'ops.command_centre',
      'READ',
      'admin.operations.read',
      {},
      () => this.ops.commandCentre(),
      () => ({}),
    );
    const bad = cc.integrations.filter((i: { state: string }) =>
      ['FAILING', 'STALE', 'DEGRADED'].includes(i.state),
    );
    this.say(
      ctx,
      'OBSERVED_FACT',
      `${this.n(ctx, bad.length)} integrations need attention; ${this.n(ctx, cc.alerts.critical)} critical alerts are open.`,
      `${this.n(ctx, bad.length)} تكاملات تحتاج إلى متابعة؛ و${this.n(ctx, cc.alerts.critical)} تنبيهات حرجة مفتوحة.`,
      ['ops.command_centre'],
    );
    for (const i of bad.slice(0, 3)) {
      this.src(ctx, i.family);
      this.say(
        ctx,
        'RECOMMENDATION',
        `Check ${i.family} (${i.state}).`,
        `تحقق من ${i.family} (${i.state}).`,
        ['ops.command_centre'],
      );
    }
    ctx.actions.push({
      label: this.t(ctx, 'Open the Command Centre', 'افتح مركز القيادة'),
      href: '/command-centre',
      requiresConfirmation: false,
      permission: 'admin.operations.read',
    });
  }

  // ---------------------------------------------------------------- 4b. Operations copilot (Stage 8)
  /** One case: summary, likely issue, missing evidence, next step; drafts a customer reply / business request (sent after approval). */
  private async caseWork(ctx: Ctx, caseId: string) {
    const disputes = this.svc(DisputeService);
    const c = await this.tool(
      ctx,
      'ops.case',
      'READ',
      'admin.disputes.read',
      { caseId },
      () => disputes.get(caseId, undefined, ctx.actor),
      (r) => ({ status: r.status }),
    );
    this.src(ctx, c.reference);
    this.src(ctx, c.title);
    this.say(
      ctx,
      'OBSERVED_FACT',
      `${c.reference} is a ${c.type.toLowerCase().replace(/_/g, ' ')} case, ${c.status.toLowerCase().replace(/_/g, ' ')}, severity ${c.severity.toLowerCase()}, SLA ${c.slaState.toLowerCase().replace(/_/g, ' ')} (due ${this.date(ctx, c.slaDueAt)}).`,
      `${c.reference} حالة من نوع ${c.type}، الحالة ${c.status}، الخطورة ${c.severity}، اتفاقية الخدمة ${c.slaState} (الاستحقاق ${this.date(ctx, c.slaDueAt)}).`,
      ['ops.case'],
    );
    if (c.financialImpactMinor)
      this.say(
        ctx,
        'OBSERVED_FACT',
        `Recorded financial impact: ${this.money(ctx, c.financialImpactMinor, c.currency ?? 'SAR')}.`,
        `الأثر المالي المسجل: ${this.money(ctx, c.financialImpactMinor, c.currency ?? 'SAR')}.`,
        ['ops.case'],
      );
    const missing: Array<[string, string]> = [];
    if (!c.attachments.length) missing.push(['no evidence is attached', 'لا يوجد دليل مرفق']);
    if (!c.transactionRef && !c.relatedId)
      missing.push(['no transaction or record reference', 'لا يوجد مرجع معاملة أو سجل']);
    if (c.financialImpactMinor && !c.financialAdjustmentId)
      missing.push(['a financial impact without a linked adjustment', 'أثر مالي دون تسوية مرتبطة']);
    if (!c.notes.some((n: { kind: string }) => n.kind === 'CONTACT') && c.customerUserId)
      missing.push(['no logged contact with the customer', 'لا يوجد تواصل مسجل مع العميل']);
    if (missing.length)
      this.say(
        ctx,
        'HYPOTHESIS',
        `Possibly missing: ${missing.map((m) => m[0]).join('; ')}.`,
        `قد يكون ناقصًا: ${missing.map((m) => m[1]).join('؛ ')}.`,
        ['ops.case'],
      );
    const next: [string, string] =
      c.status === 'AWAITING_MERCHANT' || c.status === 'AWAITING_PARTNER'
        ? [
            'Follow up with the business; the case returns to you when it replies.',
            'تابع مع الجهة التجارية؛ تعود الحالة إليك عند ردها.',
          ]
        : c.status === 'AWAITING_APPROVAL'
          ? [
              'A different person should approve or send back the proposed resolution.',
              'يجب أن يوافق شخص آخر على الحل المقترح أو يعيده.',
            ]
          : c.financialImpactMinor
            ? [
                'Prepare the governed adjustment or refund, then request approval of the resolution (a second person decides).',
                'جهّز التسوية أو الاسترداد ثم اطلب اعتماد الحل (يقرره شخص آخر).',
              ]
            : c.organizationId
              ? [
                  'Ask the business for its side (status: awaiting merchant / partner).',
                  'اطلب رأي الجهة التجارية (الحالة: بانتظار التاجر أو الشريك).',
                ]
              : [
                  'Confirm the facts with the customer, then resolve with a recorded outcome.',
                  'تحقق من الوقائع مع العميل ثم أغلق الحالة بنتيجة مسجلة.',
                ];
    this.say(ctx, 'RECOMMENDATION', next[0], next[1], []);
    this.say(
      ctx,
      'RECOMMENDATION',
      'I never refund, adjust, restrict or close anything: those steps are decided by people in the normal tools.',
      'لا أقوم بأي استرداد أو تسوية أو تقييد أو إغلاق: هذه الخطوات يقررها الموظفون عبر الأدوات المعتادة.',
      [],
    );
    if (ctx.autonomy >= 2) {
      if (c.customerUserId)
        await this.createDraft(
          ctx,
          'CUSTOMER_RESPONSE',
          this.t(ctx, 'Reply to the customer', 'رد على العميل'),
          {
            caseId,
            body: this.t(
              ctx,
              `We are looking into your request ${c.reference}. We will update you as soon as we have an answer.`,
              `نعمل على طلبك ${c.reference} وسنبلغك فور وجود رد.`,
            ),
          },
          'admin.disputes.manage',
        );
      if (c.organizationId && c.status !== 'AWAITING_MERCHANT' && c.status !== 'AWAITING_PARTNER')
        await this.createDraft(
          ctx,
          'MERCHANT_REQUEST',
          this.t(ctx, 'Ask the business for its side', 'اطلب رأي الجهة التجارية'),
          {
            caseId,
            organizationId: c.organizationId,
            body: this.t(
              ctx,
              `Please share your records and comments for case ${c.reference} (${c.title}).`,
              `يرجى مشاركة سجلاتكم وملاحظاتكم بشأن الحالة ${c.reference} (${c.title}).`,
            ),
          },
          'admin.disputes.manage',
        );
    }
    ctx.actions.push({
      label: this.t(ctx, 'Open the case', 'افتح الحالة'),
      href: `/cases?id=${caseId}`,
      requiresConfirmation: false,
      permission: 'admin.disputes.read',
    });
  }

  private async reconVariance(ctx: Ctx) {
    const recon = this.svc(ReconciliationOpsService);
    const items = await this.tool(
      ctx,
      'ops.reconciliation',
      'READ',
      'admin.finance.read',
      { exceptions: true },
      () => recon.list({ exceptions: true }),
      (r) => ({ items: r.length }),
    );
    const by = new Map<string, { n: number; v: number }>();
    for (const i of items) {
      const x = by.get(i.source) ?? { n: 0, v: 0 };
      x.n++;
      x.v += Math.abs(i.varianceMinor);
      by.set(i.source, x);
    }
    if (!items.length) {
      this.say(
        ctx,
        'OBSERVED_FACT',
        'There are no open reconciliation exceptions.',
        'لا توجد استثناءات مطابقة مفتوحة.',
        ['ops.reconciliation'],
      );
      return;
    }
    for (const [source, x] of [...by].sort((a, b) => b[1].v - a[1].v).slice(0, 5)) {
      this.src(ctx, source);
      this.say(
        ctx,
        'OBSERVED_FACT',
        `${source}: ${this.n(ctx, x.n)} open exceptions, absolute variance ${this.money(ctx, x.v)}.`,
        `${source}: ${this.n(ctx, x.n)} استثناءات مفتوحة، إجمالي الفرق ${this.money(ctx, x.v)}.`,
        ['ops.reconciliation'],
      );
    }
    this.say(
      ctx,
      'RECOMMENDATION',
      'Start with the largest variance; timing differences usually clear with the next statement, missing or mismatched amounts need an owner and, where money moved, a governed adjustment.',
      'ابدأ بأكبر فرق؛ فروق التوقيت تزول غالبًا مع الكشف التالي، أما المبالغ الناقصة أو غير المتطابقة فتحتاج مسؤولًا وتسوية معتمدة عند انتقال الأموال.',
      [],
    );
    ctx.actions.push({
      label: this.t(ctx, 'Open reconciliation exceptions', 'افتح استثناءات المطابقة'),
      href: '/reconciliation',
      requiresConfirmation: false,
      permission: 'admin.finance.read',
    });
  }

  private async queuePriority(ctx: Ctx) {
    const sla = this.svc(SlaService);
    const o = await this.tool(
      ctx,
      'ops.sla',
      'READ',
      'admin.operations.read',
      {},
      () => sla.overview(),
      (r) => ({ items: r.items.length }),
    );
    const breached = o.items.filter((i) => i.state === 'BREACHED');
    const warning = o.items.filter((i) => i.state === 'WARNING');
    this.say(
      ctx,
      'OBSERVED_FACT',
      `${this.n(ctx, breached.length)} items have breached their SLA and ${this.n(ctx, warning.length)} are close to it.`,
      `${this.n(ctx, breached.length)} عناصر تجاوزت اتفاقية الخدمة و${this.n(ctx, warning.length)} قريبة من ذلك.`,
      ['ops.sla'],
    );
    for (const i of breached.slice(0, 5)) {
      this.src(ctx, i.reference);
      this.say(
        ctx,
        'RECOMMENDATION',
        `First: ${i.area.toLowerCase()} ${i.reference} (due ${this.date(ctx, i.dueAt)}).`,
        `أولًا: ${i.area} ${i.reference} (الاستحقاق ${this.date(ctx, i.dueAt)}).`,
        ['ops.sla'],
      );
    }
    ctx.actions.push({
      label: this.t(ctx, 'Open SLA and escalations', 'افتح اتفاقيات الخدمة والتصعيد'),
      href: '/sla',
      requiresConfirmation: false,
      permission: 'admin.operations.read',
    });
  }

  // ---------------------------------------------------------------- 5. Admin / Finance copilot
  private async finance(ctx: Ctx) {
    const access = { admin: true, organizationId: null, legalEntityIds: null, canManage: false };
    const ar = await this.tool(
      ctx,
      'finance.receivables',
      'READ',
      'admin.finance.read',
      {},
      () => this.receivables.receivables(access),
      (r) => ({ accounts: r.length }),
    );
    const byCur = new Map<string, { out: number; overdue: number; accounts: number }>();
    for (const a of ar) {
      const x = byCur.get(a.currency) ?? { out: 0, overdue: 0, accounts: 0 };
      x.out += a.outstandingMinor;
      x.overdue += a.overdueMinor;
      if (a.overdueMinor > 0) x.accounts++;
      byCur.set(a.currency, x);
    }
    for (const [cur, x] of byCur) {
      if (!x.out) continue;
      this.say(
        ctx,
        'OBSERVED_FACT',
        `${cur}: ${this.money(ctx, x.out, cur)} outstanding, of which ${this.money(ctx, x.overdue, cur)} overdue across ${this.n(ctx, x.accounts)} accounts.`,
        `${cur}: ${this.money(ctx, x.out, cur)} مستحقة، منها ${this.money(ctx, x.overdue, cur)} متأخرة في ${this.n(ctx, x.accounts)} حسابات.`,
        ['finance.receivables'],
      );
      const top = ar
        .filter((a) => a.currency === cur)
        .sort((a, b) => b.overdueMinor - a.overdueMinor)[0];
      if (top && x.overdue > 0 && top.overdueMinor * 2 > x.overdue) {
        this.src(ctx, top.legalName);
        this.say(
          ctx,
          'HYPOTHESIS',
          `Most of the overdue ${cur} amount sits with one account (${top.legalName}); the invoice contact or a dispute may be the cause.`,
          `معظم المبلغ المتأخر بعملة ${cur} لدى حساب واحد (${top.legalName})؛ قد يكون السبب جهة اتصال الفواتير أو نزاع.`,
          ['finance.receivables'],
        );
      }
    }
    const now = Date.now();
    const issued = async (from: number, to: number) =>
      this.prisma.financeDocument.aggregate({
        where: {
          type: { in: ['INVOICE', 'TAX_INVOICE'] },
          status: { notIn: ['DRAFT', 'PENDING_APPROVAL', 'CANCELLED', 'VOID'] },
          currency: 'SAR',
          issuedAt: { gte: new Date(from), lt: new Date(to) },
        },
        _sum: { totalHalalas: true },
        _count: true,
      });
    const cur30 = await this.tool(
      ctx,
      'finance.invoicing_trend',
      'READ',
      'admin.finance.read',
      { days: 30 },
      () => issued(now - 30 * D, now),
      (r) => ({ count: r._count }),
    );
    const prev30 = await this.tool(
      ctx,
      'finance.invoicing_trend.prior',
      'READ',
      'admin.finance.read',
      { days: 30, offset: 30 },
      () => issued(now - 60 * D, now - 30 * D),
      (r) => ({ count: r._count }),
    );
    this.say(
      ctx,
      'CALCULATED_TREND',
      `SAR invoiced in the last 30 days: ${this.money(ctx, cur30._sum.totalHalalas ?? 0)} vs ${this.money(ctx, prev30._sum.totalHalalas ?? 0)} in the 30 days before.`,
      `المفوتر بالريال خلال آخر 30 يومًا: ${this.money(ctx, cur30._sum.totalHalalas ?? 0)} مقابل ${this.money(ctx, prev30._sum.totalHalalas ?? 0)} في الثلاثين يومًا السابقة.`,
      ['finance.invoicing_trend', 'finance.invoicing_trend.prior'],
    );
    ctx.allowed.add('30');
    const dueSoon = await this.tool(
      ctx,
      'finance.due_next_30',
      'READ',
      'admin.finance.read',
      { days: 30 },
      () =>
        this.prisma.financeDocument.aggregate({
          where: {
            type: { in: ['INVOICE', 'TAX_INVOICE', 'DEBIT_NOTE'] },
            currency: 'SAR',
            status: { in: ['ISSUED', 'SENT', 'PARTIALLY_PAID'] },
            dueAt: { gte: new Date(now), lt: new Date(now + 30 * D) },
          },
          _sum: { totalHalalas: true, paidHalalas: true },
        }),
    );
    const expected = Math.max(
      0,
      (dueSoon._sum.totalHalalas ?? 0) - (dueSoon._sum.paidHalalas ?? 0),
    );
    this.say(
      ctx,
      'FORECAST',
      `If every invoice due in the next 30 days is paid on time, ${this.money(ctx, expected)} would be collected. An estimate, not a commitment.`,
      `إذا سُددت كل الفواتير المستحقة خلال 30 يومًا القادمة في موعدها فسيُحصَّل ${this.money(ctx, expected)}. تقدير وليس التزامًا.`,
      ['finance.due_next_30'],
    );
    const flows = await this.tool(
      ctx,
      'finance.reconciliation_flows',
      'READ',
      'admin.finance.read',
      {},
      () => this.reconciliation.flows(null, null),
      (r) => ({ differences: r.filter((f) => f.status === 'DIFFERENCE').length }),
    );
    const diff = flows.filter((f) => f.status === 'DIFFERENCE');
    this.say(
      ctx,
      'OBSERVED_FACT',
      diff.length
        ? `Reconciliation differences in: ${diff.map((f) => f.product).join(', ')}.`
        : 'All product flows reconcile.',
      diff.length
        ? `فروقات تسوية في: ${diff.map((f) => f.product).join('، ')}.`
        : 'جميع تدفقات المنتجات متطابقة.',
      ['finance.reconciliation_flows'],
    );
    if ([...byCur.values()].some((x) => x.overdue > 0))
      this.say(
        ctx,
        'RECOMMENDATION',
        'Send statements to the overdue accounts and review them; a financial hold or write-off is a Finance decision with its own approval.',
        'أرسل كشوف الحساب للحسابات المتأخرة وراجعها؛ الإيقاف المالي أو الشطب قرار مالي له موافقته الخاصة.',
        [],
      );
    ctx.actions.push({
      label: this.t(ctx, 'Open receivables', 'افتح الذمم المدينة'),
      href: '/finance/receivables',
      requiresConfirmation: false,
      permission: 'admin.finance.read',
    });
  }

  // ---------------------------------------------------------------- drafts: human approval, then execution as the approver
  async drafts(actor: Actor, organizationId: string | null, status?: string) {
    if (actor.audience !== 'admin' && actor.membership?.organizationId !== organizationId)
      throw AppError.notFound();
    const rows = await this.prisma.aiDraft.findMany({
      where: {
        organizationId: actor.audience === 'admin' ? (organizationId ?? undefined) : organizationId,
        ...(status ? { status } : {}),
        ...(actor.audience === 'admin' && !organizationId ? { organizationId: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((d) => ({
      id: d.id,
      kind: d.kind,
      agent: d.agent,
      title: d.title,
      status: d.status,
      label:
        d.status === 'EXECUTED'
          ? 'SYSTEM_EXECUTED'
          : d.status === 'APPROVED'
            ? 'HUMAN_APPROVED'
            : 'AI_DRAFTED',
      payload: d.payload,
      requiredPermission: d.requiredPermission,
      createdAt: d.createdAt.toISOString(),
      decidedAt: d.decidedAt?.toISOString() ?? null,
      result: d.result,
    }));
  }

  async decide(
    actor: Actor,
    organizationId: string | null,
    draftId: string,
    approve: boolean,
    reason: string | null,
    meta: RequestMeta,
  ) {
    const d = await this.prisma.aiDraft.findUnique({ where: { id: draftId } });
    if (!d) throw AppError.notFound();
    if (
      actor.audience === 'admin'
        ? d.organizationId !== null && d.organizationId !== organizationId
        : d.organizationId !== organizationId || actor.membership?.organizationId !== organizationId
    )
      throw AppError.notFound();
    if (d.status !== 'PENDING_APPROVAL')
      throw new AppError('INVALID_STATE', 'This draft was already decided', 409);
    const approvePerm = APPROVE_PERMISSION[actor.audience];
    if (
      !approvePerm ||
      !actor.permissions.has(approvePerm) ||
      !actor.permissions.has(d.requiredPermission as PermissionCode)
    )
      throw new AppError(
        'AI_APPROVAL_REQUIRED',
        'A person with approval rights for this action must decide it',
        403,
      );
    const g = await this.governance();
    const now = new Date();
    const r = await this.prisma.aiDraft.updateMany({
      where: { id: d.id, status: 'PENDING_APPROVAL' },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        decidedByUserId: actor.userId,
        decidedAt: now,
        decisionReason: reason,
      },
    });
    if (r.count !== 1) throw new AppError('INVALID_STATE', 'This draft changed meanwhile', 409);
    const action = (tier: 'DRAFT' | 'EXECUTE', state: string, output: unknown = {}) =>
      this.prisma.aiAction.create({
        data: {
          interactionId: d.interactionId,
          draftId: d.id,
          tool: `draft.${d.kind.toLowerCase()}`,
          tier,
          state,
          input: {},
          outputSummary: output as Prisma.InputJsonValue,
          actorUserId: actor.userId,
          organizationId: d.organizationId,
        },
      });
    await action('DRAFT', approve ? 'HUMAN_APPROVED' : 'REJECTED', { reason });
    await this.audit.record({
      action: approve ? 'AI_DRAFT_APPROVED' : 'AI_DRAFT_REJECTED',
      entityType: 'AiDraft',
      entityId: d.id,
      actor,
      subjectOrganizationId: d.organizationId,
      newState: { kind: d.kind },
      reason,
      meta,
    });
    if (!approve) return { id: d.id, status: 'REJECTED', label: 'REJECTED' };
    // level 3: execute after human approval; plans never execute (they create nothing)
    if (
      d.kind === 'CAMPAIGN_PLAN' ||
      d.kind === 'CAMPAIGN_PORTFOLIO' ||
      Math.min(g.maxAutonomyLevel, AI_MVP_MAX_AUTONOMY) < 3
    )
      return { id: d.id, status: 'APPROVED', label: 'HUMAN_APPROVED' };
    const result = await this.execute(actor, d, meta);
    await this.prisma.aiDraft.update({
      where: { id: d.id },
      data: { status: 'EXECUTED', executedAt: new Date(), result: result as Prisma.InputJsonValue },
    });
    await action('EXECUTE', 'SYSTEM_EXECUTED', result);
    await this.prisma.aiUsageRecord.create({
      data: {
        interactionId: d.interactionId,
        organizationId: d.organizationId,
        agent: d.agent,
        kind: 'ACTION',
        units: 1,
        provider: g.provider,
        model: g.model,
      },
    });
    await this.audit.record({
      action: 'AI_DRAFT_EXECUTED',
      entityType: 'AiDraft',
      entityId: d.id,
      actor,
      subjectOrganizationId: d.organizationId,
      newState: { kind: d.kind, result },
      meta,
    });
    return { id: d.id, status: 'EXECUTED', label: 'SYSTEM_EXECUTED', result };
  }

  /** Executes through the same services a person would use, AS the approver (their scope and permissions apply). */
  private async execute(actor: Actor, d: Prisma.AiDraftGetPayload<object>, meta: RequestMeta) {
    const p = d.payload as Record<string, unknown>;
    if (d.kind === 'CAMPAIGN_TARGETS') {
      const a = await this.reporting.resolve(actor, d.organizationId);
      const ids: string[] = [];
      for (const x of p.targets as Array<Record<string, unknown>>) {
        const t = await this.targets.create(
          actor,
          a,
          d.organizationId!,
          x as never,
          meta,
          'AI_DRAFT',
        );
        ids.push((t as { id: string }).id);
      }
      return { targetIds: ids };
    }
    if (d.kind === 'ALERT_RULES') {
      const ids: string[] = [];
      for (const x of p.rules as Array<Record<string, unknown>>) {
        const r = await this.alerts.createRule(actor, d.organizationId, x as never, meta);
        ids.push((r as { id: string }).id);
      }
      return { ruleIds: ids };
    }
    if (d.kind === 'SUPPORT_HANDOFF') {
      const c = await this.prisma.disputeCase.create({
        data: {
          reference: `DC-${randomBytes(4).toString('hex').toUpperCase()}`,
          type: 'OTHER',
          customerUserId: p.customerUserId as string,
          relatedType: 'User',
          relatedId: p.customerUserId as string,
          title: 'Support handoff (AI summary, human owner)',
          description: JSON.stringify(p.summary ?? []),
          priority: 'NORMAL',
          status: 'OPEN',
          openedByUserId: actor.userId,
          openedByOrganizationId: actor.membership?.organizationId ?? null,
          slaDueAt: new Date(Date.now() + 2 * D),
        },
      });
      return { caseId: c.id, reference: c.reference };
    }
    // Stage 8: a reply / request is sent through the case framework AS the approving person (nothing financial ever executes here)
    if (d.kind === 'CUSTOMER_RESPONSE') {
      const disputes = this.svc(DisputeService);
      await disputes.note(actor, p.caseId as string, undefined, p.body as string, 'SHARED', meta);
      return { caseId: p.caseId, sent: 'SHARED_NOTE' };
    }
    if (d.kind === 'MERCHANT_REQUEST') {
      const disputes = this.svc(DisputeService);
      const org = await this.prisma.organization.findUnique({
        where: { id: p.organizationId as string },
        select: { type: true },
      });
      const r = await disputes.transition(
        actor,
        p.caseId as string,
        org?.type === 'PARTNER' ? 'AWAITING_PARTNER' : 'AWAITING_MERCHANT',
        p.body as string,
        meta,
      );
      return { caseId: p.caseId, status: r.status };
    }
    throw new AppError('INVALID_STATE', 'Nothing to execute', 409);
  }

  // ---------------------------------------------------------------- audit and usage views (DealDash)
  async interactions(f: { organizationId?: string; agent?: string; take?: number }) {
    const rows = await this.prisma.aiInteraction.findMany({
      where: {
        ...(f.organizationId ? { organizationId: f.organizationId } : {}),
        ...(f.agent ? { agent: f.agent } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(f.take ?? 50, 200),
    });
    return rows.map((r) => ({
      id: r.id,
      agent: r.agent,
      userId: r.userId,
      organizationId: r.organizationId,
      roleCode: r.roleCode,
      locale: r.locale,
      intent: r.intent,
      autonomyLevel: r.autonomyLevel,
      status: r.status,
      toolCalls: r.toolCalls,
      provider: r.provider,
      model: r.model,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async interaction(id: string) {
    const r = await this.prisma.aiInteraction.findUnique({ where: { id } });
    if (!r) throw AppError.notFound();
    const actions = await this.prisma.aiAction.findMany({
      where: { interactionId: id },
      orderBy: { createdAt: 'asc' },
    });
    const drafts = await this.prisma.aiDraft.findMany({ where: { interactionId: id } });
    return { ...r, createdAt: r.createdAt.toISOString(), actions, drafts };
  }

  async usage(f: { organizationId?: string; from?: Date; to?: Date }) {
    const rows = await this.prisma.aiUsageRecord.groupBy({
      by: ['agent', 'kind'],
      where: {
        ...(f.organizationId ? { organizationId: f.organizationId } : {}),
        occurredAt: { gte: f.from ?? new Date(Date.now() - 30 * D), lt: f.to ?? new Date() },
      },
      _sum: { units: true, estimatedCostMinor: true },
      _count: true,
    });
    const g = await this.governance();
    return {
      commercialTreatment: g.commercialTreatment,
      pricing: 'NOT_PRICED',
      rows: rows.map((r) => ({
        agent: r.agent,
        kind: r.kind,
        records: r._count,
        units: r._sum.units ?? 0,
        estimatedCostMinor: r._sum.estimatedCostMinor ?? 0,
      })),
    };
  }
}
