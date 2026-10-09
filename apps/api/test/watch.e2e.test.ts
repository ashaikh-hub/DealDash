import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_READY, createTestApp, idem, type TestApp } from './helpers';
import { buildWatchWorld, type WatchWorld } from './watch-fixtures';

/** Stage 6 domain: Watch & Earn authoring, funding, review, lifecycle, live-edit rules, permissions, tenant isolation, audit. */
describe.skipIf(!DB_READY)('Watch & Earn campaigns', () => {
  let t: TestApp;
  let w: WatchWorld;
  beforeAll(async () => {
    t = await createTestApp();
    w = await buildWatchWorld(t);
  });
  afterAll(() => t?.close());

  it('creates a draft that may hold one language, but cannot be submitted until both exist and the video is set', async () => {
    const v = await w.createWatch(
      'A',
      w.watchContent('A', {
        title: { en: 'Only English', ar: '' },
        videoFileId: null,
        durationSec: null,
      }),
    );
    expect(v.status).toBe('DRAFT');
    expect(v.translation.complete).toBe(false);
    const sub = await w.submitWatch('A', v.id);
    expect(sub.status).toBe(422);
    const codes = sub.body.errors.map(
      (e: { field?: string; message?: string }) => `${e.field}:${e.message}`,
    );
    expect(codes).toEqual(expect.arrayContaining(['title:REQUIRED_AR', 'videoFileId:REQUIRED']));
  });

  it('has NO merchant-controlled reward: an extra reward field is ignored and the reward comes from DealDash rules', async () => {
    const v = await w.createWatch('A', {
      ...w.watchContent('A'),
      rewardPoints: 99999,
      pointsPerView: 500,
    });
    expect(JSON.stringify(v.content)).not.toMatch(/rewardPoints|pointsPerView/);
    const f = await w.fundWatch(w.ownerA, 'A', v.id, v.budget.requiredHalalas);
    expect(f.status).toBe(200);
    await w.submitWatch('A', v.id);
    const detail = await w.decideWatch(w.ops, v.id, 'approve');
    expect(detail.status).toBe(200);
    // 8 s video falls in the first tier of the DealDash rule (mock: 10 points)
    expect(detail.body.data.economics.rewardPoints).toBe(10);
    expect(detail.body.data.economics.chargePerViewHalalas).toBe(100);
  });

  it('uploads a real video through the managed three-step flow; the real file type is checked, not just the declared one', async () => {
    const webm = Buffer.from([
      0x1a,
      0x45,
      0xdf,
      0xa3,
      ...Array.from({ length: 200 }, (_, i) => i % 251),
    ]);
    const send = async (bytes: Buffer, mime: string) => {
      const intent = await w
        .api(w.ownerA)
        .post(`${w.wbase('A')}/watch-media/intent`)
        .send({ fileName: 'clip.webm', mimeType: mime, sizeBytes: bytes.length });
      expect(intent.status).toBe(200);
      const path = new URL(intent.body.data.uploadUrl).pathname;
      const put = await t.http.put(path).set('Content-Type', mime).send(bytes);
      expect(put.status).toBe(200);
      return w
        .api(w.ownerA)
        .post(`${w.wbase('A')}/watch-media/${intent.body.data.fileId}/complete`)
        .send({});
    };
    const ok = await send(webm, 'video/webm');
    expect(ok.status).toBe(200);
    const file = await t.prisma.storedFile.findFirstOrThrow({ where: { id: ok.body.data.fileId } });
    expect(file).toMatchObject({
      kind: 'WATCH_VIDEO',
      status: 'AVAILABLE',
      mimeType: 'video/webm',
    });
    // the new file can be attached; text pretending to be a video cannot be completed
    const v = await w.createWatch('A', w.watchContent('A', { videoFileId: file.id }));
    expect(v.content.videoFileId).toBe(file.id);
    const fake = await send(
      Buffer.from('this is not a video at all, just text'.repeat(4)),
      'video/webm',
    );
    expect(fake.status).toBe(400);
    // an unsupported type and a Finance user are refused up front
    const exe = await w
      .api(w.ownerA)
      .post(`${w.wbase('A')}/watch-media/intent`)
      .send({ fileName: 'x.mov', mimeType: 'video/quicktime', sizeBytes: 100 });
    expect(exe.status).toBe(400);
    const fin = await w
      .api(w.financeA)
      .post(`${w.wbase('A')}/watch-media/intent`)
      .send({ fileName: 'clip.webm', mimeType: 'video/webm', sizeBytes: 100 });
    expect(fin.status).toBe(403);
  });

  it('prices the budget from the DealDash rate card: paid views x charge per view (nothing is hard-coded in the merchant request)', async () => {
    const v = await w.createWatch('A', w.watchContent('A', { paidViews: 25 }));
    expect(v.budget).toMatchObject({
      paidViews: 25,
      chargePerViewHalalas: 100,
      requiredHalalas: 2500,
      fundedHalalas: 0,
      fundingRequired: true,
      unusedTreatment: 'UNDECIDED_VALIDATE_KSA',
    });
    const opts = await w.api(w.ownerA).get(`${w.wbase('A')}/watch-options`);
    expect(opts.body.data.rateCard).toMatchObject({ chargePerViewHalalas: 100, placeholder: true });
    expect(opts.body.data.minRepeatWindowHours).toBe(24);
  });

  it('explains every problem: video length, too few views, an end before the start, a looser repeat window than the platform minimum', async () => {
    // an end before the start is refused at creation
    const backwards = await w
      .api(w.ownerA)
      .post(`${w.wbase('A')}/watch`)
      .set('Idempotency-Key', idem())
      .send({
        content: w.watchContent('A', { endAt: new Date(Date.now() - 2 * 3600_000).toISOString() }),
      });
    expect(backwards.status).toBe(400);
    const v = await w.createWatch(
      'A',
      w.watchContent('A', { durationSec: 600, paidViews: 2, frequency: { repeatWindowHours: 1 } }),
    );
    const sub = await w.submitWatch('A', v.id);
    expect(sub.status).toBe(422);
    const codes = sub.body.errors.map((e: { message: string }) => e.message);
    expect(codes).toEqual(
      expect.arrayContaining(['DURATION_RANGE', 'VIEWS_RANGE', 'FREQUENCY_LOOSER']),
    );
  });

  it("rejects another merchant's video, thumbnail, branch and linked offer, and a city that is not enabled", async () => {
    const post = (content: Record<string, unknown>) =>
      w
        .api(w.ownerA)
        .post(`${w.wbase('A')}/watch`)
        .set('Idempotency-Key', idem())
        .send({ content });
    expect((await post(w.watchContent('A', { videoFileId: w.videoB }))).status).toBe(400);
    expect((await post(w.watchContent('A', { thumbnailFileId: w.fileB }))).status).toBe(400);
    expect(
      (
        await post(
          w.watchContent('A', {
            targeting: {
              cities: ['Riyadh'],
              eligibility: { kind: 'PUBLIC', valueRefs: [] },
              timeWindow: null,
              branchIds: [w.B.branchIds[0]],
            },
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await post(
          w.watchContent('A', {
            targeting: {
              cities: ['Atlantis'],
              eligibility: { kind: 'PUBLIC', valueRefs: [] },
              timeWindow: null,
              branchIds: [],
            },
          }),
        )
      ).status,
    ).toBe(400);
    const other = await w.publish('B');
    expect(
      (await post(w.watchContent('A', { link: { type: 'LIVE_DEAL', id: other.id } }))).status,
    ).toBe(400);
  });

  it('funding: an exact amount, an idempotent retry adds nothing twice, over-funding is refused, and the ledger records it', async () => {
    const v = await w.createWatch('A', w.watchContent('A'));
    const key = idem();
    const a = await w.fundWatch(w.ownerA, 'A', v.id, 600, key);
    expect(a.status).toBe(200);
    expect(a.body.data.budget.fundedHalalas).toBe(600);
    const again = await w.fundWatch(w.ownerA, 'A', v.id, 600, key);
    expect(again.body.data.budget.fundedHalalas).toBe(600); // same key: nothing added
    const over = await w.fundWatch(w.ownerA, 'A', v.id, 500);
    expect(over.status).toBe(422);
    expect((await w.fundWatch(w.ownerA, 'A', v.id, 400)).body.data.budget).toMatchObject({
      fundedHalalas: 1000,
      fundingRequired: false,
    });
    const journals = await t.prisma.ledgerJournal.findMany({
      where: { sourceType: 'WatchCampaign', sourceId: v.id, type: 'CAMPAIGN_FUNDING' },
      include: { entries: { include: { account: true } } },
    });
    expect(journals).toHaveLength(2);
    for (const j of journals) expect(j.entries.reduce((n, e) => n + e.amountHalalas, 0)).toBe(0);
    const budget = await w.api(w.ownerA).get(`${w.wbase('A')}/watch/${v.id}/budget`);
    expect(budget.body.data.funding).toHaveLength(2);
    expect(budget.body.data.disclaimerKey).toBe('legal_treatment_validate_ksa');
  });

  it('cannot be sent for review until fully funded', async () => {
    const v = await w.createWatch('A', w.watchContent('A'));
    await w.fundWatch(w.ownerA, 'A', v.id, 500);
    const sub = await w.submitWatch('A', v.id);
    expect(sub.status).toBe(402);
    expect(sub.body.errors[0].code).toBe('FUNDING_REQUIRED');
  });

  it('review: submit goes to PENDING_REVIEW; request changes shows the reason; edit and resubmit; approve makes it live; every decision is audited', async () => {
    const v = await w.createWatch('A', w.watchContent('A'));
    await w.fundWatch(w.ownerA, 'A', v.id, 1000);
    const sub = await w.submitWatch('A', v.id);
    expect(sub.status).toBe(200);
    expect(sub.body.data.outcome).toBe('SENT_FOR_REVIEW');
    const locked = await w
      .api(w.ownerA)
      .put(`${w.wbase('A')}/watch/${v.id}`)
      .send({ content: w.watchContent('A', { title: { en: 'New', ar: 'جديد' } }) });
    expect(locked.status).toBe(409);
    expect(locked.body.errors[0].code).toBe('EDIT_LOCKED');

    const ask = await w.decideWatch(w.ops, v.id, 'request-changes', {
      reason: 'Please add the opening hours to the description.',
      reasonAr: 'يرجى إضافة ساعات العمل إلى الوصف.',
    });
    expect(ask.body.data.status).toBe('NEEDS_CHANGES');
    const mine = await w.api(w.ownerA).get(`${w.wbase('A')}/watch/${v.id}`);
    expect(mine.body.data.latestDecision).toMatchObject({
      action: 'REQUEST_CHANGES',
      actorRole: 'DealDash',
      actorName: null, // merchants never see which employee decided
    });
    const edit = await w
      .api(w.ownerA)
      .put(`${w.wbase('A')}/watch/${v.id}`)
      .send({
        content: w.watchContent('A', {
          description: {
            en: 'Open daily 9 to 11. Watch how we prepare it.',
            ar: 'نفتح يومياً من 9 إلى 11. شاهد كيف نحضّره.',
          },
        }),
      });
    expect(edit.status).toBe(200);
    expect((await w.submitWatch('A', v.id)).status).toBe(200);
    const ap = await w.decideWatch(w.ops, v.id, 'approve');
    expect(ap.body.data.status).toBe('LIVE');
    expect(ap.body.data.history.map((h: { action: string }) => h.action)).toEqual(
      expect.arrayContaining(['CREATE', 'FUND', 'SUBMIT', 'REQUEST_CHANGES', 'UPDATE', 'APPROVE']),
    );
    const audit = await t.prisma.auditLog.findMany({
      where: { entityType: 'WatchCampaign', entityId: v.id },
    });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'watch.create',
        'watch.fund',
        'watch.submit',
        'watch.request_changes',
        'watch.approve',
      ]),
    );
    const trail = await w.api(w.ops).get(`/v1/admin/watch/${v.id}/audit`);
    expect(trail.body.data.length).toBeGreaterThanOrEqual(5);
  });

  it('a rejected campaign is terminal, needs a reason, and its funding is closed out to the separate unused balance', async () => {
    const v = await w.createWatch('A', w.watchContent('A'));
    await w.fundWatch(w.ownerA, 'A', v.id, 1000);
    await w.submitWatch('A', v.id);
    expect((await w.decideWatch(w.ops, v.id, 'reject', { reason: 'x' })).status).toBe(400);
    const rj = await w.decideWatch(w.ops, v.id, 'reject', {
      reason: 'The offer claim is not supported.',
    });
    expect(rj.body.data.status).toBe('REJECTED');
    expect(rj.body.data.budget).toMatchObject({
      closedOut: true,
      unusedHalalas: 1000,
      remainingHalalas: 0,
    });
    expect((await w.submitWatch('A', v.id)).status).toBe(409);
    expect((await w.decideWatch(w.ops, v.id, 'approve')).status).toBe(409);
    const release = await t.prisma.ledgerJournal.findFirst({
      where: { sourceId: v.id, type: 'CAMPAIGN_RELEASE' },
      include: { entries: { include: { account: true } } },
    });
    expect(release?.entries.map((e) => e.account.family).sort()).toEqual([
      'CAMPAIGN_BUDGET',
      'CAMPAIGN_UNUSED',
    ]);
  });

  it('after approval only wording is editable; changes to the video, audience, schedule or number of views are locked', async () => {
    const live = await w.publishWatch('A');
    const minor = await w
      .api(w.ownerA)
      .put(`${w.wbase('A')}/watch/${live.id}`)
      .send({
        content: w.watchContent('A', {
          title: { en: 'Meet our head chef', ar: 'تعرّف على كبير الطهاة' },
        }),
      });
    expect(minor.status).toBe(200);
    expect(minor.body.data.outcome).toBe('APPLIED_MINOR');
    const more = await w
      .api(w.ownerA)
      .put(`${w.wbase('A')}/watch/${live.id}`)
      .send({ content: w.watchContent('A', { paidViews: 5000 }) });
    // the number of paid views is not editable once approved: it is forced back to the approved value, so nothing changes
    expect(more.status).toBe(200);
    expect(more.body.data.campaign.content.paidViews).toBe(10);
    const cities = await w
      .api(w.ownerA)
      .put(`${w.wbase('A')}/watch/${live.id}`)
      .send({
        content: w.watchContent('A', { startAt: new Date(Date.now() + 86_400_000).toISOString() }),
      });
    expect(cities.status).toBe(409);
    expect(cities.body.errors[0].code).toBe('MATERIAL_EDIT_LOCKED');
  });

  it('pause / resume by the merchant; a DealDash pause cannot be undone by the merchant; stop closes out the unused budget', async () => {
    const live = await w.publishWatch('A');
    const p = await w
      .api(w.ownerA)
      .post(`${w.wbase('A')}/watch/${live.id}/pause`)
      .send({});
    expect(p.body.data.status).toBe('PAUSED');
    expect(p.body.data.pausedBy).toBe('MERCHANT');
    const r = await w
      .api(w.ownerA)
      .post(`${w.wbase('A')}/watch/${live.id}/resume`)
      .send({});
    expect(r.body.data.status).toBe('LIVE');
    const dd = await w.decideWatch(w.ops, live.id, 'pause', {
      reason: 'Checking the video content.',
    });
    expect(dd.body.data.status).toBe('PAUSED');
    const blocked = await w
      .api(w.ownerA)
      .post(`${w.wbase('A')}/watch/${live.id}/resume`)
      .send({});
    expect(blocked.status).toBe(409);
    expect((await w.decideWatch(w.ops, live.id, 'resume')).body.data.status).toBe('LIVE');
    const stop = await w.decideWatch(w.ops, live.id, 'stop', {
      reason: 'Policy: stopped by DealDash.',
    });
    expect(stop.body.data.status).toBe('CANCELLED');
    expect(stop.body.data.budget).toMatchObject({ closedOut: true, unusedHalalas: 1000 });
  });

  it('suspension is DealDash-only and reversible; suspended campaigns are not served', async () => {
    const live = await w.publishWatch('A');
    expect(
      (await w.decideWatch(w.ops, live.id, 'suspend', { reason: 'Under policy review.' })).body.data
        .status,
    ).toBe('SUSPENDED');
    const cancel = await w
      .api(w.ownerA)
      .post(`${w.wbase('A')}/watch/${live.id}/pause`)
      .send({});
    expect(cancel.status).toBe(409);
    const hub = await w.api(await w.newCustomer()).get('/v1/app/watch');
    expect(hub.body.data.campaigns.map((c: { id: string }) => c.id)).not.toContain(live.id);
    expect(
      (await w.decideWatch(w.ops, live.id, 'reinstate', { reason: 'Review finished.' })).body.data
        .status,
    ).toBe('LIVE');
  });

  it('merchant cancel works from draft or live; a cancelled campaign is final', async () => {
    const d = await w.createWatch('A', w.watchContent('A'));
    await w.fundWatch(w.ownerA, 'A', d.id, 300);
    const c = await w
      .api(w.ownerA)
      .post(`${w.wbase('A')}/watch/${d.id}/cancel`)
      .send({ reason: 'Changed our plans.' });
    expect(c.body.data.status).toBe('CANCELLED');
    expect(c.body.data.budget).toMatchObject({ closedOut: true, unusedHalalas: 300 });
    expect((await w.fundWatch(w.ownerA, 'A', d.id, 100)).status).toBe(409);
  });

  it('the database itself refuses spend above funding, views above the paid quantity, and a second open session per customer', async () => {
    const live = await w.publishWatch('A');
    await expect(
      t.prisma
        .$executeRaw`UPDATE "WatchCampaign" SET "spentHalalas" = 5000 WHERE "id" = ${live.id}::uuid`,
    ).rejects.toThrow();
    await expect(
      t.prisma
        .$executeRaw`UPDATE "WatchCampaign" SET "qualifiedViews" = 11 WHERE "id" = ${live.id}::uuid`,
    ).rejects.toThrow();
    const user = (await w.newCustomer()).me.id as string;
    const mk = (n: string) =>
      t.prisma.watchView.create({
        data: {
          campaignId: live.id,
          userId: user,
          deviceHash: 'd',
          tokenHash: `tok-${n}-${Math.random()}`,
          durationSec: 8,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
    await mk('1');
    await expect(mk('2')).rejects.toThrow();
  });

  it('append-only: campaign history is never edited or deleted', async () => {
    const v = await w.createWatch('A', w.watchContent('A'));
    await expect(
      t.prisma
        .$executeRaw`UPDATE "WatchCampaignHistory" SET "reason" = 'x' WHERE "campaignId" = ${v.id}::uuid`,
    ).rejects.toThrow();
    await expect(
      t.prisma.$executeRaw`DELETE FROM "WatchCampaignHistory" WHERE "campaignId" = ${v.id}::uuid`,
    ).rejects.toThrow();
  });

  it('lifecycle sweep: scheduled campaigns go live, finished ones expire and close out, abandoned sessions are closed', async () => {
    const sched = await w.createWatch(
      'A',
      w.watchContent('A', { startAt: new Date(Date.now() + 3 * 3600_000).toISOString() }),
    );
    await w.fundWatch(w.ownerA, 'A', sched.id, 1000);
    await w.submitWatch('A', sched.id);
    const ap = await w.decideWatch(w.ops, sched.id, 'approve');
    expect(ap.body.data.status).toBe('SCHEDULED');
    const res = await w.lifecycle.sweep(new Date(Date.now() + 4 * 3600_000));
    expect(res.activated).toBeGreaterThanOrEqual(1);
    expect(
      (await t.prisma.watchCampaign.findUniqueOrThrow({ where: { id: sched.id } })).status,
    ).toBe('LIVE');
    const end = await w.lifecycle.sweep(new Date(Date.now() + 30 * 86_400_000));
    expect(end.expired).toBeGreaterThanOrEqual(1);
    const done = await t.prisma.watchCampaign.findUniqueOrThrow({ where: { id: sched.id } });
    expect(done).toMatchObject({ status: 'EXPIRED', unusedHalalas: 1000 });
    expect(done.closedOutAt).not.toBeNull();
  });

  // ------------------------------------------------------------------ permissions and tenant isolation
  describe('permissions and tenant isolation', () => {
    it("Merchant A cannot see, edit or fund Merchant B's campaigns (404), nor create under B", async () => {
      const b = await w.createWatch('B', w.watchContent('B'));
      expect((await w.api(w.ownerA).get(`${w.wbase('B')}/watch/${b.id}`)).status).toBe(404);
      expect((await w.api(w.ownerA).get(`${w.wbase('B')}/watch`)).status).toBe(404);
      expect(
        (
          await w
            .api(w.ownerA)
            .put(`${w.wbase('B')}/watch/${b.id}`)
            .send({ content: w.watchContent('B') })
        ).status,
      ).toBe(404);
      expect((await w.fundWatch(w.ownerA, 'B', b.id, 100)).status).toBe(404);
      expect(
        (
          await w
            .api(w.ownerA)
            .post(`${w.wbase('B')}/watch`)
            .set('Idempotency-Key', idem())
            .send({ content: w.watchContent('B') })
        ).status,
      ).toBe(404);
      // and A's own id under B's URL is not found either
      const a = await w.createWatch('A', w.watchContent('A'));
      expect((await w.api(w.ownerB).get(`${w.wbase('B')}/watch/${a.id}`)).status).toBe(404);
    });

    it('Campaign Manager manages content; Merchant Finance can read and fund but not edit; branch-scoped and Staff are refused', async () => {
      const mgr = await w.createWatch('A', w.watchContent('A')); // owner creates
      const asMgr = await w
        .api(w.campaignsA)
        .put(`${w.wbase('A')}/watch/${mgr.id}`)
        .send({ content: w.watchContent('A', { title: { en: 'By manager', ar: 'من المدير' } }) });
      expect(asMgr.status).toBe(200);
      expect((await w.api(w.financeA).get(`${w.wbase('A')}/watch/${mgr.id}`)).status).toBe(200);
      expect((await w.api(w.financeA).get(`${w.wbase('A')}/watch/${mgr.id}/budget`)).status).toBe(
        200,
      );
      expect((await w.fundWatch(w.financeA, 'A', mgr.id, 200)).status).toBe(200);
      expect(
        (
          await w
            .api(w.financeA)
            .put(`${w.wbase('A')}/watch/${mgr.id}`)
            .send({ content: w.watchContent('A') })
        ).status,
      ).toBe(403);
      expect(
        (
          await w
            .api(w.financeA)
            .post(`${w.wbase('A')}/watch`)
            .set('Idempotency-Key', idem())
            .send({ content: w.watchContent('A') })
        ).status,
      ).toBe(403);
      expect(
        (
          await w
            .api(w.financeA)
            .post(`${w.wbase('A')}/watch/${mgr.id}/submit`)
            .send({})
        ).status,
      ).toBe(403);
      expect((await w.api(w.branchScopedA).get(`${w.wbase('A')}/watch`)).status).toBe(403);
      expect([401, 403]).toContain((await w.api(w.staffA).get(`${w.wbase('A')}/watch`)).status);
    });

    it('admin roles: Ops reviews; Finance and Marketing read; Support, Analyst and Risk cannot approve; Support cannot even read', async () => {
      const v = await w.createWatch('A', w.watchContent('A'));
      await w.fundWatch(w.ownerA, 'A', v.id, 1000);
      await w.submitWatch('A', v.id);
      expect((await w.decideWatch(w.support, v.id, 'approve')).status).toBe(403);
      expect((await w.decideWatch(w.analyst, v.id, 'approve')).status).toBe(403);
      expect((await w.decideWatch(w.finance, v.id, 'approve')).status).toBe(403);
      expect((await w.decideWatch(w.risk, v.id, 'approve')).status).toBe(403);
      expect((await w.api(w.support).get('/v1/admin/watch')).status).toBe(403);
      expect((await w.api(w.finance).get('/v1/admin/watch')).status).toBe(200);
      expect((await w.api(w.finance).get(`/v1/admin/watch/${v.id}/budget`)).status).toBe(200);
      expect((await w.api(w.marketing).get(`/v1/admin/watch/${v.id}`)).status).toBe(200);
      expect((await w.api(w.risk).get('/v1/admin/watch/overview')).status).toBe(200);
      expect((await w.decideWatch(w.finance, v.id, 'pause')).status).toBe(403);
      expect((await w.decideWatch(w.ops, v.id, 'approve')).status).toBe(200);
      // drafts are the merchant's private work
      const draft = await w.createWatch('A', w.watchContent('A'));
      expect((await w.api(w.ops).get(`/v1/admin/watch/${draft.id}`)).status).toBe(404);
    });

    it('merchant routes refuse admin and customer sessions; customer routes need the customer audience', async () => {
      const cust = await w.newCustomer();
      expect([401, 403]).toContain((await w.api(cust).get(`${w.wbase('A')}/watch`)).status);
      expect([401, 403]).toContain((await w.api(w.ops).get(`${w.wbase('A')}/watch`)).status);
      expect([401, 403]).toContain((await w.api(w.ownerA).get('/v1/app/rewards')).status);
      expect((await t.http.get('/v1/app/rewards')).status).toBe(401);
    });
  });

  // ------------------------------------------------------------------ merchant monitor
  it('the merchant monitor shows only verified numbers: no invented revenue, no customer identities, no detection logic', async () => {
    const live = await w.publishWatch('A');
    const c1 = await w.newCustomer();
    const c2 = await w.newCustomer();
    await w.playView(c1, live.id);
    await w.playView(c2, live.id, { skip: true });
    const mon = await w.api(w.ownerA).get(`${w.wbase('A')}/watch/${live.id}/monitor`);
    expect(mon.status).toBe(200);
    const m = mon.body.data;
    expect(m.delivery).toMatchObject({ paidViews: 10, qualifiedViews: 1, remainingViews: 9 });
    expect(m.funnel).toMatchObject({ started: 2, qualified: 1 });
    expect(m.funnel.invalidByCategory.SKIPPED).toBe(1);
    expect(m.budget).toMatchObject({ fundedHalalas: 1000, spentHalalas: 100 });
    expect(m.costPerQualifiedViewHalalas).toBe(100);
    expect(m.disclaimerKey).toBe('views_and_verified_spend_only');
    expect(JSON.stringify(m)).not.toMatch(
      /userId|deviceHash|riskScore|AUTOMATION|DEVICE_SHARED|revenue|conversion/i,
    );
  });
});
