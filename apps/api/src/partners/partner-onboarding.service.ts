import { Inject, Injectable } from '@nestjs/common';
import type { ApiEnv } from '@dealdash/config';
import {
  IN_FORCE_LIFECYCLE,
  PARTNER_APPROVAL_REQUIRED,
  PARTNER_READINESS_CHECKS,
  PARTNER_STEP_REQUIRES,
  PARTNER_TRANSITIONS,
  type PartnerCheckState,
  type PartnerLifecycle,
  type PartnerReadinessCheck,
  type PartnerReadinessState,
} from '@dealdash/types';
import type { partnerCreateSchema, partnerProfileSchema } from '@dealdash/validation';
import type { z } from 'zod';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { randomToken, sha256 } from '../common/crypto';
import { APP_ENV } from '../common/env';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_PROVIDER, type EmailProvider } from '../providers/interfaces';
import { EntitlementService } from '../platform/entitlement.service';
import { MarketService } from '../platform/markets/market.service';
import { PartnerAccessService, type PartnerRow } from './partner-access.service';

export interface ReadinessItem {
  check: PartnerReadinessCheck;
  state: PartnerCheckState;
  detail: string;
}
export interface PartnerReadiness {
  organizationId: string;
  lifecycle: PartnerLifecycle;
  state: PartnerReadinessState;
  items: ReadinessItem[];
  nextSteps: PartnerLifecycle[];
}

const SCOPE = (orgId: string) => `PARTNER:${orgId}`;

/**
 * Partner onboarding / readiness on the shared platform: the Business Account (Organization), its legal entities, contracts and
 * entitlements, billing accounts, funding / credit, markets and integrations are the platform's own records. This service only reads
 * them to say what is missing, keeps the partner's profile, and moves the lifecycle (the partner submits; DealDash reviews; a second
 * DealDash administrator activates). No local regulatory requirement is invented: open market validation items are shown as such.
 */
