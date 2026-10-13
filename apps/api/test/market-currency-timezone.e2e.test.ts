import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONFIG_DEFAULTS } from '@dealdash/config';
import { endOfDayAfter } from '@dealdash/localization';
import { SystemConfigService } from '../src/system-config/system-config.service';
import { MerchantVouchersService } from '../src/vouchers/merchant-vouchers.service';
import { DB_READY, createTestApp, type TestApp } from './helpers';
import { buildWatchWorld } from './watch-fixtures';

/**
 * Launch readiness (founder decision 2026-10-11): currency and business time zone come from Market / Country Configuration.
 * The SAME product rules run for a Saudi merchant (SA: SAR, Asia/Riyadh — unchanged behaviour) and a Pakistani merchant
 * (PK: PKR, Asia/Karachi). Nothing is converted; every financial record states its currency.
 */
describe.skipIf(!DB_READY)(
  'market currency and time zone (PK / PKR / Asia/Karachi vs SA / SAR / Asia/Riyadh)',
  () => {
    let t: TestApp;
    let w: Awaited<ReturnType<typeof buildWatchWorld>>;

    beforeAll(async () => {
      t = await createTestApp();
      w = await buildWatchWorld(t);
      // ---- what DealDash configures to open Pakistan (governed actions in real life; direct here)
      await t.prisma.countryConfiguration.update({
        where: { code: 'PK' },
        data: { status: 'PILOT' },
      });
      await t.prisma.marketProduct.updateMany({
        where: { market: 'PK' },
        data: { status: 'PILOT' },
      });
      // merchant B is Pakistani: branches in Lahore, a Pakistani contracting entity
      await t.prisma.merchantBranch.updateMany({
        where: { organizationId: w.B.orgId },
        data: { country: 'PK', city: 'Lahore' },
      });
      await t.prisma.legalEntity.create({
        data: {
          organizationId: w.B.orgId,
          legalName: 'Lahore Foods (Pvt) Ltd',
          country: 'PK',
          currency: 'PKR',
        },
      });
      // PKR campaign pricing for Pakistan (the SAR platform default is not approved there)
      const def = CONFIG_DEFAULTS['commercial.default_pricing'] as {
        products: Record<string, unknown>;
      };
      await t.prisma.pricingAgreement.create({
        data: {
          name: 'Pakistan pilot pricing (test)',
          scope: 'GLOBAL',
          market: 'PK',
          createdByUserId: w.superAdmin.me.id,
          versions: {
            create: {
              version: 1,
              components: def.products as never,
              taxBps: null,
              unusedTreatment: 'REFUND',
              createdByUserId: w.superAdmin.me.id,
            },
          },
        },
      });
      t.app.get(SystemConfigService).invalidate();
    });
    afterAll(() => t?.close());

    // ================================================================ vouchers
    it('A/B: the same voucher rules price, sell and pay in each market currency (SAR stays SAR)', async () => {
      const sa = await w.publishVoucher('A');
      const pk = await w.publishVoucher('B');
      expect((await t.prisma.voucher.findUniqueOrThrow({ where: { id: sa.id } })).currency).toBe(
        'SAR',
      );
      expect((await t.prisma.voucher.findUniqueOrThrow({ where: { id: pk.id } })).currency).toBe(
        'PKR',
      );

      const c = await w.newCustomer();
      // the customer sees each voucher in its own currency (API value the screens format)
      expect((await w.api(c).get(`/v1/app/vouchers/${sa.id}`)).body.data.currency).toBe('SAR');
      expect((await w.api(c).get(`/v1/app/vouchers/${pk.id}`)).body.data.currency).toBe('PKR');

      for (const [v, cur] of [
        [sa, 'SAR'],
        [pk, 'PKR'],
      ] as const) {
        const b = await w.buy(c, v.id);
        expect(b.order.currency).toBe(cur);
        const pay = await t.prisma.payment.findFirstOrThrow({ where: { orderId: b.orderId } });
        expect(pay.currency).toBe(cur);
        // the sale journal and every account it touches are in the order currency
        const j = await t.prisma.ledgerJournal.findUniqueOrThrow({
          where: { idempotencyKey: `sale:${pay.id}` },
          include: { entries: { include: { account: true } } },
        });
        expect(j.currency).toBe(cur);
        expect(new Set(j.entries.map((e) => e.account.currency))).toEqual(new Set([cur]));
        const wallet = (await w.walletOne(c, b.instanceId!)).body.data;
        expect(wallet.currency).toBe(cur);
      }
      // merchant payables carry the currency; each merchant's summary is in its own market currency
      const evB = await t.prisma.merchantPayableEvent.findMany({
        where: { organizationId: w.B.orgId },
      });
      expect(evB.length).toBeGreaterThan(0);
      expect(new Set(evB.map((e) => e.currency))).toEqual(new Set(['PKR']));
      const evA = await t.prisma.merchantPayableEvent.findMany({
        where: { organizationId: w.A.orgId },
      });
      expect(new Set(evA.map((e) => e.currency))).toEqual(new Set(['SAR']));
      const mv = t.app.get(MerchantVouchersService);
      expect((await mv.payableOf(w.B.orgId)).currency).toBe('PKR');
      expect((await mv.payableOf(w.A.orgId)).currency).toBe('SAR');
      // one ledger account per (family, owner, currency): the Pakistani merchant's held money is a PKR account
      const held = await t.prisma.ledgerAccount.findMany({
        where: { family: 'MERCHANT_HELD', organizationId: w.B.orgId },
      });
      expect(held.map((a) => a.currency)).toEqual(['PKR']);
    });

    it('B: redemption and refund keep the voucher currency (payable, fee, ledger)', async () => {
      const pk = await w.publishVoucher('B');
      const c = await w.newCustomer();
      // redemption
      const o = await w.owned(c, pk.id);
      const rd = await w.redeem(w.staffBorg, o.qr, 'QR');
      expect(rd.body.data.result).toBe('REDEEMED');
      const red = await t.prisma.voucherRedemption.findFirstOrThrow({
        where: { instanceId: o.instanceId! },
      });
      const rj = await t.prisma.ledgerJournal.findUniqueOrThrow({
        where: { idempotencyKey: `redemption:${red.id}` },
      });
      expect(rj.currency).toBe('PKR');
      const eligible = await t.prisma.merchantPayableEvent.findFirstOrThrow({
        where: { instanceId: o.instanceId!, type: 'ELIGIBLE' },
      });
      expect(eligible.currency).toBe('PKR');
      // refund (within the window)
      const b = await w.buy(c, pk.id);
      const rf = await w.requestRefund(c, b.instanceId!);
      expect(rf.status).toBe(201);
      const refund = await t.prisma.refund.findFirstOrThrow({ where: { orderId: b.orderId } });
      expect(refund.currency).toBe('PKR');
    });

    it('D: voucher validity ends at the end of a local day in the voucher market (Karachi vs Riyadh)', async () => {
      const c = await w.newCustomer();
      const sa = await w.publishVoucher('A');
      const pk = await w.publishVoucher('B');
      for (const [v, tz, endUtcHour] of [
        [sa, 'Asia/Riyadh', 20],
        [pk, 'Asia/Karachi', 18],
      ] as const) {
        const b = await w.buy(c, v.id);
        const inst = await t.prisma.voucherInstance.findUniqueOrThrow({
          where: { id: b.instanceId! },
        });
        expect(inst.expiresAt.toISOString()).toBe(
          endOfDayAfter(inst.issuedAt, 30, tz).toISOString(),
        );
        // 23:59:59.999 local = 20:59:59.999Z in Riyadh (UTC+3), 18:59:59.999Z in Karachi (UTC+5)
        expect(inst.expiresAt.getUTCHours()).toBe(endUtcHour);
        expect(inst.expiresAt.getUTCMinutes()).toBe(59);
        // API value the customer screens show
        expect((await w.walletOne(c, b.instanceId!)).body.data.expiresAt).toBe(
          inst.expiresAt.toISOString(),
        );
      }
    });

    // ================================================================ Watch & Earn
    it('C: a Pakistani campaign cannot be priced without a PKR rate card (never the SAR card converted)', async () => {
      const res = await w
        .api(w.ownerB)
        .post(`${w.wbase('B')}/watch`)
        .set('Idempotency-Key', `pk-no-rate-${Date.now()}`)
        .send({ content: w.watchContent('B') });
      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('PRICING_NOT_AVAILABLE');
    });

    it('C: with a PKR rate card, budget, funding and its journal are in PKR; a Saudi campaign stays SAR', async () => {
      const restore = await w.setConfig('watch.rate_card', {
        markets: { PK: { chargePerViewHalalas: 2_500, version: 1 } },
      });
      try {
        const pk = await w.publishWatch('B');
        const sa = await w.publishWatch('A');
        const cp = await t.prisma.watchCampaign.findUniqueOrThrow({ where: { id: pk.id } });
        const cs = await t.prisma.watchCampaign.findUniqueOrThrow({ where: { id: sa.id } });
        expect(cp).toMatchObject({ currency: 'PKR', chargePerViewHalalas: 2_500 });
        expect(cs).toMatchObject({ currency: 'SAR', chargePerViewHalalas: 100 });
        const fp = await t.prisma.watchFunding.findFirstOrThrow({ where: { campaignId: pk.id } });
        expect(fp.currency).toBe('PKR');
        const jf = await t.prisma.ledgerJournal.findFirstOrThrow({
          where: { sourceType: 'WatchCampaign', sourceId: pk.id, type: 'CAMPAIGN_FUNDING' },
        });
        expect(jf.currency).toBe('PKR');
        // the commercial case of each campaign is in its market currency
        const casePk = await t.prisma.commercialCase.findFirstOrThrow({
          where: { subjectId: pk.id },
        });
        const caseSa = await t.prisma.commercialCase.findFirstOrThrow({
          where: { subjectId: sa.id },
        });
        expect(casePk.currency).toBe('PKR');
        expect(caseSa.currency).toBe('SAR');
      } finally {
        await restore();
      }
    });

    it('F: a journal can never mix currencies (database guard)', async () => {
      const sar = await t.prisma.ledgerAccount.findFirstOrThrow({ where: { currency: 'SAR' } });
      await expect(
        t.prisma.$transaction(async (tx) => {
          const j = await tx.ledgerJournal.create({
            data: {
              type: 'ADJUSTMENT',
              sourceType: 'Test',
              sourceId: w.B.orgId,
              currency: 'PKR',
              idempotencyKey: `mixed:${Date.now()}`,
            },
          });
          await tx.ledgerEntry.create({
            data: { journalId: j.id, accountId: sar.id, amountHalalas: 0 },
          });
        }),
      ).rejects.toThrow(/currency/);
    });
  },
);
