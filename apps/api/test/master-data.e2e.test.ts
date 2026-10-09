import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_READY, createBusinessUser, createDealDashOrg, createPartnerOrg, createTestApp, idem, passwordSession, type Session, type TestApp } from './helpers';
import { buildHotWorld, type HotWorld } from './hot-fixtures';
import { IntegrationService } from '../src/master/integration.service';
import { MasterService } from '../src/master/master.service';

/**
 * Shared platform, Phase 2: merchant master data (referenced vs registered), duplicate suggestions, provenance, overrides and
 * conflicts, bulk import, the integration framework, webhooks and network-offer visibility.
 */
describe.skipIf(!DB_READY)('Master data and ingestion (Phase 2)', () => {
  let t: TestApp;
  let w: HotWorld;
  let partnerOrg: string;
  let partnerOrg2: string;
  let partner: Session;
  let partner2: Session;
  let admin2: Session;
  const state: Record<string, string> = {};

  beforeAll(async () => {
    t = await createTestApp();
    w = await buildHotWorld(t);
    partnerOrg = await createPartnerOrg(t.prisma, 'Visa', 'SCHEME');
    partnerOrg2 = await createPartnerOrg(t.prisma, 'Mastercard', 'SCHEME');
    const mkPartner = async (orgId: string) =>
      passwordSession(t, await createBusinessUser(t.prisma, { role: 'PARTNER_ADMIN', orgId, userType: 'PARTNER_USER' }), 'partner');
    partner = await mkPartner(partnerOrg);
    partner2 = await mkPartner(partnerOrg2);
    const dd = await createDealDashOrg(t.prisma);
    admin2 = await passwordSession(t, await createBusinessUser(t.prisma, { role: 'DEALDASH_MERCHANT_MANAGEMENT', orgId: dd.id, userType: 'ADMIN_USER', mfa: true }), 'admin', { completeMfa: true });
  });
  afterAll(() => t?.close());

  const sa = () => w.superAdmin;
  const ia = (s: Session) => (path: string, body: unknown = {}) => w.api(s).post(path).set('Idempotency-Key', idem()).send(body as object);
  const key = (k: string) => ({ 'X-DealDash-Key': k });
  const ingest = (k: string, records: unknown[], idemKey?: string) => {
    const r = t.http.post('/v1/integrations/ingest').set(key(k));
    if (idemKey) r.set('Idempotency-Key', idemKey);
    return r.send({ apiVersion: '1', records });
  };
  const iso = (days: number) => new Date(Date.now() + days * 864e5).toISOString();
  const merchant = (id: string, nameEn: string, extra: Record<string, unknown> = {}) => ({ type: 'MERCHANT', sourceRecordId: id, nameEn, country: 'SA', ...extra });
  async function connect(org: string | undefined, sourceSystem: string, extra: Record<string, unknown> = {}) {
    const r = await ia(sa())('/v1/admin/integrations', { name: `${sourceSystem} feed`, sourceSystem, organizationId: org, publicationAuthorized: true, publicationRef: `CONTRACT-${sourceSystem}`, ...extra });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.data as { id: string; apiKey: string; keyPrefix: string };
  }
  const master = async (q: string) => (await w.api(sa()).get('/v1/admin/master/merchants').query({ q })).body.data as Array<Record<string, any>>;

  it('API credentials: shown once, hashed at rest, versioned, scoped; bad, revoked and rate-limited keys are refused', async () => {
    const c = await connect(partnerOrg, 'visa');
    state.visaKey = c.apiKey;
    state.visaId = c.id;
    expect(c.apiKey).toMatch(/^ddk_[0-9a-f]{10}\.[A-Za-z0-9_-]{20,}$/);
    const row = await t.prisma.integrationConnection.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.keyHash).not.toContain(c.apiKey.split('.')[1]!);
    const list = JSON.stringify((await w.api(sa()).get('/v1/admin/integrations')).body);
    expect(list).not.toContain(c.apiKey.split('.')[1]!);
    expect(list).not.toContain(row.keyHash);

    expect((await t.http.post('/v1/integrations/ingest').send({ apiVersion: '1', records: [] })).status).toBe(401);
    expect((await ingest('ddk_0000000000.notarealsecretnotarealsecret', [merchant('x', 'X')])).status).toBe(401);
    expect((await ingest(c.apiKey.replace(/.$/, c.apiKey.endsWith('a') ? 'b' : 'a'), [merchant('x', 'X')])).status).toBe(401);
    // the contract is versioned: an unknown version is refused, an empty batch is refused
    expect((await t.http.post('/v1/integrations/ingest').set(key(c.apiKey)).send({ apiVersion: '2', records: [merchant('x', 'X')] })).status).toBe(400);
    expect((await ingest(c.apiKey, [])).status).toBe(400);

    const limited = await connect(undefined, 'ratelimited', { rateLimitPerMinute: 2 });
    expect((await ingest(limited.apiKey, [merchant('r1', 'Rate One')])).status).toBe(200);
    expect((await ingest(limited.apiKey, [merchant('r2', 'Rate Two')])).status).toBe(200);
    expect((await ingest(limited.apiKey, [merchant('r3', 'Rate Three')])).status).toBe(429);

    const doomed = await connect(undefined, 'doomed');
    expect((await ia(sa())(`/v1/admin/integrations/${doomed.id}/status`, { status: 'REVOKED' })).status).toBe(200);
    expect((await ingest(doomed.apiKey, [merchant('d', 'Doomed')])).status).toBe(401);
    expect((await ia(sa())(`/v1/admin/integrations/${doomed.id}/status`, { status: 'ACTIVE' })).status).toBe(409);

    // a scope the key does not have is refused per record
    const narrow = await connect(undefined, 'narrow', { scopes: ['MERCHANT'] });
    const res = await ingest(narrow.apiKey, [merchant('n1', 'Narrow Cafe'), { type: 'OFFER', sourceRecordId: 'o', sourceMerchantId: 'n1', titleEn: 't', benefitEn: 'b', validFrom: iso(-1) }]);
    expect(res.body.data).toMatchObject({ accepted: 1, rejected: 1 });
  });

  it('ingestion creates REFERENCED merchants with full provenance; they are not DealDash merchants', async () => {
    const batch = [
      { type: 'OFFER', sourceRecordId: 'visa-o1', sourceMerchantId: 'visa-m1', titleEn: '20% off dinner', titleAr: 'خصم 20% على العشاء', benefitEn: '20% off the bill', validFrom: iso(-1), validUntil: iso(30), channel: 'IN_STORE', branchSourceIds: ['visa-b1'], eligibility: { schemes: ['VISA'] } },
      { type: 'BRANCH', sourceRecordId: 'visa-b1', sourceMerchantId: 'visa-m1', nameEn: 'Olaya', city: 'Riyadh', latitude: 24.7136, longitude: 46.6753 },
      merchant('visa-m1', "Cafe Nouveau", { nameAr: 'كافيه نوفو', brand: 'Nouveau Group', sourceUpdatedAt: iso(-2) }),
    ];
    const r = await ingest(state.visaKey!, batch, 'batch-1');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ received: 3, accepted: 3, rejected: 0, replayed: false });

    const m = (await master('Nouveau'))[0]!;
    expect(m).toMatchObject({ registration: 'REFERENCED', organizationId: null, brand: 'Nouveau Group', branchCount: 1, offerCount: 1 });
    expect(m.sources[0]).toMatchObject({ sourceSystem: 'visa', sourceRecordId: 'visa-m1', importMethod: 'API', editableBy: 'SOURCE', syncStatus: 'SYNCED', overrideStatus: 'NONE', publicationConfirmed: true });
    expect(m.sources[0].lastSuccessfulSyncAt).toBeTruthy();
    expect(m.sources[0].lastSourceUpdateAt).toBeTruthy();
    state.nouveau = m.id;

    // a referenced merchant has no organization, no members, no branches in the DealDash sense
    expect(await t.prisma.organization.count({ where: { nameEn: { contains: 'Nouveau' } } })).toBe(0);
    expect(await t.prisma.masterMerchant.count({ where: { id: m.id, organizationId: null } })).toBe(1);

    // idempotent replay returns the first result and writes nothing twice
    const again = await ingest(state.visaKey!, batch, 'batch-1');
    expect(again.body.data).toMatchObject({ replayed: true, syncJobId: r.body.data.syncJobId });
    expect(await t.prisma.masterMerchant.count({ where: { normalizedName: { contains: 'nouveau' } } })).toBe(1);
    // a re-send without a key updates nothing (no change) and creates nothing
    const noop = await ingest(state.visaKey!, batch);
    expect(noop.body.data).toMatchObject({ accepted: 3, replayed: false });
    expect(await t.prisma.referencedOffer.count({ where: { merchantId: m.id } })).toBe(1);
    expect(await t.prisma.externalEntityReference.count({ where: { sourceSystem: 'visa', entityType: 'MERCHANT' } })).toBe(1);
  });

  it('bad records never fail a batch and never disappear: they wait in the failed-record queue to be retried or discarded', async () => {
    const r = await ingest(state.visaKey!, [
      merchant('visa-m2', 'Good Bistro'),
      { type: 'BRANCH', sourceRecordId: 'visa-b9', sourceMerchantId: 'visa-unknown', nameEn: 'Orphan' },
      { type: 'MERCHANT', sourceRecordId: 'visa-bad', country: 'SA' },
      { type: 'WIDGET', sourceRecordId: 'w' },
      { type: 'OFFER', sourceRecordId: 'visa-o9', sourceMerchantId: 'visa-m2', titleEn: 'x', benefitEn: 'y', validFrom: iso(5), validUntil: iso(1) },
    ]);
    expect(r.body.data).toMatchObject({ received: 5, accepted: 1, rejected: 4 });
    expect(r.body.data.failures.map((f: { error: string }) => f.error).join(' | ')).toMatch(/MERCHANT_NOT_FOUND/);
    const failed = (await w.api(sa()).get(`/v1/admin/integrations/${state.visaId}/failed`)).body.data as Array<{ id: string; sourceRecordId: string; error: string }>;
    expect(failed.length).toBeGreaterThanOrEqual(4);
    const orphan = failed.find((f) => f.sourceRecordId === 'visa-b9')!;
    // retry before the merchant exists keeps it open with a higher attempt count
    expect((await ia(sa())(`/v1/admin/integrations/${state.visaId}/failed/${orphan.id}`, { action: 'RETRY' })).status).toBe(400);
    // the merchant arrives; the retry now succeeds
    await ingest(state.visaKey!, [merchant('visa-unknown', 'Late Merchant')]);
    expect((await ia(sa())(`/v1/admin/integrations/${state.visaId}/failed/${orphan.id}`, { action: 'RETRY' })).status).toBe(200);
    expect((await ia(sa())(`/v1/admin/integrations/${state.visaId}/failed/${orphan.id}`, { action: 'RETRY' })).status).toBe(409);
    const bad = failed.find((f) => f.sourceRecordId === 'visa-bad')!;
    expect((await ia(sa())(`/v1/admin/integrations/${state.visaId}/failed/${bad.id}`, { action: 'DISCARD', reason: 'Source bug' })).status).toBe(200);
    expect((await t.prisma.failedRecord.findUniqueOrThrow({ where: { id: bad.id } })).status).toBe('DISCARDED');
    const health = (await w.api(sa()).get(`/v1/admin/integrations/${state.visaId}/health`)).body.data;
    expect(health.errorCount).toBeGreaterThanOrEqual(4);
    expect(health.stale).toBe(false);
    expect(health.lastSuccessfulSyncAt).toBeTruthy();
  });

  it('possible duplicates are SUGGESTED to a person, never merged automatically; the pair appears once', async () => {
    const mc = await connect(partnerOrg2, 'mastercard');
    state.mcKey = mc.apiKey;
    await ingest(state.visaKey!, [merchant('visa-mcd', "McDonald's", { brand: 'McDonalds' })]);
    await ingest(mc.apiKey, [merchant('mc-1', 'McDonalds KSA'), merchant('mc-2', 'McD Riyadh'), merchant('mc-3', 'Totally Different Diner')]);
    await ingest(mc.apiKey, [merchant('mc-1', 'McDonalds KSA')]); // sending it again must not duplicate the suggestion
    const masters = await t.prisma.masterMerchant.findMany({ where: { normalizedName: { contains: 'mc' }, status: 'ACTIVE' } });
    expect(masters.length).toBeGreaterThanOrEqual(3); // nothing merged
    const cands = (await w.api(sa()).get('/v1/admin/master/candidates')).body.data as Array<Record<string, any>>;
    const pair = cands.find((c) => [c.a.nameEn, c.b.nameEn].sort().join('|') === ["McDonald's", 'McDonalds KSA'].sort().join('|'))!;
    expect(pair.confidence).toBe(100);
    expect(pair.reasons).toContain('SAME_NORMALIZED_NAME');
    expect(cands.filter((c) => [c.a.nameEn, c.b.nameEn].includes('McDonalds KSA') && [c.a.nameEn, c.b.nameEn].includes("McDonald's")).length).toBe(1);
    expect(pair.a.sourceSystems.concat(pair.b.sourceSystems).sort()).toEqual(['mastercard', 'visa']);
    const abbr = cands.find((c) => [c.a.nameEn, c.b.nameEn].includes('McD Riyadh'));
    if (abbr) expect(abbr.confidence).toBeLessThan(pair.confidence);
    expect(cands.some((c) => [c.a.nameEn, c.b.nameEn].includes('Totally Different Diner'))).toBe(false);
    state.pair = pair.id;
    state.pairA = pair.a.id;
    state.pairB = pair.b.id;

    // only Admin with the manage permission decides
    expect((await ia(w.ops)(`/v1/admin/master/candidates/${pair.id}/decide`, { decision: 'MERGE' })).status).toBe(403);
    expect((await ia(w.marketing)(`/v1/admin/master/candidates/${pair.id}/decide`, { decision: 'MERGE' })).status).toBe(403);
    const merged = await ia(sa())(`/v1/admin/master/candidates/${pair.id}/decide`, { decision: 'MERGE', note: 'Same company' });
    expect(merged.status, JSON.stringify(merged.body)).toBe(200);
    expect((await ia(sa())(`/v1/admin/master/candidates/${pair.id}/decide`, { decision: 'REJECT' })).status).toBe(409);
    const rows = await t.prisma.masterMerchant.findMany({ where: { id: { in: [pair.a.id, pair.b.id] } } });
    expect(rows.map((r) => r.status).sort()).toEqual(['ACTIVE', 'MERGED']);
    const survivor = rows.find((r) => r.status === 'ACTIVE')!;
    const dropped = rows.find((r) => r.status === 'MERGED')!;
    expect(dropped.mergedIntoId).toBe(survivor.id);
    // both sources now point at the survivor, and the old name is an alias
    const refs = await t.prisma.externalEntityReference.findMany({ where: { entityType: 'MERCHANT', entityId: survivor.id } });
    expect(refs.map((r) => r.sourceSystem).sort()).toEqual(['mastercard', 'visa']);
    expect((await t.prisma.entityAlias.count({ where: { entityType: 'MERCHANT', entityId: survivor.id } }))).toBeGreaterThanOrEqual(1);
    // the same source record keeps updating the survivor (no new duplicate is created)
    await ingest(mc.apiKey, [merchant('mc-1', 'McDonalds KSA', { categoryCode: 'dining' })]);
    expect(await t.prisma.masterMerchant.count({ where: { status: 'ACTIVE', normalizedName: 'mcdonalds' } })).toBe(1);
    const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'MASTER_MERCHANT_MERGED', entityId: dropped.id } });
    expect(audit.newState).toMatchObject({ mergedIntoId: survivor.id });
    expect(audit.reason).toBe('Same company');

    // a rejected suggestion stays rejected
    const other = cands.find((c) => c.id !== pair.id && c.status === 'PENDING');
    if (other) {
      expect((await ia(sa())(`/v1/admin/master/candidates/${other.id}/decide`, { decision: 'REJECT', note: 'Different business' })).status).toBe(200);
      expect((await t.prisma.matchCandidate.findUniqueOrThrow({ where: { id: other.id } })).status).toBe('REJECTED');
    }
  });

  it('referenced vs registered: a registered DealDash merchant is its own record, a referenced one is upgraded (linked), never duplicated', async () => {
    // organization A is a live DealDash merchant: it gets a REGISTERED master record automatically
    const list = await w.api(sa()).get('/v1/admin/master/merchants').query({ registration: 'REGISTERED', limit: 100 });
    const own = (list.body.data as Array<Record<string, any>>).find((m) => m.organizationId === w.A.orgId)!;
    expect(own).toMatchObject({ registration: 'REGISTERED' });
    expect(own.branchCount).toBe(w.A.branchIds.length);
    // a scheme later supplies the same business by name
    const orgName = (await t.prisma.organization.findUniqueOrThrow({ where: { id: w.A.orgId } })).nameEn;
    await ingest(state.visaKey!, [merchant('visa-alpha', orgName)]);
    const referenced = (await master(orgName)).find((m) => m.registration === 'REFERENCED')!;
    const cand = ((await w.api(sa()).get('/v1/admin/master/candidates')).body.data as Array<Record<string, any>>).find((c) => [c.a.id, c.b.id].includes(referenced.id) && [c.a.id, c.b.id].includes(own.id))!;
    expect(cand.confidence).toBe(100);
    // it is NOT linked on its own
    expect(await t.prisma.masterMerchant.count({ where: { organizationId: w.A.orgId } })).toBe(1);
    expect((await t.prisma.masterMerchant.findUniqueOrThrow({ where: { id: referenced.id } })).organizationId).toBeNull();

    // an inactive or non-merchant organization cannot be linked; a registered record cannot be linked again
    const draftOrg = await t.prisma.organization.create({ data: { type: 'MERCHANT', status: 'DRAFT', nameEn: 'Draft Co', nameAr: 'د', merchant: { create: { legalName: 'Draft Co' } } } });
    expect((await ia(sa())(`/v1/admin/master/merchants/${referenced.id}/link-registered`, { organizationId: draftOrg.id })).status).toBe(409);
    expect((await ia(sa())(`/v1/admin/master/merchants/${referenced.id}/link-registered`, { organizationId: partnerOrg })).status).toBe(400);
    expect((await ia(sa())(`/v1/admin/master/merchants/${own.id}/link-registered`, { organizationId: w.A.orgId })).status).toBe(409);

    // linking merges the referenced record INTO the registered one: one record, with both sources
    const linked = await ia(sa())(`/v1/admin/master/merchants/${referenced.id}/link-registered`, { organizationId: w.A.orgId });
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    expect(linked.body.data.id).toBe(own.id);
    const after = await w.api(sa()).get(`/v1/admin/master/merchants/${own.id}`);
    expect(after.body.data).toMatchObject({ registration: 'REGISTERED', organizationId: w.A.orgId });
    expect(after.body.data.sources.map((s: { sourceSystem: string }) => s.sourceSystem)).toContain('visa');
    expect((await t.prisma.masterMerchant.findUniqueOrThrow({ where: { id: referenced.id } })).status).toBe('MERGED');
    // the database refuses a registered merchant without an organization (and a referenced one with an organization)
    await expect(t.prisma.$executeRaw`UPDATE "MasterMerchant" SET "organizationId" = NULL WHERE "id" = ${own.id}::uuid`).rejects.toThrow();
    // a registered merchant can never be merged into something else
    const dup = await t.prisma.masterMerchant.create({ data: { nameEn: 'Alpha Twin', normalizedName: 'alpha twin' } });
    const c2 = await t.prisma.matchCandidate.create({ data: { entityType: 'MERCHANT', aId: own.id < dup.id ? own.id : dup.id, bId: own.id < dup.id ? dup.id : own.id, confidence: 80 } });
    await ia(sa())(`/v1/admin/master/candidates/${c2.id}/decide`, { decision: 'MERGE', keepId: dup.id });
    expect((await t.prisma.masterMerchant.findUniqueOrThrow({ where: { id: own.id } })).status).toBe('ACTIVE'); // the registered record survived
    expect((await t.prisma.masterMerchant.findUniqueOrThrow({ where: { id: dup.id } })).status).toBe('MERGED');
  });

  it('controlled products need a REGISTERED merchant: a referenced master record can never be a fulfilling merchant or sponsor', async () => {
    const referencedId = state.nouveau!;
    const deal = await w.createHot('A', w.hotContent('A', 3, { commercial: { fulfilmentOrganizationId: referencedId } }));
    const c = (await w.api(w.ownerA).get(`/v1/merchants/${w.A.orgId}/commercial/case`).query({ product: 'EXCLUSIVE', subjectId: deal.id })).body.data;
    expect(c.blockers.map((b: { code: string }) => b.code)).toContain('FULFILMENT_NOT_ONBOARDED');
    expect(await t.prisma.organization.count({ where: { id: referencedId } })).toBe(0);
    // and an organization cannot be created or log in from master data: there are no memberships for a master record
    expect(await t.prisma.organizationMembership.count({ where: { organizationId: referencedId } })).toBe(0);
  });

  it('source of truth: approved local data is never silently overwritten; the policy decides and a person resolves conflicts', async () => {
    await ingest(state.visaKey!, [merchant('visa-c1', 'Cafe One', { nameAr: 'كافيه ون' })]);
    const m = (await master('Cafe One'))[0]!;
    // Admin pins a local value
    const ov = await ia(sa())('/v1/admin/master/overrides', { entityType: 'MERCHANT', entityId: m.id, field: 'nameEn', value: 'Cafe One (DealDash)', kind: 'PERMANENT', reason: 'Trading name confirmed by the merchant' });
    expect(ov.status, JSON.stringify(ov.body)).toBe(201);
    expect((await w.api(sa()).get(`/v1/admin/master/merchants/${m.id}`)).body.data.nameEn).toBe('Cafe One (DealDash)');
    // the feed now says something else: the local value stays and an open conflict is recorded (once)
    const r1 = await ingest(state.visaKey!, [merchant('visa-c1', 'Cafe One Updated', { nameAr: 'كافيه ون' })]);
    expect(r1.body.data.conflicts).toBe(1);
    const r2 = await ingest(state.visaKey!, [merchant('visa-c1', 'Cafe One Updated Again', { nameAr: 'كافيه ون' })]);
    expect(r2.body.data.conflicts).toBe(0);
    const open = ((await w.api(sa()).get('/v1/admin/master/conflicts')).body.data as Array<Record<string, any>>).filter((c) => c.entityId === m.id);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ field: 'nameEn', sourceValue: 'Cafe One Updated Again', localValue: 'Cafe One (DealDash)', policy: 'MANUAL_REVIEW', status: 'OPEN' });
    const cur = (await w.api(sa()).get(`/v1/admin/master/merchants/${m.id}`)).body.data;
    expect(cur.nameEn).toBe('Cafe One (DealDash)');
    expect(cur.sources[0].overrideStatus).toBe('PENDING_RECONCILIATION');
    expect((await ia(w.ops)(`/v1/admin/master/conflicts/${open[0]!.id}/resolve`, { resolution: 'SOURCE_WINS' })).status).toBe(403);
    // the source wins this time: the value is applied, the override ends, the source is authoritative again
    expect((await ia(sa())(`/v1/admin/master/conflicts/${open[0]!.id}/resolve`, { resolution: 'SOURCE_WINS', note: 'Merchant renamed' })).status).toBe(200);
    expect((await w.api(sa()).get(`/v1/admin/master/merchants/${m.id}`)).body.data.nameEn).toBe('Cafe One Updated Again');
    expect((await ia(sa())(`/v1/admin/master/conflicts/${open[0]!.id}/resolve`, { resolution: 'SOURCE_WINS' })).status).toBe(409);
    await ingest(state.visaKey!, [merchant('visa-c1', 'Cafe One Final', { nameAr: 'كافيه ون' })]);
    expect((await w.api(sa()).get(`/v1/admin/master/merchants/${m.id}`)).body.data.nameEn).toBe('Cafe One Final');

    // a TEMPORARY override protects the value only until its end date
    const tmp = await ia(sa())('/v1/admin/master/overrides', { entityType: 'MERCHANT', entityId: m.id, field: 'categoryCode', value: 'cafes', kind: 'TEMPORARY', validUntil: iso(2), reason: 'Seasonal category' });
    expect(tmp.status).toBe(201);
    expect((await ia(sa())('/v1/admin/master/overrides', { entityType: 'MERCHANT', entityId: m.id, field: 'categoryCode', value: 'x', kind: 'TEMPORARY', reason: 'no end date' })).status).toBe(400);
    expect((await ingest(state.visaKey!, [merchant('visa-c1', 'Cafe One Final', { nameAr: 'كافيه ون', categoryCode: 'dining' })])).body.data.conflicts).toBe(1);
    await t.prisma.$executeRaw`UPDATE "EntityOverride" SET "validUntil" = now() - interval '1 hour' WHERE "id" = ${tmp.body.data.id}::uuid`;
    await t.prisma.dataConflict.updateMany({ where: { entityId: m.id, field: 'categoryCode' }, data: { status: 'RESOLVED', resolution: 'DEALDASH_WINS' } });
    await ingest(state.visaKey!, [merchant('visa-c1', 'Cafe One Final', { nameAr: 'كافيه ون', categoryCode: 'dining' })]);
    expect((await w.api(sa()).get(`/v1/admin/master/merchants/${m.id}`)).body.data.categoryCode).toBe('dining');

    // a REGISTERED merchant is the authority on its own data: the feed cannot rename it
    const own = (await w.api(sa()).get('/v1/admin/master/merchants').query({ registration: 'REGISTERED', limit: 100 })).body.data.find((x: { organizationId: string }) => x.organizationId === w.B.orgId);
    const bName = own.nameEn as string;
    await ingest(state.visaKey!, [merchant('visa-beta', bName)]);
    await ia(sa())(`/v1/admin/master/merchants/${(await master(bName)).find((x) => x.registration === 'REFERENCED')!.id}/link-registered`, { organizationId: w.B.orgId });
    const rr = await ingest(state.visaKey!, [merchant('visa-beta', `${bName} Renamed By Feed`)]);
    expect(rr.body.data.accepted).toBe(1);
    expect((await w.api(sa()).get(`/v1/admin/master/merchants/${own.id}`)).body.data.nameEn).toBe(bName);
    const kept = await t.prisma.dataConflict.findFirst({ where: { entityId: own.id, field: 'nameEn' } });
    expect(kept).toMatchObject({ policy: 'MERCHANT_WINS', status: 'RESOLVED' });
  });

  it('one source cannot touch another source\'s records, and a business cannot publish on its own authority', async () => {
    const takeover = await ingest(state.mcKey!, [merchant('visa-c1', 'Hijacked Cafe')]);
    // same source system name "mastercard" is a different namespace: it creates its own record instead of touching Visa's
    expect(takeover.body.data.accepted).toBe(1);
    expect((await master('Cafe One'))[0]!.nameEn).not.toBe('Hijacked Cafe');
    // two organizations using the same source system name cannot overwrite each other
    const imposter = await connect(partnerOrg2, 'visa');
    const res = await ingest(imposter.apiKey, [merchant('visa-m1', 'Cafe Nouveau Hacked')]);
    expect(res.body.data.rejected).toBe(1);
    expect(res.body.data.failures[0].error).toMatch(/another organization/i);
    expect((await w.api(sa()).get(`/v1/admin/master/merchants/${state.nouveau}`)).body.data.nameEn).toBe('Cafe Nouveau');

    // a partner needs the API_ACCESS feature, and cannot authorise publication itself
    expect((await ia(partner)(`/v1/orgs/${partnerOrg}/integrations`, { name: 'x', sourceSystem: 'self' })).status).toBe(403);
    const ct = await ia(sa())('/v1/admin/platform/contracts', { organizationId: partnerOrg, name: 'Visa plan', entitlements: [{ kind: 'FEATURE', key: 'API_ACCESS' }, { kind: 'FEATURE', key: 'BULK_IMPORT' }, { kind: 'FEATURE', key: 'WEBHOOKS' }, { kind: 'PRODUCT', key: 'LIVE_DEAL' }] });
    expect(ct.status, JSON.stringify(ct.body)).toBe(201);
    const own = await ia(partner)(`/v1/orgs/${partnerOrg}/integrations`, { name: 'Visa self-service', sourceSystem: 'visa-self', publicationAuthorized: true, publicationRef: 'I-SAY-SO' });
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    expect(own.body.data.publicationAuthorized).toBe(false);
    expect(own.body.data.publicationRef).toBeNull();
    await ingest(own.body.data.apiKey, [merchant('s1', 'Self Served Cafe'), { type: 'OFFER', sourceRecordId: 'so1', sourceMerchantId: 's1', titleEn: 'Self offer', benefitEn: '10% off', validFrom: iso(-1), validUntil: iso(5) }]);
    const visible = (await t.http.get('/v1/app/network-offers').query({ q: 'Self offer' })).body.data as Array<unknown>;
    expect(visible).toEqual([]); // no publication authorisation: never shown to customers

    // tenant isolation
    expect((await w.api(partner2).get(`/v1/orgs/${partnerOrg}/integrations`)).status).toBe(404);
    expect((await w.api(partner2).get(`/v1/orgs/${partnerOrg2}/integrations/${own.body.data.id}/health`)).status).toBe(404);
    expect((await w.api(w.financeA).get(`/v1/orgs/${w.A.orgId}/integrations`)).status).toBe(403);
    const mine = (await w.api(partner).get(`/v1/orgs/${partnerOrg}/integrations`)).body.data as Array<{ name: string }>;
    expect(mine.map((c) => c.name)).toContain('Visa self-service');
    expect(mine.map((c) => c.name)).not.toContain('mastercard feed');
  });

  it('bulk import: upload, validate, normalise, detect duplicates, preview, error report, approval by a different person, execute once', async () => {
    // a partner needs the BULK_IMPORT feature (granted above) and sees only its own jobs
    const header = 'source_record_id,name_en,name_ar,brand,country,category';
    const csv = [
      header,
      'imp-1,Pizza Corner,بيتزا كورنر,Corner Group,SA,dining',
      'imp-2,"Burger ""House"", Olaya",برجر هاوس,,SA,dining',
      ',Missing Id,,,SA,',
      'imp-1,Pizza Corner Again,,,SA,',
      'imp-3,Pizza Corner,,,SA,dining',
      'imp-4,,,,SA,',
      'imp-5,Sushi Place,,,SAUDI,',
      "imp-6,McDonald's Riyadh,,,SA,dining",
    ].join('\n');
    const up = await ia(partner)(`/v1/orgs/${partnerOrg}/imports`, { kind: 'MERCHANTS', sourceSystem: 'visa-file', fileName: 'merchants.csv', csv, publicationRef: 'CONTRACT-FILE-1' });
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    state.importId = up.body.data.id;
    expect(up.body.data).toMatchObject({ status: 'VALIDATED', requiresApproval: true });
    expect(up.body.data.totals).toMatchObject({ rows: 7 + 1, valid: 2, errors: 3, duplicates: 1 });
    expect(up.body.data.totals.warnings).toBeGreaterThanOrEqual(2);

    const rows = (await w.api(partner).get(`/v1/orgs/${partnerOrg}/imports/${state.importId}/rows`)).body.data as Array<{ rowNumber: number; status: string; action: string | null; errors: string[] }>;
    expect(rows.find((r) => r.rowNumber === 2)).toMatchObject({ status: 'VALID', action: 'CREATE' });
    expect(rows.find((r) => r.rowNumber === 5)!.status).toBe('DUPLICATE');
    expect(rows.find((r) => r.rowNumber === 4)!.errors.join(' ')).toMatch(/sourceRecordId/);
    expect(rows.find((r) => r.rowNumber === 7)!.errors.join(' ')).toMatch(/nameEn/);
    expect(rows.find((r) => r.rowNumber === 8)!.errors.join(' ')).toMatch(/country/);
    expect(rows.find((r) => r.rowNumber === 6)!.errors.join(' ')).toMatch(/POSSIBLE_DUPLICATE_IN_FILE/);
    const report = await w.api(partner).get(`/v1/orgs/${partnerOrg}/imports/${state.importId}/errors.csv`);
    const reportText = JSON.parse(report.text).data as string;
    expect(reportText).toMatch(/^row,status,reasons/);
    expect(reportText).toContain('4,ERROR');
    // nothing was imported by the upload
    expect(await master('Pizza Corner')).toHaveLength(0);

    // unknown columns and duplicate files are refused
    expect((await ia(partner)(`/v1/orgs/${partnerOrg}/imports`, { kind: 'MERCHANTS', sourceSystem: 'visa-file', csv: `${header},colour\nx,y,z,,SA,,red` })).status).toBe(400);
    expect((await ia(partner)(`/v1/orgs/${partnerOrg}/imports`, { kind: 'MERCHANTS', sourceSystem: 'visa-file', csv })).status).toBe(409);
    // another business does not see it
    expect((await w.api(partner2).get(`/v1/orgs/${partnerOrg}/imports/${state.importId}`)).status).toBe(404);
    expect((await w.api(partner2).get(`/v1/orgs/${partnerOrg2}/imports/${state.importId}`)).status).toBe(404);

    // a business import always needs DealDash approval, by someone else
    expect((await ia(partner)(`/v1/orgs/${partnerOrg}/imports/${state.importId}/submit`)).body.data.status).toBe('PENDING_APPROVAL');
    expect((await ia(admin2)(`/v1/admin/imports/${state.importId}/execute`)).status).toBe(409); // not approved yet
    expect((await ia(w.ops)(`/v1/admin/imports/${state.importId}/approve`)).status).toBe(403);
    const reject = await ia(admin2)(`/v1/admin/imports/${state.importId}/reject`, {});
    expect(reject.status).toBe(400); // a reason is required
    const ok = await ia(admin2)(`/v1/admin/imports/${state.importId}/approve`, { reason: 'Checked against the contract' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.status).toBe('APPROVED');
    const done = await ia(admin2)(`/v1/admin/imports/${state.importId}/execute`);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data).toMatchObject({ status: 'COMPLETED' });
    expect(done.body.data.totals).toMatchObject({ imported: 4 });
    expect((await ia(admin2)(`/v1/admin/imports/${state.importId}/execute`)).status).toBe(409); // once only
    const pizza = await master('Pizza Corner');
    // the second 'Pizza Corner' (a different source id) is imported as its own record and suggested as a possible duplicate
    expect(pizza.length).toBe(2);
    expect(pizza.find((p) => p.sources[0].sourceRecordId === 'imp-1')!.sources[0]).toMatchObject({ sourceSystem: 'visa-file', importMethod: 'BULK', publicationConfirmed: true });
    expect((await master("Burger \"House\", Olaya")).length).toBe(1); // quoted commas and quotes survive
    expect((await master('Missing Id')).length).toBe(0);
    expect((await w.api(partner).get(`/v1/orgs/${partnerOrg}/imports/${state.importId}`)).body.data.status).toBe('COMPLETED');
    // the McDonald's row was queued for duplicate review, not merged
    const cands = (await w.api(sa()).get('/v1/admin/master/candidates')).body.data as Array<Record<string, any>>;
    expect(cands.some((c) => [c.a.nameEn, c.b.nameEn].includes("McDonald's Riyadh"))).toBe(true);
    const audit = await t.prisma.auditLog.findMany({ where: { entityId: state.importId, action: { in: ['IMPORT_UPLOADED', 'IMPORT_SUBMITTED', 'IMPORT_APPROVED', 'IMPORT_EXECUTED'] } } });
    expect(audit.map((a) => a.action).sort()).toEqual(['IMPORT_APPROVED', 'IMPORT_EXECUTED', 'IMPORT_SUBMITTED', 'IMPORT_UPLOADED']);
    expect(audit.every((a) => a.scope && a.source === 'IMPORT')).toBe(true);
  });

  it('Admin imports: a large file needs a second Admin; the uploader cannot approve their own import', async () => {
    const rows = ['source_record_id,name_en,country'];
    for (let i = 0; i < 205; i++) rows.push(`big-${i},Bulk Merchant ${String.fromCharCode(97 + (i % 26))}${i},SA`);
    const up = await ia(sa())('/v1/admin/imports', { kind: 'MERCHANTS', sourceSystem: 'admin-file', csv: rows.join('\n') });
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    expect(up.body.data).toMatchObject({ requiresApproval: true, organizationId: null });
    const id = up.body.data.id as string;
    expect((await ia(sa())(`/v1/admin/imports/${id}/submit`)).body.data.status).toBe('PENDING_APPROVAL');
    const self = await ia(sa())(`/v1/admin/imports/${id}/approve`, {});
    expect(self.status).toBe(403);
    expect(self.body.errors[0].code).toBe('APPROVAL_REQUIRED');
    expect((await ia(admin2)(`/v1/admin/imports/${id}/approve`, {})).status).toBe(200);
    const done = await ia(sa())(`/v1/admin/imports/${id}/execute`);
    expect(done.body.data.totals.imported).toBe(205);
    expect(await t.prisma.externalEntityReference.count({ where: { sourceSystem: 'admin-file', importMethod: 'BULK' } })).toBe(205);

    // a small Admin file needs no second approver, but still goes through the same steps
    const small = await ia(sa())('/v1/admin/imports', { kind: 'MERCHANTS', sourceSystem: 'admin-file2', csv: 'source_record_id,name_en\nsm-1,Small Merchant\n' });
    expect(small.body.data.requiresApproval).toBe(false);
    expect((await ia(sa())(`/v1/admin/imports/${small.body.data.id}/submit`)).body.data.status).toBe('APPROVED');
    expect((await ia(sa())(`/v1/admin/imports/${small.body.data.id}/execute`)).body.data.status).toBe('COMPLETED');
    // an import with nothing valid cannot be submitted
    const empty = await ia(sa())('/v1/admin/imports', { kind: 'MERCHANTS', sourceSystem: 'admin-file3', csv: 'source_record_id,name_en\nbad-1,\n' });
    expect((await ia(sa())(`/v1/admin/imports/${empty.body.data.id}/submit`)).status).toBe(409);
    expect((await ia(sa())(`/v1/admin/imports/${empty.body.data.id}/cancel`)).status).toBe(200);
  });

  it('offers by file: needs known merchants (bad rows stay errors), and only offers with publication rights are ever shown', async () => {
    const hdr = 'source_record_id,source_merchant_id,title_en,benefit_en,channel,valid_from,valid_until';
    const day = (d: number) => new Date(Date.now() + d * 864e5).toISOString();
    const csv = [hdr, `off-1,imp-1,Two for one,Buy one get one,IN_STORE,${day(-1)},${day(10)}`, `off-2,missing-merchant,Orphan,x,IN_STORE,${day(-1)},${day(10)}`, `off-3,imp-1,Bad dates,x,IN_STORE,${day(5)},${day(1)}`].join('\n');
    const withRights = await ia(partner)(`/v1/orgs/${partnerOrg}/imports`, { kind: 'OFFERS', sourceSystem: 'visa-file', csv, publicationRef: 'CONTRACT-FILE-1' });
    expect(withRights.status, JSON.stringify(withRights.body)).toBe(201);
    expect(withRights.body.data.totals).toMatchObject({ valid: 2, errors: 1 });
    const id = withRights.body.data.id as string;
    await ia(partner)(`/v1/orgs/${partnerOrg}/imports/${id}/submit`);
    expect((await ia(admin2)(`/v1/admin/imports/${id}/approve`, {})).status).toBe(200);
    const run = await ia(admin2)(`/v1/admin/imports/${id}/execute`);
    expect(run.body.data.totals).toMatchObject({ imported: 1, failedOnImport: 1 });    const shown = (await t.http.get('/v1/app/network-offers').query({ q: 'Two for one' })).body.data as Array<Record<string, any>>;
    expect(shown).toHaveLength(1);
    expect(shown[0]!.merchant).toMatchObject({ nameEn: 'Pizza Corner', registered: false });
    expect(JSON.stringify(shown)).not.toMatch(/sourceRecordId|publicationRef|visa-file|CONTRACT/);
    // the same kind of file WITHOUT a publication reference is stored but never shown
    const hidden = await ia(sa())('/v1/admin/imports', { kind: 'OFFERS', sourceSystem: 'visa-file2', csv: [hdr, `off-9,imp-9,Hidden deal,x,IN_STORE,${day(-1)},${day(10)}`].join('\n') });
    expect(hidden.body.data.totals.errors).toBe(0);
    await ia(sa())('/v1/admin/imports', { kind: 'MERCHANTS', sourceSystem: 'visa-file2', csv: 'source_record_id,name_en\nimp-9,Hidden Diner\n' }).then(async (m) => {
      await ia(sa())(`/v1/admin/imports/${m.body.data.id}/submit`);
      await ia(sa())(`/v1/admin/imports/${m.body.data.id}/execute`);
    });
    await ia(sa())(`/v1/admin/imports/${hidden.body.data.id}/submit`);
    await ia(sa())(`/v1/admin/imports/${hidden.body.data.id}/execute`);
    expect(await t.prisma.referencedOffer.count({ where: { titleEn: 'Hidden deal' } })).toBe(1);
    expect(((await t.http.get('/v1/app/network-offers').query({ q: 'Hidden deal' })).body.data as unknown[]).length).toBe(0);
  });

  it('network offers are shown only while EVERY condition holds (rights, active source, fresh feed, dates, active merchant)', async () => {
    const q = (text: string) => t.http.get('/v1/app/network-offers').query({ q: text }).then((r) => r.body.data as Array<unknown>);
    // Cafe Nouveau's offer (Visa API connection: authorised, active, fresh)
    expect(await q('20% off dinner')).toHaveLength(1);
    const offer = await t.prisma.referencedOffer.findFirstOrThrow({ where: { titleEn: '20% off dinner' } });
    const restore = async () => {
      await t.prisma.referencedOffer.update({ where: { id: offer.id }, data: { validFrom: new Date(Date.now() - 864e5), validUntil: new Date(Date.now() + 30 * 864e5), status: 'ACTIVE' } });
      await t.prisma.integrationConnection.update({ where: { id: state.visaId! }, data: { status: 'ACTIVE', publicationAuthorized: true } });
      await t.prisma.externalEntityReference.updateMany({ where: { entityId: offer.id }, data: { publicationConfirmed: true, syncStatus: 'SYNCED' } });
      await t.prisma.masterMerchant.update({ where: { id: offer.merchantId }, data: { status: 'ACTIVE' } });
    };
    const hides = async (fn: () => Promise<unknown>) => {
      await fn();
      expect(await q('20% off dinner')).toHaveLength(0);
      await restore();
      expect(await q('20% off dinner')).toHaveLength(1);
    };
    await hides(() => t.prisma.referencedOffer.update({ where: { id: offer.id }, data: { validUntil: new Date(Date.now() - 1000) } })); // expired
    await hides(() => t.prisma.referencedOffer.update({ where: { id: offer.id }, data: { validFrom: new Date(Date.now() + 864e5) } })); // not started
    await hides(() => t.prisma.referencedOffer.update({ where: { id: offer.id }, data: { status: 'WITHDRAWN' } }));
    await hides(() => t.prisma.integrationConnection.update({ where: { id: state.visaId! }, data: { status: 'PAUSED' } })); // source not active
    await hides(() => t.prisma.integrationConnection.update({ where: { id: state.visaId! }, data: { publicationAuthorized: false } })); // rights withdrawn
    await hides(() => t.prisma.externalEntityReference.updateMany({ where: { entityId: offer.id }, data: { publicationConfirmed: false } }));
    await hides(() => t.prisma.masterMerchant.update({ where: { id: offer.merchantId }, data: { status: 'INACTIVE' } }));

    // a stale feed hides its offers; the sweep flags them, a fresh sync restores them
    await t.prisma.$executeRaw`UPDATE "IntegrationConnection" SET "staleAfterMinutes" = 5, "lastSuccessfulSyncAt" = now() - interval '2 hours' WHERE "id" = ${state.visaId!}::uuid`;
    const health = (await w.api(sa()).get(`/v1/admin/integrations/${state.visaId}/health`)).body.data;
    expect(health.stale).toBe(true);
    expect(await t.app.get(IntegrationService).markStale()).toBeGreaterThan(0);
    expect(await q('20% off dinner')).toHaveLength(0);
    // staleness is a property of the feed: any successful sync makes its records current again
    await ingest(state.visaKey!, [merchant('visa-m1', 'Cafe Nouveau')]);
    await t.app.get(IntegrationService).markStale();
    expect(await q('20% off dinner')).toHaveLength(1);
  });
  it('outbound webhooks: signed, retried with back-off, dead-lettered after the maximum, never lost', async () => {
    const svc = t.app.get(IntegrationService);
    const c = await connect(partnerOrg2, 'hooked');
    const ep = await ia(sa())(`/v1/admin/integrations/${c.id}/webhooks`, { url: 'https://partner.example/hooks', events: ['records.rejected'] });
    expect(ep.status, JSON.stringify(ep.body)).toBe(201);
    const secret = ep.body.data.secret as string;
    expect(secret).toBeTruthy();
    expect((await t.prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: ep.body.data.id } })).secretEnc).not.toContain(secret);
    await ingest(c.apiKey, [{ type: 'WIDGET' }]);
    const q = await t.prisma.webhookDelivery.findMany({ where: { endpointId: ep.body.data.id } });
    expect(q).toHaveLength(1);
    expect(q[0]!.event).toBe('records.rejected');
    // unsubscribed events are not queued
    await ingest(c.apiKey, [merchant('hk-1', 'Hooked Merchant')]);
    expect(await t.prisma.webhookDelivery.count({ where: { endpointId: ep.body.data.id } })).toBe(1);

    const seen: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
    const failing = async (url: string, body: string, headers: Record<string, string>) => {
      seen.push({ url, body, headers });
      return { ok: false, status: 500 };
    };
    let now = new Date();
    expect(await svc.deliverDue(failing, now)).toMatchObject({ delivered: 0, failed: 1 });
    // not due again until the back-off passes
    expect(await svc.deliverDue(failing, now)).toMatchObject({ delivered: 0, failed: 0, dead: 0 });
    const afterFirst = await t.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: q[0]!.id } });
    expect(afterFirst.attempts).toBe(1);
    expect(afterFirst.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
    for (let i = 0; i < 3; i++) {
      now = new Date(now.getTime() + 7 * 3600_000);
      await svc.deliverDue(failing, now);
    }
    now = new Date(now.getTime() + 7 * 3600_000);
    expect(await svc.deliverDue(failing, now)).toMatchObject({ dead: 1 });
    const dead = await t.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: q[0]!.id } });
    expect(dead).toMatchObject({ status: 'DEAD', attempts: 5 });
    // the signature is verifiable with the endpoint secret and covers timestamp and body
    const s = seen[0]!;
    const expected = createHmac('sha256', secret).update(`${s.headers['X-DealDash-Timestamp']}.${s.body}`).digest('hex');
    expect(s.headers['X-DealDash-Signature']).toBe(`v1=${expected}`);
    expect(JSON.parse(s.body)).toMatchObject({ event: 'records.rejected', data: { rejected: 1 } });

    // a healthy endpoint gets the event once
    await ingest(c.apiKey, [{ type: 'WIDGET' }]);
    const ok = await svc.deliverDue(async () => ({ ok: true, status: 200 }), new Date());
    expect(ok.delivered).toBe(1);
    expect(await svc.deliverDue(async () => ({ ok: true, status: 200 }), new Date())).toMatchObject({ delivered: 0 });
  });

  it('master data is for DealDash staff only, and the Admin screens respect read versus manage', async () => {
    expect((await w.api(w.ownerA).get('/v1/admin/master/merchants')).status).toBeGreaterThanOrEqual(401);
    expect((await w.api(w.marketing).get('/v1/admin/master/merchants')).status).toBe(403);
    expect((await w.api(w.ops).get('/v1/admin/master/merchants')).status).toBe(200);
    expect((await w.api(w.ops).get('/v1/admin/master/candidates')).status).toBe(200);
    expect((await ia(w.ops)('/v1/admin/integrations', { name: 'x', sourceSystem: 'y' })).status).toBe(403);
    expect((await w.api(w.ops).get('/v1/admin/imports')).status).toBe(403);
    const svc = t.app.get(MasterService);
    expect(await svc.normalize("McDonald's KSA")).toBe('mcdonalds');
  });
});
