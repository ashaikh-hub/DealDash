import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BILLING_EVENT_TYPES, type BillingEventType } from '@dealdash/types';
import {
  DB_READY,
  createBusinessUser,
  createTestApp,
  idem,
  passwordSession,
  type Session,
  type TestApp,
} from './helpers';
import { buildHotWorld, type HotWorld } from './hot-fixtures';
import { InvoicingService } from '../src/billing/invoicing.service';
import { CommercialService } from '../src/finance/commercial.service';
import { PricingService } from '../src/finance/pricing.service';
import { MarketConfigService, taxOf } from '../src/platform/markets/market-config.service';
import { MarketService } from '../src/platform/markets/market.service';

/**
 * Market / country configuration: lifecycle and activation gate (maker-checker), product availability per market, effective-dated tax
 * with preserved history, invoice configuration, currency, market pricing, payment and settlement selection, legal-entity and
 * cross-market isolation, market-scoped administration, the validation register, versioning and audit.
 */
describe.skipIf(!DB_READY)('Market / country configuration', () => {
  let t: TestApp;
  let w: HotWorld;
  let fin: Session;
  let ddOrg: string;
  let ddLe: string;
  let bhOrg: string;
  let bhLe: string;
  let qaOrg: string;
  const M = 'BH';
  const api = (s: Session) => w.api(s);
  const get = (s: Session, path: string) => api(s).get(`/v1/admin/markets${path}`);
  const post = (s: Session, path: string, body: unknown = {}) =>
    api(s)
      .post(`/v1/admin/markets${path}`)
      .set('Idempotency-Key', idem())
      .send(body as object);
  const put = (s: Session, path: string, body: unknown) =>
    api(s)
      .put(`/v1/admin/markets${path}`)
      .send(body as object);
  const past = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
  const draftAndApprove = async (kind: string, body: unknown, market = M) => {
    const d = await post(w.superAdmin, `/${market}/${kind}`, body);
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const a = await post(fin, `/config/${kind}/${d.body.data.id}/approve`);
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    return a.body.data as { id: string; version: number };
  };
  const event = (
    org: string,
    le: string,
    eventType: BillingEventType,
    amountMinor: number,
    currency: string,
  ) =>
    t.prisma.commercialBillingEvent.create({
      data: {
        idempotencyKey: `mk:${randomUUID()}`,
        organizationId: org,
        legalEntityId: le,
        billingLegalEntityId: le,
        eventType,
        billingCategory: BILLING_EVENT_TYPES[eventType],
        amountMinor,
        currency,
        quantity: 1,
      },
    });

  beforeAll(async () => {
    t = await createTestApp();
    w = await buildHotWorld(t);
    ddOrg = (
      await t.prisma.organizationMembership.findFirstOrThrow({
        where: { userId: w.superAdmin.me.id },
      })
    ).organizationId;
    fin = await passwordSession(
      t,
      await createBusinessUser(t.prisma, {
        role: 'DEALDASH_FINANCE',
        orgId: ddOrg,
        userType: 'ADMIN_USER',
        mfa: true,
      }),
      'admin',
      { completeMfa: true },
    );
    // a merchant registered in the new market and one in a market without tax configuration
    bhOrg = w.B.orgId;
    bhLe = (
      await t.prisma.legalEntity.create({
        data: {
          organizationId: bhOrg,
          legalName: `Beta Bahrain WLL ${randomUUID().slice(0, 6)}`,
          country: M,
          currency: 'BHD',
          taxNumber: 'BH-TRN-1',
        },
      })
    ).id;
    qaOrg = w.A.orgId;
  });
  afterAll(() => t?.close());

  describe('market master and lifecycle', () => {
    it('lists markets with region, status and readiness; read needs the permission', async () => {
      const r = await get(w.ops, '');
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const sa = r.body.data.find((m: { code: string }) => m.code === 'SA');
      expect(sa).toMatchObject({
        status: 'PILOT',
        regionCode: 'GCC',
        timezone: 'Asia/Riyadh',
        enabled: true,
      });
      expect(sa.products.PILOT).toBeGreaterThan(0);
      expect(r.body.data.find((m: { code: string }) => m.code === 'AE')).toMatchObject({
        status: 'PLANNED',
        enabled: false,
      });
      expect((await get(w.marketing, '')).status).toBe(403);
      expect(
        (
          await post(w.ops, `/${M}`, {
            nameEn: 'Bahrain',
            nameAr: 'البحرين',
            currency: 'BHD',
            languages: ['ar', 'en'],
          })
        ).status,
      ).toBe(403);
    });

    it('a new market is PLANNED with every product disabled; the lifecycle only moves along allowed steps', async () => {
      const c = await post(w.superAdmin, `/${M}`, {
        nameEn: 'Bahrain',
        nameAr: 'البحرين',
        regionCode: 'GCC',
        isoAlpha3: 'BHR',
        currency: 'BHD',
        supportedCurrencies: ['BHD'],
        currencyDecimals: 3,
        languages: ['ar', 'en'],
        defaultLanguage: 'ar',
        timezone: 'Asia/Bahrain',
        callingCode: '+973',
      });
      expect(c.status, JSON.stringify(c.body)).toBe(200);
      expect(c.body.data).toMatchObject({
        status: 'PLANNED',
        enabled: false,
        currencyDecimals: 3,
        billingCurrency: 'BHD',
      });
      const products = (await get(w.superAdmin, `/${M}/products`)).body.data as Array<{
        status: string;
      }>;
      expect(products.length).toBeGreaterThanOrEqual(14);
      expect(products.every((p) => p.status === 'DISABLED')).toBe(true);
      const jump = await post(w.superAdmin, `/${M}/status`, {
        status: 'ACTIVE',
        reason: 'Too early',
      });
      expect(jump.status).toBe(409);
      expect(jump.body.errors[0].code).toBe('MARKET_TRANSITION_INVALID');
      for (const status of ['CONFIGURING', 'TESTING'])
        expect(
          (await post(w.superAdmin, `/${M}/status`, { status, reason: `Move to ${status}` })).body
            .data.status,
        ).toBe(status);
      // the legacy flag cannot open a market around the gate
      const legacy = await api(w.superAdmin)
        .post(`/v1/admin/platform/countries/${M}`)
        .set('Idempotency-Key', idem())
        .send({
          nameEn: 'Bahrain',
          nameAr: 'البحرين',
          currency: 'BHD',
          languages: ['ar', 'en'],
          enabled: true,
        });
      expect(legacy.status).toBe(409);
    });

    it('the activation gate refuses a pilot while mandatory configuration is missing', async () => {
      const r = await get(w.superAdmin, `/${M}/readiness`);
      expect(r.body.data.state).toBe('NOT_READY');
      const missing = r.body.data.items
        .filter((i: { state: string }) => i.state === 'MISSING')
        .map((i: { check: string }) => i.check);
      expect(missing).toEqual(
        expect.arrayContaining([
          'LEGAL_ENTITY',
          'PRODUCTS',
          'PRICING',
          'TAX',
          'INVOICE',
          'PAYMENT',
          'SETTLEMENT',
          'LEGAL_TERMS',
          'PRIVACY_CONSENT',
          'SUPPORT',
          'KYB',
          'PROVIDERS',
        ]),
      );
      const pilot = await post(w.superAdmin, `/${M}/status`, {
        status: 'PILOT',
        reason: 'Start the pilot',
      });
      expect(pilot.status).toBe(409);
      expect(pilot.body.errors[0].code).toBe('MARKET_NOT_READY');
    });
  });

  describe('configuration (effective-dated, versioned, second approver)', () => {
    it('master data: DealDash legal entity of the market, support contact', async () => {
      ddLe = (
        await t.prisma.legalEntity.create({
          data: {
            organizationId: ddOrg,
            legalName: `DealDash Bahrain ${randomUUID().slice(0, 6)}`,
            country: M,
            currency: 'BHD',
            taxNumber: 'BH-DD-1',
          },
        })
      ).id;
      const wrong = await post(w.superAdmin, `/${M}`, {
        nameEn: 'Bahrain',
        nameAr: 'البحرين',
        regionCode: 'GCC',
        currency: 'BHD',
        languages: ['ar', 'en'],
        timezone: 'Asia/Bahrain',
        dealdashLegalEntityId: bhLe,
      });
      expect(wrong.status).toBe(400);
      const ok = await post(w.superAdmin, `/${M}`, {
        nameEn: 'Bahrain',
        nameAr: 'البحرين',
        regionCode: 'GCC',
        isoAlpha3: 'BHR',
        currency: 'BHD',
        supportedCurrencies: ['BHD'],
        currencyDecimals: 3,
        languages: ['ar', 'en'],
        defaultLanguage: 'ar',
        timezone: 'Asia/Bahrain',
        callingCode: '+973',
        dealdashLegalEntityId: ddLe,
        supportContact: { email: 'support-bh@dealdash.test' },
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.data.version).toBeGreaterThan(1);
    });

    it('products are opened per market (never more open than the market)', async () => {
      expect(
        (await put(w.superAdmin, `/${M}/products/EXCLUSIVE`, { status: 'ACTIVE' })).status,
      ).toBe(409);
      for (const p of ['EXCLUSIVE', 'LIVE_DEAL', 'MERCHANT_SUBSCRIPTION'])
        expect(
          (
            await put(w.superAdmin, `/${M}/products/${p}`, {
              status: 'PILOT',
              notes: 'Pilot scope',
            })
          ).status,
        ).toBe(200);
    });

    it('tax rules: the creator cannot approve; approved versions are frozen; a new version closes the old one at its start', async () => {
      const d = await post(w.superAdmin, `/${M}/tax-rules`, {
        code: 'VAT-STD',
        taxType: 'VAT',
        rateBps: 1000,
        applicability: ['*'],
        effectiveFrom: past(30),
        registrationRef: 'BH-DD-1',
      });
      expect(d.status, JSON.stringify(d.body)).toBe(201);
      const self = await post(w.superAdmin, `/config/tax-rules/${d.body.data.id}/approve`);
      expect(self.status).toBe(403);
      expect(self.body.errors[0].code).toBe('APPROVAL_REQUIRED');
      expect((await post(fin, `/config/tax-rules/${d.body.data.id}/approve`)).status).toBe(200);
      await expect(
        t.prisma.taxRule.update({ where: { id: d.body.data.id }, data: { rateBps: 500 } }),
      ).rejects.toThrow();
      await expect(t.prisma.taxRule.delete({ where: { id: d.body.data.id } })).rejects.toThrow();
      const v2 = await draftAndApprove('tax-rules', {
        code: 'VAT-STD',
        taxType: 'VAT',
        rateBps: 1500,
        applicability: ['*'],
        effectiveFrom: future(60),
      });
      expect(v2.version).toBe(2);
      const v1 = await t.prisma.taxRule.findUniqueOrThrow({ where: { id: d.body.data.id } });
      expect(v1.effectiveTo!.toISOString().slice(0, 10)).toBe(future(60).slice(0, 10));
      const cfg = t.app.get(MarketConfigService);
      expect((await cfg.resolveTax(M, 'SETUP_FEE'))!.rateBps).toBe(1000);
      expect((await cfg.resolveTax(M, 'SETUP_FEE', { at: new Date(future(61)) }))!.rateBps).toBe(
        1500,
      );
      // an exemption for one taxable item wins over the catch-all
      await draftAndApprove('tax-rules', {
        code: 'EXEMPT-VOUCHER',
        taxType: 'VAT',
        rateBps: 0,
        exempt: true,
        exemptionReason: 'Configured exemption (validation item)',
        applicability: ['VOUCHER_COMMISSION'],
        effectiveFrom: past(30),
      });
      expect((await cfg.resolveTax(M, 'VOUCHER_COMMISSION'))!.exempt).toBe(true);
      // a validation-only check of the arithmetic: inclusive vs exclusive, rounding
      expect(
        taxOf(1000, { rateBps: 1500, inclusive: false, exempt: false, roundingRule: 'HALF_UP' }),
      ).toEqual({ netMinor: 1000, taxMinor: 150, grossMinor: 1150 });
      expect(
        taxOf(1150, { rateBps: 1500, inclusive: true, exempt: false, roundingRule: 'HALF_UP' }),
      ).toEqual({ netMinor: 1000, taxMinor: 150, grossMinor: 1150 });
      expect(
        taxOf(5, { rateBps: 1000, inclusive: false, exempt: false, roundingRule: 'HALF_EVEN' })
          .taxMinor,
      ).toBe(0);
    });

    it('no silent tax fallback from another country', async () => {
      expect(await t.app.get(MarketConfigService).resolveTax('QA', 'SETUP_FEE')).toBeNull();
      const qaLe = (
        await t.prisma.legalEntity.create({
          data: {
            organizationId: qaOrg,
            legalName: `Alpha Qatar ${randomUUID().slice(0, 6)}`,
            country: 'QA',
            currency: 'QAR',
          },
        })
      ).id;
      await event(qaOrg, qaLe, 'SETUP_FEE', 10_000, 'QAR');
      await t.app.get(InvoicingService).run(null, { organizationId: qaOrg, force: true });
      const doc = await t.prisma.financeDocument.findFirstOrThrow({
        where: { organizationId: qaOrg, legalEntityId: qaLe, status: 'DRAFT' },
      });
      expect(doc).toMatchObject({ market: 'QA', type: 'INVOICE', taxHalalas: 0 });
      expect(doc.statutory).toMatchObject({
        status: 'TAX_NOT_CONFIGURED_VALIDATE',
        validationCode: 'VALIDATE-QATAR-TAX',
      });
    });

    it('invoice configuration drives numbering and required fields; documents keep the tax rule version they were issued with', async () => {
      await draftAndApprove('invoice-configs', {
        documentKind: 'TAX_INVOICE',
        prefix: 'BH-TINV',
        languages: ['ar', 'en'],
        requiredFields: ['legalName', 'taxId'],
        qrRequired: true,
        validationStatus: 'VALIDATED',
        effectiveFrom: past(30),
      });
      await draftAndApprove('invoice-configs', {
        documentKind: 'INVOICE',
        prefix: 'BH-INV',
        languages: ['ar', 'en'],
        validationStatus: 'VALIDATED',
        effectiveFrom: past(30),
      });
      await event(bhOrg, bhLe, 'SETUP_FEE', 20_000, 'BHD');
      await t.app.get(InvoicingService).run(null, { organizationId: bhOrg, force: true });
      const draft = await t.prisma.financeDocument.findFirstOrThrow({
        where: { organizationId: bhOrg, legalEntityId: bhLe, status: 'DRAFT' },
        include: { invoiceLines: true },
      });
      expect(draft).toMatchObject({
        type: 'TAX_INVOICE',
        market: M,
        currency: 'BHD',
        taxHalalas: 2_000,
        totalHalalas: 22_000,
      });
      expect(draft.invoiceLines[0]).toMatchObject({
        taxRateBps: 1000,
        taxRuleVersion: 1,
        taxableItem: 'SETUP_FEE',
      });
      // required field missing on a second legal entity without a tax number
      const noTaxLe = (
        await t.prisma.legalEntity.create({
          data: {
            organizationId: bhOrg,
            legalName: `Beta Bahrain Two ${randomUUID().slice(0, 6)}`,
            country: M,
            currency: 'BHD',
          },
        })
      ).id;
      await event(bhOrg, noTaxLe, 'API_FEE', 5_000, 'BHD');
      await t.app.get(InvoicingService).run(null, { organizationId: bhOrg, force: true });
      const draft2 = await t.prisma.financeDocument.findFirstOrThrow({
        where: { organizationId: bhOrg, legalEntityId: noTaxLe, status: 'DRAFT' },
      });
      const refused = await api(fin)
        .post(`/v1/admin/billing/documents/${draft2.id}/issue`)
        .set('Idempotency-Key', idem())
        .send({});
      expect(refused.status).toBe(422);
      expect(refused.body.errors[0].code).toBe('INVOICE_REQUIRED_FIELDS_MISSING');
      const issued = await api(fin)
        .post(`/v1/admin/billing/documents/${draft.id}/issue`)
        .set('Idempotency-Key', idem())
        .send({});
      expect(issued.status, JSON.stringify(issued.body)).toBe(200);
      expect(issued.body.data.number).toMatch(/^BH-TINV-\d{6}$/);
      const doc = await t.prisma.financeDocument.findUniqueOrThrow({
        where: { id: draft.id },
        include: { invoiceLines: true },
      });
      expect(doc.invoiceConfigId).toBeTruthy();
      expect(doc.statutory).toMatchObject({
        invoiceConfig: { prefix: 'BH-TINV', qrRequired: true },
      });
      // a later rate change never rewrites the issued document
      await expect(
        t.prisma.financeDocument.update({ where: { id: draft.id }, data: { market: 'SA' } }),
      ).rejects.toThrow();
      await expect(
        t.prisma.invoiceLine.updateMany({
          where: { documentId: draft.id },
          data: { taxRateBps: 1500 },
        }),
      ).rejects.toThrow();
      expect(doc.invoiceLines[0]!.taxRuleVersion).toBe(1);
    });

    it('providers: references only, never secrets; routing order with an approved fallback', async () => {
      const bad = await post(w.superAdmin, `/${M}/providers`, {
        capability: 'PAYMENT',
        providerCode: 'TEST_PSP',
        method: 'CARD',
        credentialRef: 'sk_live_1234567890',
        environment: 'SANDBOX',
        status: 'ACTIVE',
      });
      expect(bad.status).toBe(400);
      const mockProd = await post(w.superAdmin, `/${M}/providers`, {
        capability: 'PAYMENT',
        providerCode: 'MOCK_PAYMENT',
        environment: 'PRODUCTION',
        status: 'ACTIVE',
      });
      expect(mockProd.status).toBe(400);
      const primary = await post(w.superAdmin, `/${M}/providers`, {
        capability: 'PAYMENT',
        providerCode: 'TEST_PSP',
        method: 'CARD',
        currency: 'BHD',
        refundSupported: true,
        credentialRef: 'env:BH_PSP_KEY',
        webhookRef: 'secret:bh/psp-webhook',
        environment: 'SANDBOX',
        priority: 10,
        status: 'ACTIVE',
      });
      expect(primary.status, JSON.stringify(primary.body)).toBe(201);
      await post(w.superAdmin, `/${M}/providers`, {
        capability: 'PAYMENT',
        providerCode: 'TEST_PSP_B',
        method: 'CARD',
        currency: 'BHD',
        environment: 'SANDBOX',
        priority: 5,
        isFallback: true,
        status: 'ACTIVE',
      });
      await post(w.superAdmin, `/${M}/providers`, {
        capability: 'PAYMENT',
        providerCode: 'MOCK_PAYMENT',
        environment: 'MOCK',
        status: 'ACTIVE',
      });
      for (const capability of ['SMS_OTP', 'EMAIL'])
        expect(
          (
            await post(w.superAdmin, `/${M}/providers`, {
              capability,
              providerCode: `TEST_${capability}`,
              environment: 'SANDBOX',
              status: 'ACTIVE',
            })
          ).status,
        ).toBe(201);
      const order = (
        await t.app
          .get(MarketConfigService)
          .selectProviders(M, 'PAYMENT', { method: 'CARD', currency: 'BHD' })
      ).map((p) => p.providerCode);
      expect(order[0]).toBe('TEST_PSP');
      expect(order[order.length - 1]).toBe('TEST_PSP_B');
    });

    it('settlement: the most specific approved rule wins (contract > business > legal entity > market)', async () => {
      await draftAndApprove('settlement-rules', {
        code: 'MARKET-DEFAULT',
        currency: 'BHD',
        frequency: 'WEEKLY',
        cycleDays: 7,
        minimumMinor: 5_000,
        holdDays: 3,
        effectiveFrom: past(30),
      });
      await draftAndApprove('settlement-rules', {
        code: 'BETA-LE',
        legalEntityId: bhLe,
        currency: 'BHD',
        frequency: 'MONTHLY',
        effectiveFrom: past(30),
      });
      expect(
        (
          await post(w.superAdmin, `/${M}/settlement-rules`, {
            code: 'BAD',
            currency: 'SAR',
            frequency: 'WEEKLY',
            effectiveFrom: past(1),
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await post(w.superAdmin, `/${M}/settlement-rules`, {
            code: 'BAD2',
            currency: 'BHD',
            frequency: 'WEEKLY',
            destinationRef: 'BH12345678901234567890',
            effectiveFrom: past(1),
          })
        ).status,
      ).toBe(400);
      const cfg = t.app.get(MarketConfigService);
      expect((await cfg.resolveSettlement(M, { currency: 'BHD' }))!.code).toBe('MARKET-DEFAULT');
      expect((await cfg.resolveSettlement(M, { currency: 'BHD', legalEntityId: bhLe }))!.code).toBe(
        'BETA-LE',
      );
      expect(await cfg.resolveSettlement('QA', { currency: 'QAR' })).toBeNull();
    });

    it('policies: terms, privacy, consent and KYB versions', async () => {
      for (const [category, key, value] of [
        ['LEGAL_TERMS', 'CUSTOMER_TERMS', { version: 'BH-C-1' }],
        ['LEGAL_TERMS', 'MERCHANT_TERMS', { version: 'BH-M-1' }],
        ['PRIVACY_CONSENT', 'PRIVACY_NOTICE', { version: 'BH-P-1' }],
        ['PRIVACY_CONSENT', 'CUSTOMER_CONSENT', { version: 'BH-CC-1' }],
        [
          'PRIVACY_CONSENT',
          'DATA_RESIDENCY',
          { reference: 'Residency decision (validation item)' },
        ],
        ['KYB', 'COMPANY_REGISTRATION', { documents: ['commercial registration'] }],
        [
          'REFUND_EXPIRY',
          'VOUCHER_EXPIRY',
          { minimumDays: null, note: 'to be confirmed (validation item)' },
        ],
      ] as const)
        await draftAndApprove('policies', { category, key, value });
      expect(
        (
          await post(w.superAdmin, `/${M}/policies`, {
            category: 'KYB',
            key: 'CUSTOMER_TERMS',
            value: {},
          })
        ).status,
      ).toBe(400);
    });
  });

  describe('validation register, readiness and activation', () => {
    let itemId: string;

    it('market pricing exists for the market; a blocking validation item keeps it at VALIDATION_REQUIRED', async () => {
      await t.prisma.pricingAgreement.create({
        data: {
          name: 'Bahrain campaign pricing',
          scope: 'GLOBAL',
          market: M,
          createdByUserId: w.superAdmin.me.id,
          versions: { create: { version: 1, components: {}, createdByUserId: w.superAdmin.me.id } },
        },
      });
      const item = await post(w.superAdmin, `/${M}/validations`, {
        code: 'VALIDATE-BH-TAX',
        topic: 'Tax treatment',
        description: 'Confirm VAT on platform fees',
        blocksActivation: true,
      });
      expect(item.status, JSON.stringify(item.body)).toBe(201);
      itemId = item.body.data.id;
      const r = await get(w.superAdmin, `/${M}/readiness`);
      expect(r.body.data.items.filter((i: { state: string }) => i.state === 'MISSING')).toEqual([]);
      expect(r.body.data.state).toBe('VALIDATION_REQUIRED');
    });

    it('pilot: requested by one administrator, approved by another; ACTIVE needs every validation closed', async () => {
      const req = await post(w.superAdmin, `/${M}/status`, {
        status: 'PILOT',
        reason: 'Configuration complete',
      });
      expect(req.status, JSON.stringify(req.body)).toBe(200);
      expect(req.body.data).toMatchObject({
        status: 'TESTING',
        approvalStatus: 'PENDING',
        pending: { status: 'PILOT' },
      });
      expect((await post(w.superAdmin, `/${M}/status/approve`)).status).toBe(403);
      const ok = await post(fin, `/${M}/status/approve`);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.data).toMatchObject({
        status: 'PILOT',
        enabled: true,
        approvalStatus: 'APPROVED',
      });
      const active = await post(w.superAdmin, `/${M}/status`, {
        status: 'ACTIVE',
        reason: 'Launch',
      });
      expect(active.status).toBe(409);
      expect(active.body.errors[0].code).toBe('MARKET_NOT_READY');
    });

    it('closing a validation item needs a decision, evidence and the approve permission; items are never deleted', async () => {
      expect((await put(fin, `/validations/${itemId}`, { status: 'RESOLVED' })).status).toBe(400);
      expect(
        (
          await put(fin, `/validations/${itemId}`, {
            status: 'RESOLVED',
            decision: 'Standard rate applies (adviser memo)',
          })
        ).status,
      ).toBe(400);
      expect((await put(w.ops, `/validations/${itemId}`, { status: 'IN_REVIEW' })).status).toBe(
        403,
      );
      const done = await put(fin, `/validations/${itemId}`, {
        status: 'RESOLVED',
        decision: 'Standard rate applies (adviser memo)',
        evidenceRef: 'DMS-2026-0042',
      });
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      expect(done.body.data.approvedByUserId).toBeTruthy();
      await expect(
        t.prisma.marketValidationItem.delete({ where: { id: itemId } }),
      ).rejects.toThrow();
      const list = (await get(w.ops, `/validations?market=SA`)).body.data as Array<{
        code: string;
        sourceRef: string;
      }>;
      expect(list.find((x) => x.code === 'VALIDATE-KSA-VK-03')?.sourceRef).toContain('§25 VK-03');
      expect(list.map((x) => x.code)).toEqual(
        expect.arrayContaining([
          'VALIDATE-KSA-TAX-INVOICE',
          'VALIDATE-KSA-WRITE-OFF',
          'VALIDATE-KSA-FX-SOURCE',
          'VALIDATE-KSA-AI-RESIDENCY',
          'VALIDATE-KSA-AI-CONSENT',
          'VALIDATE-KSA-ARABIC-REVIEW',
        ]),
      );
    });

    it('ACTIVE once READY (second approver); every change is in the market history', async () => {
      expect((await get(w.superAdmin, `/${M}/readiness`)).body.data.state).toBe('READY');
      await post(w.superAdmin, `/${M}/status`, { status: 'ACTIVE', reason: 'Launch' });
      const ok = await post(fin, `/${M}/status/approve`);
      expect(ok.body.data.status, JSON.stringify(ok.body)).toBe('ACTIVE');
      const h = (await get(w.superAdmin, `/${M}/history`)).body.data as Array<{
        action: string;
        reason: string | null;
      }>;
      expect(h.map((x) => x.action)).toEqual(
        expect.arrayContaining([
          'MARKET_CREATED',
          'MARKET_UPDATED',
          'MARKET_STATUS_REQUESTED',
          'MARKET_STATUS_CHANGED',
          'TAXRULE_APPROVED',
          'INVOICECONFIG_APPROVED',
          'MARKET_PRODUCT_CHANGED',
          'MARKET_PROVIDER_CREATED',
          'MARKET_VALIDATION_UPDATED',
        ]),
      );
      const sus = await post(w.superAdmin, `/${M}/status`, {
        status: 'SUSPENDED',
        reason: 'Regulator request',
      });
      expect(sus.body.data).toMatchObject({ status: 'SUSPENDED', enabled: false });
      expect((await get(w.superAdmin, `/${M}/readiness`)).body.data.state).toBe('BLOCKED');
      await post(w.superAdmin, `/${M}/status`, { status: 'ACTIVE', reason: 'Resolved' });
      expect((await post(fin, `/${M}/status/approve`)).body.data.status).toBe('ACTIVE');
    });
  });

  describe('enforcement on the business side', () => {
    it('a campaign cannot use a product that is not open in its market', async () => {
      await t.prisma.marketProduct.update({
        where: { market_product: { market: 'SA', product: 'EXCLUSIVE' } },
        data: { status: 'SUSPENDED' },
      });
      try {
        const deal = await w.createHot('A', w.hotContent('A', 3));
        await w.commercialReady(deal.id).catch(() => undefined);
        const sub = await api(w.ownerA)
          .post(`/v1/merchants/${w.A.orgId}/hot-deals/${deal.id}/submit`)
          .send({});
        expect(sub.status).toBe(403);
        expect(sub.body.errors[0].code).toBe('MARKET_PRODUCT_UNAVAILABLE');
      } finally {
        await t.prisma.marketProduct.update({
          where: { market_product: { market: 'SA', product: 'EXCLUSIVE' } },
          data: { status: 'PILOT' },
        });
      }
    });

    it('a Live Deal is refused when Live Deals are not open in the market of its branches', async () => {
      await t.prisma.marketProduct.update({
        where: { market_product: { market: 'SA', product: 'LIVE_DEAL' } },
        data: { status: 'DISABLED' },
      });
      try {
        const d = await w.createDeal(w.ownerA, w.A.orgId, w.content('A'));
        const r = await w.submit(w.ownerA, w.A.orgId, d.id);
        expect(r.status).toBe(403);
        expect(r.body.errors[0].code).toBe('MARKET_PRODUCT_UNAVAILABLE');
      } finally {
        await t.prisma.marketProduct.update({
          where: { market_product: { market: 'SA', product: 'LIVE_DEAL' } },
          data: { status: 'PILOT' },
        });
      }
    });

    it('a campaign cannot span markets', async () => {
      const b1 = w.A.branchIds[1]!;
      await t.prisma.merchantBranch.update({ where: { id: b1 }, data: { country: M } });
      try {
        const content = {
          ...w.hotContent('A', 2),
          allocations: [
            { branchId: w.A.branchIds[0], units: 2 },
            { branchId: b1, units: 2 },
          ],
        };
        await expect(
          t.app.get(MarketService).marketOfCampaign(w.A.orgId, content),
        ).rejects.toMatchObject({ code: 'MARKET_CONFIG_INVALID' });
      } finally {
        await t.prisma.merchantBranch.update({ where: { id: b1 }, data: { country: 'SA' } });
      }
    });

    it('market pricing: another market is never priced with SA defaults; non-ledger currencies are refused for campaigns', async () => {
      const pricing = t.app.get(PricingService);
      await expect(pricing.resolve(w.A.orgId, 'EXCLUSIVE', new Date(), 'QA')).rejects.toMatchObject(
        { code: 'PRICING_NOT_AVAILABLE' },
      );
      const bh = await pricing.resolve(w.A.orgId, 'EXCLUSIVE', new Date(), M);
      expect(bh).toMatchObject({ source: 'AGREEMENT', currency: 'BHD', market: M });
      // the market's own tax rule applies to the campaign quote, with its version
      expect(bh.taxBps).toBe(1000);
      expect(bh.taxRuleVersion).toBe(1);
      const sa = await pricing.resolve(w.A.orgId, 'EXCLUSIVE', new Date(), 'SA');
      expect(sa.currency).toBe('SAR');
      expect(sa.taxBps).toBeNull();
      const b1 = w.A.branchIds[0]!;
      await t.prisma.merchantBranch.update({ where: { id: b1 }, data: { country: M } });
      try {
        await expect(
          t.app.get(CommercialService).preview('EXCLUSIVE', w.A.orgId, w.hotContent('A', 2), null),
        ).rejects.toMatchObject({ code: 'MARKET_CURRENCY_NOT_SUPPORTED' });
      } finally {
        await t.prisma.merchantBranch.update({ where: { id: b1 }, data: { country: 'SA' } });
      }
    });

    it('a multinational business: one account, several markets and legal entities, each with its own market rules', async () => {
      const r = await api(w.ownerB).get(`/v1/orgs/${bhOrg}/markets`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const bh = r.body.data.find((m: { code: string }) => m.code === M);
      expect(bh).toMatchObject({ status: 'ACTIVE', currency: 'BHD', open: true });
      expect(bh.legalEntities.map((l: { id: string }) => l.id)).toContain(bhLe);
      expect(bh.products.find((p: { product: string }) => p.product === 'EXCLUSIVE')).toMatchObject(
        { available: true },
      );
      expect(bh.products.find((p: { product: string }) => p.product === 'VOUCHER')).toMatchObject({
        available: false,
      });
      const svc = t.app.get(MarketService);
      expect(await svc.resolveMarket(bhOrg, { legalEntityId: bhLe })).toBe(M);
      // the billing account of the Bahraini entity is in BHD and invoiced under Bahrain's rules; another business sees none of it
      expect((await api(w.ownerA).get(`/v1/orgs/${bhOrg}/markets`)).status).toBe(404);
      expect(
        (await api(w.ownerA).get(`/v1/orgs/${w.A.orgId}/billing/documents`)).body.data.some(
          (d: { market?: string; legalEntityId: string }) => d.legalEntityId === bhLe,
        ),
      ).toBe(false);
    });
  });

  describe('market-scoped administration (existing role + scope)', () => {
    it('an administrator scoped to one market sees and manages only that market', async () => {
      const u = await createBusinessUser(t.prisma, {
        role: 'DEALDASH_FINANCE',
        orgId: ddOrg,
        userType: 'ADMIN_USER',
        mfa: true,
        label: 'bh-admin',
      });
      const m = await t.prisma.organizationMembership.findFirstOrThrow({
        where: { userId: u.id, organizationId: ddOrg },
      });
      await t.prisma.organizationMembership.update({ where: { id: m.id }, data: { scoped: true } });
      await t.prisma.roleAssignment.create({
        data: {
          organizationId: ddOrg,
          membershipId: m.id,
          userId: u.id,
          roleId: m.roleId,
          scopeKind: 'COUNTRY',
          scopeRef: M,
          grantedByUserId: w.superAdmin.me.id,
          reason: 'Bahrain market lead',
        },
      });
      const scoped = await passwordSession(t, u, 'admin', { completeMfa: true });
      const list = await get(scoped, '');
      expect(list.status, JSON.stringify(list.body)).toBe(200);
      expect(list.body.data.map((x: { code: string }) => x.code)).toEqual([M]);
      expect((await get(scoped, `/${M}/readiness`)).status).toBe(200);
      expect((await get(scoped, '/SA')).status).toBe(403);
      expect((await put(scoped, '/SA/products/VOUCHER', { status: 'DISABLED' })).status).toBe(403);
      expect((await put(scoped, `/${M}/products/VOUCHER`, { status: 'PILOT' })).status).toBe(200);
      const v = (await get(scoped, '/validations')).body.data as Array<{ market: string }>;
      expect(v.every((x) => x.market === M)).toBe(true);
    });
  });

  describe('closing a market', () => {
    it('a closed market is terminal and no longer open (the test market is closed, never deleted)', async () => {
      const r = await post(w.superAdmin, `/${M}/status`, {
        status: 'CLOSED',
        reason: 'Test market closed',
      });
      expect(r.body.data).toMatchObject({ status: 'CLOSED', enabled: false });
      expect(r.body.data.effectiveTo).toBeTruthy();
      expect(
        (await post(w.superAdmin, `/${M}/status`, { status: 'ACTIVE', reason: 'Reopen' })).body
          .errors[0].code,
      ).toBe('MARKET_TRANSITION_INVALID');
      expect(await t.app.get(MarketService).isAvailable(M, 'EXCLUSIVE')).toMatchObject({
        ok: false,
        reason: 'MARKET',
      });
    });
  });
});
