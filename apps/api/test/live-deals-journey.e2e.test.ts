import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DealLifecycleService } from '../src/live-deals/lifecycle.service';
import {
  DB_READY,
  call,
  createTestApp,
  idem,
  pngBytes,
  validContent,
  type TestApp,
} from './helpers';
import { buildWorld, type World } from './deal-fixtures';

/**
 * The complete Stage 3 journey, step by step, through the public API only (plus the clock for scheduling):
 *   Merchant: create, EN + AR content, branches, image, submit
 *   Admin: review, request changes
 *   Merchant: correct, resubmit
 *   Admin: approve
 *   System: scheduled -> live
 *   Customer: discover, open the deal, view the merchant, get directions
 *   Merchant: sees measurable engagement
 *   Audit: complete history
 */
describe.skipIf(!DB_READY)('Stage 3 end-to-end journey', () => {
  let t: TestApp;
  let w: World;
  beforeAll(async () => {
    t = await createTestApp();
    w = await buildWorld(t);
  });
  afterAll(() => t?.close());

  it('runs the whole journey and leaves a complete, ordered audit trail', async () => {
    const owner = call(t, w.ownerA);
    const base = `/v1/merchants/${w.A.orgId}`;

    // ---------------------------------------------------------------- merchant: create
    const options = await owner.get(`${base}/deal-options`);
    const dining = options.body.data.categories.find((c: { code: string }) => c.code === 'dining');
    expect(dining.nameAr).toBe('المطاعم');

    const draft = await owner.post(`${base}/live-deals`).set('Idempotency-Key', idem()).send({});
    expect(draft.status).toBe(201);
    const id = draft.body.data.id as string;
    expect(draft.body.data.status).toBe('DRAFT');

    // image: intent -> direct upload -> completion check
    const bytes = pngBytes(900, 560);
    const intent = await owner
      .post(`${base}/deal-media/intent`)
      .send({ fileName: 'tasting.png', mimeType: 'image/png', sizeBytes: bytes.length });
    expect(intent.status).toBe(200);
    expect(
      (
        await t.http
          .put(new URL(intent.body.data.uploadUrl).pathname)
          .set('Content-Type', 'image/png')
          .send(bytes)
      ).status,
    ).toBe(200);
    const done = await owner
      .post(`${base}/deal-media/${intent.body.data.fileId}/complete`)
      .send({});
    expect(done.status).toBe(200);

    // English + Arabic content, branches, schedule (starts in an hour -> SCHEDULED), terms, eligibility
    const startsAt = new Date(Date.now() + 3600_000).toISOString();
    const endsAt = new Date(Date.now() + 8 * 86400_000).toISOString();
    const content = validContent({
      categoryId: dining.id,
      branchIds: w.A.branchIds,
      fileId: intent.body.data.fileId,
      overrides: {
        startAt: startsAt,
        endAt: endsAt,
        terms: {
          blocks: {
            fullPriceItemsOnly: true,
            notCombinable: false,
            validDays: [],
            minimumSpendHalalas: null,
            validFrom: null,
            validTo: null,
          },
          textEn: 'Valid on full-price items.',
          textAr: 'صالح على الأصناف بالسعر الكامل.',
        },
      },
    });
    const saved = await owner
      .put(`${base}/live-deals/${id}`)
      .send({ content, expectedVersion: draft.body.data.version });
    expect(saved.status).toBe(200);
    expect(saved.body.data.deal.translation.complete).toBe(true);

    // the merchant previews exactly what customers will see, in both languages
    const preview = await owner.get(`${base}/live-deals/${id}/preview`);
    expect(preview.body.data.title.ar).toBe('خصم 30% على قائمة التذوق');
    expect(preview.body.data.branches).toHaveLength(2);

    // before submitting: the guardrail panel says it will be reviewed
    const view = await owner.get(`${base}/live-deals/${id}`);
    expect(view.body.data.guardrail.outcome).toBe('MANUAL_REVIEW');

    const submit1 = await w.submit(w.ownerA, w.A.orgId, id);
    expect(submit1.body.data.outcome).toBe('SENT_FOR_REVIEW');

    // ---------------------------------------------------------------- admin: review -> request changes
    const queue = await call(t, w.ops).get('/v1/admin/live-deals?queue=true&limit=100');
    expect(queue.body.data.some((r: { id: string }) => r.id === id)).toBe(true);
    const claimed = await call(t, w.ops).get(`/v1/admin/live-deals/${id}`);
    expect(claimed.body.data.merchant.id).toBe(w.A.orgId);
    expect(claimed.body.data.preview.title.en).toBe('30% off the tasting menu');
    const changes = await w.decide(w.ops, id, 'request-changes', {
      reason: 'Please add an Arabic alt text for the photo.',
      reasonAr: 'يرجى إضافة نص بديل عربي للصورة.',
      fields: ['media'],
    });
    expect(changes.body.data.status).toBe('NEEDS_CHANGES');

    // ---------------------------------------------------------------- merchant: correct and resubmit
    const afterFeedback = await owner.get(`${base}/live-deals/${id}`);
    expect(afterFeedback.body.data.latestDecision.reason).toContain('alt text');
    const fixed = await owner.put(`${base}/live-deals/${id}`).send({
      content: {
        ...content,
        media: [
          {
            fileId: intent.body.data.fileId,
            altEn: 'Tasting menu plates',
            altAr: 'أطباق قائمة التذوق',
          },
        ],
      },
    });
    expect(fixed.status).toBe(200);
    const submit2 = await w.submit(w.ownerA, w.A.orgId, id);
    expect(submit2.body.data.deal.status).toBe('PENDING_REVIEW');

    // ---------------------------------------------------------------- admin: approve -> scheduled
    const approved = await w.decide(w.ops, id, 'approve', {
      reason: 'Content is complete and accurate.',
      reasonAr: 'المحتوى كامل ودقيق.',
    });
    expect(approved.body.data.status).toBe('SCHEDULED'); // starts in an hour
    expect(await w.visibleDealIds(w.A.orgId)).not.toContain(id);

    // ---------------------------------------------------------------- system: scheduled -> live
    await t.prisma.liveDeal.update({
      where: { id },
      data: { startAt: new Date(Date.now() - 60_000) },
    });
    await t.app.get(DealLifecycleService).sweep();
    expect((await t.prisma.liveDeal.findUniqueOrThrow({ where: { id } })).status).toBe('LIVE');

    // ---------------------------------------------------------------- customer: discover -> open -> merchant -> directions
    const customer = await w.newCustomer();
    const anon = 'journey-device-0001';
    const feed = await t.http.get(
      `/v1/app/search?q=${encodeURIComponent('tasting menu')}&lat=24.7136&lng=46.6753`,
    );
    const card = feed.body.data.deals.find((d: { id: string }) => d.id === id);
    expect(card).toBeTruthy();
    expect(card.title.ar).toBe('خصم 30% على قائمة التذوق');
    await t.http
      .post('/v1/app/events')
      .send({ events: [{ type: 'IMPRESSION', dealId: id, anonymousId: anon }] });

    const detail = await call(t, customer).get(`/v1/app/live-deals/${id}?lat=24.7136&lng=46.6753`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.media[0].alt.ar).toBe('أطباق قائمة التذوق');
    expect(detail.body.data.redemption.mode).toBe('GENERAL');
    await t.http
      .post('/v1/app/events')
      .send({ events: [{ type: 'DETAIL_VIEW', dealId: id, anonymousId: anon }] });

    const merchantPage = await t.http.get(`/v1/app/merchants/${w.A.orgId}`);
    expect(merchantPage.body.data.deals.map((d: { id: string }) => d.id)).toContain(id);
    await t.http.post('/v1/app/events').send({
      events: [
        {
          type: 'MERCHANT_PAGE_VIEW',
          merchantId: w.A.orgId,
          sourceDealId: id,
          anonymousId: anon,
        },
      ],
    });

    const branch = detail.body.data.branches[0];
    expect(branch.latitude).not.toBeNull(); // directions need coordinates
    await t.http.post('/v1/app/events').send({
      events: [{ type: 'DIRECTIONS_CLICK', dealId: id, branchId: branch.id, anonymousId: anon }],
    });
    await call(t, customer).post(`/v1/app/saved/live-deals/${id}`).send({});

    // ---------------------------------------------------------------- merchant: measurable engagement
    const perf = await owner.get(`${base}/live-deals/${id}/performance`);
    expect(perf.body.data.totals).toEqual({
      impressions: 1,
      detailViews: 1,
      merchantPageViews: 1,
      saves: 1,
      unsaves: 0,
      directionsClicks: 1,
    });
    expect(JSON.stringify(perf.body.data).toLowerCase()).not.toMatch(/revenue|sales|conversion/);

    // ---------------------------------------------------------------- audit: complete history
    const history = await t.prisma.liveDealHistory.findMany({
      where: { dealId: id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.map((h) => h.action)).toEqual([
      'CREATE',
      'UPDATE',
      'SUBMIT',
      'REQUEST_CHANGES',
      'UPDATE',
      'SUBMIT',
      'APPROVE',
      'ACTIVATE',
    ]);
    expect(history.map((h) => h.toStatus ?? h.fromStatus)).toEqual([
      'DRAFT',
      'DRAFT',
      'PENDING_REVIEW',
      'NEEDS_CHANGES',
      'NEEDS_CHANGES',
      'PENDING_REVIEW',
      'SCHEDULED',
      'LIVE',
    ]);
    const audit = await t.prisma.auditLog.findMany({
      where: { entityType: 'LiveDeal', entityId: id },
      orderBy: { occurredAt: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual([
      'live_deal.create',
      'live_deal.update',
      'live_deal.submit',
      'live_deal.request_changes',
      'live_deal.update',
      'live_deal.submit',
      'live_deal.approve',
      'live_deal.activate',
    ]);
    const humans = audit.filter((a) => a.actorRole !== 'SYSTEM');
    for (const a of humans) {
      expect(a.actorUserId, a.action).toBeTruthy();
      expect(a.actorRole, a.action).toBeTruthy();
      expect(a.requestId, a.action).toBeTruthy();
      expect(a.occurredAt, a.action).toBeInstanceOf(Date);
    }
    expect(
      audit
        .filter((a) => ['live_deal.request_changes', 'live_deal.approve'].includes(a.action))
        .every((a) => a.actorRole === 'DEALDASH_OPERATIONS' && !!a.reason),
    ).toBe(true);
    expect(audit[audit.length - 1]!.actorRole).toBe('SYSTEM');
    // the uploaded image is audited too
    expect(
      await t.prisma.auditLog.count({
        where: { action: 'file.uploaded', entityId: intent.body.data.fileId },
      }),
    ).toBe(1);

    // DealDash can read the same trail through the API
    const trail = await call(t, w.ops).get(`/v1/admin/live-deals/${id}/audit`);
    expect(trail.status).toBe(200);
    expect(trail.body.data.length).toBeGreaterThanOrEqual(8);
    const adminDetail = await call(t, w.ops).get(`/v1/admin/live-deals/${id}`);
    expect(adminDetail.body.data.history.length).toBe(8);
    // while the merchant sees the same history without staff names
    const merchantHistory = await owner.get(`${base}/live-deals/${id}/history`);
    expect(merchantHistory.body.data).toHaveLength(8);
    expect(
      merchantHistory.body.data
        .filter((h: any) => h.byDealDash)
        .every((h: any) => h.actorName === null),
    ).toBe(true);
  });
});
