import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PAN_LIKE_PATTERN, type NetworkCapability, type NetworkMerchantState } from '@dealdash/types';
import type { networkMerchantCreateSchema } from '@dealdash/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementService } from '../platform/entitlement.service';
import { IngestService } from '../master/ingest.service';
import { MasterService } from '../master/master.service';
import { importTemplate } from '../master/import.service';
import { PartnerAccessService, type PartnerRow } from './partner-access.service';

/**
 * A partner's merchant network, read from the shared master data: a merchant belongs to the network when the partner is the source of
 * one of its records (ExternalEntityReference.sourceOrganizationId). Manual entries, bulk files and API feeds all go through the ONE
 * ingestion pipeline (IngestService), so normalisation, duplicate suggestions, provenance and "never silently overwrite approved local
 * data" exist once. A referenced (network) merchant never gains controlled products: only a registered, active, entitled DealDash
 * merchant can run Exclusive Deals, vouchers, rewards, staff redemption, settlement or finance.
 */
@Injectable()
export class PartnerNetworkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: PartnerAccessService,
    private readonly ingest: IngestService,
    private readonly master: MasterService,
    private readonly entitlements: EntitlementService,
  ) {}

  private async guard(actor: Actor, organizationId: string) {
    const p = await this.access.requirePartner(actor, organizationId);
    await this.access.requireModule(p, 'MERCHANT_NETWORK');
    return p;
  }

  /** Master merchant ids of the partner's network (merged records follow to the record they were merged into). */
  async networkIds(organizationId: string): Promise<string[]> {
    const refs = await this.prisma.externalEntityReference.findMany({
      where: { sourceOrganizationId: organizationId, entityType: 'MERCHANT' },
      select: { entityId: true },
    });
    const ids = new Set(refs.map((r) => r.entityId));
    const merged = await this.prisma.masterMerchant.findMany({
      where: { id: { in: [...ids] }, mergedIntoId: { not: null } },
      select: { id: true, mergedIntoId: true },
    });
    for (const m of merged) {
      ids.delete(m.id);
      ids.add(m.mergedIntoId!);
    }
    return [...ids];
  }

  /** Is this DealDash merchant organization in the partner's network (registered and linked)? */
  async isRegisteredMember(partnerOrganizationId: string, merchantOrganizationId: string) {
    const ids = await this.networkIds(partnerOrganizationId);
    return (
      (await this.prisma.masterMerchant.count({
        where: {
          id: { in: ids },
          organizationId: merchantOrganizationId,
          registration: 'REGISTERED',
        },
      })) > 0
    );
  }

  private async capabilities(
    m: {
      registration: string;
      organizationId: string | null;
      status: string;
      mergedIntoId: string | null;
    },
    published: boolean,
  ) {
    const caps: Record<NetworkCapability, boolean> = {
      DISCOVERY_LISTING: published,
      LIVE_DEAL: false,
      EXCLUSIVE: false,
      VOUCHER: false,
      WATCH_REWARD: false,
      STAFF_REDEMPTION: false,
      SETTLEMENT: false,
      FINANCE: false,
    };
    let state: NetworkMerchantState = m.mergedIntoId
      ? 'MERGED'
      : m.status !== 'ACTIVE'
        ? 'CLOSED'
        : m.registration === 'REGISTERED'
          ? 'REGISTERED'
          : 'REFERENCED';
    if (m.registration !== 'REGISTERED' || !m.organizationId) return { state, capabilities: caps };
    const org = await this.prisma.organization.findUnique({
      where: { id: m.organizationId },
      include: { merchant: true },
    });
    if (!org || org.status !== 'ACTIVE' || !org.merchant) return { state, capabilities: caps };
    state = 'REGISTERED_ACTIVE';
    const e = await this.entitlements.effective(org.id);
    const accounts = await this.prisma.businessAccount.count({
      where: { organizationId: org.id, status: 'ACTIVE' },
    });
    caps.DISCOVERY_LISTING = true;
    caps.LIVE_DEAL = e.products.includes('LIVE_DEAL');
    caps.EXCLUSIVE = e.products.includes('EXCLUSIVE');
    caps.VOUCHER = e.products.includes('VOUCHER');
    caps.WATCH_REWARD = e.products.includes('WATCH');
    caps.STAFF_REDEMPTION = true;
    caps.SETTLEMENT = accounts > 0;
    caps.FINANCE = accounts > 0;
    return { state, capabilities: caps };
  }

  async list(
    actor: Actor,
    organizationId: string,
    q: { q?: string; registration?: 'REFERENCED' | 'REGISTERED'; country?: string; limit: number },
  ) {
    const p = await this.guard(actor, organizationId);
    const markets = await this.access.authorizedMarkets(actor, p, 'partner.merchants.read');
    const ids = await this.networkIds(organizationId);
    const rows = await this.prisma.masterMerchant.findMany({
      where: {
        id: { in: ids },
        country: q.country ? q.country : { in: markets },
        ...(q.registration ? { registration: q.registration } : {}),
        ...(q.q
          ? {
              OR: [
                { nameEn: { contains: q.q, mode: 'insensitive' } },
                { nameAr: { contains: q.q } },
              ],
            }
          : {}),
      },
      include: { brand: true, _count: { select: { branches: true, offers: true } } },
      orderBy: { nameEn: 'asc' },
      take: q.limit,
    });
    if (q.country && !markets.includes(q.country)) return { items: [], total: ids.length, markets };
    const refs = await this.prisma.externalEntityReference.findMany({
      where: {
        sourceOrganizationId: organizationId,
        entityType: 'MERCHANT',
        entityId: { in: rows.map((r) => r.id) },
      },
    });
    const conflicts = await this.prisma.dataConflict.groupBy({
      by: ['entityId'],
      where: { entityType: 'MERCHANT', entityId: { in: rows.map((r) => r.id) }, status: 'OPEN' },
      _count: true,
    });
    const candidates = await this.prisma.matchCandidate.findMany({
      where: {
        entityType: 'MERCHANT',
        status: 'PENDING',
        OR: [{ aId: { in: rows.map((r) => r.id) } }, { bId: { in: rows.map((r) => r.id) } }],
      },
      select: { aId: true, bId: true },
    });
    const items = [];
    for (const r of rows) {
      const ref = refs.find((x) => x.entityId === r.id) ?? null;
      const c = await this.capabilities(r, !!ref?.publicationConfirmed);
      items.push({
        id: r.id,
        nameEn: r.nameEn,
        nameAr: r.nameAr,
        brand: r.brand?.nameEn ?? null,
        country: r.country,
        categoryCode: r.categoryCode,
        registration: r.registration,
        organizationId: r.organizationId,
        state: c.state,
        capabilities: c.capabilities,
        branches: r._count.branches,
        offers: r._count.offers,
        externalId: ref?.sourceRecordId ?? null,
        importMethod: ref?.importMethod ?? null,
        lastSyncAt: ref?.lastSyncAt?.toISOString() ?? null,
        overrideStatus: ref?.overrideStatus ?? 'NONE',
        openConflicts: conflicts.find((x) => x.entityId === r.id)?._count ?? 0,
        possibleDuplicates: candidates.filter((x) => x.aId === r.id || x.bId === r.id).length,
      });
    }
    return { items, total: ids.length, markets };
  }

  async detail(actor: Actor, organizationId: string, id: string) {
    const p = await this.guard(actor, organizationId);
    if (!(await this.networkIds(organizationId)).includes(id)) throw AppError.notFound();
    const m = await this.prisma.masterMerchant.findUnique({
      where: { id },
      include: { brand: true, branches: true, offers: true },
    });
    if (!m) throw AppError.notFound();
    if (
      !(await this.access.authorizedMarkets(actor, p, 'partner.merchants.read')).includes(m.country)
    )
      throw AppError.notFound();
    const entityIds = [m.id, ...m.branches.map((b) => b.id), ...m.offers.map((o) => o.id)];
    const refs = await this.prisma.externalEntityReference.findMany({
      where: { sourceOrganizationId: organizationId, entityId: { in: entityIds } },
    });
    const mine = new Set(refs.map((r) => r.entityId));
    const conflicts = await this.prisma.dataConflict.findMany({
      where: { entityId: { in: entityIds }, status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const c = await this.capabilities(
      m,
      refs.some((r) => r.entityId === m.id && r.publicationConfirmed),
    );
    return {
      id: m.id,
      nameEn: m.nameEn,
      nameAr: m.nameAr,
      brand: m.brand?.nameEn ?? null,
      country: m.country,
      categoryCode: m.categoryCode,
      registration: m.registration,
      organizationId: m.organizationId,
      state: c.state,
      capabilities: c.capabilities,
      branches: m.branches.map((b) => ({
        id: b.id,
        nameEn: b.nameEn,
        nameAr: b.nameAr,
        city: b.city,
        country: b.country,
        addressEn: b.addressEn,
        registered: !!b.merchantBranchId,
        fromYou: mine.has(b.id),
      })),
      // only the partner's own offers (another source's offers are not this partner's data)
      offers: m.offers
        .filter((o) => mine.has(o.id))
        .map((o) => ({
          id: o.id,
          titleEn: o.titleEn,
          titleAr: o.titleAr,
          benefitEn: o.benefitEn,
          status: o.status,
          validFrom: o.validFrom.toISOString(),
          validUntil: o.validUntil?.toISOString() ?? null,
          channel: o.channel,
        })),
      provenance: refs.map((r) => ({
        entityType: r.entityType,
        entityId: r.entityId,
        sourceSystem: r.sourceSystem,
        sourceRecordId: r.sourceRecordId,
        importMethod: r.importMethod,
        syncStatus: r.syncStatus,
        overrideStatus: r.overrideStatus,
        publicationConfirmed: r.publicationConfirmed,
        lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
        lastSuccessfulSyncAt: r.lastSuccessfulSyncAt?.toISOString() ?? null,
        lastSourceUpdateAt: r.lastSourceUpdateAt?.toISOString() ?? null,
      })),
      conflicts: conflicts.map((x) => ({
        id: x.id,
        entityType: x.entityType,
        field: x.field,
        sourceValue: x.sourceValue,
        localValue: x.localValue,
        policy: x.policy,
        createdAt: x.createdAt.toISOString(),
      })),
    };
  }

  /** One merchant (and its outlets) entered by hand: the same pipeline as files and feeds, with the partner as the source. */
  async createManual(
    actor: Actor,
    organizationId: string,
    b: z.infer<typeof networkMerchantCreateSchema>,
    meta: RequestMeta,
  ) {
    const p = await this.guard(actor, organizationId);
    await this.access.requireIngestion(p, 'MANUAL');
    await this.access.requireMarket(actor, p, b.country, 'partner.network.manage');
    const ctx = {
      sourceSystem: this.access.sourceSystemOf(organizationId),
      sourceOrganizationId: organizationId,
      connectionId: null,
      importJobId: null,
      method: 'MANUAL' as const,
      publicationConfirmed: false,
      publicationRef: null,
      actorUserId: actor.userId,
    };
    const sourceRecordId =
      b.externalMerchantId || `M-${randomBytes(5).toString('hex').toUpperCase()}`;
    const res = await this.ingest.apply(ctx, {
      type: 'MERCHANT',
      sourceRecordId,
      nameEn: b.nameEn,
      nameAr: b.nameAr,
      brand: b.brand,
      country: b.country,
      categoryCode: b.categoryCode,
    });
    const warnings = [...res.warnings];
    let n = 0;
    for (const br of b.branches) {
      const r = await this.ingest.apply(ctx, {
        type: 'BRANCH',
        sourceRecordId: br.externalId || `${sourceRecordId}-B${++n}`,
        sourceMerchantId: sourceRecordId,
        nameEn: br.nameEn,
        nameAr: br.nameAr,
        addressEn: br.addressEn,
        addressAr: br.addressAr,
        city: br.city,
        country: br.country ?? b.country,
        latitude: br.latitude,
        longitude: br.longitude,
      });
      warnings.push(...r.warnings);
    }
    await this.audit.record({
      action: 'partner.network.merchant_added',
      entityType: 'MasterMerchant',
      entityId: res.entityId,
      newState: { method: 'MANUAL', action: res.action, branches: b.branches.length, warnings },
      actor,
      subjectOrganizationId: organizationId,
      source: 'UI',
      meta,
    });
    return { id: res.entityId, action: res.action, warnings };
  }

  /** Registered DealDash merchants (public business names only) the partner can add to its network to run campaigns with them. */
  async searchRegistered(actor: Actor, organizationId: string, q: string) {
    const p = await this.guard(actor, organizationId);
    const markets = await this.access.authorizedMarkets(actor, p, 'partner.merchants.read');
    if (q.trim().length < 2) return [];
    const orgs = await this.prisma.organization.findMany({
      where: {
        type: 'MERCHANT',
        status: 'ACTIVE',
        merchant: { isNot: null },
        OR: [{ nameEn: { contains: q, mode: 'insensitive' } }, { nameAr: { contains: q } }],
      },
      take: 20,
      orderBy: { nameEn: 'asc' },
    });
    const out = [];
    for (const o of orgs) {
      const country =
        (
          await this.prisma.merchantBranch.findFirst({
            where: { organizationId: o.id },
            select: { country: true },
          })
        )?.country ?? null;
      if (country && !markets.includes(country)) continue;
      out.push({ organizationId: o.id, nameEn: o.nameEn, nameAr: o.nameAr, country });
    }
    return out;
  }

  /** Adds a registered merchant to the network (a provenance link only; nothing about the merchant changes). */
  async linkRegistered(
    actor: Actor,
    organizationId: string,
    merchantOrganizationId: string,
    meta: RequestMeta,
  ) {
    const p = await this.guard(actor, organizationId);
    await this.access.requireIngestion(p, 'MANUAL');
    const org = await this.prisma.organization.findFirst({
      where: { id: merchantOrganizationId, type: 'MERCHANT', status: 'ACTIVE' },
      include: { merchant: true },
    });
    if (!org?.merchant)
      throw new AppError(
        'PARTNER_MERCHANT_NOT_REGISTERED',
        'Only an active, registered DealDash merchant can be linked',
        409,
      );
    const masterId = await this.master.ensureRegisteredMaster(merchantOrganizationId);
    const m = await this.prisma.masterMerchant.findUniqueOrThrow({ where: { id: masterId } });
    await this.access.requireMarket(actor, p, m.country, 'partner.network.manage');
    const sourceSystem = this.access.sourceSystemOf(organizationId);
    const sourceRecordId = `REG-${merchantOrganizationId}`;
    await this.prisma.externalEntityReference.upsert({
      where: {
        sourceSystem_entityType_sourceRecordId: {
          sourceSystem,
          entityType: 'MERCHANT',
          sourceRecordId,
        },
      },
      update: {},
      create: {
        entityType: 'MERCHANT',
        entityId: masterId,
        sourceSystem,
        sourceRecordId,
        sourceOrganizationId: organizationId,
        importMethod: 'MANUAL',
        sourceOwner: sourceSystem,
        editableBy: 'DEALDASH',
        lastSyncAt: new Date(),
        lastSuccessfulSyncAt: new Date(),
      },
    });
    await this.audit.record({
      action: 'partner.network.registered_linked',
      entityType: 'MasterMerchant',
      entityId: masterId,
      newState: { merchantOrganizationId },
      actor,
      subjectOrganizationId: organizationId,
      meta,
    });
    return { id: masterId };
  }

  /** Possible duplicates involving the partner's records. The partner gives its view; only DealDash merges (never silently). */
  async duplicates(actor: Actor, organizationId: string) {
    await this.guard(actor, organizationId);
    const ids = await this.networkIds(organizationId);
    const rows = await this.prisma.matchCandidate.findMany({
      where: {
        entityType: 'MERCHANT',
        status: 'PENDING',
        OR: [{ aId: { in: ids } }, { bId: { in: ids } }],
      },
      orderBy: { confidence: 'desc' },
      take: 200,
    });
    const all = await this.prisma.masterMerchant.findMany({
      where: { id: { in: rows.flatMap((r) => [r.aId, r.bId]) } },
      select: { id: true, nameEn: true, nameAr: true, country: true, registration: true },
    });
    const name = (id: string) => all.find((m) => m.id === id) ?? null;
    return rows.map((r) => {
      const mineA = ids.includes(r.aId);
      return {
        id: r.id,
        confidence: r.confidence,
        reasons: r.reasons,
        yours: name(mineA ? r.aId : r.bId),
        other: name(mineA ? r.bId : r.aId),
        highRisk: r.confidence < 90 || name(mineA ? r.bId : r.aId)?.registration === 'REGISTERED',
        partnerSuggestion: r.partnerSuggestionOrgId === organizationId ? r.partnerSuggestion : null,
      };
    });
  }

  async suggest(
    actor: Actor,
    organizationId: string,
    candidateId: string,
    decision: 'NOT_DUPLICATE' | 'SUGGEST_MERGE',
    note: string | undefined,
    meta: RequestMeta,
  ) {
    await this.guard(actor, organizationId);
    const ids = await this.networkIds(organizationId);
    const c = await this.prisma.matchCandidate.findFirst({
      where: {
        id: candidateId,
        status: 'PENDING',
        OR: [{ aId: { in: ids } }, { bId: { in: ids } }],
      },
    });
    if (!c) throw AppError.notFound();
    await this.prisma.matchCandidate.update({
      where: { id: c.id },
      data: {
        partnerSuggestion: decision,
        partnerSuggestionOrgId: organizationId,
        partnerSuggestionNote: note ?? null,
        partnerSuggestedAt: new Date(),
      },
    });
    await this.audit.record({
      action: 'partner.network.duplicate_suggested',
      entityType: 'MatchCandidate',
      entityId: c.id,
      newState: { decision },
      reason: note ?? null,
      actor,
      subjectOrganizationId: organizationId,
      meta,
    });
    return { ok: true as const };
  }

  /**
   * The partner's own network Live Deals (referenced offers: discovery-only listings). Each keeps its full provenance: source,
   * publication authority, external offer id, merchant source id, effective dates, eligibility, market, method and last sync.
   * Publication: an API connection DealDash authorised, a bulk import DealDash approved with a publication reference, or a manual
   * entry whose publication right DealDash confirmed (FD-S7-4). Discovery itself is the unchanged shared network-offer rule.
   */
  async offers(actor: Actor, organizationId: string) {
    const p = await this.access.requirePartner(actor, organizationId);
    await this.access.requireModule(p, 'OFFERS');
    const markets = await this.access.authorizedMarkets(actor, p, 'partner.merchants.read');
    const refs = await this.prisma.externalEntityReference.findMany({
      where: { sourceOrganizationId: organizationId, entityType: { in: ['OFFER', 'MERCHANT'] } },
    });
    const offerRefs = refs.filter((r) => r.entityType === 'OFFER');
    const rows = await this.prisma.referencedOffer.findMany({
      where: { id: { in: offerRefs.map((r) => r.entityId) }, merchant: { country: { in: markets } } },
      include: { merchant: { select: { nameEn: true, nameAr: true, country: true, registration: true } } },
      orderBy: { validFrom: 'desc' },
      take: 300,
    });
    const connIds = [...new Set(offerRefs.map((r) => r.connectionId).filter((x): x is string => !!x))];
    const conns = new Map(
      (await this.prisma.integrationConnection.findMany({ where: { id: { in: connIds } } })).map((c) => [c.id, c]),
    );
    return rows.map((o) => {
      const ref = offerRefs.find((r) => r.entityId === o.id)!;
      const conn = ref.connectionId ? conns.get(ref.connectionId) : null;
      const authorised = conn ? conn.status === 'ACTIVE' && conn.publicationAuthorized : !!ref.publicationRef;
      return {
        id: o.id,
        merchant: o.merchant.nameEn,
        merchantAr: o.merchant.nameAr,
        merchantRegistered: o.merchant.registration === 'REGISTERED',
        merchantSourceId: refs.find((r) => r.entityType === 'MERCHANT' && r.entityId === o.merchantId)?.sourceRecordId ?? null,
        country: o.merchant.country,
        titleEn: o.titleEn,
        titleAr: o.titleAr,
        benefitEn: o.benefitEn,
        status: o.status,
        validFrom: o.validFrom.toISOString(),
        validUntil: o.validUntil?.toISOString() ?? null,
        channel: o.channel,
        eligibility: o.eligibility,
        sourceSystem: ref.sourceSystem,
        importMethod: ref.importMethod,
        publicationRef: conn ? conn.publicationRef : ref.publicationRef,
        publicationConfirmed: ref.publicationConfirmed,
        publication: !ref.publicationConfirmed || !authorised ? 'AWAITING_CONFIRMATION' : ref.syncStatus === 'STALE' ? 'STALE' : 'PUBLISHABLE',
        sourceRecordId: ref.sourceRecordId,
        lastSyncAt: ref.lastSyncAt?.toISOString() ?? null,
      };
    });
  }

  /**
   * FD-S7-4: a partner creates one Live Deal (a network offer) for a merchant of its network, stating its publication authority (the
   * contract / programme reference that gives it the right to publish the merchant's offer). It goes through the ONE ingestion pipeline
   * with full provenance and is NOT shown to customers until DealDash confirms the publication right. It never gives the merchant
   * Exclusive Deal, voucher, controlled redemption, staff, settlement or finance capability.
   */
  async createOffer(
    actor: Actor,
    organizationId: string,
    b: {
      sourceRecordId?: string;
      merchantSourceId: string;
      publicationRef: string;
      titleEn: string;
      titleAr?: string;
      benefitEn: string;
      benefitAr?: string;
      termsEn?: string;
      termsAr?: string;
      categoryCode?: string;
      channel?: 'IN_STORE' | 'ONLINE' | 'BOTH';
      validFrom: string;
      validUntil?: string;
      branchSourceIds?: string[];
      eligibility?: Record<string, unknown>;
    },
    meta: RequestMeta,
  ) {
    const p = await this.access.requirePartner(actor, organizationId);
    this.access.requireOperating(p);
    await this.access.requireModule(p, 'OFFERS');
    await this.access.requireIngestion(p, 'MANUAL');
    for (const v of [b.titleEn, b.titleAr, b.benefitEn, b.benefitAr, b.termsEn, b.termsAr, JSON.stringify(b.eligibility ?? {})])
      if (v && PAN_LIKE_PATTERN.test(v)) throw new AppError('CARD_DATA_FORBIDDEN', 'Card numbers are never stored', 422);
    const sourceSystem = this.access.sourceSystemOf(organizationId);
    const mref = await this.prisma.externalEntityReference.findUnique({
      where: { sourceSystem_entityType_sourceRecordId: { sourceSystem, entityType: 'MERCHANT', sourceRecordId: b.merchantSourceId } },
    });
    const merchant = mref
      ? await this.prisma.masterMerchant.findUnique({ where: { id: mref.entityId }, select: { country: true } })
      : null;
    if (!mref || !merchant)
      throw new AppError('PARTNER_MERCHANT_NOT_IN_NETWORK', 'Choose a merchant of your network', 409);
    await this.access.requireMarket(actor, p, merchant.country, 'partner.network.manage');
    const res = await this.ingest.applyRaw(
      {
        sourceSystem,
        sourceOrganizationId: organizationId,
        connectionId: null,
        importJobId: null,
        method: 'MANUAL',
        publicationConfirmed: false,
        publicationRef: b.publicationRef,
        actorUserId: actor.userId,
      },
      {
        type: 'OFFER',
        sourceRecordId: b.sourceRecordId || `O-${randomBytes(5).toString('hex').toUpperCase()}`,
        sourceMerchantId: b.merchantSourceId,
        titleEn: b.titleEn,
        titleAr: b.titleAr,
        benefitEn: b.benefitEn,
        benefitAr: b.benefitAr,
        termsEn: b.termsEn,
        termsAr: b.termsAr,
        categoryCode: b.categoryCode,
        channel: b.channel ?? 'IN_STORE',
        validFrom: b.validFrom,
        validUntil: b.validUntil,
        branchSourceIds: b.branchSourceIds ?? [],
        eligibility: b.eligibility ?? {},
      },
    );
    await this.audit.record({
      action: 'partner.offer.created',
      entityType: 'ReferencedOffer',
      entityId: res.entityId,
      newState: { method: 'MANUAL', action: res.action, publicationRef: b.publicationRef, publicationConfirmed: false },
      actor,
      subjectOrganizationId: organizationId,
      source: 'UI',
      meta,
    });
    return { id: res.entityId, action: res.action, warnings: res.warnings, publication: 'AWAITING_CONFIRMATION' as const };
  }

  /** DealDash: network offers from partners waiting for their publication right to be confirmed. */
  async pendingPublication() {
    const refs = await this.prisma.externalEntityReference.findMany({
      where: { entityType: 'OFFER', publicationConfirmed: false, publicationRef: { not: null }, connectionId: null, sourceOrganizationId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const offers = await this.prisma.referencedOffer.findMany({
      where: { id: { in: refs.map((r) => r.entityId) } },
      include: { merchant: { select: { nameEn: true, country: true } } },
    });
    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: refs.map((r) => r.sourceOrganizationId!) } },
      select: { id: true, nameEn: true },
    });
    return refs.flatMap((r) => {
      const o = offers.find((x) => x.id === r.entityId);
      if (!o) return [];
      return [{
        id: o.id,
        partner: orgs.find((x) => x.id === r.sourceOrganizationId)?.nameEn ?? null,
        partnerOrganizationId: r.sourceOrganizationId,
        merchant: o.merchant.nameEn,
        country: o.merchant.country,
        titleEn: o.titleEn,
        benefitEn: o.benefitEn,
        validFrom: o.validFrom.toISOString(),
        validUntil: o.validUntil?.toISOString() ?? null,
        publicationRef: r.publicationRef,
        sourceSystem: r.sourceSystem,
        sourceRecordId: r.sourceRecordId,
        importMethod: r.importMethod,
      }];
    });
  }

  /** DealDash confirms (or withdraws) a partner's right to publish one network offer; every decision is audited. */
  async decidePublication(actor: Actor, offerId: string, confirm: boolean, reason: string | undefined, meta: RequestMeta) {
    const ref = await this.prisma.externalEntityReference.findFirst({
      where: { entityType: 'OFFER', entityId: offerId, sourceOrganizationId: { not: null }, connectionId: null },
    });
    if (!ref) throw AppError.notFound();
    const partner = await this.prisma.organization.findFirst({ where: { id: ref.sourceOrganizationId!, type: 'PARTNER' } });
    if (!partner) throw AppError.notFound();
    if (confirm && !ref.publicationRef)
      throw AppError.validation('A publication authority reference is required', 'publicationRef');
    await this.prisma.externalEntityReference.update({ where: { id: ref.id }, data: { publicationConfirmed: confirm } });
    await this.audit.record({
      action: confirm ? 'partner.offer.publication_confirmed' : 'partner.offer.publication_withdrawn',
      entityType: 'ReferencedOffer',
      entityId: offerId,
      previousState: { publicationConfirmed: ref.publicationConfirmed },
      newState: { publicationConfirmed: confirm, publicationRef: ref.publicationRef, reason: reason ?? null },
      actor,
      subjectOrganizationId: ref.sourceOrganizationId,
      source: 'UI',
      meta,
    });
    return { id: offerId, publicationConfirmed: confirm };
  }

  template(kind: 'MERCHANTS' | 'BRANCHES' | 'OFFERS') {
    return importTemplate(kind);
  }

  async summary(p: PartnerRow) {
    const ids = await this.networkIds(p.organizationId);
    const [referenced, registered] = await Promise.all([
      this.prisma.masterMerchant.count({ where: { id: { in: ids }, registration: 'REFERENCED' } }),
      this.prisma.masterMerchant.count({ where: { id: { in: ids }, registration: 'REGISTERED' } }),
    ]);
    return { total: ids.length, referenced, registered };
  }
}
