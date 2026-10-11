import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { sourceRecordSchema, type ImportJobView, type ImportRowView } from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementService } from '../platform/entitlement.service';
import { UsageService } from '../subscription/usage.service';
import { IntegrationService } from './integration.service';
import { IngestService } from './ingest.service';
import { MasterService } from './master.service';

/** Column headers each import kind accepts (CSV). Excel files are exported to CSV first (an Excel reader is a post-MVP addition). */
const COLUMNS: Record<string, Record<string, string>> = {
  MERCHANTS: {
    source_record_id: 'sourceRecordId',
    name_en: 'nameEn',
    name_ar: 'nameAr',
    brand: 'brand',
    country: 'country',
    category: 'categoryCode',
    source_updated_at: 'sourceUpdatedAt',
  },
  BRANCHES: {
    source_record_id: 'sourceRecordId',
    source_merchant_id: 'sourceMerchantId',
    name_en: 'nameEn',
    name_ar: 'nameAr',
    address_en: 'addressEn',
    address_ar: 'addressAr',
    city: 'city',
    country: 'country',
    latitude: 'latitude',
    longitude: 'longitude',
    source_updated_at: 'sourceUpdatedAt',
  },
  OFFERS: {
    source_record_id: 'sourceRecordId',
    source_merchant_id: 'sourceMerchantId',
    title_en: 'titleEn',
    title_ar: 'titleAr',
    benefit_en: 'benefitEn',
    benefit_ar: 'benefitAr',
    terms_en: 'termsEn',
    terms_ar: 'termsAr',
    channel: 'channel',
    valid_from: 'validFrom',
    valid_until: 'validUntil',
    category: 'categoryCode',
    branch_source_ids: 'branchSourceIds',
    source_updated_at: 'sourceUpdatedAt',
  },
};
/** Stage 7: the CSV template (header row) of an import kind, for the person preparing the file. */
export const importTemplate = (kind: 'MERCHANTS' | 'BRANCHES' | 'OFFERS') =>
  Object.keys(COLUMNS[kind]!).join(',') + '\n';
const TYPE_OF: Record<string, string> = {
  MERCHANTS: 'MERCHANT',
  BRANCHES: 'BRANCH',
  OFFERS: 'OFFER',
};
const ORDER: Record<string, number> = { MERCHANTS: 0, BRANCHES: 1, OFFERS: 2 };

