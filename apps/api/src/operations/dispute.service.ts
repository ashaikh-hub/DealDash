import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CONFIG_KEYS, type OperationsConfig } from '@dealdash/config';
import {
  CASE_OPEN_STATUSES,
  CASE_TERMINAL_STATUSES,
  CASE_TYPES,
  type CaseStatus,
} from '@dealdash/types';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { FilesService } from '../files/files.service';
import { MarketService } from '../platform/markets/market.service';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

interface DisputeConfig {
  types: string[];
  slaHours: Record<string, number>;
}
export const DISPUTE_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const;
export const ATTACHMENT_TYPES = ['DOCUMENT', 'SCREENSHOT', 'CONTRACT', 'RECEIPT', 'OTHER'] as const;
const MAX_ATTACHMENTS = 20;

/** One evidence item kept on the case (the bytes live in the file store; this is the reference + who / when / what). */
export interface Attachment {
  id: string;
  fileId: string;
  type: (typeof ATTACHMENT_TYPES)[number];
  label: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  visibility: 'INTERNAL' | 'SHARED';
  fromBusiness: boolean;
  uploadedByUserId: string;
  uploadedAt: string;
}
/** Every status a case can still be worked in (Stage 8 lifecycle plus the Phase 3 IN_REVIEW / WAITING names). */
const OPEN: string[] = [...CASE_OPEN_STATUSES];
const TERMINAL: string[] = [...CASE_TERMINAL_STATUSES];

type Case = Prisma.DisputeCaseGetPayload<{ include: { notes: true } }>;

export interface CaseOpenInput {
  type: string;
  title: string;
  description?: string | null;
  priority?: string;
  product?: string | null;
  relatedType?: string | null;
  relatedId?: string | null;
  targetOrganizationId?: string | null;
  customerUserId?: string | null;
  // ---- Stage 8
  severity?: string | null;
  market?: string | null;
  legalEntityId?: string | null;
  businessAccountId?: string | null;
  assignedTeam?: string | null;
  queue?: string | null;
  reasonCode?: string | null;
  sourceEvent?: string | null;
  sourceEventId?: string | null;
  transactionRef?: string | null;
  financialImpactMinor?: number | null;
  currency?: string | null;
  supportCaseId?: string | null;
}

export interface CaseListFilter {
  status?: string;
  type?: string;
  team?: string;
  queue?: string;
  market?: string;
  severity?: string;
  slaState?: string;
  organizationId?: string;
  customerUserId?: string;
  open?: boolean;
  q?: string;
}

/**
 * The shared exception / case framework (Phase 3 disputes, completed in Stage 8). Every case has a type, an owner and team, a
 * severity and a priority, an SLA, an append-only note trail (notes, logged contacts, escalations), evidence, an optional financial
 * impact and a recorded resolution. The lifecycle is configuration (`operations.caseLifecycle`). A resolution with a financial
 * impact above the configured threshold needs a second person (maker-checker), and money only moves through a LINKED governed
 * adjustment, never as a shortcut here. A business sees its own cases and SHARED notes only; a customer is told when their case
 * changes.
 */