@Injectable()
export class PartnerOnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: PartnerAccessService,
    private readonly entitlements: EntitlementService,
    private readonly markets: MarketService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(APP_ENV) private readonly env: ApiEnv,
  ) {}

  // ---------------------------------------------------------------- profile
  async profile(organizationId: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId, type: 'PARTNER' },
      include: { partner: true },
    });
    if (!org?.partner) throw AppError.notFound();
    const p = org.partner;
    return {
      organizationId: org.id,
      nameEn: org.nameEn,
      nameAr: org.nameAr,
      status: org.status,
      partnerType: p.partnerType,
      lifecycle: p.lifecycle,
      legalName: p.legalName,
      registrationNumber: p.registrationNumber,
      taxNumber: p.taxNumber,
      website: p.website,
      parentGroup: p.parentGroup,
      description: p.description,
      requestedMarkets: p.requestedMarkets,
      contacts: p.contacts as Record<string, unknown>,
      signatory: (p.signatory as Record<string, unknown> | null) ?? null,
      submittedAt: p.submittedAt?.toISOString() ?? null,
      approvedAt: p.approvedAt?.toISOString() ?? null,
      lifecycleReason: p.lifecycleReason,
      pending: p.pendingLifecycle
        ? {
            lifecycle: p.pendingLifecycle,
            reason: p.pendingReason,
            requestedByUserId: p.pendingRequestedByUserId,
            requestedAt: p.pendingRequestedAt?.toISOString() ?? null,
          }
        : null,
      version: p.version,
    };
  }

  /** The partner keeps its own profile while onboarding (and later, for contacts). Identity fields lock once approved. */
  async updateProfile(
    actor: Actor,
    organizationId: string,
    b: z.infer<typeof partnerProfileSchema>,
    meta: RequestMeta,
  ) {
    const p = await this.access.requirePartner(actor, organizationId);
    await this.access.requireOrgWide(actor, 'partner.profile.write');
    const before = await this.prisma.partner.findUniqueOrThrow({ where: { organizationId } });
    const editable = ['DRAFT', 'CHANGES_REQUESTED'].includes(p.lifecycle);
    if (
      !editable &&
      (b.legalName !== before.legalName ||
        (b.registrationNumber ?? null) !== before.registrationNumber ||
        (b.taxNumber ?? null) !== before.taxNumber)
    )
      throw new AppError(
        'EDIT_LOCKED',
        'Legal name and registration details are locked after review. Ask DealDash to change them.',
        409,
      );
    const codes = await this.prisma.countryConfiguration.findMany({
      where: { code: { in: b.requestedMarkets } },
      select: { code: true },
    });
    if (codes.length !== new Set(b.requestedMarkets).size)
      throw AppError.validation('Choose markets from the list', 'requestedMarkets');
    const after = await this.prisma.partner.update({
      where: { organizationId },
      data: {
        legalName: b.legalName,
        registrationNumber: b.registrationNumber ?? null,
        taxNumber: b.taxNumber ?? null,
        website: b.website || null,
        parentGroup: b.parentGroup ?? null,
        description: b.description ?? null,
        requestedMarkets: [...new Set(b.requestedMarkets)],
        contacts: b.contacts as Prisma.InputJsonValue,
        signatory: (b.signatory ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });
    await this.audit.record({
      action: 'partner.profile.updated',
      entityType: 'Partner',
      entityId: organizationId,
      previousState: {
        legalName: before.legalName,
        requestedMarkets: before.requestedMarkets,
        version: before.version,
      },
      newState: {
        legalName: after.legalName,
        requestedMarkets: after.requestedMarkets,
        version: after.version,
      },
      actor,
      subjectOrganizationId: organizationId,
      scope: SCOPE(organizationId),
      meta,
    });
    return this.profile(organizationId);
  }

  // ---------------------------------------------------------------- readiness
  async readiness(organizationId: string): Promise<PartnerReadiness> {
    const p = await this.access.load(organizationId);
    const row = await this.prisma.partner.findUniqueOrThrow({ where: { organizationId } });
    const profile = await this.access.profileOf(p.partnerType);
    const now = new Date();
    const items: ReadinessItem[] = [];
    const add = (check: PartnerReadinessCheck, state: PartnerCheckState, detail: string) =>
      items.push({ check, state, detail });
    const contacts = (row.contacts ?? {}) as { primary?: { email?: string } };

    add(
      'PROFILE',
      row.legalName && row.requestedMarkets.length ? 'OK' : 'MISSING',
      row.requestedMarkets.length
        ? `${row.legalName} · ${row.requestedMarkets.join(', ')}`
        : 'Legal name and requested markets',
    );
    const les = await this.prisma.legalEntity.findMany({
      where: { organizationId, status: 'ACTIVE' },
      select: { id: true, legalName: true, country: true },
    });
    add(
      'LEGAL_ENTITY',
      les.length ? 'OK' : 'MISSING',
      les.length ? les.map((l) => `${l.legalName} (${l.country})`).join(', ') : 'No legal entity',
    );

    const avail = await this.markets.settings();
    const ms = await this.prisma.countryConfiguration.findMany({
      where: { code: { in: row.requestedMarkets } },
      select: { code: true, status: true },
    });
    const leCountries = new Set(les.map((l) => l.country));
    const notOpen = ms
      .filter((m) => !avail.availableStatuses.includes(m.status))
      .map((m) => `${m.code} ${m.status}`);
    const noEntity = row.requestedMarkets.filter((c) => !leCountries.has(c));
    add(
      'MARKETS',
      !row.requestedMarkets.length || noEntity.length
        ? 'MISSING'
        : notOpen.length
          ? 'VALIDATION_REQUIRED'
          : 'OK',
      !row.requestedMarkets.length
        ? 'No market requested'
        : [
            noEntity.length ? `No legal entity in ${noEntity.join(', ')}` : null,
            notOpen.length ? `Market not open: ${notOpen.join(', ')}` : null,
          ]
            .filter(Boolean)
            .join('; ') || row.requestedMarkets.join(', '),
    );
    add(
      'CONTACTS',
      contacts.primary?.email ? 'OK' : 'MISSING',
      contacts.primary?.email ? 'Primary contact recorded' : 'Primary business contact',
    );
    add(
      'SIGNATORY',
      row.signatory ? 'OK' : 'MISSING',
      row.signatory ? 'Authorised signatory recorded' : 'Authorised signatory',
    );

    const contracts = await this.prisma.contract.findMany({
      where: {
        organizationId,
        status: { in: [...IN_FORCE_LIFECYCLE] },
        effectiveFrom: { lte: now },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }],
      },
      select: { kind: true, planCode: true, market: true },
    });
    const fitting = contracts.filter(
      (c) => !profile.contractKinds.length || profile.contractKinds.includes(c.kind),
    );
    add(
      'CONTRACT',
      fitting.length ? 'OK' : contracts.length ? 'VALIDATION_REQUIRED' : 'MISSING',
      fitting.length
        ? fitting.map((c) => `${c.kind}${c.planCode ? ` · ${c.planCode}` : ''}`).join(', ')
        : contracts.length
          ? `Contract kind ${contracts.map((c) => c.kind).join(', ')} differs from ${profile.contractKinds.join(' / ')}`
          : 'No contract / licence in force',
    );
    const accounts = await this.prisma.businessAccount.findMany({
      where: { organizationId, status: 'ACTIVE' },
      select: { id: true, currency: true, fundingMode: true },
    });
    add(
      'BILLING_ACCOUNT',
      accounts.length ? 'OK' : 'MISSING',
      accounts.length
        ? accounts.map((a) => `${a.currency} · ${a.fundingMode}`).join(', ')
        : 'No billing account',
    );
    const credit = await this.prisma.creditFacility.count({
      where: { organizationId, status: 'ACTIVE', expiresAt: { gt: now } },
    });
    const creditAccounts = accounts.filter((a) => a.fundingMode === 'CREDIT');
    add(
      'FUNDING',
      !accounts.length ? 'MISSING' : creditAccounts.length && !credit ? 'MISSING' : 'OK',
      !accounts.length
        ? 'Funding method (prepaid or approved credit)'
        : creditAccounts.length && !credit
          ? 'Credit funding without an active credit facility'
          : accounts.map((a) => a.fundingMode).join(', '),
    );
    const e = await this.entitlements.effective(organizationId);
    add(
      'ENTITLEMENTS',
      e.products.length ? 'OK' : 'MISSING',
      e.products.length ? e.products.join(', ') : 'No product entitlements',
    );
    const apiEntitled = e.features.includes('API_ACCESS');
    const conns = await this.prisma.integrationConnection.count({
      where: { organizationId, status: 'ACTIVE' },
    });
    add(
      'INTEGRATION',
      !apiEntitled ? 'NOT_APPLICABLE' : conns ? 'OK' : 'MISSING',
      !apiEntitled
        ? 'No API in the contract'
        : conns
          ? `${conns} active connection(s)`
          : 'No active API / feed connection',
    );
    const open = await this.prisma.marketValidationItem.findMany({
      where: {
        market: { in: row.requestedMarkets },
        status: { in: ['OPEN', 'IN_REVIEW'] },
        blocksActivation: true,
      },
      select: { code: true },
      take: 50,
    });
    add(
      'MARKET_VALIDATIONS',
      open.length ? 'VALIDATION_REQUIRED' : 'OK',
      open.length
        ? `${open.length} open market validation item(s): ${open
            .slice(0, 5)
            .map((o) => o.code)
            .join(', ')}${open.length > 5 ? ' …' : ''}`
        : 'No open blocking items',
    );

    const ordered = PARTNER_READINESS_CHECKS.map((c) => items.find((i) => i.check === c)!).filter(
      Boolean,
    );
    const state: PartnerReadinessState =
      p.lifecycle === 'SUSPENDED' || p.lifecycle === 'REJECTED'
        ? 'BLOCKED'
        : ordered.some((i) => i.state === 'MISSING')
          ? 'NOT_READY'
          : ordered.some((i) => i.state === 'VALIDATION_REQUIRED')
            ? 'VALIDATION_REQUIRED'
            : 'READY';
    return {
      organizationId,
      lifecycle: p.lifecycle,
      state,
      items: ordered,
      nextSteps: [...PARTNER_TRANSITIONS[p.lifecycle]],
    };
  }

  /** Every check the target step needs must be complete; ACTIVE needs nothing MISSING (validation items are shown, never hidden). */
  private async gate(organizationId: string, to: PartnerLifecycle) {
    const r = await this.readiness(organizationId);
    const need = to === 'ACTIVE' ? PARTNER_READINESS_CHECKS : (PARTNER_STEP_REQUIRES[to] ?? []);
    const missing = r.items.filter((i) => need.includes(i.check) && i.state === 'MISSING');
    if (missing.length)
      throw new AppError(
        'PARTNER_NOT_READY',
        `Not ready: ${missing.map((m) => m.check).join(', ')}`,
        409,
        undefined,
        missing.map((m) => ({ code: 'PARTNER_NOT_READY', message: m.detail, field: m.check })),
      );
    return r;
  }

  // ---------------------------------------------------------------- lifecycle
  /** The partner submits its onboarding for DealDash review. */
  async submit(actor: Actor, organizationId: string, meta: RequestMeta) {
    const p = await this.access.requirePartner(actor, organizationId);
    await this.access.requireOrgWide(actor, 'partner.profile.write');
    if (p.lifecycle !== 'DRAFT' && p.lifecycle !== 'CHANGES_REQUESTED')
      throw new AppError(
        'PARTNER_TRANSITION_INVALID',
        `A ${p.lifecycle} partner cannot be submitted`,
        409,
      );
    await this.gate(organizationId, 'UNDER_REVIEW');
    await this.apply(actor, p, 'UNDER_REVIEW', 'Submitted for review', meta, {
      submittedAt: new Date(),
    });
    return this.profile(organizationId);
  }

  /** DealDash moves a partner through review and readiness. ACTIVE (and re-activation) waits for a second administrator. */
  async transition(
    actor: Actor,
    organizationId: string,
    to: PartnerLifecycle,
    reason: string,
    meta: RequestMeta,
  ) {
    const p = await this.access.load(organizationId);
    if (!PARTNER_TRANSITIONS[p.lifecycle].includes(to))
      throw new AppError('PARTNER_TRANSITION_INVALID', `${p.lifecycle} cannot move to ${to}`, 409);
    if (to === 'UNDER_REVIEW')
      throw new AppError(
        'PARTNER_TRANSITION_INVALID',
        'The partner submits its own onboarding',
        409,
      );
    if (PARTNER_APPROVAL_REQUIRED.includes(to)) {
      await this.gate(organizationId, to);
      const row = await this.prisma.partner.updateMany({
        where: { organizationId, pendingLifecycle: null },
        data: {
          pendingLifecycle: to,
          pendingReason: reason,
          pendingRequestedByUserId: actor.userId,
          pendingRequestedAt: new Date(),
        },
      });
      if (!row.count)
        throw new AppError('INVALID_STATE', 'A change is already waiting for approval', 409);
      await this.audit.record({
        action: 'partner.lifecycle.requested',
        entityType: 'Partner',
        entityId: organizationId,
        previousState: { lifecycle: p.lifecycle },
        newState: { requested: to },
        reason,
        actor,
        subjectOrganizationId: organizationId,
        scope: SCOPE(organizationId),
        meta,
      });
      return this.profile(organizationId);
    }
    await this.gate(organizationId, to);
    await this.apply(
      actor,
      p,
      to,
      reason,
      meta,
      ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED'].includes(to)
        ? { reviewedByUserId: actor.userId, reviewedAt: new Date() }
        : {},
    );
    return this.profile(organizationId);
  }

  /** The second administrator approves or rejects a pending activation; the gate runs again at approval. */
  async decide(
    actor: Actor,
    organizationId: string,
    decision: 'approve' | 'reject',
    reason: string | undefined,
    meta: RequestMeta,
  ) {
    const p = await this.access.load(organizationId);
    const row = await this.prisma.partner.findUniqueOrThrow({ where: { organizationId } });
    if (!row.pendingLifecycle)
      throw new AppError('INVALID_STATE', 'Nothing is waiting for approval', 409);
    if (row.pendingRequestedByUserId === actor.userId)
      throw new AppError(
        'APPROVAL_REQUIRED',
        'A different administrator must approve this change',
        403,
      );
    const to = row.pendingLifecycle as PartnerLifecycle;
    const clear = {
      pendingLifecycle: null,
      pendingReason: null,
      pendingRequestedByUserId: null,
      pendingRequestedAt: null,
    };
    if (decision === 'reject') {
      if (!reason) throw AppError.validation('A reason is required', 'reason');
      await this.prisma.partner.update({ where: { organizationId }, data: clear });
      await this.audit.record({
        action: 'partner.lifecycle.rejected',
        entityType: 'Partner',
        entityId: organizationId,
        newState: { rejected: to },
        reason,
        actor,
        subjectOrganizationId: organizationId,
        scope: SCOPE(organizationId),
        meta,
      });
      return this.profile(organizationId);
    }
    await this.gate(organizationId, to);
    await this.apply(
      actor,
      p,
      to,
      row.pendingReason ?? reason ?? 'Approved',
      meta,
      { ...clear, approvedByUserId: actor.userId, approvedAt: new Date() },
      row.pendingRequestedByUserId,
    );
    return this.profile(organizationId);
  }

  private async apply(
    actor: Actor,
    p: PartnerRow,
    to: PartnerLifecycle,
    reason: string,
    meta: RequestMeta,
    extra: Prisma.PartnerUncheckedUpdateInput,
    approvalOf?: string | null,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.partner.updateMany({
        where: { organizationId: p.organizationId, lifecycle: p.lifecycle },
        data: {
          ...(extra as object),
          lifecycle: to,
          lifecycleReason: reason,
          version: { increment: 1 },
        },
      });
      if (r.count !== 1) throw new AppError('INVALID_STATE', 'This partner changed meanwhile', 409);
      // the Business Account becomes active with the partner; suspension blocks new exposure through the lifecycle (records stay readable)
      if (to === 'ACTIVE')
        await tx.organization.update({
          where: { id: p.organizationId },
          data: { status: 'ACTIVE' },
        });
      await this.audit.record(
        {
          action: 'partner.lifecycle.changed',
          entityType: 'Partner',
          entityId: p.organizationId,
          previousState: { lifecycle: p.lifecycle },
          newState: { lifecycle: to },
          reason,
          actor,
          subjectOrganizationId: p.organizationId,
          scope: SCOPE(p.organizationId),
          approvalRef: approvalOf ? `requested-by:${approvalOf}` : null,
          meta,
        },
        tx,
      );
    });
  }

  // ---------------------------------------------------------------- DealDash creates a partner Business Account
  async create(actor: Actor, b: z.infer<typeof partnerCreateSchema>, meta: RequestMeta) {
    const market = await this.prisma.countryConfiguration.findUnique({
      where: { code: b.country },
    });
    if (!market) throw AppError.validation('Choose a market from the list', 'country');
    if (await this.prisma.user.findUnique({ where: { email: b.adminEmail } }))
      throw AppError.conflict('EMAIL_TAKEN', 'This email is already registered');
    const role = await this.prisma.role.findUniqueOrThrow({ where: { code: 'PARTNER_ADMIN' } });
    const ttl = (await this.access.settings()).inviteTtlHours ?? 72;
    const token = randomToken(24);
    const orgId = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          type: 'PARTNER',
          status: 'DRAFT',
          nameEn: b.nameEn,
          nameAr: b.nameAr,
          partner: {
            create: {
              partnerType: b.partnerType,
              legalName: b.legalName,
              registrationNumber: b.registrationNumber ?? null,
              parentGroup: b.parentGroup ?? null,
              requestedMarkets: [b.country],
            },
          },
        },
      });
      await tx.legalEntity.create({
        data: {
          organizationId: org.id,
          legalName: b.legalName,
          registrationNumber: b.registrationNumber ?? null,
          country: b.country,
          currency: market.currency,
        },
      });
      const inv = await tx.invitation.create({
        data: {
          organizationId: org.id,
          name: b.adminName,
          email: b.adminEmail,
          roleId: role.id,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + ttl * 3600_000),
          invitedByUserId: actor.userId,
        },
      });
      await this.audit.record(
        {
          action: 'partner.created',
          entityType: 'Partner',
          entityId: org.id,
          newState: { partnerType: b.partnerType, country: b.country, invitation: inv.id },
          actor,
          subjectOrganizationId: org.id,
          scope: SCOPE(org.id),
          meta,
        },
        tx,
      );
      return org.id;
    });
    await this.email.send({
      to: b.adminEmail,
      templateKey: 'partner.invite',
      locale: meta.locale,
      subject: `You are invited to ${b.nameEn} on DealDash for Partners`,
      body: `Accept your invitation: ${this.env.PARTNER_APP_URL}/${meta.locale}/accept-invite?token=${token}`,
    });
    return this.profile(orgId);
  }

  async list(q: { lifecycle?: string; partnerType?: string }) {
    const rows = await this.prisma.organization.findMany({
      where: {
        type: 'PARTNER',
        partner: {
          is: {
            ...(q.lifecycle ? { lifecycle: q.lifecycle } : {}),
            ...(q.partnerType ? { partnerType: q.partnerType as never } : {}),
          },
        },
      },
      include: { partner: true },
      orderBy: { nameEn: 'asc' },
      take: 500,
    });
    return Promise.all(
      rows.map(async (o) => ({
        organizationId: o.id,
        nameEn: o.nameEn,
        nameAr: o.nameAr,
        partnerType: o.partner!.partnerType,
        lifecycle: o.partner!.lifecycle,
        requestedMarkets: o.partner!.requestedMarkets,
        pending: o.partner!.pendingLifecycle,
        readiness: (await this.readiness(o.id)).state,
      })),
    );
  }

  async history(organizationId: string) {
    const rows = await this.prisma.auditLog.findMany({
      where: { scope: SCOPE(organizationId) },
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      at: r.occurredAt.toISOString(),
      actorUserId: r.actorUserId,
      actorRole: r.actorRole,
      reason: r.reason,
      previousState: r.previousState,
      newState: r.newState,
      approvalRef: r.approvalRef,
    }));
  }
}