/** Minimal RFC 4180 parser: quotes, escaped quotes, commas and line breaks inside quoted fields. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/**
 * Bulk import: Upload -> Validate -> Normalise -> Detect duplicates -> Preview -> Error report -> Approval -> Import -> Audit.
 * Bad data is never imported silently: every row keeps its status and reasons. Execution uses the same IngestService as the API.
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ingest: IngestService,
    private readonly master: MasterService,
    private readonly integrations: IntegrationService,
    private readonly entitlements: EntitlementService,
    private readonly usage: UsageService,
  ) {}

  private view(
    j: Awaited<ReturnType<PrismaService['importJob']['findFirstOrThrow']>>,
    requiresApproval: boolean,
  ): ImportJobView {
    return {
      id: j.id,
      organizationId: j.organizationId,
      kind: j.kind,
      sourceSystem: j.sourceSystem,
      fileName: j.fileName,
      status: j.status,
      totals: j.totals as Record<string, number>,
      createdAt: j.createdAt.toISOString(),
      approvedAt: j.approvedAt?.toISOString() ?? null,
      executedAt: j.executedAt?.toISOString() ?? null,
      requiresApproval,
      rejectionReason: j.rejectionReason,
    };
  }

  private async needsApproval(j: { organizationId: string | null; totals: unknown }) {
    // a business always needs DealDash's approval; Admin imports above the configured size need a second Admin
    if (j.organizationId) return true;
    const cfg = await this.integrations.ingestConfig();
    return ((j.totals as { rows?: number }).rows ?? 0) > cfg.adminApprovalAboveRows;
  }

  // ---------------------------------------------------------------- upload, validate, preview
  async upload(
    actor: Actor,
    organizationId: string | null,
    b: {
      kind: 'MERCHANTS' | 'BRANCHES' | 'OFFERS';
      sourceSystem: string;
      fileName?: string;
      csv: string;
      publicationRef?: string;
      mapping?: Record<string, string>;
    },
    meta: RequestMeta,
  ): Promise<ImportJobView> {
    if (organizationId) await this.entitlements.requireFeature(organizationId, 'BULK_IMPORT');
    const cfg = await this.integrations.ingestConfig();
    const table = parseCsv(b.csv);
    if (table.length < 2)
      throw AppError.validation('The file needs a header row and at least one data row', 'csv');
    if (table.length - 1 > cfg.maxImportRows)
      throw AppError.validation(`At most ${cfg.maxImportRows} rows per file`, 'csv');
    const map = COLUMNS[b.kind]!;
    // Stage 7: the file's own column names can be mapped to the template's (unmapped names must already be template names)
    const mapping = Object.fromEntries(
      Object.entries(b.mapping ?? {}).map(([k, v]) => [
        k.trim().toLowerCase(),
        v.trim().toLowerCase(),
      ]),
    );
    for (const v of Object.values(mapping))
      if (!map[v])
        throw AppError.validation(`Unknown template column in the mapping: ${v}`, 'mapping');
    const header = table[0]!.map((h) => h.trim().toLowerCase()).map((h) => mapping[h] ?? h);
    const unknown = header.filter((h) => !map[h]);
    if (unknown.length)
      throw AppError.validation(`Unknown column(s): ${unknown.join(', ')}`, 'csv');
    for (const need of ['source_record_id'])
      if (!header.includes(need)) throw AppError.validation(`Missing column: ${need}`, 'csv');
    const fileHash = createHash('sha256').update(b.csv).digest('hex');
    const dup = await this.prisma.importJob.findFirst({
      where: {
        organizationId,
        kind: b.kind,
        fileHash,
        status: { notIn: ['REJECTED', 'CANCELLED', 'FAILED'] },
      },
    });
    if (dup) throw new AppError('INVALID_STATE', 'This file was already uploaded', 409);
    // the plan's bulk-import allowance (rows per period): HARD refuses the whole file, SOFT warns or charges the overage
    if (organizationId) {
      await this.entitlements.requireNewExposure(organizationId, 'PREMIUM_FEATURE');
      await this.usage.consume({
        organizationId,
        limitKey: 'bulk_import.rows',
        quantity: table.length - 1,
        idempotencyKey: `import-rows:${organizationId}:${fileHash}`,
        sourceType: 'IMPORT',
        sourceId: fileHash,
        feature: 'BULK_IMPORT',
      });
    }

    // ---- validate and normalise every row
    const type = TYPE_OF[b.kind]!;
    const seenSource = new Map<string, number>();
    const seenName = new Map<string, number>();
    const rows: Array<{
      rowNumber: number;
      raw: Record<string, string>;
      normalized: unknown;
      status: string;
      action: string | null;
      errors: string[];
      matchedEntityId: string | null;
    }> = [];
    for (let i = 1; i < table.length; i++) {
      const cells = table[i]!;
      const raw: Record<string, string> = {};
      header.forEach((h, c) => (raw[map[h]!] = (cells[c] ?? '').trim()));
      const rec: Record<string, unknown> = { type };
      for (const [k, v] of Object.entries(raw)) {
        if (v === '') continue;
        if (k === 'branchSourceIds')
          rec[k] = v
            .split(/[;|]/)
            .map((s) => s.trim())
            .filter(Boolean);
        else if (k === 'latitude' || k === 'longitude') rec[k] = Number(v);
        else rec[k] = v;
      }
      const errors: string[] = [];
      let status = 'VALID';
      let normalized: unknown = null;
      const parsed = sourceRecordSchema.safeParse(rec);
      if (!parsed.success) {
        status = 'ERROR';
        for (const is of parsed.error.issues.slice(0, 5))
          errors.push(`${is.path.join('.') || 'row'}: ${is.message}`);
      } else {
        normalized = parsed.data;
        const sid = parsed.data.sourceRecordId;
        if (seenSource.has(sid)) {
          status = 'DUPLICATE';
          errors.push(`DUPLICATE_SOURCE_ID: same as row ${seenSource.get(sid)}`);
        } else seenSource.set(sid, i);
        if (parsed.data.type === 'MERCHANT') {
          const n = `${await this.master.normalize(parsed.data.nameEn)}|${parsed.data.country}`;
          if (status === 'VALID' && seenName.has(n)) {
            status = 'WARNING';
            errors.push(`POSSIBLE_DUPLICATE_IN_FILE: same name as row ${seenName.get(n)}`);
          } else if (!seenName.has(n)) seenName.set(n, i);
        }
      }
      rows.push({
        rowNumber: i + 1,
        raw,
        normalized,
        status,
        action: null,
        errors,
        matchedEntityId: null,
      });
    }

    // ---- what each valid row would do (create or update), without changing anything
    for (const r of rows) {
      if (r.status === 'ERROR' || r.status === 'DUPLICATE') continue;
      const rec = r.normalized as {
        type: string;
        sourceRecordId: string;
        nameEn?: string;
        country?: string;
      };
      const ref = await this.prisma.externalEntityReference.findUnique({
        where: {
          sourceSystem_entityType_sourceRecordId: {
            sourceSystem: b.sourceSystem,
            entityType: rec.type,
            sourceRecordId: rec.sourceRecordId,
          },
        },
      });
      if (ref) {
        if ((ref.sourceOrganizationId ?? null) !== organizationId) {
          r.status = 'ERROR';
          r.errors.push('SOURCE_RECORD_BELONGS_TO_ANOTHER_ORGANIZATION');
        } else {
          r.action = 'UPDATE';
          r.matchedEntityId = ref.entityId;
        }
      } else {
        r.action = 'CREATE';
        if (rec.type === 'MERCHANT' && rec.nameEn) {
          const cands = await this.master.findMerchantCandidates(
            rec.nameEn,
            null,
            rec.country ?? 'SA',
          );
          if (cands.length) {
            if (r.status === 'VALID') r.status = 'WARNING';
            r.errors.push(
              `POSSIBLE_DUPLICATE_OF_EXISTING: ${cands[0]!.confidence}% match, will be queued for review`,
            );
          }
        }
      }
    }
    const count = (s: string) => rows.filter((r) => r.status === s).length;
    const totals = {
      rows: rows.length,
      valid: count('VALID'),
      warnings: count('WARNING'),
      errors: count('ERROR'),
      duplicates: count('DUPLICATE'),
      creates: rows.filter((r) => r.action === 'CREATE').length,
      updates: rows.filter((r) => r.action === 'UPDATE').length,
    };
    const job = await this.prisma.$transaction(async (tx) => {
      const j = await tx.importJob.create({
        data: {
          organizationId,
          kind: b.kind,
          sourceSystem: b.sourceSystem,
          fileName: b.fileName ?? null,
          fileHash,
          publicationRef: b.publicationRef ?? null,
          status: 'VALIDATED',
          totals,
          createdByUserId: actor.userId,
          rows: {
            create: rows.map((r) => ({
              rowNumber: r.rowNumber,
              raw: r.raw as Prisma.InputJsonValue,
              normalized: (r.normalized ?? undefined) as Prisma.InputJsonValue | undefined,
              status: r.status,
              action: r.action,
              errors: r.errors as Prisma.InputJsonValue,
              matchedEntityId: r.matchedEntityId,
            })),
          },
        },
      });
      await this.audit.record(
        {
          action: 'IMPORT_UPLOADED',
          entityType: 'ImportJob',
          entityId: j.id,
          actor,
          subjectOrganizationId: organizationId,
          newState: { kind: b.kind, sourceSystem: b.sourceSystem, ...totals },
          scope: organizationId ? 'ORGANIZATION' : 'PLATFORM',
          source: 'IMPORT',
          meta,
        },
        tx,
      );
      return j;
    });
    return this.view(
      await this.prisma.importJob.findUniqueOrThrow({ where: { id: job.id } }),
      await this.needsApproval({ organizationId, totals }),
    );
  }

  /** organizationId undefined = any (DealDash Admin reads every business's jobs); null = DealDash's own; a uuid = that business. */
  async get(id: string, organizationId?: string | null) {
    const j = await this.prisma.importJob.findFirst({
      where: { id, ...(organizationId !== undefined ? { organizationId } : {}) },
    });
    if (!j) throw AppError.notFound();
    return this.view(j, await this.needsApproval(j));
  }

  async rows(
    id: string,
    organizationId?: string | null,
    status?: string,
  ): Promise<ImportRowView[]> {
    const j = await this.prisma.importJob.findFirst({
      where: { id, ...(organizationId !== undefined ? { organizationId } : {}) },
    });
    if (!j) throw AppError.notFound();
    const rows = await this.prisma.importRow.findMany({
      where: { jobId: id, ...(status ? { status } : {}) },
      orderBy: { rowNumber: 'asc' },
      take: 500,
    });
    return rows.map((r) => ({
      rowNumber: r.rowNumber,
      status: r.status,
      action: r.action,
      errors: r.errors as string[],
      raw: r.raw as Record<string, unknown>,
    }));
  }

  /** The error report as CSV (row number, status, reasons) for the person who uploaded the file to fix. */
  async errorReport(id: string, organizationId?: string | null): Promise<string> {
    const rows = (await this.rows(id, organizationId)).filter((r) => r.errors.length);
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    return [
      'row,status,reasons',
      ...rows.map((r) => `${r.rowNumber},${r.status},${esc(r.errors.join(' | '))}`),
    ].join('\n');
  }

  async list(organizationId?: string | null, status?: string) {
    const jobs = await this.prisma.importJob.findMany({
      where: {
        ...(organizationId !== undefined ? { organizationId } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return Promise.all(jobs.map(async (j) => this.view(j, await this.needsApproval(j))));
  }

  // ---------------------------------------------------------------- approval and execution
  async submitForApproval(
    actor: Actor,
    id: string,
    organizationId: string | null,
    meta: RequestMeta,
  ) {
    const j = await this.prisma.importJob.findFirst({ where: { id, organizationId } });
    if (!j) throw AppError.notFound();
    if (j.status !== 'VALIDATED')
      throw new AppError('IMPORT_NOT_READY', 'Only a validated file can be submitted', 409);
    const t = j.totals as { valid: number; warnings: number };
    if (t.valid + t.warnings === 0)
      throw new AppError('IMPORT_NOT_READY', 'There is nothing valid to import', 409);
    const needs = await this.needsApproval(j);
    await this.prisma.$transaction(async (tx) => {
      await tx.importJob.update({
        where: { id },
        data: {
          status: needs ? 'PENDING_APPROVAL' : 'APPROVED',
          ...(needs ? {} : { approvedAt: new Date(), approvedByUserId: actor.userId }),
        },
      });
      await this.audit.record(
        {
          action: needs ? 'IMPORT_SUBMITTED' : 'IMPORT_AUTO_APPROVED',
          entityType: 'ImportJob',
          entityId: id,
          actor,
          subjectOrganizationId: organizationId,
          scope: organizationId ? 'ORGANIZATION' : 'PLATFORM',
          source: 'IMPORT',
          meta,
        },
        tx,
      );
    });
    return this.get(id, organizationId);
  }

  /** Approval is by DealDash Admin and by a different person than the uploader (two-person control). */
  async decide(
    actor: Actor,
    id: string,
    decision: 'APPROVE' | 'REJECT',
    reason: string | undefined,
    meta: RequestMeta,
  ) {
    const j = await this.prisma.importJob.findUnique({ where: { id } });
    if (!j) throw AppError.notFound();
    if (j.status !== 'PENDING_APPROVAL')
      throw new AppError('INVALID_STATE', 'This import is not waiting for approval', 409);
    if (j.createdByUserId === actor.userId)
      throw new AppError('APPROVAL_REQUIRED', 'A different person must approve this import', 403);
    if (decision === 'REJECT' && !reason)
      throw AppError.validation('A reason is required', 'reason');
    await this.prisma.$transaction(async (tx) => {
      await tx.importJob.update({
        where: { id },
        data:
          decision === 'APPROVE'
            ? { status: 'APPROVED', approvedByUserId: actor.userId, approvedAt: new Date() }
            : { status: 'REJECTED', rejectionReason: reason ?? null },
      });
      await this.audit.record(
        {
          action: decision === 'APPROVE' ? 'IMPORT_APPROVED' : 'IMPORT_REJECTED',
          entityType: 'ImportJob',
          entityId: id,
          actor,
          subjectOrganizationId: j.organizationId,
          reason: reason ?? null,
          scope: 'PLATFORM',
          source: 'IMPORT',
          meta,
        },
        tx,
      );
    });
    return this.get(id, j.organizationId);
  }

  async cancel(actor: Actor, id: string, organizationId: string | null, meta: RequestMeta) {
    const j = await this.prisma.importJob.findFirst({ where: { id, organizationId } });
    if (!j) throw AppError.notFound();
    if (!['UPLOADED', 'VALIDATED', 'PENDING_APPROVAL', 'APPROVED'].includes(j.status))
      throw new AppError('INVALID_STATE', 'This import cannot be cancelled', 409);
    await this.prisma.$transaction(async (tx) => {
      await tx.importJob.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.record(
        {
          action: 'IMPORT_CANCELLED',
          entityType: 'ImportJob',
          entityId: id,
          actor,
          subjectOrganizationId: organizationId,
          scope: organizationId ? 'ORGANIZATION' : 'PLATFORM',
          meta,
        },
        tx,
      );
    });
  }

  /** Imports every importable row. Re-running a completed job does nothing (rows are marked IMPORTED and the claim is a single update). */
  async execute(actor: Actor, id: string, organizationId: string | null, meta: RequestMeta) {
    const j = await this.prisma.importJob.findFirst({ where: { id, organizationId } });
    if (!j) throw AppError.notFound();
    const claim = await this.prisma.importJob.updateMany({
      where: { id, status: 'APPROVED' },
      data: { status: 'EXECUTING' },
    });
    if (claim.count !== 1)
      throw new AppError('IMPORT_NOT_READY', 'This import is not approved or has already run', 409);
    const rows = await this.prisma.importRow.findMany({
      where: { jobId: id, status: { in: ['VALID', 'WARNING'] } },
      orderBy: { rowNumber: 'asc' },
    });
    const ref = j.publicationRef;
    const ctx = {
      sourceSystem: j.sourceSystem,
      sourceOrganizationId: organizationId,
      connectionId: null,
      importJobId: id,
      method: 'BULK' as const,
      publicationConfirmed: !!ref,
      publicationRef: ref,
      actorUserId: actor.userId,
    };
    let imported = 0;
    let failed = 0;
    let conflicts = 0;
    for (const r of rows) {
      try {
        const res = await this.ingest.apply(ctx, r.normalized as never);
        conflicts += res.conflicts;
        imported++;
        await this.prisma.importRow.update({
          where: { id: r.id },
          data: { status: 'IMPORTED', action: res.action, matchedEntityId: res.entityId },
        });
      } catch (e) {
        failed++;
        const msg =
          e instanceof AppError
            ? ((e.getResponse() as { message?: string }).message ?? e.message)
            : 'INTERNAL_ERROR';
        await this.prisma.importRow.update({
          where: { id: r.id },
          data: { status: 'ERROR', errors: [msg] as Prisma.InputJsonValue },
        });
      }
    }
    const totals = { ...(j.totals as object), imported, failedOnImport: failed, conflicts };
    await this.prisma.$transaction(async (tx) => {
      await tx.importJob.update({
        where: { id },
        data: {
          status: failed === rows.length && rows.length > 0 ? 'FAILED' : 'COMPLETED',
          executedAt: new Date(),
          totals,
        },
      });
      await this.audit.record(
        {
          action: 'IMPORT_EXECUTED',
          entityType: 'ImportJob',
          entityId: id,
          actor,
          subjectOrganizationId: organizationId,
          newState: totals,
          scope: organizationId ? 'ORGANIZATION' : 'PLATFORM',
          source: 'IMPORT',
          meta,
        },
        tx,
      );
    });
    return this.get(id, organizationId);
  }
}

void ORDER;
