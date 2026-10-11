import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import type { MasterMerchantView } from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import { Page } from '../common/pagination';
import type { Actor, RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { branchKey, normalizeName, similarity } from './normalize';

type Tx = Prisma.TransactionClient;
interface MatchingConfig {
  candidateMinConfidence: number;
  stopWords: string[];
}

/**
 * Canonical merchant, brand and branch identities.
 *
 * REFERENCED (network) merchants come from a bank, scheme or partner source and are NOT DealDash merchants: no organization, no
 * staff, no inventory, no finance, no controlled products. REGISTERED merchants are linked to their organization. Possible
 * duplicates become MatchCandidate rows that a person decides; only an identical (source system, source record id) is ever
 * recognised automatically.
 */
@Injectable()
export class MasterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: SystemConfigService,
  ) {}

  async matching(): Promise<MatchingConfig> {
    return this.config.get<MatchingConfig>(CONFIG_KEYS.PLATFORM_MATCHING);
  }

  async normalize(name: string): Promise<string> {
    return normalizeName(name, (await this.matching()).stopWords);
  }

  // ---------------------------------------------------------------- duplicate detection
  /** Possible duplicates of a merchant name in the same country (aliases included). Suggests; never merges. */
  async findMerchantCandidates(
    nameEn: string,
    nameAr: string | null | undefined,
    country: string,
    excludeId?: string,
    db: Tx | PrismaService = this.prisma,
  ): Promise<Array<{ id: string; confidence: number; reasons: string[] }>> {
    const cfg = await this.matching();
    const names = [nameEn, nameAr]
      .filter((n): n is string => !!n)
      .map((n) => normalizeName(n, cfg.stopWords));
    const keys = names.filter(Boolean);
    if (!keys.length) return [];
    const heads = [...new Set(keys.map((k) => k.slice(0, 3)))];
    const pool = await db.masterMerchant.findMany({
      where: {
        country,
        status: 'ACTIVE',
        ...(excludeId ? { id: { not: excludeId } } : {}),
        OR: heads.map((h) => ({ normalizedName: { contains: h } })),
      },
      select: { id: true, normalizedName: true },
      take: 400,
    });
    const aliasRows = await db.entityAlias.findMany({
      where: {
        entityType: 'MERCHANT',
        OR: heads.map((h) => ({ normalizedAlias: { contains: h } })),
      },
      select: { entityId: true, normalizedAlias: true },
      take: 400,
    });
    const best = new Map<string, { confidence: number; reasons: Set<string> }>();
    const consider = (id: string, theirs: string, viaAlias: boolean) => {
      if (id === excludeId) return;
      for (const k of keys) {
        const s = similarity(k, theirs);
        if (s.confidence < cfg.candidateMinConfidence) continue;
        const cur = best.get(id) ?? { confidence: 0, reasons: new Set<string>() };
        cur.confidence = Math.max(cur.confidence, s.confidence);
        s.reasons.forEach((r) => cur.reasons.add(r));
        if (viaAlias) cur.reasons.add('MATCHES_AN_ALIAS');
        best.set(id, cur);
      }
    };
    for (const p of pool) consider(p.id, p.normalizedName, false);
    for (const a of aliasRows) consider(a.entityId, a.normalizedAlias, true);
    return [...best.entries()]
      .map(([id, v]) => ({ id, confidence: v.confidence, reasons: [...v.reasons] }))
      .sort((x, y) => y.confidence - x.confidence)
      .slice(0, 10);
  }

  /** Stores each suggestion once, in canonical order, so the same pair never appears twice. */
  async recordCandidates(
    tx: Tx,
    entityType: string,
    id: string,
    found: Array<{ id: string; confidence: number; reasons: string[] }>,
  ) {
    for (const f of found) {
      const [aId, bId] = id < f.id ? [id, f.id] : [f.id, id];
      await tx.matchCandidate.upsert({
        where: { entityType_aId_bId: { entityType, aId, bId } },
        update: {},
        create: {
          entityType,
          aId,
          bId,
          confidence: f.confidence,
          reasons: f.reasons as Prisma.InputJsonValue,
        },
      });
    }
  }

  async findOrCreateBrand(tx: Tx, name: string | undefined | null): Promise<string | null> {
    if (!name?.trim()) return null;
    const normalized = await this.normalize(name);
    if (!normalized) return null;
    const found = await tx.masterBrand.findFirst({
      where: { normalizedName: normalized, status: 'ACTIVE' },
    });
    if (found) return found.id;
    return (
      await tx.masterBrand.create({ data: { nameEn: name.trim(), normalizedName: normalized } })
    ).id;
  }

  async addAlias(tx: Tx, entityType: string, entityId: string, alias: string) {
    const normalizedAlias = await this.normalize(alias);
    if (!normalizedAlias) return;
    await tx.entityAlias.upsert({
      where: { entityType_entityId_normalizedAlias: { entityType, entityId, normalizedAlias } },
      update: {},
      create: { entityType, entityId, alias, normalizedAlias },
    });
  }

  // ---------------------------------------------------------------- registered merchants
  /**
   * Makes sure a DealDash organization has its REGISTERED master record (and its outlets are mirrored), and suggests any referenced
   * merchants that might be the same business. It never links on its own.
   */
  async ensureRegisteredMaster(organizationId: string): Promise<string> {
    const existing = await this.prisma.masterMerchant.findUnique({ where: { organizationId } });
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: { merchant: { select: { legalName: true } } },
    });
    const le = await this.prisma.legalEntity.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });
    const country = le?.country ?? 'SA';
    let id = existing?.id;
    if (!id) {
      const normalizedName = await this.normalize(org.nameEn);
      const candidates = await this.findMerchantCandidates(org.nameEn, org.nameAr, country);
      id = await this.prisma.$transaction(async (tx) => {
        const row = await tx.masterMerchant.create({
          data: {
            registration: 'REGISTERED',
            organizationId,
            nameEn: org.nameEn,
            nameAr: org.nameAr,
            normalizedName,
            country,
          },
        });
        if (org.merchant?.legalName && org.merchant.legalName !== org.nameEn)
          await this.addAlias(tx, 'MERCHANT', row.id, org.merchant.legalName);
        await this.recordCandidates(tx, 'MERCHANT', row.id, candidates);
        return row.id;
      });
    }
    await this.syncRegisteredBranches(organizationId, id);
    return id;
  }

  private lastEnsureAll = 0;

  /**
   * Gives every active DealDash merchant its registered master record, so duplicate detection always sees registered merchants too.
   * Done lazily (before ingestion and when the master list is opened) instead of in the onboarding code path; throttled so a large
   * batch does not repeat the query for every record.
   */
  async ensureAllRegistered(force = false, limit = 200): Promise<number> {
    if (!force && Date.now() - this.lastEnsureAll < 15_000) return 0;
    this.lastEnsureAll = Date.now();
    const missing = await this.prisma.organization.findMany({
      where: { type: 'MERCHANT', status: 'ACTIVE', masterMerchant: null },
      select: { id: true },
      take: limit,
    });
    for (const o of missing) await this.ensureRegisteredMaster(o.id);
    return missing.length;
  }

  /** Mirrors the organization's outlets into the master branch list (idempotent). */
  async syncRegisteredBranches(organizationId: string, masterMerchantId: string) {
    const branches = await this.prisma.merchantBranch.findMany({ where: { organizationId } });
    for (const b of branches) {
      const exists = await this.prisma.masterBranch.findUnique({
        where: { merchantBranchId: b.id },
      });
      if (exists) continue;
      await this.prisma.masterBranch.create({
        data: {
          merchantId: masterMerchantId,
          nameEn: b.nameEn,
          nameAr: b.nameAr,
          addressEn: b.addressEn,
          addressAr: b.addressAr,
          city: b.city,
          country: b.country,
          latitude: b.latitude,
          longitude: b.longitude,
          normalizedKey: branchKey({
            name: b.nameEn,
            city: b.city,
            latitude: b.latitude ? Number(b.latitude) : null,
            longitude: b.longitude ? Number(b.longitude) : null,
          }),
          merchantBranchId: b.id,
        },
      });
    }
  }

  /**
   * A referenced merchant registers: it is UPGRADED to the registered record instead of being duplicated. If the organization
   * already has its own registered record, the referenced one is merged into it.
   */
  async linkRegistered(actor: Actor, masterId: string, organizationId: string, meta: RequestMeta) {
    const m = await this.prisma.masterMerchant.findUnique({ where: { id: masterId } });
    if (!m) throw AppError.notFound();
    if (m.registration !== 'REFERENCED' || m.status !== 'ACTIVE')
      throw new AppError('INVALID_STATE', 'Only an active referenced merchant can be linked', 409);
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org || org.type !== 'MERCHANT')
      throw AppError.validation('The organization must be a merchant', 'organizationId');
    if (org.status !== 'ACTIVE')
      throw new AppError('ORG_NOT_ACTIVE', 'The merchant must be approved and active first', 409);
    const own = await this.prisma.masterMerchant.findUnique({ where: { organizationId } });
    if (own) {
      await this.merge(actor, masterId, own.id, 'Linked to the registered merchant', meta);
      return own.id;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.masterMerchant.update({
        where: { id: masterId },
        data: { registration: 'REGISTERED', organizationId },
      });
      await this.audit.record(
        {
          action: 'MASTER_MERCHANT_REGISTERED',
          entityType: 'MasterMerchant',
          entityId: masterId,
          actor,
          subjectOrganizationId: organizationId,
          previousState: { registration: 'REFERENCED' },
          newState: { registration: 'REGISTERED', organizationId },
          scope: 'ORGANIZATION',
          source: 'ADMIN',
          meta,
        },
        tx,
      );
    });
    await this.syncRegisteredBranches(organizationId, masterId);
    return masterId;
  }

  // ---------------------------------------------------------------- merge
  /** Merges `fromId` into `intoId`: every source reference, alias, outlet and offer follows; the history stays. */
  async merge(
    actor: Actor,
    fromId: string,
    intoId: string,
    note: string | undefined,
    meta: RequestMeta,
  ) {
    if (fromId === intoId) throw AppError.validation('Choose two different records', 'keepId');
    const [from, into] = await Promise.all([
      this.prisma.masterMerchant.findUnique({ where: { id: fromId } }),
      this.prisma.masterMerchant.findUnique({ where: { id: intoId } }),
    ]);
    if (!from || !into) throw AppError.notFound();
    if (from.status !== 'ACTIVE' || into.status !== 'ACTIVE')
      throw new AppError('INVALID_STATE', 'Both records must be active', 409);
    if (from.registration === 'REGISTERED')
      throw new AppError(
        'INVALID_STATE',
        'A registered merchant cannot be merged into another record',
        409,
      );
    await this.prisma.$transaction(async (tx) => {
      await tx.externalEntityReference.updateMany({
        where: { entityType: 'MERCHANT', entityId: fromId },
        data: { entityId: intoId },
      });
      // outlets: an outlet the target already has is the same outlet, so references and offers are re-pointed to it
      const mine = await tx.masterBranch.findMany({ where: { merchantId: fromId } });
      const theirs = await tx.masterBranch.findMany({ where: { merchantId: intoId } });
      const byKey = new Map(theirs.map((b) => [b.normalizedKey, b.id]));
      const remap = new Map<string, string>();
      for (const b of mine) {
        const same = byKey.get(b.normalizedKey);
        if (same) {
          remap.set(b.id, same);
          await tx.externalEntityReference.updateMany({
            where: { entityType: 'BRANCH', entityId: b.id },
            data: { entityId: same },
          });
          await tx.masterBranch.delete({ where: { id: b.id } });
        } else await tx.masterBranch.update({ where: { id: b.id }, data: { merchantId: intoId } });
      }
      const offers = await tx.referencedOffer.findMany({ where: { merchantId: fromId } });
      for (const o of offers)
        await tx.referencedOffer.update({
          where: { id: o.id },
          data: { merchantId: intoId, branchIds: o.branchIds.map((id) => remap.get(id) ?? id) },
        });
      for (const a of await tx.entityAlias.findMany({
        where: { entityType: 'MERCHANT', entityId: fromId },
      }))
        await tx.entityAlias.upsert({
          where: {
            entityType_entityId_normalizedAlias: {
              entityType: 'MERCHANT',
              entityId: intoId,
              normalizedAlias: a.normalizedAlias,
            },
          },
          update: {},
          create: {
            entityType: 'MERCHANT',
            entityId: intoId,
            alias: a.alias,
            normalizedAlias: a.normalizedAlias,
          },
        });
      await tx.entityAlias.deleteMany({ where: { entityType: 'MERCHANT', entityId: fromId } });
      await this.addAlias(tx, 'MERCHANT', intoId, from.nameEn);
      if (from.nameAr) await this.addAlias(tx, 'MERCHANT', intoId, from.nameAr);
      if (!into.brandId && from.brandId)
        await tx.masterMerchant.update({ where: { id: intoId }, data: { brandId: from.brandId } });
      await tx.masterMerchant.update({
        where: { id: fromId },
        data: { status: 'MERGED', mergedIntoId: intoId },
      });
      // every other suggestion about the merged record is closed: it is re-evaluated against the surviving record on demand
      await tx.matchCandidate.updateMany({
        where: {
          entityType: 'MERCHANT',
          status: 'PENDING',
          OR: [{ aId: fromId }, { bId: fromId }],
        },
        data: {
          status: 'MERGED',
          decidedByUserId: actor.userId,
          decidedAt: new Date(),
          decisionNote: note ?? 'Record merged',
        },
      });
      await this.audit.record(
        {
          action: 'MASTER_MERCHANT_MERGED',
          entityType: 'MasterMerchant',
          entityId: fromId,
          actor,
          reason: note ?? null,
          previousState: { status: 'ACTIVE', nameEn: from.nameEn },
          newState: { status: 'MERGED', mergedIntoId: intoId },
          scope: 'PLATFORM',
          source: 'ADMIN',
          meta,
        },
        tx,
      );
    });
  }

  async decideMatch(
    actor: Actor,
    id: string,
    b: { decision: 'MERGE' | 'REJECT' | 'ALIAS'; keepId?: string; note?: string },
    meta: RequestMeta,
  ) {
    const c = await this.prisma.matchCandidate.findUnique({ where: { id } });
    if (!c) throw AppError.notFound();
    if (c.status !== 'PENDING')
      throw new AppError('INVALID_STATE', 'This suggestion was already decided', 409);
    if (c.entityType !== 'MERCHANT')
      throw AppError.validation('Only merchant suggestions can be decided here');
    if (b.decision === 'REJECT') {
      await this.prisma.$transaction(async (tx) => {
        await tx.matchCandidate.update({
          where: { id },
          data: {
            status: 'REJECTED',
            decidedByUserId: actor.userId,
            decidedAt: new Date(),
            decisionNote: b.note ?? null,
          },
        });
        await this.audit.record(
          {
            action: 'MATCH_REJECTED',
            entityType: 'MatchCandidate',
            entityId: id,
            actor,
            reason: b.note ?? null,
            scope: 'PLATFORM',
            source: 'ADMIN',
            meta,
          },
          tx,
        );
      });
      return;
    }
    const [a, bb] = await Promise.all([
      this.prisma.masterMerchant.findUniqueOrThrow({ where: { id: c.aId } }),
      this.prisma.masterMerchant.findUniqueOrThrow({ where: { id: c.bId } }),
    ]);
    // the registered record always survives; otherwise the caller chooses, defaulting to the older one
    const keep =
      a.registration === 'REGISTERED'
        ? a
        : bb.registration === 'REGISTERED'
          ? bb
          : b.keepId === bb.id
            ? bb
            : b.keepId === a.id
              ? a
              : a.createdAt <= bb.createdAt
                ? a
                : bb;
    const drop = keep.id === a.id ? bb : a;
    if (b.decision === 'ALIAS') {
      await this.prisma.$transaction(async (tx) => {
        await this.addAlias(tx, 'MERCHANT', keep.id, drop.nameEn);
        await tx.matchCandidate.update({
          where: { id },
          data: {
            status: 'ALIAS',
            decidedByUserId: actor.userId,
            decidedAt: new Date(),
            decisionNote: b.note ?? null,
          },
        });
        await this.audit.record(
          {
            action: 'MATCH_ALIASED',
            entityType: 'MatchCandidate',
            entityId: id,
            actor,
            reason: b.note ?? null,
            scope: 'PLATFORM',
            source: 'ADMIN',
            meta,
          },
          tx,
        );
      });
      return;
    }
    await this.merge(actor, drop.id, keep.id, b.note, meta);
    await this.prisma.matchCandidate.update({
      where: { id },
      data: {
        status: 'MERGED',
        decidedByUserId: actor.userId,
        decidedAt: new Date(),
        decisionNote: b.note ?? null,
      },
    });
  }

  // ---------------------------------------------------------------- overrides and conflicts
  async createOverride(
    actor: Actor,
    b: {
      entityType: 'MERCHANT' | 'BRANCH' | 'OFFER';
      entityId: string;
      field: string;
      value: unknown;
      kind: 'LOCAL' | 'TEMPORARY' | 'PERMANENT';
      validUntil?: string;
      reason: string;
    },
    meta: RequestMeta,
  ) {
    if (b.kind === 'TEMPORARY' && !b.validUntil)
      throw AppError.validation('A temporary override needs an end date', 'validUntil');
    const until = b.validUntil ? new Date(b.validUntil) : null;
    if (until && until <= new Date())
      throw AppError.validation('The end date must be in the future', 'validUntil');
    const exists =
      b.entityType === 'MERCHANT'
        ? await this.prisma.masterMerchant.findUnique({
            where: { id: b.entityId },
            select: { id: true },
          })
        : b.entityType === 'BRANCH'
          ? await this.prisma.masterBranch.findUnique({
              where: { id: b.entityId },
              select: { id: true },
            })
          : await this.prisma.referencedOffer.findUnique({
              where: { id: b.entityId },
              select: { id: true },
            });
    if (!exists) throw AppError.notFound();
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.entityOverride.create({
        data: {
          ...b,
          value: b.value as Prisma.InputJsonValue,
          validUntil: until,
          createdByUserId: actor.userId,
        },
      });
      await tx.externalEntityReference.updateMany({
        where: { entityType: b.entityType, entityId: b.entityId },
        data: {
          overrideStatus:
            b.kind === 'TEMPORARY' ? 'TEMPORARY' : b.kind === 'PERMANENT' ? 'PERMANENT' : 'LOCAL',
        },
      });
      await this.applyLocal(tx, b.entityType, b.entityId, b.field, b.value);
      await this.audit.record(
        {
          action: 'DATA_OVERRIDE_CREATED',
          entityType: b.entityType,
          entityId: b.entityId,
          actor,
          reason: b.reason,
          newState: { field: b.field, value: b.value, kind: b.kind, validUntil: until },
          scope: 'PLATFORM',
          source: 'ADMIN',
          meta,
        },
        tx,
      );
      return r;
    });
    return { id: row.id };
  }

  /** Writes a local value straight to the entity (used when an override is created or a conflict is resolved for DealDash). */
  async applyLocal(tx: Tx, entityType: string, entityId: string, field: string, value: unknown) {
    const data = { [field]: value } as never;
    if (entityType === 'MERCHANT') {
      if (!['nameEn', 'nameAr', 'country', 'categoryCode'].includes(field))
        throw AppError.validation('This field cannot be overridden', 'field');
      await tx.masterMerchant.update({ where: { id: entityId }, data });
      if (field === 'nameEn')
        await tx.masterMerchant.update({
          where: { id: entityId },
          data: { normalizedName: await this.normalize(String(value)) },
        });
    } else if (entityType === 'BRANCH') {
      if (!['nameEn', 'nameAr', 'addressEn', 'addressAr', 'city'].includes(field))
        throw AppError.validation('This field cannot be overridden', 'field');
      await tx.masterBranch.update({ where: { id: entityId }, data });
    } else {
      if (!['titleEn', 'titleAr', 'benefitEn', 'benefitAr', 'termsEn', 'termsAr'].includes(field))
        throw AppError.validation('This field cannot be overridden', 'field');
      await tx.referencedOffer.update({ where: { id: entityId }, data });
    }
  }

  async activeOverride(
    tx: Tx | PrismaService,
    entityType: string,
    entityId: string,
    field: string,
    now = new Date(),
  ) {
    return tx.entityOverride.findFirst({
      where: {
        entityType,
        entityId,
        field,
        endedAt: null,
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async resolveConflict(
    actor: Actor,
    id: string,
    b: { resolution: 'SOURCE_WINS' | 'DEALDASH_WINS' | 'MERCHANT_WINS'; note?: string },
    meta: RequestMeta,
  ) {
    const c = await this.prisma.dataConflict.findUnique({ where: { id } });
    if (!c) throw AppError.notFound();
    if (c.status !== 'OPEN')
      throw new AppError('INVALID_STATE', 'This conflict was already resolved', 409);
    await this.prisma.$transaction(async (tx) => {
      if (b.resolution === 'SOURCE_WINS') {
        await this.applyLocal(tx, c.entityType, c.entityId, c.field, c.sourceValue);
        // the override that protected the local value ends: the source is authoritative again for this field
        await tx.entityOverride.updateMany({
          where: { entityType: c.entityType, entityId: c.entityId, field: c.field, endedAt: null },
          data: { endedAt: new Date() },
        });
      }
      await tx.dataConflict.update({
        where: { id },
        data: {
          status: 'RESOLVED',
          resolution: b.resolution,
          resolvedByUserId: actor.userId,
          resolvedAt: new Date(),
        },
      });
      const open = await tx.dataConflict.count({
        where: { entityType: c.entityType, entityId: c.entityId, status: 'OPEN', id: { not: id } },
      });
      if (!open)
        await tx.externalEntityReference.updateMany({
          where: {
            entityType: c.entityType,
            entityId: c.entityId,
            overrideStatus: 'PENDING_RECONCILIATION',
          },
          data: { overrideStatus: 'LOCAL' },
        });
      await this.audit.record(
        {
          action: 'DATA_CONFLICT_RESOLVED',
          entityType: c.entityType,
          entityId: c.entityId,
          actor,
          reason: b.note ?? null,
          previousState: { local: c.localValue },
          newState: { field: c.field, resolution: b.resolution, source: c.sourceValue },
          scope: 'PLATFORM',
          source: 'ADMIN',
          meta,
        },
        tx,
      );
    });
  }

  // ---------------------------------------------------------------- views
  private async toView(
    m: Prisma.MasterMerchantGetPayload<{ include: { brand: true } }>,
  ): Promise<MasterMerchantView> {
    const [refs, aliases, branches, offers] = await Promise.all([
      this.prisma.externalEntityReference.findMany({
        where: { entityType: 'MERCHANT', entityId: m.id },
      }),
      this.prisma.entityAlias.findMany({ where: { entityType: 'MERCHANT', entityId: m.id } }),
      this.prisma.masterBranch.count({ where: { merchantId: m.id } }),
      this.prisma.referencedOffer.count({ where: { merchantId: m.id } }),
    ]);
    return {
      id: m.id,
      registration: m.registration,
      organizationId: m.organizationId,
      brand: m.brand?.nameEn ?? null,
      nameEn: m.nameEn,
      nameAr: m.nameAr,
      country: m.country,
      categoryCode: m.categoryCode,
      status: m.status,
      branchCount: branches,
      offerCount: offers,
      sources: refs.map((r) => ({
        sourceSystem: r.sourceSystem,
        sourceRecordId: r.sourceRecordId,
        importMethod: r.importMethod,
        editableBy: r.editableBy,
        syncStatus: r.syncStatus,
        overrideStatus: r.overrideStatus,
        publicationConfirmed: r.publicationConfirmed,
        lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
        lastSuccessfulSyncAt: r.lastSuccessfulSyncAt?.toISOString() ?? null,
        lastSourceUpdateAt: r.lastSourceUpdateAt?.toISOString() ?? null,
      })),
      aliases: aliases.map((a) => a.alias),
    };
  }

  async list(q: {
    q?: string;
    registration?: 'REFERENCED' | 'REGISTERED';
    limit: number;
    cursor?: string;
  }) {
    await this.ensureAllRegistered();
    const norm = q.q ? await this.normalize(q.q) : '';
    const rows = await this.prisma.masterMerchant.findMany({
      where: {
        status: 'ACTIVE',
        ...(q.registration ? { registration: q.registration } : {}),
        ...(norm
          ? {
              OR: [
                { normalizedName: { contains: norm } },
                { nameEn: { contains: q.q!, mode: 'insensitive' } },
                { nameAr: { contains: q.q! } },
              ],
            }
          : {}),
        ...(q.cursor ? { id: { gt: q.cursor } } : {}),
      },
      include: { brand: true },
      orderBy: { id: 'asc' },
      take: q.limit + 1,
    });
    const more = rows.length > q.limit;
    const items = await Promise.all(rows.slice(0, q.limit).map((m) => this.toView(m)));
    return new Page(items, more ? items[items.length - 1]!.id : null);
  }

  async get(id: string) {
    const m = await this.prisma.masterMerchant.findUnique({
      where: { id },
      include: { brand: true },
    });
    if (!m) throw AppError.notFound();
    return this.toView(m);
  }

  async candidates(status = 'PENDING') {
    await this.ensureAllRegistered();
    const rows = await this.prisma.matchCandidate.findMany({
      where: { entityType: 'MERCHANT', status },
      orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
    const ids = [...new Set(rows.flatMap((r) => [r.aId, r.bId]))];
    const masters = await this.prisma.masterMerchant.findMany({ where: { id: { in: ids } } });
    const refs = await this.prisma.externalEntityReference.findMany({
      where: { entityType: 'MERCHANT', entityId: { in: ids } },
      select: { entityId: true, sourceSystem: true },
    });
    const mk = (id: string) => {
      const m = masters.find((x) => x.id === id);
      return {
        id,
        nameEn: m?.nameEn ?? '',
        country: m?.country ?? '',
        registration: m?.registration ?? null,
        sourceSystems: [
          ...new Set(refs.filter((r) => r.entityId === id).map((r) => r.sourceSystem)),
        ],
      };
    };
    return rows.map((r) => ({
      id: r.id,
      entityType: r.entityType,
      confidence: r.confidence,
      reasons: r.reasons as string[],
      status: r.status,
      a: mk(r.aId),
      b: mk(r.bId),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async conflicts(status = 'OPEN') {
    const rows = await this.prisma.dataConflict.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((c) => ({
      id: c.id,
      entityType: c.entityType,
      entityId: c.entityId,
      field: c.field,
      sourceSystem: c.sourceSystem,
      sourceValue: c.sourceValue,
      localValue: c.localValue,
      policy: c.policy,
      status: c.status,
      resolution: c.resolution,
      createdAt: c.createdAt.toISOString(),
    }));
  }

  newId() {
    return randomUUID();
  }
}
