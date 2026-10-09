import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DB_READY,
  type TestApp,
  createTestApp,
  createLiveMerchant,
  createBusinessUser,
  passwordSession,
} from './helpers';
import { buildWorld, type World } from './deal-fixtures';
import { DealLifecycleService } from '../src/live-deals/lifecycle.service';
import { SystemConfigService } from '../src/system-config/system-config.service';

describe.skipIf(!DB_READY)('Live Deals: merchant create, edit, validation', () => {
  let t: TestApp;
  let w: World;
  beforeAll(async () => {
    t = await createTestApp();
    w = await buildWorld(t);
  });
  afterAll(() => t?.close());

  it('creates an empty draft with no input and records history and audit', async () => {
    const res = await w
      .api(w.ownerA)
      .post(`/v1/merchants/${w.A.orgId}/live-deals`)
      .set('Idempotency-Key', 'idem-empty-001')
      .send({});
    expect(res.status).toBe(201);
    const d = res.body.data;
    expect(d.status).toBe('DRAFT');
    expect(d.content.redemptionMode).toBe('GENERAL');
    expect(d.allowedActions).toEqual(expect.arrayContaining(['edit', 'submit']));
    expect(d.issues.length).toBeGreaterThan(0);
    const history = await t.prisma.liveDealHistory.findMany({ where: { dealId: d.id } });
    expect(history.map((h) => h.action)).toEqual(['CREATE']);
    const audit = await t.prisma.auditLog.findMany({
      where: { entityType: 'LiveDeal', entityId: d.id },
    });
    expect(audit.map((a) => a.action)).toContain('live_deal.create');
    expect(audit[0]!.actorOrganizationId).toBe(w.A.orgId);
    expect(audit[0]!.subjectOrganizationId).toBe(w.A.orgId);
  });

  it('requires an Idempotency-Key and replays the same response for the same key', async () => {
    const noKey = await w.api(w.ownerA).post(`/v1/merchants/${w.A.orgId}/live-deals`).send({});
    expect(noKey.status).toBe(400);
    const a = await w
      .api(w.ownerA)
      .post(`/v1/merchants/${w.A.orgId}/live-deals`)
      .set('Idempotency-Key', 'idem-replay-01')
      .send({});
    const b = await w
      .api(w.ownerA)
      .post(`/v1/merchants/${w.A.orgId}/live-deals`)
      .set('Idempotency-Key', 'idem-replay-01')
      .send({});
    expect(a.body.data.id).toBe(b.body.data.id);
  });

  it('saves English and Arabic content and returns both languages unchanged', async () => {
    const d = await w.createDeal(w.ownerA, w.A.orgId, w.content('A'));
    expect(d.content.title).toEqual({
      en: '30% off the tasting menu',
      ar: 'خصم 30% على قائمة التذوق',
    });
    expect(d.content.description.ar).toContain('استمتع');
    expect(d.translation).toEqual({ complete: true, missing: [] });
    expect(d.issues).toEqual([]);
    const row = await t.prisma.liveDeal.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.titleAr).toBe('خصم 30% على قائمة التذوق');
    expect(row.titleEn).toBe('30% off the tasting menu');
    const list = await w.api(w.ownerA).get(`/v1/merchants/${w.A.orgId}/live-deals?limit=100`);
    const item = list.body.data.find((x: { id: string }) => x.id === d.id);
    expect(item.title.ar).toBe('خصم 30% على قائمة التذوق');
  });

  it('reports a missing language in the translation status', async () => {
    const d = await w.createDeal(
      w.ownerA,
      w.A.orgId,
      w.content('A', { title: { en: 'English only', ar: '' } }),
    );
    expect(d.translation).toEqual({ complete: false, missing: ['ar'] });
  });

  it('edits a draft and detects a version conflict', async () => {
    const d = await w.createDeal(w.ownerA, w.A.orgId, w.content('A'));
    const ok = await w
      .api(w.ownerA)
      .put(`/v1/merchants/${w.A.orgId}/live-deals/${d.id}`)
      .send({
        content: w.content('A', { title: { en: 'New title', ar: 'عنوان جديد' } }),
        expectedVersion: d.version,
      });
    expect(ok.status).toBe(200);
    expect(ok.body.data.outcome).toBe('SAVED');
    expect(ok.body.data.deal.version).toBe(d.version + 1);
    expect(ok.body.data.deal.content.title.ar).toBe('عنوان جديد');
    const stale = await w
      .api(w.ownerA)
      .put(`/v1/merchants/${w.A.orgId}/live-deals/${d.id}`)
      .send({
        content: w.content('A'),
        expectedVersion: d.version,
      });
    expect(stale.status).toBe(409);
    expect(stale.body.errors[0].code).toBe('VERSION_CONFLICT');
    const same = await w.api(w.ownerA).put(`/v1/merchants/${w.A.orgId}/live-deals/${d.id}`).send({
      content: ok.body.data.deal.content,
    });
    expect(same.body.data.deal.version).toBe(d.version + 1); // no change, no new version
  });

  it("cannot reference another merchant's branch, image or an unknown category (tenant isolation inside content)", async () => {
    const wrongBranch = await w
      .api(w.ownerA)
      .post(`/v1/merchants/${w.A.orgId}/live-deals`)
      .set('Idempotency-Key', 'idem-xbranch-1')
      .send({
        content: w.content('A', { branchIds: [w.B.branchIds[0]] }),
      });
    expect(wrongBranch.status).toBe(400);
    expect(wrongBranch.body.errors[0].field).toBe('branchIds');
    const wrongImage = await w
      .api(w.ownerA)
      .post(`/v1/merchants/${w.A.orgId}/live-deals`)
      .set('Idempotency-Key', 'idem-ximage-1')
      .send({
        content: w.content('A', { media: [{ fileId: w.fileB, altEn: '', altAr: '' }] }),
      });
    expect(wrongImage.status).toBe(400);
    expect(wrongImage.body.errors[0].field).toBe('media');
    const badCategory = await w
      .api(w.ownerA)
      .post(`/v1/merchants/${w.A.orgId}/live-deals`)
      .set('Idempotency-Key', 'idem-xcat-001')
      .send({
        content: w.content('A', { categoryId: '11111111-1111-4111-8111-111111111111' }),
      });
    expect(badCategory.status).toBe(400);
    expect(badCategory.body.errors[0].field).toBe('categoryId');
  });

  it('rejects an inactive category and unavailable partner references', async () => {
    const cat = await t.prisma.category.create({
      data: { code: `hidden_${Date.now()}`, nameEn: 'Hidden', nameAr: 'مخفي', active: false },
    });
    const r1 = await w
      .api(w.ownerA)
      .post(`/v1/merchants/${w.A.orgId}/live-deals`)
      .set('Idempotency-Key', 'idem-inactive-1')
      .send({ content: w.content('A', { categoryId: cat.id }) });
    expect(r1.status).toBe(400);
    const r2 = await w
      .api(w.ownerA)
      .post(`/v1/merchants/${w.A.orgId}/live-deals`)
      .set('Idempotency-Key', 'idem-partner-01')
      .send({
        content: w.content('A', { eligibility: { kind: 'EMPLOYER', valueRefs: [w.bank] } }), // a bank is not an employer
      });
    expect(r2.status).toBe(400);
    expect(r2.body.errors[0].field).toBe('eligibility');
  });

  it('API validation: unknown mechanic, oversized text, malformed dates, too many images and bad ids return field errors', async () => {
    const post = (content: unknown, key: string) =>
      w
        .api(w.ownerA)
        .post(`/v1/merchants/${w.A.orgId}/live-deals`)
        .set('Idempotency-Key', key)
        .send({ content });
    const mech = await post({ mechanic: 'FREE_LUNCH' }, 'idem-val-mech-1');
    expect(mech.status).toBe(400);
    expect(mech.body.errors[0].code).toBe('VALIDATION_FAILED');
    expect(mech.body.errors[0].field).toBe('content.mechanic');
    const long = await post({ title: { en: 'x'.repeat(81), ar: '' } }, 'idem-val-long-1');
    expect(long.status).toBe(400);
    const date = await post({ startAt: 'tomorrow' }, 'idem-val-date-1');
    expect(date.status).toBe(400);
    const imgs = await post(
      { media: Array.from({ length: 6 }, () => ({ fileId: w.fileA })) },
      'idem-val-imgs-1',
    );
    expect(imgs.status).toBe(400);
    const bad = await w.api(w.ownerA).get(`/v1/merchants/${w.A.orgId}/live-deals/not-a-uuid`);
    expect(bad.status).toBe(400);
    const unknownField = await post({ nonsense: true }, 'idem-val-unk-01');
    expect(unknownField.status).toBe(201); // unknown keys are stripped, never stored
  });

  it('submitting an incomplete deal lists every missing field', async () => {
    const d = await w.createDeal(w.ownerA, w.A.orgId, { title: { en: 'Just a title', ar: '' } });
    const res = await w.submit(w.ownerA, w.A.orgId, d.id);
    expect(res.status).toBe(422);
    const fields = res.body.errors.map((e: { field: string }) => e.field);
    for (const f of [
      'categoryId',
      'mechanic',
      'title',
      'description',
      'media',
      'branchIds',
      'startAt',
      'terms.textEn',
    ])
      expect(fields).toContain(f);
    expect(res.body.errors[0].code).toBe('DEAL_INCOMPLETE');
    const still = await t.prisma.liveDeal.findUniqueOrThrow({ where: { id: d.id } });
    expect(still.status).toBe('DRAFT');
  });

  it('rejects an end date before the start date and an end date in the past on submit', async () => {
    const d = await w.createDeal(
      w.ownerA,
      w.A.orgId,
      w.content('A', {
        startAt: new Date(Date.now() - 10 * 3600_000).toISOString(),
        endAt: new Date(Date.now() - 5 * 3600_000).toISOString(),
      }),
    );
    const res = await w.submit(w.ownerA, w.A.orgId, d.id);
    expect(res.status).toBe(422);
    expect(
      res.body.errors.some((e: { field: string; message: string }) => e.field === 'endAt'),
    ).toBe(true);
  });

  it('general deals have no claim, QR or reservation: controlled redemption is not enabled by default', async () => {
    const res = await w
      .api(w.ownerA)
      .post(`/v1/merchants/${w.A.orgId}/live-deals`)
      .set('Idempotency-Key', 'idem-ctrl-0001')
      .send({
        content: w.content('A', { redemptionMode: 'CONTROLLED' }),
      });
    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('CONTROLLED_NOT_ENABLED');
    const d = await w.createDeal(w.ownerA, w.A.orgId, w.content('A'));
    expect(d.content.redemptionMode).toBe('GENERAL');
    // no claim/reservation/QR routes exist for live deals
    const claim = await w
      .api(w.ownerA)
      .post(`/v1/merchants/${w.A.orgId}/live-deals/${d.id}/claim`)
      .send({});
    expect(claim.status).toBe(404);
  });

  it('requires at least one active branch to submit', async () => {
    const m = await createLiveMerchant(t.prisma, 'Closed Branch Co', [
      { lat: 24.71, lng: 46.67 },
      { lat: 24.72, lng: 46.68 },
    ]);
    const owner = await passwordSession(
      t,
      await createBusinessUser(t.prisma, {
        role: 'MERCHANT_OWNER',
        orgId: m.orgId,
        userType: 'MERCHANT_USER',
      }),
      'merchant',
    );
    const file = (
      await t.prisma.storedFile.create({
        data: {
          organizationId: m.orgId,
          kind: 'DEAL_IMAGE',
          originalName: 'a.png',
          mimeType: 'image/png',
          declaredSize: 10,
          sizeBytes: 10,
          storageKey: `k/${m.orgId}`,
          status: 'AVAILABLE',
        },
      })
    ).id;
    const d = await w.createDeal(owner, m.orgId, {
      ...w.content('A'),
      branchIds: [m.branchIds[0]],
      media: [{ fileId: file, altEn: '', altAr: '' }],
    });
    await t.prisma.merchantBranch.update({
      where: { id: m.branchIds[0]! },
      data: { status: 'CLOSED' },
    });
    const res = await w.submit(owner, m.orgId, d.id);
    expect(res.status).toBe(422);
    expect(res.body.errors[0].field).toBe('branchIds');
  });
});