@Injectable()
export class DisputeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: SystemConfigService,
    private readonly files: FilesService,
    private readonly markets: MarketService,
  ) {}

  private cfg() {
    return this.config.get<DisputeConfig>(CONFIG_KEYS.PLATFORM_DISPUTES);
  }
  async ops(): Promise<OperationsConfig> {
    return this.config.get<OperationsConfig>(CONFIG_KEYS.OPERATIONS);
  }
  /** Phase 3 types (configuration) plus the Stage 8 shared exception types. */
  async types() {
    return [...new Set([...(await this.cfg()).types, ...CASE_TYPES])];
  }

  /** `forOrg` limits the view for a business (their own cases, SHARED notes only, no internal routing or approval details). */
  view(c: Case, forOrg: boolean, now = new Date()) {
    return {
      id: c.id,
      reference: c.reference,
      type: c.type,
      product: c.product,
      organizationId: c.organizationId,
      relatedType: c.relatedType,
      relatedId: c.relatedId,
      title: c.title,
      description: c.description,
      priority: c.priority,
      status: c.status,
      ownerUserId: forOrg ? null : c.ownerUserId,
      slaDueAt: c.slaDueAt.toISOString(),
      overdue: OPEN.includes(c.status) && c.slaDueAt < now,
      resolution: c.resolution,
      resolvedAt: c.resolvedAt?.toISOString() ?? null,
      attachments: this.attachmentsOf(c, forOrg),
      financialAdjustmentId: c.financialAdjustmentId,
      createdAt: c.createdAt.toISOString(),
      // ---- Stage 8
      severity: c.severity,
      market: c.market,
      legalEntityId: forOrg ? null : c.legalEntityId,
      businessAccountId: forOrg ? null : c.businessAccountId,
      customerUserId: forOrg ? null : c.customerUserId,
      assignedTeam: forOrg ? null : c.assignedTeam,
      queue: forOrg ? null : c.queue,
      reasonCode: c.reasonCode,
      sourceEvent: forOrg ? null : c.sourceEvent,
      sourceEventId: forOrg ? null : c.sourceEventId,
      transactionRef: c.transactionRef,
      financialImpactMinor: c.financialImpactMinor,
      currency: c.currency,
      proposedResolution: forOrg ? null : c.proposedResolution,
      approvalState: forOrg ? null : c.approvalState,
      approvalRequestedByUserId: forOrg ? null : c.approvalRequestedByUserId,
      approvalDecidedByUserId: forOrg ? null : c.approvalDecidedByUserId,
      approvalReason: forOrg ? null : c.approvalReason,
      slaState: OPEN.includes(c.status) && c.slaDueAt < now ? 'BREACHED' : c.slaState,
      escalationLevel: forOrg ? 0 : c.escalationLevel,
      supportCaseId: forOrg ? null : c.supportCaseId,
      awaitingYou: c.status === 'AWAITING_MERCHANT' || c.status === 'AWAITING_PARTNER',
      notes: c.notes
        .filter((n) => !forOrg || n.visibility === 'SHARED')
        .map((n) => ({
          id: n.id,
          visibility: n.visibility,
          body: n.body,
          kind: n.kind,
          channel: forOrg ? null : n.channel,
          direction: forOrg ? null : n.direction,
          fromBusiness: n.authorOrganizationId !== null,
          createdAt: n.createdAt.toISOString(),
        })),
    };
  }

  private attachmentsOf(c: { evidence: unknown }, forOrg: boolean) {
    const all = (Array.isArray(c.evidence) ? c.evidence : []) as Attachment[];
    return all
      .filter((a) => !forOrg || a.visibility === 'SHARED')
      .map((a) => ({ ...a, uploadedByUserId: forOrg && !a.fromBusiness ? null : a.uploadedByUserId }));
  }

  /** The market a case belongs to: given, else the legal entity's country, else the business's market. */
  private async marketOf(b: CaseOpenInput, org: string | null): Promise<string | null> {
    if (b.market) return b.market.toUpperCase();
    if (b.legalEntityId) {
      const le = await this.prisma.legalEntity.findUnique({ where: { id: b.legalEntityId }, select: { country: true, organizationId: true } });
      if (!le || (org && le.organizationId !== org)) throw AppError.validation('The legal entity does not belong to this business', 'legalEntityId');
      return le.country;
    }
    if (org) return this.markets.resolveMarket(org).catch(() => null);
    return null;
  }

  async open(actor: Actor, organizationId: string | null, b: CaseOpenInput, meta: RequestMeta) {
    const cfg = await this.cfg();
    const ops = await this.ops();
    if (!(await this.types()).includes(b.type)) throw AppError.validation('Unknown case type', 'type');
    const priority = b.priority ?? 'NORMAL';
    if (!(priority in cfg.slaHours)) throw AppError.validation('Unknown priority', 'priority');
    const subjectOrg = organizationId ?? b.targetOrganizationId ?? null;
    if (subjectOrg && !(await this.prisma.organization.findUnique({ where: { id: subjectOrg }, select: { id: true } })))
      throw AppError.validation('The organization was not found', 'targetOrganizationId');
    if (b.businessAccountId) {
      const acc = await this.prisma.businessAccount.findUnique({ where: { id: b.businessAccountId }, select: { organizationId: true } });
      if (!acc || acc.organizationId !== subjectOrg) throw AppError.validation('The business account does not belong to this business', 'businessAccountId');
    }
    const route = ops.caseTypes[b.type];
    const market = await this.marketOf(b, subjectOrg);
    const now = new Date();
    const hours = cfg.slaHours[priority] ?? 72;
    const warnPct = ops.sla.CASE?.warnPct ?? 75;
    const c = await this.prisma.$transaction(async (tx) => {
      const row = await tx.disputeCase.create({
        data: {
          reference: `DC-${randomBytes(4).toString('hex').toUpperCase()}`,
          type: b.type,
          product: b.product ?? null,
          organizationId: subjectOrg,
          customerUserId: organizationId ? null : (b.customerUserId ?? null),
          relatedType: b.relatedType ?? null,
          relatedId: b.relatedId ?? null,
          title: b.title,
          description: b.description ?? null,
          priority,
          openedByUserId: actor.userId,
          openedByOrganizationId: organizationId,
          slaDueAt: new Date(now.getTime() + hours * 3_600_000),
          slaWarnAt: new Date(now.getTime() + (hours * warnPct * 36_000)),
          severity: b.severity ?? route?.severity ?? 'MEDIUM',
          market,
          legalEntityId: b.legalEntityId ?? null,
          businessAccountId: b.businessAccountId ?? null,
          assignedTeam: organizationId ? (route?.team ?? null) : (b.assignedTeam ?? route?.team ?? null),
          queue: organizationId ? null : (b.queue ?? ops.supportQueues.find((q) => q.caseTypes.includes(b.type))?.code ?? null),
          reasonCode: b.reasonCode ?? null,
          sourceEvent: organizationId ? null : (b.sourceEvent ?? null),
          sourceEventId: organizationId ? null : (b.sourceEventId ?? null),
          transactionRef: b.transactionRef ?? null,
          financialImpactMinor: b.financialImpactMinor ?? null,
          currency: b.currency ?? (b.financialImpactMinor ? 'SAR' : null),
          supportCaseId: organizationId ? null : (b.supportCaseId ?? null),
        },
        include: { notes: true },
      });
      await this.audit.record(
        { action: 'DISPUTE_OPENED', entityType: 'DisputeCase', entityId: row.id, actor, subjectOrganizationId: subjectOrg, newState: { type: b.type, priority, severity: row.severity, team: row.assignedTeam, ref: row.reference }, market, legalEntityId: row.legalEntityId, meta },
        tx,
      );
      return row;
    });
    return this.view(c, organizationId !== null);
  }

  /** Market-scoped DealDash users only see the markets they are scoped to (cases with no market need an unscoped user). */
  async marketFilter(actor: Actor | null): Promise<Prisma.DisputeCaseWhereInput> {
    if (!actor || actor.audience !== 'admin') return {};
    const codes = await this.markets.visibleCodes(actor, 'admin.disputes.read');
    return codes === null ? {} : { market: { in: [...codes] } };
  }

  async list(where: Prisma.DisputeCaseWhereInput, forOrg: boolean, filter: CaseListFilter = {}, actor: Actor | null = null) {
    const w: Prisma.DisputeCaseWhereInput = {
      ...where,
      ...(filter.status ? { status: filter.status } : filter.open ? { status: { in: OPEN } } : {}),
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.team ? { assignedTeam: filter.team } : {}),
      ...(filter.queue ? { queue: filter.queue } : {}),
      ...(filter.severity ? { severity: filter.severity } : {}),
      ...(filter.slaState ? { slaState: filter.slaState } : {}),
      ...(filter.customerUserId ? { customerUserId: filter.customerUserId } : {}),
      ...(filter.q ? { OR: [{ reference: { contains: filter.q, mode: 'insensitive' } }, { title: { contains: filter.q, mode: 'insensitive' } }, { transactionRef: { contains: filter.q, mode: 'insensitive' } }] } : {}),
      AND: [filter.market ? { market: filter.market } : {}, await this.marketFilter(actor)],
    };
    const rows = await this.prisma.disputeCase.findMany({ where: w, include: { notes: true }, orderBy: [{ slaDueAt: 'asc' }], take: 200 });
    return rows.map((r) => this.view(r, forOrg));
  }

  async load(id: string, organizationId?: string, actor: Actor | null = null) {
    const c = await this.prisma.disputeCase.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}), ...(await this.marketFilter(actor)) },
      include: { notes: { orderBy: { createdAt: 'asc' } } },
    });
    if (!c) throw AppError.notFound();
    return c;
  }

  async get(id: string, organizationId?: string, actor: Actor | null = null) {
    return this.view(await this.load(id, organizationId, actor), organizationId !== undefined);
  }

  /** The full audit trail of one case (DealDash only). */
  async history(id: string, actor: Actor | null = null) {
    await this.load(id, undefined, actor);
    const rows = await this.prisma.auditLog.findMany({ where: { entityType: 'DisputeCase', entityId: id }, orderBy: { occurredAt: 'asc' }, take: 500 });
    return rows.map((a) => ({ at: a.occurredAt.toISOString(), action: a.action, actorUserId: a.actorUserId, actorRole: a.actorRole, reason: a.reason, previousState: a.previousState, newState: a.newState }));
  }

  private requireOpen(c: { status: string }) {
    if (!OPEN.includes(c.status)) throw new AppError('INVALID_STATE', 'This case is closed', 409);
  }

  async note(actor: Actor, id: string, organizationId: string | undefined, body: string, visibility: 'INTERNAL' | 'SHARED', meta: RequestMeta) {
    const c = await this.load(id, organizationId, organizationId ? null : actor);
    this.requireOpen(c);
    const vis = organizationId ? 'SHARED' : visibility; // a business can never write an internal note
    // a business reply to a case waiting for it moves the case back to DealDash
    const reply = organizationId && (c.status === 'AWAITING_MERCHANT' || c.status === 'AWAITING_PARTNER');
    await this.prisma.$transaction(async (tx) => {
      await tx.caseNote.create({ data: { caseId: id, authorUserId: actor.userId, authorOrganizationId: organizationId ?? null, visibility: vis, body } });
      if (reply) await tx.disputeCase.updateMany({ where: { id, status: c.status }, data: { status: 'INVESTIGATING' } });
      await this.audit.record({ action: 'DISPUTE_NOTE_ADDED', entityType: 'DisputeCase', entityId: id, actor, subjectOrganizationId: c.organizationId, previousState: reply ? { status: c.status } : undefined, newState: { visibility: vis, ...(reply ? { status: 'INVESTIGATING' } : {}) }, market: c.market, meta }, tx);
    });
    return this.get(id, organizationId);
  }

  /** Stage 8: a logged contact with the customer or business (channel, direction); internal to DealDash. */
  async contact(actor: Actor, id: string, b: { channel: string; direction: 'INBOUND' | 'OUTBOUND'; body: string }, meta: RequestMeta) {
    const c = await this.load(id, undefined, actor);
    this.requireOpen(c);
    await this.prisma.$transaction(async (tx) => {
      await tx.caseNote.create({ data: { caseId: id, authorUserId: actor.userId, visibility: 'INTERNAL', body: b.body, kind: 'CONTACT', channel: b.channel, direction: b.direction } });
      await this.audit.record({ action: 'CASE_CONTACT_LOGGED', entityType: 'DisputeCase', entityId: id, actor, subjectOrganizationId: c.organizationId, newState: { channel: b.channel, direction: b.direction }, market: c.market, meta }, tx);
    });
    return this.get(id);
  }

  async assign(actor: Actor, id: string, ownerUserId: string, meta: RequestMeta, team?: string | null) {
    const c = await this.load(id, undefined, actor);
    this.requireOpen(c);
    const owner = await this.prisma.user.findFirst({ where: { id: ownerUserId, memberships: { some: { organization: { type: 'DEALDASH' } } } }, select: { id: true } });
    if (!owner) throw AppError.validation('The owner must be a DealDash user', 'ownerUserId');
    await this.prisma.$transaction(async (tx) => {
      // assigning a new case starts the review (Phase 3 IN_REVIEW); a case already being worked keeps its status
      await tx.disputeCase.update({ where: { id }, data: { ownerUserId, status: c.status === 'OPEN' ? 'IN_REVIEW' : c.status, ...(team ? { assignedTeam: team } : {}) } });
      await this.audit.record({ action: 'DISPUTE_ASSIGNED', entityType: 'DisputeCase', entityId: id, actor, subjectOrganizationId: c.organizationId, previousState: { owner: c.ownerUserId, team: c.assignedTeam }, newState: { owner: ownerUserId, team: team ?? c.assignedTeam }, market: c.market, meta }, tx);
    });
    return this.get(id);
  }

  /** Stage 8: move a case along its configured lifecycle (not to a closing status: resolve / reject do that, with an outcome). */
  async transition(actor: Actor, id: string, to: CaseStatus, note: string | null, meta: RequestMeta) {
    const c = await this.load(id, undefined, actor);
    this.requireOpen(c);
    if (TERMINAL.includes(to) || to === 'AWAITING_APPROVAL')
      throw new AppError('CASE_TRANSITION_INVALID', 'Use resolve, reject or request approval for this step', 409);
    const ops = await this.ops();
    if (!(ops.caseLifecycle[c.status] ?? []).includes(to))
      throw new AppError('CASE_TRANSITION_INVALID', `A case cannot move from ${c.status} to ${to}`, 409);
    if ((to === 'AWAITING_MERCHANT' || to === 'AWAITING_PARTNER') && !c.organizationId)
      throw new AppError('CASE_TRANSITION_INVALID', 'This case is not about a business', 409);
    if (to === 'AWAITING_CUSTOMER' && !c.customerUserId)
      throw new AppError('CASE_TRANSITION_INVALID', 'This case is not about a customer', 409);
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.disputeCase.updateMany({ where: { id, status: c.status }, data: { status: to } });
      if (r.count !== 1) throw new AppError('VERSION_CONFLICT', 'The case changed. Reload and try again.', 409);
      // a request to the business is a SHARED note it can answer; to the customer it is a notification
      if (note) await tx.caseNote.create({ data: { caseId: id, authorUserId: actor.userId, visibility: to === 'AWAITING_MERCHANT' || to === 'AWAITING_PARTNER' ? 'SHARED' : 'INTERNAL', body: note, kind: to.startsWith('AWAITING_') ? 'ESCALATION' : 'NOTE' } });
      if (to === 'AWAITING_CUSTOMER') await this.notifyCustomer(tx, c, 'INFORMATION_REQUESTED');
      await this.audit.record({ action: 'CASE_STATUS_CHANGED', entityType: 'DisputeCase', entityId: id, actor, subjectOrganizationId: c.organizationId, reason: note, previousState: { status: c.status }, newState: { status: to }, market: c.market, legalEntityId: c.legalEntityId, meta }, tx);
    });
    return this.get(id);
  }

  /** Stage 8: severity, priority, team, queue, financial impact and proposed resolution (DealDash only). */
  async update(
    actor: Actor,
    id: string,
    b: { severity?: string; priority?: string; assignedTeam?: string | null; queue?: string | null; financialImpactMinor?: number | null; currency?: string | null; proposedResolution?: string | null },
    meta: RequestMeta,
  ) {
    const c = await this.load(id, undefined, actor);
    this.requireOpen(c);
    if (c.approvalState === 'PENDING') throw new AppError('CASE_APPROVAL_PENDING', 'This case is waiting for approval', 409);
    const cfg = await this.cfg();
    if (b.priority && !(b.priority in cfg.slaHours)) throw AppError.validation('Unknown priority', 'priority');
    const data: Prisma.DisputeCaseUpdateInput = {};
    if (b.severity) data.severity = b.severity;
    if (b.priority && b.priority !== c.priority) {
      data.priority = b.priority;
      // a new priority restarts the SLA clock from the case's creation (never extends a breached case silently: the change is audited)
      data.slaDueAt = new Date(c.createdAt.getTime() + (cfg.slaHours[b.priority] ?? 72) * 3_600_000);
    }
    if (b.assignedTeam !== undefined) data.assignedTeam = b.assignedTeam;
    if (b.queue !== undefined) data.queue = b.queue;
    if (b.financialImpactMinor !== undefined) data.financialImpactMinor = b.financialImpactMinor;
    if (b.currency !== undefined) data.currency = b.currency;
    if (b.proposedResolution !== undefined) data.proposedResolution = b.proposedResolution;
    await this.prisma.$transaction(async (tx) => {
      await tx.disputeCase.update({ where: { id }, data });
      await this.audit.record({ action: 'CASE_UPDATED', entityType: 'DisputeCase', entityId: id, actor, subjectOrganizationId: c.organizationId, previousState: { severity: c.severity, priority: c.priority, team: c.assignedTeam, queue: c.queue, financialImpactMinor: c.financialImpactMinor, proposedResolution: c.proposedResolution }, newState: b, market: c.market, meta }, tx);
    });
    return this.get(id);
  }

  /** Does closing this case need a second person (financial impact above the configured threshold)? */
  async needsApproval(c: { financialImpactMinor: number | null }) {
    const ops = await this.ops();
    if (ops.caseApprovalAboveMinor === null) return false;
    return (c.financialImpactMinor ?? 0) > ops.caseApprovalAboveMinor;
  }

  /** Stage 8 maker: propose the resolution of a case with a financial impact; a different person approves it. */
  async requestApproval(actor: Actor, id: string, b: { proposedResolution: string; financialImpactMinor?: number | null }, meta: RequestMeta) {
    const c = await this.load(id, undefined, actor);
    this.requireOpen(c);
    if (c.approvalState === 'PENDING') throw new AppError('CASE_APPROVAL_PENDING', 'This case is already waiting for approval', 409);
    const impact = b.financialImpactMinor ?? c.financialImpactMinor;
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.disputeCase.updateMany({
        where: { id, status: c.status },
        data: { status: 'AWAITING_APPROVAL', approvalState: 'PENDING', proposedResolution: b.proposedResolution, financialImpactMinor: impact, approvalRequestedByUserId: actor.userId, approvalRequestedAt: new Date(), approvalDecidedByUserId: null, approvalDecidedAt: null, approvalReason: null },
      });
      if (r.count !== 1) throw new AppError('VERSION_CONFLICT', 'The case changed. Reload and try again.', 409);
      await this.audit.record({ action: 'CASE_APPROVAL_REQUESTED', entityType: 'DisputeCase', entityId: id, actor, subjectOrganizationId: c.organizationId, reason: b.proposedResolution, previousState: { status: c.status }, newState: { status: 'AWAITING_APPROVAL', financialImpactMinor: impact }, market: c.market, meta }, tx);
    });
    return this.get(id);
  }

  /** Stage 8 checker: approve (the proposed resolution closes the case) or send back. Never the person who proposed it. */
  async decideApproval(actor: Actor, id: string, approve: boolean, reason: string, meta: RequestMeta) {
    const c = await this.load(id, undefined, actor);
    if (c.approvalState !== 'PENDING' || c.status !== 'AWAITING_APPROVAL') throw new AppError('INVALID_STATE', 'Nothing is waiting for approval on this case', 409);
    if (c.approvalRequestedByUserId === actor.userId) throw new AppError('CHECKER_REQUIRED', 'A different person must approve this resolution', 403);
    if ((await this.needsApproval(c)) && !actor.permissions.has('admin.finance.approve'))
      throw new AppError('FORBIDDEN', 'A finance approver must decide a resolution with a financial impact', 403);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.disputeCase.updateMany({
        where: { id, status: 'AWAITING_APPROVAL', approvalState: 'PENDING' },
        data: approve
          ? { status: 'RESOLVED', approvalState: 'APPROVED', approvalDecidedByUserId: actor.userId, approvalDecidedAt: now, approvalReason: reason, resolution: c.proposedResolution, resolvedAt: now, resolvedByUserId: actor.userId, slaState: c.slaDueAt < now ? 'BREACHED' : 'MET' }
          : { status: 'INVESTIGATING', approvalState: 'REJECTED', approvalDecidedByUserId: actor.userId, approvalDecidedAt: now, approvalReason: reason },
      });
      if (r.count !== 1) throw new AppError('VERSION_CONFLICT', 'The case changed. Reload and try again.', 409);
      if (approve) await this.notifyCustomer(tx, c, 'RESOLVED');
      await this.audit.record({ action: approve ? 'CASE_APPROVAL_GRANTED' : 'CASE_APPROVAL_REJECTED', entityType: 'DisputeCase', entityId: id, actor, subjectOrganizationId: c.organizationId, reason, approvalRef: c.approvalRequestedByUserId, previousState: { status: c.status }, newState: { status: approve ? 'RESOLVED' : 'INVESTIGATING', financialImpactMinor: c.financialImpactMinor }, market: c.market, legalEntityId: c.legalEntityId, meta }, tx);
    });
    return this.get(id);
  }

  async resolve(actor: Actor, id: string, b: { outcome: 'RESOLVED' | 'CLOSED' | 'REJECTED'; resolution: string; financialAdjustmentId?: string | null }, meta: RequestMeta) {
    const c = await this.load(id, undefined, actor);
    if (!OPEN.includes(c.status)) throw new AppError('INVALID_STATE', 'This case is already closed', 409);
    if (c.status === 'AWAITING_APPROVAL') throw new AppError('CASE_APPROVAL_PENDING', 'This case is waiting for approval', 409);
    // the person who raised it does not close it alone
    if (c.openedByUserId === actor.userId && c.openedByOrganizationId === null && c.ownerUserId !== actor.userId)
      throw new AppError('APPROVAL_REQUIRED', 'Another team member should close a case you raised', 403);
    // a resolution with a financial impact above the threshold goes through the approval step (maker-checker)
    if (b.outcome === 'RESOLVED' && c.approvalState !== 'APPROVED' && (await this.needsApproval(c)))
      throw new AppError('APPROVAL_REQUIRED', 'A resolution with a financial impact needs a second person: request approval', 409);
    if (b.financialAdjustmentId) {
      const j = await this.prisma.ledgerJournal.findUnique({ where: { id: b.financialAdjustmentId }, select: { id: true } });
      if (!j) throw AppError.validation('The finance record was not found', 'financialAdjustmentId');
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.disputeCase.updateMany({
        where: { id, status: { in: OPEN } },
        data: { status: b.outcome, resolution: b.resolution, resolvedAt: now, resolvedByUserId: actor.userId, financialAdjustmentId: b.financialAdjustmentId ?? null, slaState: c.slaDueAt < now ? 'BREACHED' : 'MET' },
      });
      if (r.count !== 1) throw new AppError('VERSION_CONFLICT', 'The case changed. Reload and try again.', 409);
      await this.notifyCustomer(tx, c, b.outcome);
      await this.audit.record({ action: 'DISPUTE_RESOLVED', entityType: 'DisputeCase', entityId: id, actor, subjectOrganizationId: c.organizationId, reason: b.resolution, previousState: { status: c.status }, newState: { status: b.outcome, financialAdjustmentId: b.financialAdjustmentId ?? null }, market: c.market, legalEntityId: c.legalEntityId, meta }, tx);
    });
    return this.get(id);
  }

  /** The customer a case is about is told in-app when it closes or needs them (delivery to other channels is tracked separately). */
  private async notifyCustomer(tx: Prisma.TransactionClient, c: Case, event: string) {
    // a fraud review is internal: the customer is told through the restriction workflow if (and only if) one is approved
    if (!c.customerUserId || c.type === 'FRAUD_REVIEW') return;
    await tx.notification.createMany({
      data: [{ userId: c.customerUserId, type: 'CASE_UPDATED', dedupeKey: `case:${c.id}:${event}`, data: { caseId: c.id, reference: c.reference, event, title: c.title } }],
      skipDuplicates: true,
    });
    await tx.disputeCase.update({ where: { id: c.id }, data: { customerNotifiedAt: new Date() } });
  }

  // ---------------------------------------------------------------- evidence attachments (reference + access control + audit; no document management)
  private async openCase(id: string, organizationId?: string) {
    const c = await this.load(id, organizationId);
    this.requireOpen(c);
    if (!c.organizationId) throw AppError.validation('Evidence can only be attached to a case about a business');
    return c as Case & { organizationId: string };
  }

  /** Step 1: a signed upload URL for the evidence file (the standard file flow: type, size and content are checked on completion). */
  async attachmentIntent(actor: Actor, id: string, organizationId: string | undefined, input: { fileName: string; mimeType: string; sizeBytes: number }) {
    const c = await this.openCase(id, organizationId);
    return this.files.createIntent(actor, c.organizationId, { kind: 'DOCUMENT', ...input });
  }

  /** Step 2: after the upload, verify the file and link it to the case. */
  async attach(
    actor: Actor,
    id: string,
    organizationId: string | undefined,
    b: { fileId: string; type: Attachment['type']; label?: string | null; visibility?: 'INTERNAL' | 'SHARED' },
    meta: RequestMeta,
  ) {
    const c = await this.openCase(id, organizationId);
    const file = await this.files.complete(actor, c.organizationId, b.fileId, meta);
    const list = (Array.isArray(c.evidence) ? c.evidence : []) as unknown as Attachment[];
    if (list.some((a) => a.fileId === b.fileId)) throw new AppError('INVALID_STATE', 'This file is already attached', 409);
    if (list.length >= MAX_ATTACHMENTS) throw AppError.validation(`A case holds at most ${MAX_ATTACHMENTS} files`);
    const item: Attachment = {
      id: randomBytes(8).toString('hex'),
      fileId: b.fileId,
      type: b.type,
      label: b.label ?? null,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes ?? 0,
      visibility: organizationId ? 'SHARED' : (b.visibility ?? 'SHARED'),
      fromBusiness: organizationId !== undefined,
      uploadedByUserId: actor.userId,
      uploadedAt: new Date().toISOString(),
    };
    await this.prisma.$transaction(async (tx) => {
      // a conditional update on the current list, so two concurrent uploads cannot overwrite each other
      const upd = await tx.$executeRaw`UPDATE "DisputeCase" SET "evidence" = "evidence" || ${JSON.stringify([item])}::jsonb, "updatedAt" = now()
        WHERE "id" = ${id}::uuid AND "status" = ANY(${OPEN}::text[]) AND jsonb_array_length("evidence") < ${MAX_ATTACHMENTS}`;
      if (upd !== 1) throw new AppError('VERSION_CONFLICT', 'The case changed. Reload and try again.', 409);
      await this.audit.record({ action: 'DISPUTE_EVIDENCE_ADDED', entityType: 'DisputeCase', entityId: id, actor, subjectOrganizationId: c.organizationId, newState: { fileId: b.fileId, type: b.type, visibility: item.visibility }, market: c.market, meta }, tx);
    });
    return this.get(id, organizationId);
  }

  /** Short-lived signed link. A business can only open SHARED evidence of its own cases. */
  async attachmentUrl(actor: Actor, id: string, attachmentId: string, organizationId: string | undefined, meta: RequestMeta) {
    const c = await this.load(id, organizationId);
    const a = ((Array.isArray(c.evidence) ? c.evidence : []) as unknown as Attachment[]).find((x) => x.id === attachmentId);
    if (!a || (organizationId && a.visibility !== 'SHARED') || !c.organizationId) throw AppError.notFound();
    const url = await this.files.readUrl(a.fileId, c.organizationId, 300);
    await this.audit.record({ action: 'DISPUTE_EVIDENCE_VIEWED', entityType: 'DisputeCase', entityId: id, actor, subjectOrganizationId: c.organizationId, newState: { attachmentId }, market: c.market, meta });
    return url;
  }
}
