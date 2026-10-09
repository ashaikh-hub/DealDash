import { Injectable } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import {
  branchRecordSchema,
  merchantRecordSchema,
  offerRecordSchema,
  type BranchRecord,
  type MerchantRecord,
  type OfferRecord,
  type SourceRecord,
} from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { MasterService } from './master.service';
import { branchKey } from './normalize';

type Tx = Prisma.TransactionClient;
type Policy = 'SOURCE_WINS' | 'DEALDASH_WINS' | 'MERCHANT_WINS' | 'MANUAL_REVIEW';

export interface IngestContext {
  sourceSystem: string;
  sourceOrganizationId: string | null;
  connectionId: string | null;
  importJobId: string | null;
  method: 'API' | 'FEED' | 'BULK' | 'MANUAL';
  /** The source is authorised to have DealDash show its offers (contract reference kept with the record). */
  publicationConfirmed: boolean;
  publicationRef: string | null;
  actorUserId: string | null;
}
export interface ApplyResult {
  action: 'CREATE' | 'UPDATE' | 'NONE';
  entityId: string;
  conflicts: number;
  warnings: string[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * THE one code path that turns a source record into master data. The API, the feed and the bulk import all end here, so the rules
 * (provenance, no silent overwrite of approved local data, duplicate suggestions, referenced vs registered) exist exactly once.
 */
@Injectable()
export class IngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly master: MasterService,
    private readonly config: SystemConfigService,
  ) {}

