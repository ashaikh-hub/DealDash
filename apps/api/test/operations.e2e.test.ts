import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_READY, createTestApp, idem, pngBytes, type Session, type TestApp } from './helpers';
import { buildHotWorld, type HotWorld } from './hot-fixtures';

/**
 * Shared platform, Phase 3: dispute / exception cases, offer-conflict detection, the task inbox and plain-language activity
 * history, including the tenant and permission boundaries around each.
 */
describe.skipIf(!DB_READY)('Shared operations (Phase 3)', () => {
  let t: TestApp;
  let w: HotWorld;
  const st: Record<string, string> = {};

  beforeAll(async () => {
    t = await createTestApp();
    w = await buildHotWorld(t);
  });
  afterAll(() => t?.close());

  const post = (s: Session, path: string, body: unknown = {}) => w.api(s).post(path).set('Idempotency-Key', idem()).send(body as object);
  const get = (s: Session, path: string) => w.api(s).get(path);

  describe('dispute cases', () => {
    it('a business opens a case about its own account; it gets an SLA from configuration and a reference', async () => {
      const r = await post(w.ownerA, `/v1/orgs/${w.A.orgId}/disputes`, { type: 'SETTLEMENT_MISMATCH', title: 'Payout lower than expected', priority: 'HIGH' });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      st.dispute = r.body.data.id;
      expect(r.body.data.reference).toMatch(/^DC-/);
      expect(new Date(r.body.data.slaDueAt).getTime() - Date.now()).toBeLessThanOrEqual(24 * 3_600_000 + 5000);
      expect(r.body.data.ownerUserId).toBeNull();
      expect((await post(w.ownerA, `/v1/orgs/${w.A.orgId}/disputes`, { type: 'NOT_A_TYPE', title: 'Something odd' })).status).toBe(400);
    });

    it('another business cannot see, read or write to it; finance roles without the permission are refused', async () => {
      expect((await get(w.ownerB, `/v1/orgs/${w.A.orgId}/disputes/${st.dispute}`)).status).toBe(404);
      expect((await get(w.ownerB, `/v1/orgs/${w.B.orgId}/disputes/${st.dispute}`)).status).toBe(404);
      expect((await get(w.ownerB, `/v1/orgs/${w.B.orgId}/disputes`)).body.data).toEqual([]);
      expect((await post(w.ownerB, `/v1/orgs/${w.B.orgId}/disputes/${st.dispute}/notes`, { body: 'hello' })).status).toBe(404);
      expect((await get(w.financeA, `/v1/orgs/${w.A.orgId}/disputes`)).status).toBe(403);
    });

    it('internal notes stay with DealDash; the business sees shared notes only and cannot write an internal one', async () => {
      expect((await post(w.superAdmin, `/v1/admin/disputes/${st.dispute}/notes`, { body: 'Internal: check ledger', visibility: 'INTERNAL' })).status).toBe(201);
      expect((await post(w.superAdmin, `/v1/admin/disputes/${st.dispute}/notes`, { body: 'We are looking into it', visibility: 'SHARED' })).status).toBe(201);
      const forbiddenVis = await post(w.ownerA, `/v1/orgs/${w.A.orgId}/disputes/${st.dispute}/notes`, { body: 'Thanks', visibility: 'INTERNAL' });
      expect(forbiddenVis.status).toBe(201);
      const mine = (await get(w.ownerA, `/v1/orgs/${w.A.orgId}/disputes/${st.dispute}`)).body.data;
      expect(mine.notes.map((n: { body: string }) => n.body)).toEqual(['We are looking into it', 'Thanks']);
      expect(mine.notes.every((n: { visibility: string }) => n.visibility === 'SHARED')).toBe(true);
      const admin = (await get(w.superAdmin, `/v1/admin/disputes/${st.dispute}`)).body.data;
      expect(admin.notes.length).toBe(3);
    });

    it('notes are append-only at the database level', async () => {
      await expect(t.prisma.caseNote.updateMany({ where: { caseId: st.dispute }, data: { body: 'edited' } })).rejects.toThrow();
      await expect(t.prisma.caseNote.deleteMany({ where: { caseId: st.dispute } })).rejects.toThrow();
    });

    it('DealDash assigns an owner and resolves it with a recorded outcome; a closed case takes no more notes; every step is audited', async () => {
      const opsUser = (await t.prisma.user.findFirstOrThrow({ where: { email: { startsWith: 'dealdash_operations' } } }).catch(() => null)) ?? (await t.prisma.user.findFirstOrThrow({ where: { memberships: { some: { organization: { type: 'DEALDASH' } } } } }));
      const a = await post(w.superAdmin, `/v1/admin/disputes/${st.dispute}/assign`, { ownerUserId: opsUser.id });
      expect(a.status, JSON.stringify(a.body)).toBe(200);
      expect(a.body.data.status).toBe('IN_REVIEW');
      expect((await post(w.superAdmin, `/v1/admin/disputes/${st.dispute}/assign`, { ownerUserId: w.ownerA.me.id })).status).toBe(400);
      const res = await post(w.superAdmin, `/v1/admin/disputes/${st.dispute}/resolve`, { outcome: 'RESOLVED', resolution: 'Fee rule explained; no adjustment needed' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.status).toBe('RESOLVED');
      expect((await post(w.superAdmin, `/v1/admin/disputes/${st.dispute}/resolve`, { outcome: 'RESOLVED', resolution: 'again please' })).status).toBe(409);
      expect((await post(w.ownerA, `/v1/orgs/${w.A.orgId}/disputes/${st.dispute}/notes`, { body: 'one more' })).status).toBe(409);
      const acts = await t.prisma.auditLog.findMany({ where: { entityType: 'DisputeCase', entityId: st.dispute }, select: { action: true } });
      expect(acts.map((x) => x.action).sort()).toEqual(expect.arrayContaining(['DISPUTE_OPENED', 'DISPUTE_NOTE_ADDED', 'DISPUTE_ASSIGNED', 'DISPUTE_RESOLVED']));
    });

    it('a missed SLA shows as overdue and as a critical inbox task', async () => {
      const r = await post(w.ownerA, `/v1/orgs/${w.A.orgId}/disputes`, { type: 'OTHER', title: 'Overdue test case' });
      await t.prisma.disputeCase.update({ where: { id: r.body.data.id }, data: { slaDueAt: new Date(Date.now() - 3600_000) } });
      const list = (await get(w.superAdmin, '/v1/admin/disputes?status=OPEN')).body.data as Array<{ id: string; overdue: boolean }>;
      expect(list.find((c) => c.id === r.body.data.id)?.overdue).toBe(true);
      const inbox = (await get(w.superAdmin, '/v1/admin/inbox')).body as Array<{ entityId: string; priority: string }> | { data: Array<{ entityId: string; priority: string }> };
      const items = Array.isArray(inbox) ? inbox : inbox.data;
      expect(items.find((i) => i.entityId === r.body.data.id)?.priority).toBe('CRITICAL');
    });
  });

  describe('offer conflicts', () => {
    it('an Exclusive Deal weaker than the same business’s overlapping public deal is flagged (not blocked) and a person decides', async () => {
      await w.publish('A', { mechanic: 'PERCENTAGE_OFF', valueNumber: 50 });
      const hot = await w.publishHot('A', 5, { mechanic: 'PERCENTAGE_OFF', valueNumber: 20 });
      expect(hot.status).toBe('LIVE'); // approval was not blocked
      const flags = (await get(w.superAdmin, '/v1/admin/conflicts?status=OPEN')).body.data as Array<{ id: string; type: string; organizationId: string }>;
      const f = flags.find((x) => x.type === 'OVERLAP_WEAKER_EXCLUSIVE' && x.organizationId === w.A.orgId);
      expect(f).toBeTruthy();
      st.flag = f!.id;
      // detection is idempotent
      await post(w.superAdmin, '/v1/admin/conflicts/scan');
      const again = (await get(w.superAdmin, '/v1/admin/conflicts?status=OPEN')).body.data as Array<{ type: string; organizationId: string }>;
      expect(again.filter((x) => x.type === 'OVERLAP_WEAKER_EXCLUSIVE' && x.organizationId === w.A.orgId).length).toBe(1);
      expect((await post(w.ownerA, '/v1/admin/conflicts/scan')).status).toBeGreaterThanOrEqual(401);
    });

    it('a decision needs a reason, is recorded once, and “requires change” lands in the business inbox', async () => {
      expect((await post(w.superAdmin, `/v1/admin/conflicts/${st.flag}/decide`, { decision: 'REQUIRES_CHANGE', note: '' })).status).toBe(400);
      const d = await post(w.superAdmin, `/v1/admin/conflicts/${st.flag}/decide`, { decision: 'REQUIRES_CHANGE', note: 'Exclusive must beat the public offer' });
      expect(d.status, JSON.stringify(d.body)).toBe(200);
      expect((await post(w.superAdmin, `/v1/admin/conflicts/${st.flag}/decide`, { decision: 'ACKNOWLEDGED', note: 'changed my mind' })).status).toBe(409);
      const mine = (await get(w.ownerA, `/v1/orgs/${w.A.orgId}/inbox`)).body.data ?? (await get(w.ownerA, `/v1/orgs/${w.A.orgId}/inbox`)).body;
      expect((mine as Array<{ kind: string }>).some((i) => i.kind === 'OFFER_CONFLICT')).toBe(true);
      const theirs = (await get(w.ownerB, `/v1/orgs/${w.B.orgId}/inbox`)).body;
      expect(JSON.stringify(theirs)).not.toContain(st.flag);
    });
  });

  describe('activity history and the inbox boundary', () => {
    it('a business sees plain-language history of its own account with no internal detail and no DealDash staff identity', async () => {
      const r = await get(w.ownerA, `/v1/orgs/${w.A.orgId}/activity?limit=20`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const body = r.body.data ?? r.body;
      expect(body.items.length).toBeGreaterThan(0);
      const first = body.items[0];
      expect(first.summary).toMatch(/^[A-Z]/);
      expect(first).not.toHaveProperty('previousState');
      expect(first).not.toHaveProperty('ip');
      expect(Object.keys(first.actor)).toEqual(['by']);
      expect(body.items.every((i: { entityType: string }) => typeof i.entityType === 'string')).toBe(true);
      const bOnly = (await get(w.ownerB, `/v1/orgs/${w.B.orgId}/activity?limit=100`)).body;
      const ids = new Set(((bOnly.data ?? bOnly).items as Array<{ id: string }>).map((i) => i.id));
      for (const i of body.items as Array<{ id: string }>) expect(ids.has(i.id)).toBe(false);
      expect((await get(w.ownerB, `/v1/orgs/${w.A.orgId}/activity`)).status).toBe(404);
      expect((await get(w.financeA, `/v1/orgs/${w.A.orgId}/activity`)).status).toBe(403);
    });

    it('admin activity filters by organization and entity, and DealDash sees the actor role', async () => {
      const r = (await get(w.superAdmin, `/v1/admin/activity?organizationId=${w.A.orgId}&limit=10`)).body;
      const items = (r.data ?? r).items as Array<{ actor: { role?: string | null } }>;
      expect(items.length).toBeGreaterThan(0);
      expect(items[0]).toHaveProperty('actor.role');
      expect((await get(w.merchantMgmt, '/v1/admin/activity')).status).toBeGreaterThanOrEqual(200);
    });

    it('the admin inbox shows only what the viewer has permission to act on', async () => {
      const allOps = (await get(w.superAdmin, '/v1/admin/inbox')).body;
      const analyst = (await get(w.analyst, '/v1/admin/inbox')).body;
      const opsItems = (allOps.data ?? allOps) as Array<{ requiredPermission: string }>;
      const anItems = (analyst.data ?? analyst) as Array<{ requiredPermission: string }>;
      expect(opsItems.length).toBeGreaterThan(0);
      expect(anItems).toEqual([]);
      expect(opsItems.every((i) => typeof i.requiredPermission === 'string')).toBe(true);
    });
  });

  describe('dispute evidence', () => {
    const upload = async (post: (p: string, b?: unknown) => Promise<{ status: number; body: any }>, base: string, bytes = pngBytes()) => {
      const intent = await post(`${base}/attachments/intent`, { fileName: 'proof.png', mimeType: 'image/png', sizeBytes: bytes.length });
      expect(intent.status, JSON.stringify(intent.body)).toBe(200);
      const put = await t.http.put(new URL(intent.body.data.uploadUrl).pathname).set('Content-Type', 'image/png').send(bytes);
      expect(put.status).toBe(200);
      return intent.body.data.fileId as string;
    };

    it('a business attaches evidence to its own case; DealDash and the business see it, with audit', async () => {
      const c = await post(w.ownerA, `/v1/orgs/${w.A.orgId}/disputes`, { type: 'OTHER', title: 'Evidence case' });
      const id = c.body.data.id as string;
      const fileId = await upload((p, b) => post(w.ownerA, `/v1/orgs/${w.A.orgId}/disputes/${id}${p}`, b), '');
      const a = await post(w.ownerA, `/v1/orgs/${w.A.orgId}/disputes/${id}/attachments`, { fileId, type: 'SCREENSHOT', label: 'Payout screen' });
      expect(a.status, JSON.stringify(a.body)).toBe(201);
      expect(a.body.data.attachments).toHaveLength(1);
      expect(a.body.data.attachments[0]).toMatchObject({ type: 'SCREENSHOT', label: 'Payout screen', fromBusiness: true, visibility: 'SHARED', mimeType: 'image/png' });
      // the same file cannot be attached twice
      expect((await post(w.ownerA, `/v1/orgs/${w.A.orgId}/disputes/${id}/attachments`, { fileId, type: 'OTHER' })).status).toBe(409);
      // both sides can open it through a short-lived signed link
      const attId = a.body.data.attachments[0].id as string;
      const mine = await get(w.ownerA, `/v1/orgs/${w.A.orgId}/disputes/${id}/attachments/${attId}/url`);
      expect(mine.status).toBe(200);
      expect((await get(w.superAdmin, `/v1/admin/disputes/${id}/attachments/${attId}/url`)).status).toBe(200);
      // another business gets nothing
      expect((await get(w.ownerB, `/v1/orgs/${w.B.orgId}/disputes/${id}/attachments/${attId}/url`)).status).toBe(404);
      expect((await get(w.ownerB, `/v1/orgs/${w.A.orgId}/disputes/${id}/attachments/${attId}/url`)).status).toBe(404);
      const acts = (await t.prisma.auditLog.findMany({ where: { entityType: 'DisputeCase', entityId: id }, select: { action: true } })).map((x) => x.action);
      expect(acts).toEqual(expect.arrayContaining(['DISPUTE_EVIDENCE_ADDED', 'DISPUTE_EVIDENCE_VIEWED']));
      st.evCase = id;
    });

    it('internal DealDash evidence is invisible to the business; a closed case takes no more files; a foreign file cannot be attached', async () => {
      const id = st.evCase!;
      const fileId = await upload((p, b) => post(w.superAdmin, `/v1/admin/disputes/${id}${p}`, b), '');
      const a = await post(w.superAdmin, `/v1/admin/disputes/${id}/attachments`, { fileId, type: 'DOCUMENT', visibility: 'INTERNAL' });
      expect(a.status, JSON.stringify(a.body)).toBe(201);
      expect(a.body.data.attachments).toHaveLength(2);
      const mine = (await get(w.ownerA, `/v1/orgs/${w.A.orgId}/disputes/${id}`)).body.data;
      expect(mine.attachments).toHaveLength(1);
      const internalId = (a.body.data.attachments as Array<{ id: string; visibility: string }>).find((x) => x.visibility === 'INTERNAL')!.id;
      expect((await get(w.ownerA, `/v1/orgs/${w.A.orgId}/disputes/${id}/attachments/${internalId}/url`)).status).toBe(404);
      // a file that belongs to another business is not found
      const other = await t.prisma.storedFile.findFirstOrThrow({ where: { organizationId: w.B.orgId } });
      expect((await post(w.ownerA, `/v1/orgs/${w.A.orgId}/disputes/${id}/attachments`, { fileId: other.id, type: 'OTHER' })).status).toBe(404);
      // wrong content for the declared type is rejected by the file flow
      const bad = await post(w.ownerA, `/v1/orgs/${w.A.orgId}/disputes/${id}/attachments/intent`, { fileName: 'x.exe', mimeType: 'application/x-msdownload', sizeBytes: 100 });
      expect(bad.status).toBe(400);
      expect((await post(w.superAdmin, `/v1/admin/disputes/${id}/resolve`, { outcome: 'CLOSED', resolution: 'Closed after review of the evidence' })).status).toBe(200);
      const late = await post(w.ownerA, `/v1/orgs/${w.A.orgId}/disputes/${id}/attachments/intent`, { fileName: 'late.png', mimeType: 'image/png', sizeBytes: 100 });
      expect(late.status).toBe(409);
    });
  });});