describe.skipIf(!DB_READY)(
  'Live Deals: review loop, rejection, scheduling, expiry, pause and suspend',
  () => {
    let t: TestApp;
    let w: World;
    beforeAll(async () => {
      t = await createTestApp();
      w = await buildWorld(t);
    });
    afterAll(() => t?.close());

    it('submit moves a draft to PENDING_REVIEW, locks editing and shows it in the Admin queue', async () => {
      const d = await w.createDeal(w.ownerA, w.A.orgId, w.content('A'));
      const sub = await w.submit(w.ownerA, w.A.orgId, d.id);
      expect(sub.status).toBe(200);
      expect(sub.body.data.outcome).toBe('SENT_FOR_REVIEW');
      expect(sub.body.data.deal.status).toBe('PENDING_REVIEW');
      expect(sub.body.data.deal.allowedActions).toEqual([]);
      const edit = await w
        .api(w.ownerA)
        .put(`/v1/merchants/${w.A.orgId}/live-deals/${d.id}`)
        .send({ content: w.content('A') });
      expect(edit.status).toBe(409);
      expect(edit.body.errors[0].code).toBe('EDIT_LOCKED');
      const queue = await w.api(w.ops).get('/v1/admin/live-deals?queue=true&limit=100');
      expect(queue.status).toBe(200);
      const row = queue.body.data.find((r: { id: string }) => r.id === d.id);
      expect(row.kind).toBe('NEW');
      expect(row.merchant.id).toBe(w.A.orgId);
      expect(row.title.ar).toBe('خصم 30% على قائمة التذوق');
    });

    it('Admin sees everything needed to review: merchant, branches, both languages, eligibility, dates, terms and the customer preview', async () => {
      const d = await w.createDeal(
        w.ownerA,
        w.A.orgId,
        w.content('A', { eligibility: { kind: 'EMPLOYER', valueRefs: [w.employer] } }),
      );
      await w.submit(w.ownerA, w.A.orgId, d.id);
      const res = await w.api(w.ops).get(`/v1/admin/live-deals/${d.id}`);
      expect(res.status).toBe(200);
      const x = res.body.data;
      expect(x.merchant.nameEn).toBe(w.A.nameEn);
      expect(x.merchant.trustLevel).toBe('NEW');
      expect(x.branches).toHaveLength(1);
      expect(x.content.title.en).toBe('30% off the tasting menu');
      expect(x.content.title.ar).toBe('خصم 30% على قائمة التذوق');
      expect(x.content.eligibility.kind).toBe('EMPLOYER');
      expect(x.content.startAt).toBeTruthy();
      expect(x.content.terms.textAr).toContain('صالح');
      expect(x.preview.title.ar).toBe(x.content.title.ar);
      expect(x.preview.eligibility.result).toBe('LOCKED_UNLOCKABLE'); // preview shows the locked label customers see
      expect(x.preview.branches).toHaveLength(1);
      expect(x.reviewTarget).toBe('DEAL');
      expect(x.adminActions).toEqual(
        expect.arrayContaining(['approve', 'request_changes', 'reject']),
      );
      expect(x.guardrail.reasons).toContain('PILOT_MANUAL_REVIEW');
    });

    it('Admin drafts are private: a draft is not visible to DealDash', async () => {
      const d = await w.createDeal(w.ownerA, w.A.orgId, w.content('A'));
      expect((await w.api(w.ops).get(`/v1/admin/live-deals/${d.id}`)).status).toBe(404);
      const all = await w.api(w.ops).get('/v1/admin/live-deals?limit=100');
      expect(all.body.data.some((r: { id: string }) => r.id === d.id)).toBe(false);
    });

    it('request changes -> merchant sees feedback -> corrects -> resubmits -> approved (full loop with decision records)', async () => {
      const d = await w.createDeal(w.ownerA, w.A.orgId, w.content('A'));
      await w.submit(w.ownerA, w.A.orgId, d.id);

      const noReason = await w.decide(w.ops, d.id, 'request-changes', {});
      expect(noReason.status).toBe(400);

      const rc = await w.decide(w.ops, d.id, 'request-changes', {
        reason: 'Please add the minimum spend to the terms.',
        reasonAr: 'يرجى إضافة الحد الأدنى للإنفاق في الشروط.',
        fields: ['terms'],
      });
      expect(rc.status).toBe(200);
      expect(rc.body.data.status).toBe('NEEDS_CHANGES');

      const merchantView = await w
        .api(w.ownerA)
        .get(`/v1/merchants/${w.A.orgId}/live-deals/${d.id}`);
      expect(merchantView.body.data.status).toBe('NEEDS_CHANGES');
      const decision = merchantView.body.data.latestDecision;
      expect(decision.action).toBe('REQUEST_CHANGES');
      expect(decision.reason).toBe('Please add the minimum spend to the terms.');
      expect(decision.reasonAr).toContain('الحد الأدنى');
      expect(decision.fields).toEqual(['terms']);
      expect(decision.actorName).toBeNull(); // DealDash staff names are not shown to merchants
      expect(decision.actorRole).toBe('DEALDASH');
      expect(merchantView.body.data.allowedActions).toEqual(
        expect.arrayContaining(['edit', 'submit']),
      );

      const fix = await w
        .api(w.ownerA)
        .put(`/v1/merchants/${w.A.orgId}/live-deals/${d.id}`)
        .send({
          content: w.content('A', {
            terms: {
              blocks: {
                fullPriceItemsOnly: true,
                notCombinable: true,
                validDays: [],
                minimumSpendHalalas: 10000,
                validFrom: null,
                validTo: null,
              },
              textEn: 'Minimum spend SAR 100. Valid on full-price items only.',
              textAr: 'الحد الأدنى للإنفاق 100 ريال. صالح على الأصناف بالسعر الكامل فقط.',
            },
          }),
        });
      expect(fix.status).toBe(200);
      expect(fix.body.data.deal.status).toBe('NEEDS_CHANGES'); // still needs changes until resubmitted

      const re = await w.submit(w.ownerA, w.A.orgId, d.id);
      expect(re.body.data.deal.status).toBe('PENDING_REVIEW');

      const ap = await w.decide(w.ops, d.id, 'approve', { reason: 'Terms are now clear.' });
      expect(ap.status).toBe(200);
      expect(ap.body.data.status).toBe('LIVE');
      expect(ap.body.data.publishedAt).toBeTruthy();

      const hist = await t.prisma.liveDealHistory.findMany({
        where: { dealId: d.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(hist.map((h) => h.action)).toEqual([
        'CREATE',
        'SUBMIT',
        'REQUEST_CHANGES',
        'UPDATE',
        'SUBMIT',
        'APPROVE',
      ]);
      const rcRow = hist.find((h) => h.action === 'REQUEST_CHANGES')!;
      expect(rcRow.actorUserId).toBeTruthy();
      expect(rcRow.actorRole).toBe('DEALDASH_OPERATIONS');
      expect(rcRow.byDealDash).toBe(true);
      expect(rcRow.reason).toContain('minimum spend');
      expect(rcRow.createdAt).toBeInstanceOf(Date);
      expect(rcRow.fromStatus).toBe('PENDING_REVIEW');
      expect(rcRow.toStatus).toBe('NEEDS_CHANGES');

      // every decision also has an audit entry with actor, reason and before/after status
      const audit = await t.prisma.auditLog.findMany({
        where: { entityType: 'LiveDeal', entityId: d.id },
        orderBy: { occurredAt: 'asc' },
      });
      const rcAudit = audit.find((a) => a.action === 'live_deal.request_changes')!;
      expect(rcAudit.actorUserId).toBe(rcRow.actorUserId);
      expect(rcAudit.reason).toContain('minimum spend');
      expect(rcAudit.previousState).toEqual({ status: 'PENDING_REVIEW' });
      expect(rcAudit.newState).toMatchObject({ status: 'NEEDS_CHANGES' });
      expect(audit.map((a) => a.action)).toEqual(
        expect.arrayContaining([
          'live_deal.create',
          'live_deal.submit',
          'live_deal.request_changes',
          'live_deal.update',
          'live_deal.approve',
        ]),
      );
    });

    it('rejection is final: the deal stays REJECTED and cannot be edited, submitted or approved again', async () => {
      const d = await w.createDeal(w.ownerA, w.A.orgId, w.content('A'));
      await w.submit(w.ownerA, w.A.orgId, d.id);
      const rj = await w.decide(w.ops, d.id, 'reject', {
        reason: 'Misleading discount claim.',
        reasonAr: 'ادعاء خصم مضلل.',
      });
      expect(rj.status).toBe(200);
      expect(rj.body.data.status).toBe('REJECTED');
      expect(
        (
          await w
            .api(w.ownerA)
            .put(`/v1/merchants/${w.A.orgId}/live-deals/${d.id}`)
            .send({ content: w.content('A') })
        ).status,
      ).toBe(409);
      expect((await w.submit(w.ownerA, w.A.orgId, d.id)).status).toBe(409);
      const again = await w.decide(w.ops, d.id, 'approve');
      expect(again.status).toBe(409);
      expect(again.body.errors[0].code).toBe('INVALID_STATE');
      expect(await w.visibleDealIds(w.A.orgId)).not.toContain(d.id);
      const mv = await w.api(w.ownerA).get(`/v1/merchants/${w.A.orgId}/live-deals/${d.id}`);
      expect(mv.body.data.latestDecision.action).toBe('REJECT');
      expect(mv.body.data.latestDecision.reasonAr).toBe('ادعاء خصم مضلل.');
    });

    it('a deal that starts in the future becomes SCHEDULED, is hidden, then goes LIVE when its start time arrives (sweep)', async () => {
      const d = await w.publish('A', {
        startAt: new Date(Date.now() + 2 * 86400_000).toISOString(),
        endAt: new Date(Date.now() + 9 * 86400_000).toISOString(),
      });
      expect(d.status).toBe('SCHEDULED');
      expect(d.discoverable.reason).toBe('NOT_STARTED');
      expect(await w.visibleDealIds(w.A.orgId)).not.toContain(d.id);
      const detail = await t.http.get(`/v1/app/live-deals/${d.id}`);
      expect(detail.status).toBe(404);

      // time passes: the start moves into the past
      await t.prisma.liveDeal.update({
        where: { id: d.id },
        data: { startAt: new Date(Date.now() - 60_000) },
      });
      const sweep = await t.app.get(DealLifecycleService).sweep();
      expect(sweep.activated).toBeGreaterThanOrEqual(1);
      const row = await t.prisma.liveDeal.findUniqueOrThrow({ where: { id: d.id } });
      expect(row.status).toBe('LIVE');
      expect(await w.visibleDealIds(w.A.orgId)).toContain(d.id);
      const hist = await t.prisma.liveDealHistory.findMany({
        where: { dealId: d.id, action: 'ACTIVATE' },
      });
      expect(hist).toHaveLength(1);
      expect(hist[0]!.byDealDash).toBe(true);
      expect(hist[0]!.actorUserId).toBeNull();
    });

    it('a live deal is hidden the moment its end date passes (even before the sweep) and then expires', async () => {
      const d = await w.publish('A');
      expect(await w.visibleDealIds(w.A.orgId)).toContain(d.id);
      const past = new Date(Date.now() - 1000);
      await t.prisma.liveDeal.update({
        where: { id: d.id },
        data: { startAt: new Date(Date.now() - 3600_000), endAt: past },
      });
      expect(await w.visibleDealIds(w.A.orgId)).not.toContain(d.id); // visibility uses the dates directly
      const sweep = await t.app.get(DealLifecycleService).sweep();
      expect(sweep.expired).toBeGreaterThanOrEqual(1);
      const row = await t.prisma.liveDeal.findUniqueOrThrow({ where: { id: d.id } });
      expect(row.status).toBe('EXPIRED');
      expect(row.endedAt).toBeTruthy();
      const mv = await w.api(w.ownerA).get(`/v1/merchants/${w.A.orgId}/live-deals/${d.id}`);
      expect(mv.body.data.allowedActions).toEqual([]);
      expect(
        (
          await w
            .api(w.ownerA)
            .put(`/v1/merchants/${w.A.orgId}/live-deals/${d.id}`)
            .send({ content: w.content('A') })
        ).status,
      ).toBe(409);
    });

    it('merchant can pause, resume and end a deal; each step changes visibility and is recorded', async () => {
      const d = await w.publish('A');
      const base = `/v1/merchants/${w.A.orgId}/live-deals/${d.id}`;
      const p = await w
        .api(w.ownerA)
        .post(`${base}/pause`)
        .send({ reason: 'Kitchen closed today' });
      expect(p.body.data.status).toBe('PAUSED');
      expect(p.body.data.pausedBy).toBe('MERCHANT');
      expect(await w.visibleDealIds(w.A.orgId)).not.toContain(d.id);
      expect((await w.api(w.ownerA).post(`${base}/pause`).send({})).status).toBe(409); // already paused
      const r = await w.api(w.ownerA).post(`${base}/resume`).send({});
      expect(r.body.data.status).toBe('LIVE');
      expect(await w.visibleDealIds(w.A.orgId)).toContain(d.id);
      const e = await w
        .api(w.ownerA)
        .post(`${base}/end`)
        .send({ reason: 'Sold out of ingredients' });
      expect(e.body.data.status).toBe('EXPIRED');
      expect(e.body.data.endedAt).toBeTruthy();
      expect(await w.visibleDealIds(w.A.orgId)).not.toContain(d.id);
      expect((await w.api(w.ownerA).post(`${base}/resume`).send({})).status).toBe(409);
      expect((await w.api(w.ownerA).post(`${base}/end`).send({})).status).toBe(400); // reason is required
      const hist = await t.prisma.liveDealHistory.findMany({
        where: { dealId: d.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(hist.map((h) => h.action)).toEqual([
        'CREATE',
        'SUBMIT',
        'APPROVE',
        'PAUSE',
        'RESUME',
        'END',
      ]);
    });

    it('DealDash pause cannot be undone by the merchant; DealDash suspend blocks every merchant action; reinstate restores', async () => {
      const d = await w.publish('A');
      const base = `/v1/merchants/${w.A.orgId}/live-deals/${d.id}`;
      const pause = await w.decide(w.ops, d.id, 'pause', { reason: 'Under investigation' });
      expect(pause.body.data.status).toBe('PAUSED');
      const mr = await w.api(w.ownerA).post(`${base}/resume`).send({});
      expect(mr.status).toBe(409);
      expect(mr.body.errors[0].message).toContain('DealDash paused');
      const resume = await w.decide(w.ops, d.id, 'resume', { reason: 'Cleared' });
      expect(resume.body.data.status).toBe('LIVE');

      const sus = await w.decide(w.ops, d.id, 'suspend', {
        reason: 'Customer complaints',
        reasonAr: 'شكاوى العملاء',
      });
      expect(sus.body.data.status).toBe('SUSPENDED');
      expect(await w.visibleDealIds(w.A.orgId)).not.toContain(d.id);
      for (const [action, body] of [
        ['resume', {}],
        ['pause', {}],
        ['end', { reason: 'x yz' }],
        ['submit', {}],
      ] as const) {
        const res = await w.api(w.ownerA).post(`${base}/${action}`).send(body);
        expect(res.status, action).toBe(409);
      }
      expect(
        (
          await w
            .api(w.ownerA)
            .put(`${base}`)
            .send({ content: w.content('A') })
        ).status,
      ).toBe(409);
      const mv = await w.api(w.ownerA).get(base);
      expect(mv.body.data.allowedActions).toEqual([]);
      expect(mv.body.data.latestDecision.action).toBe('SUSPEND');

      const back = await w.decide(w.ops, d.id, 'reinstate', { reason: 'Resolved with merchant' });
      expect(back.body.data.status).toBe('LIVE');
      expect(await w.visibleDealIds(w.A.orgId)).toContain(d.id);
    });

    it('reinstating a suspended deal whose end date has passed expires it', async () => {
      const d = await w.publish('A');
      await w.decide(w.ops, d.id, 'suspend', { reason: 'Hold' });
      await t.prisma.liveDeal.update({
        where: { id: d.id },
        data: { startAt: new Date(Date.now() - 7200_000), endAt: new Date(Date.now() - 60_000) },
      });
      const back = await w.decide(w.ops, d.id, 'reinstate', { reason: 'Released' });
      expect(back.body.data.status).toBe('EXPIRED');
    });

    it("a suspended or inactive merchant's deals are hidden immediately and return when the merchant is reactivated", async () => {
      const d = await w.publish('B');
      expect(await w.visibleDealIds(w.B.orgId)).toContain(d.id);
      await t.prisma.organization.update({
        where: { id: w.B.orgId },
        data: { status: 'SUSPENDED' },
      });
      expect(await w.visibleDealIds(w.B.orgId)).toEqual([]);
      expect((await t.http.get(`/v1/app/live-deals/${d.id}`)).status).toBe(404);
      expect((await t.http.get(`/v1/app/merchants/${w.B.orgId}`)).status).toBe(404);
      const mv = await w.api(w.ownerB).get(`/v1/merchants/${w.B.orgId}/live-deals/${d.id}`);
      expect(mv.status).toBe(403); // a suspended merchant keeps only profile/support permissions
      await t.prisma.organization.update({ where: { id: w.B.orgId }, data: { status: 'ACTIVE' } });
      expect(await w.visibleDealIds(w.B.orgId)).toContain(d.id);
    });

    it('a deal whose only branch is closed is not discoverable (and returns when the branch reopens)', async () => {
      const m = await createLiveMerchant(t.prisma, 'One Branch Co', [{ lat: 24.7, lng: 46.7 }]);
      const owner = await passwordSession(
        t,
        await createBusinessUser(t.prisma, {
          role: 'MERCHANT_OWNER',
          orgId: m.orgId,
          userType: 'MERCHANT_USER',
        }),
        'merchant',
      );
      const file = (
        await t.prisma.storedFile.create({
          data: {
            organizationId: m.orgId,
            kind: 'DEAL_IMAGE',
            originalName: 'a.png',
            mimeType: 'image/png',
            declaredSize: 10,
            sizeBytes: 10,
            storageKey: `k2/${m.orgId}`,
            status: 'AVAILABLE',
          },
        })
      ).id;
      const d = await w.createDeal(owner, m.orgId, {
        ...w.content('A'),
        branchIds: m.branchIds,
        media: [{ fileId: file, altEn: '', altAr: '' }],
      });
      await w.submit(owner, m.orgId, d.id);
      await w.decide(w.ops, d.id, 'approve');
      expect(await w.visibleDealIds(m.orgId)).toContain(d.id);
      await t.prisma.merchantBranch.update({
        where: { id: m.branchIds[0]! },
        data: { status: 'CLOSED' },
      });
      expect((await t.http.get(`/v1/app/live-deals/${d.id}`)).status).toBe(404);
      const mv = await w.api(owner).get(`/v1/merchants/${m.orgId}/live-deals/${d.id}`);
      expect(mv.body.data.discoverable.reason).toBe('NO_ACTIVE_BRANCH');
      await t.prisma.merchantBranch.update({
        where: { id: m.branchIds[0]! },
        data: { status: 'ACTIVE' },
      });
      expect((await t.http.get(`/v1/app/live-deals/${d.id}`)).status).toBe(200);
    });

    it('concurrent decisions: only one of two simultaneous approvals succeeds', async () => {
      const d = await w.createDeal(w.ownerA, w.A.orgId, w.content('A'));
      await w.submit(w.ownerA, w.A.orgId, d.id);
      const [a, b] = await Promise.all([
        w.decide(w.ops, d.id, 'approve'),
        w.decide(w.merchantMgmt, d.id, 'approve'),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const approvals = await t.prisma.liveDealHistory.count({
        where: { dealId: d.id, action: 'APPROVE' },
      });
      expect(approvals).toBe(1);
    });
  },
);

describe.skipIf(!DB_READY)('Live Deals: editing a live deal (minor vs material, revisions)', () => {
  let t: TestApp;
  let w: World;
  beforeAll(async () => {
    t = await createTestApp();
    w = await buildWorld(t);
  });
  afterAll(() => t?.close());

  const put = (id: string, content: Record<string, unknown>) =>
    w.api(w.ownerA).put(`/v1/merchants/${w.A.orgId}/live-deals/${id}`).send({ content });

  it('a minor edit (typo and translation fix) publishes immediately with an audit snapshot', async () => {
    const d = await w.publish('A');
    const res = await put(
      d.id,
      w.content('A', {
        description: {
          en: 'Enjoy 30% off the full tasting menu every evening!',
          ar: 'استمتع بخصم 30% على قائمة التذوق الكاملة كل مساءً.',
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('APPLIED_MINOR');
    expect(res.body.data.material).toEqual([]);
    expect(res.body.data.deal.content.description.en).toContain('every evening!');
    expect(res.body.data.deal.status).toBe('LIVE');
    expect(res.body.data.deal.revision).toBeNull();
    const h = await t.prisma.liveDealHistory.findFirstOrThrow({
      where: { dealId: d.id, action: 'MINOR_EDIT' },
    });
    expect(h.fields).toEqual(expect.arrayContaining(['description.en', 'description.ar']));
    const snap = h.snapshot as {
      before: { description: { en: string } };
      after: { description: { en: string } };
    };
    expect(snap.before.description.en).toBe('Enjoy 30% off the full tasting menu every evening.');
    expect(snap.after.description.en).toContain('every evening!');
    expect(
      await t.prisma.auditLog.count({ where: { entityId: d.id, action: 'live_deal.minor_edit' } }),
    ).toBe(1);
    // the customer sees the corrected text right away
    const detail = await t.http.get(`/v1/app/live-deals/${d.id}`);
    expect(detail.body.data.description.en).toContain('every evening!');
  });

  it('changing images or alt text is a minor edit', async () => {
    const d = await w.publish('A');
    const res = await put(
      d.id,
      w.content('A', {
        media: [{ fileId: w.fileA2, altEn: 'Fresh alt text', altAr: 'نص بديل جديد' }],
      }),
    );
    expect(res.body.data.outcome).toBe('APPLIED_MINOR');
  });

  it('a material edit (discount) does NOT change what customers see: it becomes a revision awaiting review', async () => {
    const d = await w.publish('A');
    const res = await put(
      d.id,
      w.content('A', {
        valueNumber: 50,
        offerLabel: { en: '50% off', ar: 'خصم 50%' },
        title: { en: '50% off the tasting menu', ar: 'خصم 50% على قائمة التذوق' },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('REVISION_SAVED');
    expect(res.body.data.material).toEqual(
      expect.arrayContaining(['valueNumber', 'offerLabel', 'title']),
    );
    const deal = res.body.data.deal;
    expect(deal.content.valueNumber).toBe(30); // the live proposition is untouched
    expect(deal.revision.status).toBe('DRAFT');
    expect(deal.revision.content.valueNumber).toBe(50);
    expect(deal.status).toBe('LIVE');
    const detail = await t.http.get(`/v1/app/live-deals/${d.id}`);
    expect(detail.body.data.offerLabel.en).toBe('30% off');
    expect(detail.body.data.title.en).toBe('30% off the tasting menu');
  });

  it('revision: submit -> queue shows REVISION -> request changes -> merchant fixes -> resubmit -> approve publishes the new version', async () => {
    const d = await w.publish('A');
    const base = `/v1/merchants/${w.A.orgId}/live-deals/${d.id}`;
    const v50 = w.content('A', {
      valueNumber: 50,
      offerLabel: { en: '50% off', ar: 'خصم 50%' },
      title: { en: '50% off the tasting menu', ar: 'خصم 50% على قائمة التذوق' },
      description: {
        en: 'Enjoy 50% off the full tasting menu.',
        ar: 'استمتع بخصم 50% على قائمة التذوق.',
      },
    });
    await put(d.id, v50);
    const sub = await w.submit(w.ownerA, w.A.orgId, d.id);
    expect(sub.body.data.outcome).toBe('SENT_FOR_REVIEW');
    expect(sub.body.data.deal.revision.status).toBe('PENDING_REVIEW');
    expect(sub.body.data.deal.status).toBe('LIVE');

    // locked while under review
    const locked = await put(d.id, v50);
    expect(locked.status).toBe(409);
    expect(locked.body.errors[0].code).toBe('EDIT_LOCKED');

    const queue = await w.api(w.ops).get('/v1/admin/live-deals?queue=true&limit=100');
    const row = queue.body.data.find((r: { id: string }) => r.id === d.id);
    expect(row.kind).toBe('REVISION');
    expect(row.title.en).toBe('50% off the tasting menu');

    const detail = await w.api(w.ops).get(`/v1/admin/live-deals/${d.id}`);
    expect(detail.body.data.reviewTarget).toBe('REVISION');
    expect(detail.body.data.preview.offerLabel.en).toBe('50% off'); // reviewers preview the proposal
    expect(detail.body.data.content.valueNumber).toBe(30); // next to the live version

    const rc = await w.decide(w.ops, d.id, 'request-changes', {
      reason: '50% is above the allowed range for new merchants.',
    });
    expect(rc.status).toBe(200);
    expect(rc.body.data.status).toBe('LIVE'); // the live deal keeps running
    expect(rc.body.data.revision.status).toBe('NEEDS_CHANGES');

    const v40 = w.content('A', {
      valueNumber: 40,
      offerLabel: { en: '40% off', ar: 'خصم 40%' },
      title: { en: '40% off the tasting menu', ar: 'خصم 40% على قائمة التذوق' },
      description: {
        en: 'Enjoy 40% off the full tasting menu.',
        ar: 'استمتع بخصم 40% على قائمة التذوق.',
      },
    });
    const fix = await put(d.id, v40);
    expect(fix.body.data.outcome).toBe('REVISION_SAVED');
    expect(fix.body.data.deal.revision.status).toBe('NEEDS_CHANGES');
    const re = await w.submit(w.ownerA, w.A.orgId, d.id);
    expect(re.body.data.deal.revision.status).toBe('PENDING_REVIEW');

    const versionBefore = (await t.prisma.liveDeal.findUniqueOrThrow({ where: { id: d.id } }))
      .version;
    const ap = await w.decide(w.ops, d.id, 'approve', { reason: 'Within range.' });
    expect(ap.status).toBe(200);
    expect(ap.body.data.content.valueNumber).toBe(40);
    expect(ap.body.data.revision).toBeNull();
    expect(ap.body.data.version).toBeGreaterThan(versionBefore);
    expect(ap.body.data.status).toBe('LIVE');
    const detailAfter = await t.http.get(`/v1/app/live-deals/${d.id}`);
    expect(detailAfter.body.data.offerLabel.en).toBe('40% off');
    const hist = await t.prisma.liveDealHistory.findMany({
      where: { dealId: d.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(hist.map((h) => h.action)).toEqual([
      'CREATE',
      'SUBMIT',
      'APPROVE',
      'REVISION_SAVED',
      'REVISION_SUBMIT',
      'REVISION_REQUEST_CHANGES',
      'UPDATE',
      'REVISION_SUBMIT',
      'REVISION_APPROVE',
    ]);
    const approveRow = hist[hist.length - 1]!;
    const snap = approveRow.snapshot as {
      before: { valueNumber: number };
      after: { valueNumber: number };
    };
    expect(snap.before.valueNumber).toBe(30);
    expect(snap.after.valueNumber).toBe(40);
    const revs = await t.prisma.liveDealRevision.findMany({ where: { dealId: d.id } });
    expect(revs).toHaveLength(1);
    expect(revs[0]!.status).toBe('APPROVED');
    expect(revs[0]!.decidedByUserId).toBeTruthy();
    void base;
  });

  it('a rejected revision leaves the live deal exactly as it was', async () => {
    const d = await w.publish('A');
    await put(d.id, w.content('A', { valueNumber: 70 }));
    await w.submit(w.ownerA, w.A.orgId, d.id);
    const rj = await w.decide(w.ops, d.id, 'reject', { reason: 'Not acceptable.' });
    expect(rj.body.data.status).toBe('LIVE');
    expect(rj.body.data.content.valueNumber).toBe(30);
    expect(rj.body.data.revision).toBeNull(); // rejected revisions are closed
    expect(
      await t.prisma.liveDealRevision.count({ where: { dealId: d.id, status: 'REJECTED' } }),
    ).toBe(1);
    // the merchant can propose again
    const again = await put(d.id, w.content('A', { valueNumber: 35 }));
    expect(again.body.data.outcome).toBe('REVISION_SAVED');
    expect(await t.prisma.liveDealRevision.count({ where: { dealId: d.id } })).toBe(2);
  });

  it('participating branches, eligibility and dates are material; the start date cannot move after the deal started', async () => {
    const d = await w.publish('A');
    const branches = await put(
      d.id,
      w.content('A', { branchIds: [w.A.branchIds[0], w.A.branchIds[1]] }),
    );
    expect(branches.body.data.outcome).toBe('REVISION_SAVED');
    expect(branches.body.data.material).toContain('branchIds');
    const live = await t.prisma.liveDealBranch.count({ where: { dealId: d.id } });
    expect(live).toBe(1); // live participation unchanged until approved
    const start = await put(
      d.id,
      w.content('A', { startAt: new Date(Date.now() + 86400_000).toISOString() }),
    );
    expect(start.status).toBe(400);
    expect(start.body.errors[0].field).toBe('startAt');
    const elig = await put(
      d.id,
      w.content('A', {
        branchIds: [w.A.branchIds[0], w.A.branchIds[1]],
        eligibility: { kind: 'EMPLOYER', valueRefs: [w.employer] },
      }),
    );
    expect(elig.body.data.material).toEqual(expect.arrayContaining(['eligibility']));
    const subm = await w.submit(w.ownerA, w.A.orgId, d.id);
    expect(subm.status, JSON.stringify(subm.body)).toBe(200);
    const appr = await w.decide(w.ops, d.id, 'approve', { reason: 'Looks fine.' });
    expect(appr.status, JSON.stringify(appr.body)).toBe(200);
    expect(await t.prisma.liveDealBranch.count({ where: { dealId: d.id } })).toBe(2); // applied on approval
    const row = await t.prisma.liveDeal.findUniqueOrThrow({
      where: { id: d.id },
      include: { ruleSet: { include: { conditions: true } } },
    });
    expect(row.eligibilityKind).toBe('EMPLOYER');
    expect(row.ruleSet?.conditions.map((c) => c.valueRef)).toEqual([w.employer]);
  });

  it('merchant can discard pending changes; reverting to the live content closes the revision', async () => {
    const d = await w.publish('A');
    await put(d.id, w.content('A', { valueNumber: 45 }));
    const back = await put(d.id, w.content('A'));
    expect(back.body.data.deal.revision).toBeNull();
    await put(d.id, w.content('A', { valueNumber: 45 }));
    const disc = await w
      .api(w.ownerA)
      .post(`/v1/merchants/${w.A.orgId}/live-deals/${d.id}/discard-revision`)
      .send({});
    expect(disc.status).toBe(200);
    expect(disc.body.data.revision).toBeNull();
    expect(
      (
        await w
          .api(w.ownerA)
          .post(`/v1/merchants/${w.A.orgId}/live-deals/${d.id}/discard-revision`)
          .send({})
      ).status,
    ).toBe(409);
  });

  it('merchant can withdraw a pending revision to edit it again', async () => {
    const d = await w.publish('A');
    await put(d.id, w.content('A', { valueNumber: 45 }));
    await w.submit(w.ownerA, w.A.orgId, d.id);
    const disc = await w
      .api(w.ownerA)
      .post(`/v1/merchants/${w.A.orgId}/live-deals/${d.id}/discard-revision`)
      .send({});
    expect(disc.body.data.revision).toBeNull();
    expect((await put(d.id, w.content('A', { valueNumber: 46 }))).status).toBe(200);
    expect(
      (await w.api(w.ops).get('/v1/admin/live-deals?queue=true&limit=100')).body.data.some(
        (r: { id: string }) => r.id === d.id,
      ),
    ).toBe(false);
  });

  it('an edit that would leave the live deal incomplete is refused', async () => {
    const d = await w.publish('A');
    const res = await put(d.id, w.content('A', { title: { en: 'Only English now', ar: '' } }));
    expect(res.status).toBe(422);
    expect(res.body.errors.some((e: { field: string }) => e.field === 'title')).toBe(true);
  });

  it('editing a paused deal follows the same rules', async () => {
    const d = await w.publish('A');
    await w.api(w.ownerA).post(`/v1/merchants/${w.A.orgId}/live-deals/${d.id}/pause`).send({});
    const minor = await put(
      d.id,
      w.content('A', {
        shortDescription: { en: 'Dinner for two, tasting menu.', ar: 'عشاء لشخصين، قائمة التذوق.' },
      }),
    );
    expect(minor.body.data.outcome).toBe('APPLIED_MINOR');
    expect(minor.body.data.deal.status).toBe('PAUSED');
  });

  it("auto-publish stays off in the pilot; when enabled, a trusted merchant's clean deal skips review (and is still audited)", async () => {
    const d = await w.createDeal(w.ownerA, w.A.orgId, w.content('A'));
    const manual = await w.submit(w.ownerA, w.A.orgId, d.id);
    expect(manual.body.data.outcome).toBe('SENT_FOR_REVIEW');

    await t.prisma.systemConfiguration.upsert({
      where: { key: 'live_deals.auto_publish' },
      update: { value: { enabled: true, minTrustLevel: 'TRUSTED' } },
      create: {
        key: 'live_deals.auto_publish',
        value: { enabled: true, minTrustLevel: 'TRUSTED' },
      },
    });
    t.app.get(SystemConfigService).invalidate();
    try {
      const d2 = await w.createDeal(w.ownerA, w.A.orgId, w.content('A'));
      const stillNew = await w.submit(w.ownerA, w.A.orgId, d2.id);
      expect(stillNew.body.data.outcome).toBe('SENT_FOR_REVIEW'); // trust level NEW is too low
      await t.prisma.merchant.update({
        where: { organizationId: w.A.orgId },
        data: { trustLevel: 'TRUSTED' },
      });
      const d3 = await w.createDeal(w.ownerA, w.A.orgId, w.content('A'));
      const auto = await w.submit(w.ownerA, w.A.orgId, d3.id);
      expect(auto.body.data.outcome).toBe('PUBLISHED');
      expect(auto.body.data.deal.status).toBe('LIVE');
      const hist = await t.prisma.liveDealHistory.findMany({
        where: { dealId: d3.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(hist.map((h) => h.action)).toEqual(['CREATE', 'AUTO_APPROVE']);
      expect(hist[1]!.byDealDash).toBe(true);
      expect(
        await t.prisma.auditLog.count({
          where: { entityId: d3.id, action: 'live_deal.auto_approve' },
        }),
      ).toBe(1);
      // too-high discounts still go to a person
      const d4 = await w.createDeal(w.ownerA, w.A.orgId, w.content('A', { valueNumber: 90 }));
      expect((await w.submit(w.ownerA, w.A.orgId, d4.id)).body.data.outcome).toBe(
        'SENT_FOR_REVIEW',
      );
    } finally {
      await t.prisma.systemConfiguration.update({
        where: { key: 'live_deals.auto_publish' },
        data: { value: { enabled: false, minTrustLevel: 'TRUSTED' } },
      });
      await t.prisma.merchant.update({
        where: { organizationId: w.A.orgId },
        data: { trustLevel: 'NEW' },
      });
      t.app.get(SystemConfigService).invalidate();
    }
  });
});