  /** Validates an untrusted object and applies it. Throws AppError on a record the platform will not accept. */
  async applyRaw(ctx: IngestContext, raw: unknown): Promise<ApplyResult> {
    const type = (raw as { type?: string } | null)?.type;
    const schema = type === 'MERCHANT' ? merchantRecordSchema : type === 'BRANCH' ? branchRecordSchema : type === 'OFFER' ? offerRecordSchema : null;
    if (!schema) throw AppError.validation('Unknown record type', 'type');
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0]!;
      throw AppError.validation(`${first.path.join('.') || 'record'}: ${first.message}`, first.path.join('.') || 'record');
    }
    return this.apply(ctx, parsed.data);
  }

  async apply(ctx: IngestContext, rec: SourceRecord): Promise<ApplyResult> {
    if (rec.type === 'MERCHANT') await this.master.ensureAllRegistered();
    return this.prisma.$transaction(async (tx) => {
      if (rec.type === 'MERCHANT') return this.merchant(tx, ctx, rec);
      if (rec.type === 'BRANCH') return this.branch(tx, ctx, rec);
      return this.offer(tx, ctx, rec);
    });
  }

  // ---------------------------------------------------------------- provenance and conflict handling
  private refData(ctx: IngestContext, rec: { sourceUpdatedAt?: string }, now: Date) {
    return {
      sourceOrganizationId: ctx.sourceOrganizationId,
      connectionId: ctx.connectionId,
      importJobId: ctx.importJobId,
      importMethod: ctx.method,
      syncStatus: 'SYNCED',
      publicationConfirmed: ctx.publicationConfirmed,
      publicationRef: ctx.publicationRef,
      lastSyncAt: now,
      lastSuccessfulSyncAt: now,
      lastSourceUpdateAt: rec.sourceUpdatedAt ? new Date(rec.sourceUpdatedAt) : now,
    };
  }

  private async policyFor(entityType: string, field: string, registered: boolean): Promise<Policy> {
    const c = await this.config.get<{ default: Policy; registeredMerchant: Policy; fields: Record<string, Policy> }>(CONFIG_KEYS.PLATFORM_CONFLICT_POLICY);
    return c.fields[`${entityType}.${field}`] ?? (registered ? c.registeredMerchant : c.default);
  }

  /**
   * Source value vs the value DealDash holds. Approved local data (an active override, a registered merchant, or a record not
   * editable by its source) is NEVER silently overwritten: the configured policy decides, and manual review leaves the local value
   * in place with an open conflict.
   */
  private async reconcile(
    tx: Tx,
    ctx: IngestContext,
    entityType: 'MERCHANT' | 'BRANCH' | 'OFFER',
    entityId: string,
    current: Record<string, unknown>,
    incoming: Record<string, unknown>,
    opts: { registered: boolean; editableBy: string },
  ): Promise<{ apply: Record<string, unknown>; conflicts: number }> {
    const apply: Record<string, unknown> = {};
    let conflicts = 0;
    for (const [field, value] of Object.entries(incoming)) {
      if (value === undefined || same(current[field], value)) continue;
      const override = await this.master.activeOverride(tx, entityType, entityId, field);
      const protectedLocal = !!override || opts.registered || opts.editableBy !== 'SOURCE';
      if (!protectedLocal) {
        apply[field] = value;
        continue;
      }
      const policy = await this.policyFor(entityType, field, opts.registered);
      if (policy === 'SOURCE_WINS') {
        apply[field] = value;
        await tx.dataConflict.create({ data: { entityType, entityId, field, sourceSystem: ctx.sourceSystem, sourceValue: value as Prisma.InputJsonValue, localValue: (current[field] ?? null) as Prisma.InputJsonValue, policy, status: 'RESOLVED', resolution: 'SOURCE_WINS', resolvedAt: new Date() } });
        continue;
      }
      if (policy === 'DEALDASH_WINS' || policy === 'MERCHANT_WINS') {
        await tx.dataConflict.create({ data: { entityType, entityId, field, sourceSystem: ctx.sourceSystem, sourceValue: value as Prisma.InputJsonValue, localValue: (current[field] ?? null) as Prisma.InputJsonValue, policy, status: 'RESOLVED', resolution: policy, resolvedAt: new Date() } });
        continue;
      }
      // MANUAL_REVIEW: keep the local value, remember the disagreement once
      const dup = await tx.dataConflict.findFirst({ where: { entityType, entityId, field, status: 'OPEN' } });
      if (dup) await tx.dataConflict.update({ where: { id: dup.id }, data: { sourceValue: value as Prisma.InputJsonValue } });
      else {
        await tx.dataConflict.create({ data: { entityType, entityId, field, sourceSystem: ctx.sourceSystem, sourceValue: value as Prisma.InputJsonValue, localValue: (current[field] ?? null) as Prisma.InputJsonValue, policy } });
        conflicts++;
      }
      await tx.externalEntityReference.updateMany({ where: { entityType, entityId }, data: { overrideStatus: 'PENDING_RECONCILIATION' } });
    }
    return { apply, conflicts };
  }

  private async findRef(tx: Tx, ctx: IngestContext, entityType: string, sourceRecordId: string) {
    return tx.externalEntityReference.findUnique({
      where: { sourceSystem_entityType_sourceRecordId: { sourceSystem: ctx.sourceSystem, entityType, sourceRecordId } },
    });
  }

  /** Another organization's source cannot update a record through the same source system name. */
  private assertSameSource(ctx: IngestContext, ref: { sourceOrganizationId: string | null }) {
    if ((ref.sourceOrganizationId ?? null) !== (ctx.sourceOrganizationId ?? null))
      throw new AppError('SCOPE_FORBIDDEN', 'This source record belongs to another organization', 403);
  }

  // ---------------------------------------------------------------- merchants
  private async merchant(tx: Tx, ctx: IngestContext, rec: MerchantRecord): Promise<ApplyResult> {
    const now = new Date();
    const ref = await this.findRef(tx, ctx, 'MERCHANT', rec.sourceRecordId);
    const normalizedName = await this.master.normalize(rec.nameEn);
    if (ref) {
      this.assertSameSource(ctx, ref);
      const m = await tx.masterMerchant.findUniqueOrThrow({ where: { id: ref.entityId } });
      if (m.status !== 'ACTIVE') throw new AppError('INVALID_STATE', 'This merchant record was merged or closed', 409);
      const r = await this.reconcile(tx, ctx, 'MERCHANT', m.id, { nameEn: m.nameEn, nameAr: m.nameAr, country: m.country, categoryCode: m.categoryCode }, { nameEn: rec.nameEn, nameAr: rec.nameAr, country: rec.country, categoryCode: rec.categoryCode }, { registered: m.registration === 'REGISTERED', editableBy: ref.editableBy });
      const data: Prisma.MasterMerchantUncheckedUpdateInput = { ...(r.apply as object) };
      if (typeof r.apply.nameEn === 'string') data.normalizedName = await this.master.normalize(r.apply.nameEn);
      if (Object.keys(data).length) await tx.masterMerchant.update({ where: { id: m.id }, data });
      await tx.externalEntityReference.update({ where: { id: ref.id }, data: this.refData(ctx, rec, now) });
      return { action: Object.keys(r.apply).length ? 'UPDATE' : 'NONE', entityId: m.id, conflicts: r.conflicts, warnings: [] };
    }
    const brandId = await this.master.findOrCreateBrand(tx, rec.brand);
    const candidates = await this.master.findMerchantCandidates(rec.nameEn, rec.nameAr, rec.country, undefined, tx);
    const created = await tx.masterMerchant.create({
      data: { registration: 'REFERENCED', nameEn: rec.nameEn, nameAr: rec.nameAr ?? null, normalizedName, country: rec.country, categoryCode: rec.categoryCode ?? null, brandId },
    });
    await tx.externalEntityReference.create({
      data: { entityType: 'MERCHANT', entityId: created.id, sourceSystem: ctx.sourceSystem, sourceRecordId: rec.sourceRecordId, sourceOwner: ctx.sourceSystem, ...this.refData(ctx, rec, now) },
    });
    // an uncertain duplicate is a question for a person: it is recorded, and the new record stays separate until someone decides
    await this.master.recordCandidates(tx, 'MERCHANT', created.id, candidates);
    return { action: 'CREATE', entityId: created.id, conflicts: 0, warnings: candidates.length ? ['POSSIBLE_DUPLICATE'] : [] };
  }

  // ---------------------------------------------------------------- branches
  private async merchantOf(tx: Tx, ctx: IngestContext, sourceMerchantId: string) {
    const ref = await this.findRef(tx, ctx, 'MERCHANT', sourceMerchantId);
    if (!ref) throw AppError.validation(`MERCHANT_NOT_FOUND: ${sourceMerchantId}`, 'sourceMerchantId');
    this.assertSameSource(ctx, ref);
    return ref.entityId;
  }

  private async branch(tx: Tx, ctx: IngestContext, rec: BranchRecord): Promise<ApplyResult> {
    const now = new Date();
    const merchantId = await this.merchantOf(tx, ctx, rec.sourceMerchantId);
    const ref = await this.findRef(tx, ctx, 'BRANCH', rec.sourceRecordId);
    const key = branchKey({ name: rec.nameEn, city: rec.city, latitude: rec.latitude, longitude: rec.longitude });
    const geo = { latitude: rec.latitude ?? null, longitude: rec.longitude ?? null };
    if (ref) {
      this.assertSameSource(ctx, ref);
      const b = await tx.masterBranch.findUniqueOrThrow({ where: { id: ref.entityId } });
      const r = await this.reconcile(tx, ctx, 'BRANCH', b.id, { nameEn: b.nameEn, nameAr: b.nameAr, addressEn: b.addressEn, addressAr: b.addressAr, city: b.city }, { nameEn: rec.nameEn, nameAr: rec.nameAr, addressEn: rec.addressEn, addressAr: rec.addressAr, city: rec.city }, { registered: !!b.merchantBranchId, editableBy: ref.editableBy });
      if (Object.keys(r.apply).length) await tx.masterBranch.update({ where: { id: b.id }, data: { ...(r.apply as object), normalizedKey: key, ...geo } });
      await tx.externalEntityReference.update({ where: { id: ref.id }, data: this.refData(ctx, rec, now) });
      return { action: Object.keys(r.apply).length ? 'UPDATE' : 'NONE', entityId: b.id, conflicts: r.conflicts, warnings: [] };
    }
    // the same outlet reported by two sources is one outlet: link the reference to the existing record
    const twin = await tx.masterBranch.findFirst({ where: { merchantId, normalizedKey: key } });
    const branchId =
      twin?.id ??
      (
        await tx.masterBranch.create({
          data: { merchantId, nameEn: rec.nameEn, nameAr: rec.nameAr ?? null, addressEn: rec.addressEn ?? null, addressAr: rec.addressAr ?? null, city: rec.city ?? null, country: rec.country, ...geo, normalizedKey: key },
        })
      ).id;
    await tx.externalEntityReference.create({
      data: { entityType: 'BRANCH', entityId: branchId, sourceSystem: ctx.sourceSystem, sourceRecordId: rec.sourceRecordId, sourceOwner: ctx.sourceSystem, ...this.refData(ctx, rec, now) },
    });
    return { action: twin ? 'NONE' : 'CREATE', entityId: branchId, conflicts: 0, warnings: twin ? ['SAME_OUTLET_AS_EXISTING'] : [] };
  }

  // ---------------------------------------------------------------- offers
  private async offer(tx: Tx, ctx: IngestContext, rec: OfferRecord): Promise<ApplyResult> {
    const now = new Date();
    const merchantId = await this.merchantOf(tx, ctx, rec.sourceMerchantId);
    const warnings: string[] = [];
    const branchIds: string[] = [];
    for (const sid of rec.branchSourceIds) {
      const b = await this.findRef(tx, ctx, 'BRANCH', sid);
      if (b) branchIds.push(b.entityId);
      else warnings.push(`UNKNOWN_BRANCH:${sid}`);
    }
    const ref = await this.findRef(tx, ctx, 'OFFER', rec.sourceRecordId);
    const fields = { titleEn: rec.titleEn, titleAr: rec.titleAr ?? null, benefitEn: rec.benefitEn, benefitAr: rec.benefitAr ?? null, termsEn: rec.termsEn ?? null, termsAr: rec.termsAr ?? null };
    if (ref) {
      this.assertSameSource(ctx, ref);
      const o = await tx.referencedOffer.findUniqueOrThrow({ where: { id: ref.entityId } });
      const r = await this.reconcile(tx, ctx, 'OFFER', o.id, { titleEn: o.titleEn, titleAr: o.titleAr, benefitEn: o.benefitEn, benefitAr: o.benefitAr, termsEn: o.termsEn, termsAr: o.termsAr }, fields, { registered: false, editableBy: ref.editableBy });
      await tx.referencedOffer.update({
        where: { id: o.id },
        data: {
          ...(r.apply as object),
          categoryCode: rec.categoryCode ?? null,
          channel: rec.channel,
          validFrom: new Date(rec.validFrom),
          validUntil: rec.validUntil ? new Date(rec.validUntil) : null,
          eligibility: rec.eligibility as Prisma.InputJsonValue,
          branchIds,
          // a feed that re-sends a withdrawn offer re-activates it
          status: 'ACTIVE',
        },
      });
      await tx.externalEntityReference.update({ where: { id: ref.id }, data: this.refData(ctx, rec, now) });
      return { action: 'UPDATE', entityId: o.id, conflicts: r.conflicts, warnings };
    }
    const created = await tx.referencedOffer.create({
      data: {
        merchantId,
        ...fields,
        categoryCode: rec.categoryCode ?? null,
        channel: rec.channel,
        validFrom: new Date(rec.validFrom),
        validUntil: rec.validUntil ? new Date(rec.validUntil) : null,
        eligibility: rec.eligibility as Prisma.InputJsonValue,
        branchIds,
      },
    });
    await tx.externalEntityReference.create({
      data: { entityType: 'OFFER', entityId: created.id, sourceSystem: ctx.sourceSystem, sourceRecordId: rec.sourceRecordId, sourceOwner: ctx.sourceSystem, ...this.refData(ctx, rec, now) },
    });
    return { action: 'CREATE', entityId: created.id, conflicts: 0, warnings };
  }
}

// keep the zod schemas referenced so a bundler never drops the validation import
void branchRecordSchema;
