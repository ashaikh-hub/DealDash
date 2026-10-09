import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { FilesService } from '../files/files.service';
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
const OPEN = ['OPEN', 'IN_REVIEW'];

type Case = Prisma.DisputeCaseGetPayload<{ include: { notes: true } }>;

/**
 * Dispute and exception cases (reward refused, redemption dispute, sponsor charge dispute, settlement mismatch, import conflict,
 * reconciliation break...). Every case has an owner, a priority, an SLA, an append-only note trail and a recorded resolution.
 * A resolution that needs money is only a LINK to the finance adjustment (made under finance approval rules), never a shortcut.
 */
@Injectable()
export class DisputeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: SystemConfigService,
    private readonly files: FilesService,
  ) {}

  private cfg() {
    return this.config.get<DisputeConfig>(CONFIG_KEYS.PLATFORM_DISPUTES);
  }

  /** `organizationId` limits to one business (their own cases, SHARED notes only). */
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
      notes: c.notes
        .filter((n) => !forOrg || n.visibility === 'SHARED')
        .map((n) => ({
          id: n.id,
          visibility: n.visibility,
          body: n.body,
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

  async open(
    actor: Actor,
    organizationId: string | null,
    b: { type: string; title: string; description?: string | null; priority?: string; product?: string | null; relatedType?: string | null; relatedId?: string | null; targetOrganizationId?: string | null; customerUserId?: string | null },
    meta: RequestMeta,
  ) {
    const cfg = await this.cfg();
    if (!cfg.types.includes(b.type)) throw AppError.validation('Unknown case type', 'type');
    const priority = b.priority ?? 'NORMAL';
    if (!(priority in cfg.slaHours)) throw AppError.validation('Unknown priority', 'priority');
    const subjectOrg = organizationId ?? b.targetOrganizationId ?? null;
    if (subjectOrg && !(await this.prisma.organization.findUnique({ where: { id: subjectOrg }, select: { id: true } })))
      throw AppError.validation('The organization was not found', 'targetOrganizationId');
    const now = new Date();
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
          slaDueAt: new Date(now.getTime() + (cfg.slaHours[priority] ?? 72) * 3_600_000),
        },
        include: { notes: true },
      });
      await this.audit.record(
        { action: 'DISPUTE_OPENED', entityType: 'DisputeCase', entityId: row.id, actor, subjectOrganizationId: subjectOrg, newState: { type: b.type, priority, ref: row.reference }, meta },
        tx,
      );
      return row;
    });
    return this.view(c, organizationId !== null);
  }

  async list(where: Prisma.DisputeCaseWhereInput, forOrg: boolean) {
    const rows = await this.prisma.disputeCase.findMany({ where, include: { notes: true }, orderBy: [{ slaDueAt: 'asc' }], take: 200 });
    return rows.map((r) => this.view(r, forOrg));
  }

  async load(id: string, organizationId?: string) {
    const c = await this.prisma.disputeCase.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}) },
      include: { notes: { orderBy: { createdAt: 'asc' } } },
    });
    if (!c) throw AppError.notFound();
    return c;
  }

  async get(id: string, organizationId?: string) {
    return this.view(await this.load(id, organizationId), organizationId !== undefined);
  }

  async note(actor: Actor, id: string, organizationId: string | undefined, body: string, visibility: 'INTERNAL' | 'SHARED', meta: RequestMeta) {
    const c = await this.load(id, organizationId);
    if (!OPEN.includes(c.status)) throw new AppError('INVALID_STATE', 'This case is closed', 409);
    const vis = organizationId ? 'SHARED' : visibility; // a business can never write an internal note
    await this.prisma.$transaction(async (tx) => {
      await tx.caseNote.create({ data: { caseId: id, authorUserId: actor.userId, authorOrganizationId: organizationId ?? null, visibility: vis, body } });
      await this.audit.record({ action: 'DISPUTE_NOTE_ADDED', entityType: 'DisputeCase', entityId: id, actor, subjectOrganizationId: c.organizationId, newState: { visibility: vis }, meta }, tx);
    });
    return this.get(id, organizationId);
  }

  async assign(actor: Actor, id: string, ownerUserId: string, meta: RequestMeta) {
    const c = await this.load(id);
    if (!OPEN.includes(c.status)) throw new AppError('INVALID_STATE', 'This case is closed', 409);
    const owner = await this.prisma.user.findFirst({ where: { id: ownerUserId, memberships: { some: { organization: { type: 'DEALDASH' } } } }, select: { id: true } });
    if (!owner) throw AppError.validation('The owner must be a DealDash user', 'ownerUserId');
    await this.prisma.$transaction(async (tx) => {
      await tx.disputeCase.update({ where: { id }, data: { ownerUserId, status: 'IN_REVIEW' } });
      await this.audit.record({ action: 'DISPUTE_ASSIGNED', entityType: 'DisputeCase', entityId: id, actor, subjectOrganizationId: c.organizationId, previousState: { owner: c.ownerUserId }, newState: { owner: ownerUserId }, meta }, tx);
    });
    return this.get(id);
  }

  async resolve(actor: Actor, id: string, b: { outcome: 'RESOLVED' | 'CLOSED'; resolution: string; financialAdjustmentId?: string | null }, meta: RequestMeta) {
    const c = await this.load(id);
    if (!OPEN.includes(c.status)) throw new AppError('INVALID_STATE', 'This case is already closed', 409);
    // the person who raised it does not close it alone
    if (c.openedByUserId === actor.userId && c.openedByOrganizationId === null && c.ownerUserId !== actor.userId)
      throw new AppError('APPROVAL_REQUIRED', 'Another team member should close a case you raised', 403);
    if (b.financialAdjustmentId) {
      const j = await this.prisma.ledgerJournal.findUnique({ where: { id: b.financialAdjustmentId }, select: { id: true } });
      if (!j) throw AppError.validation('The finance record was not found', 'financialAdjustmentId');
    }
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.disputeCase.updateMany({
        where: { id, status: { in: OPEN } },
        data: { status: b.outcome, resolution: b.resolution, resolvedAt: new Date(), resolvedByUserId: actor.userId, financialAdjustmentId: b.financialAdjustmentId ?? null },
      });
      if (r.count !== 1) throw new AppError('VERSION_CONFLICT', 'The case changed. Reload and try again.', 409);
      await this.audit.record({ action: 'DISPUTE_RESOLVED', entityType: 'DisputeCase', entityId: id, actor, subjectOrganizationId: c.organizationId, reason: b.resolution, previousState: { status: c.status }, newState: { status: b.outcome, financialAdjustmentId: b.financialAdjustmentId ?? null }, meta }, tx);
    });
    return this.get(id);
  }

  // ---------------------------------------------------------------- evidence attachments (reference + access control + audit; no document management)
  private async openCase(id: string, organizationId?: string) {
    const c = await this.load(id, organizationId);
    if (!OPEN.includes(c.status)) throw new AppError('INVALID_STATE', 'This case is closed', 409);
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
        WHERE "id" = ${id}::uuid AND "status" IN ('OPEN', 'IN_REVIEW', 'WAITING') AND jsonb_array_length("evidence") < ${MAX_ATTACHMENTS}`;
      if (upd !== 1) throw new AppError('VERSION_CONFLICT', 'The case changed. Reload and try again.', 409);
      await this.audit.record({ action: 'DISPUTE_EVIDENCE_ADDED', entityType: 'DisputeCase', entityId: id, actor, subjectOrganizationId: c.organizationId, newState: { fileId: b.fileId, type: b.type, visibility: item.visibility }, meta }, tx);
    });
    return this.get(id, organizationId);
  }

  /** Short-lived signed link. A business can only open SHARED evidence of its own cases. */
  async attachmentUrl(actor: Actor, id: string, attachmentId: string, organizationId: string | undefined, meta: RequestMeta) {
    const c = await this.load(id, organizationId);
    const a = ((Array.isArray(c.evidence) ? c.evidence : []) as unknown as Attachment[]).find((x) => x.id === attachmentId);
    if (!a || (organizationId && a.visibility !== 'SHARED') || !c.organizationId) throw AppError.notFound();
    const url = await this.files.readUrl(a.fileId, c.organizationId, 300);
    await this.audit.record({ action: 'DISPUTE_EVIDENCE_VIEWED', entityType: 'DisputeCase', entityId: id, actor, subjectOrganizationId: c.organizationId, newState: { attachmentId }, meta });
    return url;
  }
}