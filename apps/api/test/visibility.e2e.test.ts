import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FORECAST_LABEL } from '@dealdash/types';
import { DB_READY, createTestApp, idem, type Session, type TestApp } from './helpers';
import { buildHotWorld, type HotWorld } from './hot-fixtures';
import { projectSince } from './visibility-helpers';
import { TargetsService } from '../src/visibility/targets.service';
import { AlertsService } from '../src/visibility/alerts.service';
import { EarlyWarningService } from '../src/visibility/early-warning.service';
import { SignalService } from '../src/subscription/signal.service';

/**
 * Phase 4: event integrity, aggregation, scope filtering, hierarchical reporting, targets and forecast labelling, alerts (dedupe,
 * preferences, escalation, actions), early warnings (integration staleness), subscription signals, the Command Centre, the
 * performance-to-finance linkage and the customer support timeline.
 */
describe.skipIf(!DB_READY)('Phase 4: visibility and operations', () => {
  let t: TestApp;
  let w: HotWorld;
  let dealId: string;
  let customer: Session;
  let reservationQr: string;

  const orgA = () => w.A.orgId;
  const get = (s: Session, path: string) => w.api(s).get(path);
  const post = (s: Session, path: string, body: unknown = {}) => w.api(s).post(path).set('Idempotency-Key', idem()).send(body as object);
  let started: Date;
  const catchUp = () => projectSince(t, started);
  const since = () => new Date(Date.now() - 2 * 3_600_000).toISOString();

  beforeAll(async () => {
    started = new Date(Date.now() - 60_000);
    t = await createTestApp();
    w = await buildHotWorld(t);
    const deal = await w.publishHot('A', 5);
    dealId = deal.id;
    customer = await w.newCustomer();
    const r1 = (await w.reserve(customer, dealId, w.A.branchIds[0]!)).body.data;
    reservationQr = r1.code.qr as string;
    const other = await w.newCustomer();
    const r2 = (await w.reserve(other, dealId, w.A.branchIds[0]!)).body.data;
    expect((await w.redeem(w.staffA, reservationQr)).body.data.result).toBe('REDEEMED');
    expect((await w.cancelRes(other, r2.id)).status).toBe(200);
    await w.redeem(w.staffA, 'ZZZZ-NOT-A-CODE', 'MANUAL');
    // client engagement (unverified): impressions and views of the Exclusive Deal, directions on a Live Deal at another branch
    await t.prisma.dealEvent.createMany({
      data: [
        { type: 'IMPRESSION', dealId, merchantOrgId: orgA(), branchId: w.A.branchIds[0], anonymousId: 'anon-1', productType: 'HOT' },
        { type: 'DETAIL_VIEW', dealId, merchantOrgId: orgA(), branchId: w.A.branchIds[0], anonymousId: 'anon-1', productType: 'HOT' },
        { type: 'DIRECTIONS_CLICK', dealId: randomUUID(), merchantOrgId: orgA(), branchId: w.A.branchIds[1], anonymousId: 'anon-2', productType: 'LIVE' },
      ],
    });
    await catchUp();
  });
  afterAll(() => t?.close());

  describe('event framework', () => {
    it('projects verified outcomes from server records and engagement as unverified, with dimensions and finance links', async () => {
      const rows = await t.prisma.analyticsEvent.findMany({ where: { campaignId: dealId } });
      const names = rows.map((r) => r.name);
      expect(names.filter((n) => n === 'EXCLUSIVE_CREDENTIAL_ISSUED')).toHaveLength(2);
      expect(names.filter((n) => n === 'EXCLUSIVE_REDEMPTION_VERIFIED')).toHaveLength(1);
      expect(names).toContain('EXCLUSIVE_RESERVATION_CANCELLED');
      const redeemed = rows.find((r) => r.name === 'EXCLUSIVE_REDEMPTION_VERIFIED')!;
      expect(redeemed).toMatchObject({ verified: true, eventClass: 'VERIFIED_OUTCOME', organizationId: orgA(), branchId: w.A.branchIds[0], product: 'EXCLUSIVE' });
      expect(redeemed.legalEntityId).toBeTruthy();
      const view = rows.find((r) => r.name === 'EXCLUSIVE_VIEW')!;
      expect(view).toMatchObject({ verified: false, eventClass: 'ENGAGEMENT' });
      // a rejected attempt is recorded as a rejection, never as a redemption
      expect(await t.prisma.analyticsEvent.count({ where: { organizationId: orgA(), name: 'EXCLUSIVE_REDEMPTION_REJECTED' } })).toBeGreaterThanOrEqual(1);
    });

    it('is idempotent: projecting again adds nothing', async () => {
      const before = await t.prisma.analyticsEvent.count({ where: { campaignId: dealId } });
      await catchUp();
      expect(await t.prisma.analyticsEvent.count({ where: { campaignId: dealId } })).toBe(before);
    });

    it('the database keeps the taxonomy honest and the events append-only', async () => {
      const base = { idempotencyKey: `x:${randomUUID()}`, product: 'LIVE', occurredAt: new Date(), sourceType: 'Test', sourceId: 'x' };
      await expect(t.prisma.analyticsEvent.create({ data: { ...base, name: 'LIVE_DETAIL_VIEW', eventClass: 'ENGAGEMENT', verified: true } })).rejects.toThrow();
      await expect(t.prisma.analyticsEvent.create({ data: { ...base, name: 'MADE_UP_EVENT', eventClass: 'ENGAGEMENT' } })).rejects.toThrow();
      const row = await t.prisma.analyticsEvent.findFirstOrThrow({ where: { campaignId: dealId } });
      await expect(t.prisma.analyticsEvent.update({ where: { id: row.id }, data: { quantity: 99 } })).rejects.toThrow();
      await expect(t.prisma.analyticsEvent.delete({ where: { id: row.id } })).rejects.toThrow();
    });
  });

  describe('metrics, scope and hierarchy', () => {
    it('the product overview counts credentials, verified redemptions and the redemption rate; a click is never a sale', async () => {
      const r = await get(w.ownerA, `/v1/orgs/${orgA()}/performance/overview?from=${since()}`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const ex = r.body.data.products.find((p: { product: string }) => p.product === 'EXCLUSIVE').metrics;
      expect(ex['exclusive.credentials_issued']).toBe(2);
      expect(ex['exclusive.verified_redemptions']).toBe(1);
      expect(ex['exclusive.redemption_rate']).toBe(5000);
      expect(ex['exclusive.inventory_remaining']).toBeGreaterThan(0);
      const live = r.body.data.products.find((p: { product: string }) => p.product === 'LIVE').metrics;
      expect(live['live.directions']).toBeGreaterThanOrEqual(1);
      expect(live['live.member_benefit_redemptions']).toBe(0);
      expect(r.body.data.asOf).toBeTruthy();
    });

    it('a branch-bound member sees only their branch; another business and a customer see nothing', async () => {
      const q = `groupBy=BRANCH&metrics=live.directions,exclusive.credentials_issued&from=${since()}`;
      const owner = (await get(w.ownerA, `/v1/orgs/${orgA()}/performance/report?${q}`)).body.data.rows.map((r: { key: string }) => r.key);
      expect(owner).toEqual(expect.arrayContaining([w.A.branchIds[0], w.A.branchIds[1]]));
      const scoped = await get(w.branchScopedA, `/v1/orgs/${orgA()}/performance/report?${q}`);
      expect(scoped.status, JSON.stringify(scoped.body)).toBe(200);
      expect(scoped.body.data.rows.map((r: { key: string }) => r.key)).not.toContain(w.A.branchIds[1]);
      expect((await get(w.ownerB, `/v1/orgs/${orgA()}/performance/overview`)).status).toBe(404);
      expect((await get(w.ownerB, `/v1/orgs/${orgA()}/performance/campaigns/EXCLUSIVE/${dealId}`)).status).toBe(404);
      expect([401, 403]).toContain((await get(customer, `/v1/orgs/${orgA()}/performance/overview`)).status);
      expect([401, 403]).toContain((await get(w.staffA, `/v1/orgs/${orgA()}/performance/overview`)).status);
    });

    it('drill-down above branch needs ADVANCED_REPORTING for a business; DealDash can group by business and legal entity', async () => {
      const denied = await get(w.ownerA, `/v1/orgs/${orgA()}/performance/report?groupBy=LEGAL_ENTITY&metrics=exclusive.credentials_issued&from=${since()}`);
      expect(denied.status).toBe(403);
      expect(denied.body.errors[0].code).toBe('ENTITLEMENT_REQUIRED');
      const admin = await get(w.superAdmin, `/v1/admin/visibility/report?groupBy=ORGANIZATION&metrics=exclusive.credentials_issued&from=${since()}`);
      expect(admin.status, JSON.stringify(admin.body)).toBe(200);
      expect(admin.body.data.rows.find((r: { key: string }) => r.key === orgA()).metrics['exclusive.credentials_issued']).toBe(2);
      const le = await get(w.superAdmin, `/v1/admin/visibility/report?groupBy=LEGAL_ENTITY&organizationId=${orgA()}&metrics=exclusive.verified_redemptions&from=${since()}`);
      expect(le.status).toBe(200);
      expect(le.body.data.totals['exclusive.verified_redemptions']).toBe(1);
      expect((await get(w.analyst, `/v1/admin/visibility/overview`)).status).toBe(200);
      expect((await get(w.support, `/v1/admin/visibility/overview`)).status).toBe(403);
    });

    it('campaign performance carries the performance-to-finance linkage', async () => {
      const r = await get(w.ownerA, `/v1/orgs/${orgA()}/performance/campaigns/EXCLUSIVE/${dealId}?from=${since()}`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data.metrics['exclusive.verified_redemptions']).toBe(1);
      expect(r.body.data.finance.status).toBe('MATCHED');
      expect(r.body.data.finance.lines.find((l: { measure: string }) => l.measure === 'VERIFIED_REDEMPTIONS')).toMatchObject({ performance: 1, finance: 1, matches: true });
    });
  });

  describe('targets', () => {
    let targetId: string;

    it('target, actual, expected-to-date and a forecast that is labelled an estimate', async () => {
      const r = await post(w.campaignsA, `/v1/orgs/${orgA()}/targets`, { name: 'Lunch redemptions', metric: 'REDEMPTIONS', product: 'EXCLUSIVE', campaignId: dealId, targetValue: 4, periodStart: new Date(Date.now() - 3_600_000).toISOString(), periodEnd: new Date(Date.now() + 3 * 3_600_000).toISOString() });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      targetId = r.body.data.id;
      expect(r.body.data).toMatchObject({ target: 4, actual: 1, achievementBps: 2500 });
      expect(r.body.data.expectedToDate).toBeGreaterThanOrEqual(0);
      expect(r.body.data.forecast).toMatchObject({ label: FORECAST_LABEL, method: 'RUN_RATE' });
      expect(r.body.data.forecast.value).toBeGreaterThanOrEqual(1);
    });

    it('validates targets and keeps them inside the business', async () => {
      const bad = await post(w.campaignsA, `/v1/orgs/${orgA()}/targets`, { name: 'Bad', metric: 'REDEMPTIONS', targetValue: 4, periodStart: new Date().toISOString(), periodEnd: new Date(Date.now() - 1000).toISOString() });
      expect(bad.status).toBe(422);
      expect(bad.body.errors[0].code).toBe('TARGET_INVALID');
      const foreign = await post(w.ownerB, `/v1/orgs/${w.B.orgId}/targets`, { name: 'Steal', metric: 'REDEMPTIONS', product: 'EXCLUSIVE', campaignId: dealId, targetValue: 4, periodStart: new Date().toISOString(), periodEnd: new Date(Date.now() + 3_600_000).toISOString() });
      expect(foreign.status).toBe(404);
      expect((await post(w.financeA, `/v1/orgs/${orgA()}/targets`, { name: 'No', metric: 'REDEMPTIONS', targetValue: 4, periodStart: new Date().toISOString(), periodEnd: new Date(Date.now() + 3_600_000).toISOString() })).status).toBe(403);
    });

    it('milestones raise ONE alert each, delivered in-app to the business', async () => {
      const svc = t.app.get(TargetsService);
      await svc.evaluate();
      await svc.evaluate();
      const alerts = await t.prisma.alertEvent.findMany({ where: { code: 'TARGET_MILESTONE', subjectId: targetId } });
      expect(alerts).toHaveLength(1);
      expect((alerts[0]!.data as { milestone: number }).milestone).toBe(25);
      const n = await t.prisma.notification.count({ where: { userId: w.ownerA.me.id, type: 'ALERT' } });
      expect(n).toBeGreaterThanOrEqual(1);
      const list = (await get(w.financeA, `/v1/orgs/${orgA()}/alerts`)).body.data;
      expect(list.find((a: { code: string; subjectId: string }) => a.code === 'TARGET_MILESTONE' && a.subjectId === targetId)).toMatchObject({ action: 'VIEW_PERFORMANCE', actionAllowed: true });
    });

    it('a person who asked for critical alerts only is not disturbed by an informational milestone', async () => {
      const set = await w.api(w.campaignsA).put('/v1/me/notification-preferences').send({ category: 'PERFORMANCE', frequency: 'CRITICAL_ONLY', channels: ['IN_APP'], muted: false });
      expect(set.status, JSON.stringify(set.body)).toBe(200);
      const r = await post(w.campaignsA, `/v1/orgs/${orgA()}/targets`, { name: 'Credentials', metric: 'REDEMPTIONS', product: 'EXCLUSIVE', campaignId: dealId, targetValue: 2, periodStart: new Date(Date.now() - 3_600_000).toISOString(), periodEnd: new Date(Date.now() + 3_600_000).toISOString() });
      await t.app.get(TargetsService).evaluate();
      const a = await t.prisma.alertEvent.findFirstOrThrow({ where: { code: 'TARGET_MILESTONE', subjectId: r.body.data.id } });
      const d = await t.prisma.alertDelivery.findFirst({ where: { alertId: a.id, userId: w.campaignsA.me.id } });
      expect(d?.status).toBe('SKIPPED_SEVERITY');
      expect(await t.prisma.alertDelivery.count({ where: { alertId: a.id, userId: w.ownerA.me.id, status: 'SENT' } })).toBe(1);
    });
  });

  describe('alerts', () => {
    it('rules are validated: roles must belong to the business, managers only', async () => {
      const bad = await post(w.ownerA, `/v1/orgs/${orgA()}/alert-rules`, { name: 'Wrong', code: 'INVOICE_OVERDUE', recipientRoles: ['PARTNER_ADMIN'] });
      expect(bad.status).toBe(422);
      expect(bad.body.errors[0].code).toBe('ALERT_RULE_INVALID');
      expect((await post(w.financeA, `/v1/orgs/${orgA()}/alert-rules`, { name: 'No', code: 'INVOICE_OVERDUE' })).status).toBe(403);
      expect((await post(w.branchScopedA, `/v1/orgs/${orgA()}/alert-rules`, { name: 'Scoped', code: 'INVOICE_OVERDUE' })).status).toBe(403);
    });

    it('deduplicates, routes to the task inbox, escalates, and stops escalating once acknowledged', async () => {
      const rule = await post(w.ownerA, `/v1/orgs/${orgA()}/alert-rules`, { name: 'Overdue', code: 'INVOICE_OVERDUE', channels: ['IN_APP', 'TASK_INBOX'], recipientRoles: ['MERCHANT_FINANCE'], escalation: [{ afterMinutes: 5, toRoles: ['MERCHANT_OWNER'] }] });
      expect(rule.status, JSON.stringify(rule.body)).toBe(201);
      const alerts = t.app.get(AlertsService);
      const subjectId = randomUUID();
      const first = await alerts.raise({ code: 'INVOICE_OVERDUE', organizationId: orgA(), subjectType: 'FinanceDocument', subjectId });
      const again = await alerts.raise({ code: 'INVOICE_OVERDUE', organizationId: orgA(), subjectType: 'FinanceDocument', subjectId });
      expect(first?.created).toBe(true);
      expect(again).toMatchObject({ id: first!.id, created: false });
      expect(await t.prisma.alertDelivery.count({ where: { alertId: first!.id, userId: w.financeA.me.id, status: 'SENT' } })).toBe(1);
      expect(await t.prisma.approvalTask.count({ where: { entityType: 'AlertEvent', entityId: first!.id, status: 'OPEN' } })).toBe(1);
      // the action opens the invoice for Finance; a campaign manager cannot act on it
      const asCm = (await get(w.campaignsA, `/v1/orgs/${orgA()}/alerts`)).body.data.find((a: { id: string }) => a.id === first!.id);
      expect(asCm).toMatchObject({ action: 'VIEW_INVOICE', actionAllowed: false });
      expect(await alerts.escalate(new Date(Date.now() + 10 * 60_000))).toBeGreaterThanOrEqual(1);
      const esc = await t.prisma.alertEvent.findUniqueOrThrow({ where: { id: first!.id } });
      expect(esc.escalationLevel).toBe(1);
      expect(await t.prisma.alertDelivery.count({ where: { alertId: first!.id, userId: w.ownerA.me.id, level: 1 } })).toBeGreaterThanOrEqual(1);
      const ack = await post(w.financeA, `/v1/orgs/${orgA()}/alerts/${first!.id}/acknowledge`);
      expect(ack.status, JSON.stringify(ack.body)).toBe(200);
      expect(ack.body.data.status).toBe('ACKNOWLEDGED');
      expect(await t.prisma.approvalTask.count({ where: { entityType: 'AlertEvent', entityId: first!.id, status: 'OPEN' } })).toBe(0);
      expect(await alerts.escalate(new Date(Date.now() + 60 * 60_000))).toBe(0);
      // another business cannot touch it
      expect((await post(w.ownerB, `/v1/orgs/${w.B.orgId}/alerts/${first!.id}/resolve`)).status).toBe(404);
    });

    it('turns subscription signals into alerts and marks them consumed', async () => {
      const signals = t.app.get(SignalService);
      await signals.raise({ type: 'BRANCH_LIMIT_80_PERCENT', dedupeKey: `t:${randomUUID()}`, organizationId: orgA(), payload: { limitKey: 'branches.max' } });
      const n = await t.app.get(AlertsService).consumeSignals();
      expect(n).toBeGreaterThanOrEqual(1);
      expect(await t.prisma.commercialSignal.count({ where: { organizationId: orgA(), consumedAt: null } })).toBe(0);
      expect(await t.prisma.alertEvent.count({ where: { organizationId: orgA(), code: 'SUBSCRIPTION_LIMIT' } })).toBeGreaterThanOrEqual(1);
    });
  });

  describe('operations', () => {
    it('detects a stale feed for the business and for DealDash; the integration view shows STALE and NOT_CONFIGURED', async () => {
      const c = await t.prisma.integrationConnection.create({
        data: { organizationId: orgA(), name: 'Branch feed', sourceSystem: 'MERCHANT_POS_FEED', kind: 'FEED_PULL', keyPrefix: `kp_${randomUUID().slice(0, 8)}`, keyHash: 'x', createdByUserId: w.ownerA.me.id, staleAfterMinutes: 60, lastSuccessfulSyncAt: new Date(Date.now() - 3 * 3_600_000) },
      });
      await t.app.get(EarlyWarningService).integrations(new Date());
      expect(await t.prisma.alertEvent.count({ where: { code: 'FEED_STALE', subjectId: c.id, organizationId: orgA() } })).toBe(1);
      expect(await t.prisma.alertEvent.count({ where: { code: 'FEED_STALE', subjectId: c.id, organizationId: null } })).toBe(1);
      const h = await get(w.ownerA, `/v1/orgs/${orgA()}/integration-health`);
      expect(h.status).toBe(200);
      expect(h.body.data.find((x: { family: string }) => x.family === 'PARTNER_FEED')).toMatchObject({ state: 'STALE', connections: 1 });
      expect(h.body.data.find((x: { family: string }) => x.family === 'VISA')).toMatchObject({ state: 'NOT_CONFIGURED' });
    });

    it('the Command Centre covers campaigns, transactions, finance, integrations, risk and platform health (DealDash only)', async () => {
      const r = await get(w.superAdmin, '/v1/admin/visibility/command-centre');
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const d = r.body.data;
      expect(d.campaigns.map((c: { product: string }) => c.product)).toEqual(['LIVE', 'EXCLUSIVE', 'VOUCHER', 'WATCH']);
      expect(d.campaigns.find((c: { product: string }) => c.product === 'EXCLUSIVE').live).toBeGreaterThanOrEqual(1);
      expect(d.transactions.redemptions.exclusive).toBeGreaterThanOrEqual(1);
      expect(d.finance).toHaveProperty('receivablesLedgerMinor');
      expect(d.integrations.find((x: { family: string }) => x.family === 'PAYMENT_GATEWAY')).toMatchObject({ adapter: 'MOCK' });
      expect(d.platform.database.latencyMs).toBeGreaterThanOrEqual(0);
      expect(d.risk).toHaveProperty('fraudAlerts');
      expect([401, 403]).toContain((await get(w.ownerA, '/v1/admin/visibility/command-centre')).status);
      expect((await get(w.analyst, '/v1/admin/visibility/command-centre')).status).toBe(403);
    });

    it('the customer support timeline shows the journey without codes or tokens, for DealDash support only', async () => {
      const r = await get(w.support, `/v1/admin/visibility/customers/${customer.me.id}/timeline`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const kinds = r.body.data.items.map((i: { kind: string }) => i.kind);
      expect(kinds).toEqual(expect.arrayContaining(['ACCOUNT', 'RESERVATION', 'REDEMPTION']));
      expect(JSON.stringify(r.body)).not.toContain(reservationQr);
      expect(r.body.data.customer.mobileMasked).toContain('•');
      expect((await get(w.support, `/v1/admin/visibility/customers/${w.ownerA.me.id}/timeline`)).status).toBe(404);
      expect((await get(w.analyst, `/v1/admin/visibility/customers/${customer.me.id}/timeline`)).status).toBe(403);
      expect([401, 403]).toContain((await get(w.ownerA, `/v1/admin/visibility/customers/${customer.me.id}/timeline`)).status);
    });
  });
});
