import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RESERVATION_POLICY, type ApiEnv } from '@dealdash/config';
import { APP_ENV } from '../src/common/env';
import { SystemConfigService } from '../src/system-config/system-config.service';
import { DB_READY, createTestApp, idem, type Session, type TestApp } from './helpers';
import { buildHotWorld, type HotWorld } from './hot-fixtures';

const PREPAY = {
  method: 'FULL_PREPAYMENT',
  amountMinor: 5_000,
  depositRefundable: null,
  cancelCutoffMinutes: 15,
  noShowRefundPercent: 40,
};

/**
 * Customer experience gap closure, part 2 (2026-10-16): Google / Apple sign-in through the development provider (new account, linking
 * to an existing phone account, sign-in again, cancel, failure, replay, linking from settings, conflicts), saved cards (provider
 * tokens only; add, duplicate, decline, default, remove, paying with one), card-linked offer activation, "Log my saving", the Employee
 * Pass, per-deal reviews and the merchant gallery.
 */
describe.skipIf(!DB_READY)(
  'Customer experience: sign-in, cards, offers, savings, pass, reviews',
  () => {
    let t: TestApp;
    let w: HotWorld;
    let env: ApiEnv;
    let app: string;
    const cfg = () => t.app.get(SystemConfigService);
    const actor = () => ({ userId: w.superAdmin.me.id, membership: null }) as never;
    const meta = { requestId: 'test', ip: '127.0.0.1', userAgent: 'vitest' } as never;
    const cookieOf = (res: { headers: Record<string, unknown> }) =>
      ([] as string[])
        .concat((res.headers['set-cookie'] as string[] | string | undefined) ?? [])
        .find((c) => c.startsWith('dd_customer='));

    beforeAll(async () => {
      t = await createTestApp();
      w = await buildHotWorld(t);
      env = t.app.get(APP_ENV);
      app = env.CORS_ORIGINS[0]!;
      // merchant A: paid reservations only (saved cards); B keeps the environment default (free on test machines)
      await cfg().set(
        'reservation.policy',
        { ...DEFAULT_RESERVATION_POLICY, merchant: { [w.A.orgId]: { freeAllowed: false } } },
        'test',
        actor(),
        meta,
      );
    });
    afterAll(async () => {
      if (t)
        await cfg()
          .set('reservation.policy', DEFAULT_RESERVATION_POLICY, 'test restore', actor(), meta)
          .catch(() => undefined);
      await t?.close();
    });

    // ---------------------------------------------------------------- Google / Apple sign-in
    const startSocial = async (provider: 'GOOGLE' | 'APPLE', s?: Session, intent = 'SIGN_IN') => {
      const body = { provider, intent, callbackUrl: `${app}/en/auth/social/callback` };
      const res = s
        ? await w.api(s).post('/v1/auth/social/start').send(body)
        : await t.http.post('/v1/auth/social/start').send(body);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const url = new URL(res.body.data.authorizeUrl);
      expect(url.origin).toBe(app);
      expect(url.searchParams.get('mock_social')).toBe(provider);
      return url.searchParams.get('state')!;
    };
    const approve = async (provider: 'GOOGLE' | 'APPLE', state: string, subject: string) => {
      const r = await t.http.post('/v1/dev/social/approve').send({
        state,
        provider,
        subject,
        email: `${subject}@example.com`,
        name: 'Sara Ahmed',
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body.data.code as string;
    };
    const otpCode = async (mobile: string) => {
      const r = await t.http.post('/v1/auth/otp/request').send({ mobile, audience: 'customer' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return /\b(\d{6})\b/.exec(t.sms.lastTo(mobile)?.body ?? '')![1]!;
    };
    const mobile = () => `+96656${Math.floor(1000000 + Math.random() * 8999999)}`;

    it('first Google sign-in: phone step creates the account and links Google; the next Google sign-in signs straight in', async () => {
      const subject = `new-${randomUUID().slice(0, 8)}`;
      const state = await startSocial('GOOGLE');
      const code = await approve('GOOGLE', state, subject);
      const cb = await t.http.post('/v1/auth/social/callback').send({ state, code });
      expect(cb.status, JSON.stringify(cb.body)).toBe(200);
      expect(cb.body.data).toMatchObject({
        status: 'NEEDS_PHONE',
        provider: 'GOOGLE',
        intent: 'SIGN_IN',
        csrfToken: null,
        profile: { name: 'Sara Ahmed', email: `${subject}@example.com` },
      });
      expect(cookieOf(cb)).toBeUndefined(); // no session before the phone is confirmed
      const m = mobile();
      // (each request is built only after the previous one finished: supertest runs one server per request)
      const otp = await otpCode(m);
      const done = await t.http.post('/v1/auth/social/complete').send({
        linkToken: cb.body.data.linkToken,
        mobile: m,
        code: otp,
      });
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      expect(done.body.data).toMatchObject({
        account: 'NEW',
        provider: 'GOOGLE',
        csrfToken: expect.any(String),
      });
      expect(cookieOf(done)).toBeDefined();
      const user = await t.prisma.user.findUniqueOrThrow({ where: { mobile: m } });
      expect(
        await t.prisma.userIdentity.findFirst({ where: { userId: user.id, provider: 'GOOGLE' } }),
      ).toMatchObject({ subject: `google-${subject}`, email: `${subject}@example.com` });
      // the verified name and e-mail start the profile
      expect(await t.prisma.customer.findUnique({ where: { userId: user.id } })).toMatchObject({
        firstName: 'Sara',
        lastName: 'Ahmed',
        email: `${subject}@example.com`,
      });
      // the link token is single use
      expect(
        (
          await t.http.post('/v1/auth/social/complete').send({
            linkToken: cb.body.data.linkToken,
            mobile: m,
            code: '000000',
          })
        ).body.errors[0].code,
      ).toBe('SOCIAL_SIGN_IN_EXPIRED');

      // signing in with the same Google account again: straight in, with a session
      const s2 = await startSocial('GOOGLE');
      const code2 = await approve('GOOGLE', s2, subject);
      const again = await t.http.post('/v1/auth/social/callback').send({ state: s2, code: code2 });
      expect(again.body.data).toMatchObject({ status: 'SIGNED_IN', csrfToken: expect.any(String) });
      expect(cookieOf(again)).toBeDefined();
    });

    it('an existing phone account is linked (never a second account); Apple works the same way', async () => {
      const m = mobile();
      const existing = await t.prisma.user.create({
        data: {
          userType: 'CUSTOMER',
          mobile: m,
          displayName: 'Customer',
          customer: { create: { firstName: 'Noor' } },
        },
      });
      const state = await startSocial('APPLE');
      const code = await approve('APPLE', state, `apple-${randomUUID().slice(0, 8)}`);
      const cb = await t.http.post('/v1/auth/social/callback').send({ state, code });
      const otp = await otpCode(m);
      const done = await t.http
        .post('/v1/auth/social/complete')
        .send({ linkToken: cb.body.data.linkToken, mobile: m, code: otp });
      expect(done.body.data.account).toBe('EXISTING');
      expect(await t.prisma.user.count({ where: { mobile: m } })).toBe(1);
      expect(
        await t.prisma.userIdentity.count({ where: { userId: existing.id, provider: 'APPLE' } }),
      ).toBe(1);
      // the name the customer already had is kept
      expect(
        (await t.prisma.customer.findUnique({ where: { userId: existing.id } }))?.firstName,
      ).toBe('Noor');
    });

    it('cancel, provider error, invalid code, replayed state and foreign callback addresses', async () => {
      const s1 = await startSocial('GOOGLE');
      const cancelled = await t.http
        .post('/v1/auth/social/callback')
        .send({ state: s1, error: 'access_denied' });
      expect(cancelled.body.data.status).toBe('CANCELLED');
      // a state is never accepted twice
      const replay = await t.http.post('/v1/auth/social/callback').send({ state: s1, code: 'x' });
      expect(replay.status).toBe(400);
      expect(replay.body.errors[0].code).toBe('SOCIAL_SIGN_IN_EXPIRED');
      const s2 = await startSocial('GOOGLE');
      expect(
        (await t.http.post('/v1/auth/social/callback').send({ state: s2, error: 'server_error' }))
          .body.data.status,
      ).toBe('FAILED');
      const s3 = await startSocial('APPLE');
      expect(
        (await t.http.post('/v1/auth/social/callback').send({ state: s3, code: 'not-a-real-code' }))
          .body.data.status,
      ).toBe('FAILED');
      expect(
        (
          await t.http
            .post('/v1/auth/social/callback')
            .send({ state: 'unknown-state-0123456789', code: 'x' })
        ).status,
      ).toBe(400);
      const evil = await t.http.post('/v1/auth/social/start').send({
        provider: 'GOOGLE',
        intent: 'SIGN_IN',
        callbackUrl: 'https://evil.example/cb',
      });
      expect(evil.status).toBe(400);
      // linking needs a signed-in customer
      expect(
        (
          await t.http.post('/v1/auth/social/start').send({
            provider: 'GOOGLE',
            intent: 'LINK',
            callbackUrl: `${app}/en/auth/social/callback`,
          })
        ).status,
      ).toBe(401);
    });

    it('Account settings: link, see, conflict with another account, unlink', async () => {
      const c = await w.newCustomer();
      const subject = `link-${randomUUID().slice(0, 8)}`;
      const state = await startSocial('GOOGLE', c, 'LINK');
      const code = await approve('GOOGLE', state, subject);
      const linked = await w.api(c).post('/v1/auth/social/callback').send({ state, code });
      expect(linked.body.data).toMatchObject({ status: 'LINKED', intent: 'LINK' });
      const list = await w.api(c).get('/v1/app/me/identities');
      expect(list.body.data).toMatchObject({
        items: [{ provider: 'GOOGLE', email: `${subject}@example.com` }],
        available: ['GOOGLE', 'APPLE'],
      });
      // the same Google account cannot be linked to a second DealDash account
      const other = await w.newCustomer();
      const s2 = await startSocial('GOOGLE', other, 'LINK');
      const code2 = await approve('GOOGLE', s2, subject);
      const conflict = await w
        .api(other)
        .post('/v1/auth/social/callback')
        .send({ state: s2, code: code2 });
      expect(conflict.body.data.status).toBe('CONFLICT');
      const un = await w.api(c).delete('/v1/app/me/identities/GOOGLE');
      expect(un.body.data.items).toEqual([]);
      expect((await w.api(c).delete('/v1/app/me/identities/FACEBOOK')).status).toBe(404);
    });

    // ---------------------------------------------------------------- saved cards
    const addCard = async (
      s: Session,
      card: string,
      opts: { makeDefault?: boolean; outcome?: 'SAVED' | 'CANCELLED' } = {},
    ) => {
      const start = await w
        .api(s)
        .post('/v1/app/payment-methods/setups')
        .send({ returnUrl: `${app}/en/payment-methods`, makeDefault: !!opts.makeDefault });
      expect(start.status, JSON.stringify(start.body)).toBe(200);
      const url = new URL(start.body.data.redirectUrl);
      expect(url.searchParams.get('setup')).toBe(start.body.data.setupId);
      const ref = url.searchParams.get('mock_setup')!;
      expect(
        (
          await t.http
            .post(`/v1/dev/payment-methods/${ref}/complete`)
            .send({ outcome: opts.outcome ?? 'SAVED', card })
        ).status,
      ).toBe(200);
      return { setupId: start.body.data.setupId as string, ref };
    };
    const finish = (s: Session, setupId: string) =>
      w.api(s).post(`/v1/app/payment-methods/setups/${setupId}/finish`).send({});

    it('saved cards: added on the provider page (token only), duplicates kept once, declined / cancelled, default, remove', async () => {
      const c = await w.newCustomer();
      expect((await w.api(c).get('/v1/app/payment-methods')).body.data).toEqual({
        items: [],
        canSave: true,
      });
      const visa = await addCard(c, 'VISA_4242');
      const f1 = await finish(c, visa.setupId);
      expect(f1.body.data).toMatchObject({
        status: 'COMPLETED',
        duplicate: false,
        card: { brand: 'VISA', last4: '4242', isDefault: true, expired: false },
      });
      // finishing twice gives the same answer (no second card)
      expect((await finish(c, visa.setupId)).body.data.card.id).toBe(f1.body.data.card.id);
      const mc = await addCard(c, 'MASTERCARD_5454', { makeDefault: true });
      const f2 = await finish(c, mc.setupId);
      expect(f2.body.data.card).toMatchObject({ brand: 'MASTERCARD', isDefault: true });
      // the same card again is not saved twice
      const dup = await addCard(c, 'VISA_4242');
      expect((await finish(c, dup.setupId)).body.data).toMatchObject({
        status: 'COMPLETED',
        duplicate: true,
      });
      const declined = await addCard(c, 'DECLINED');
      expect((await finish(c, declined.setupId)).body.data).toMatchObject({
        status: 'FAILED',
        failureCode: 'CARD_DECLINED',
        card: null,
      });
      const cancelled = await addCard(c, 'VISA_4242', { outcome: 'CANCELLED' });
      expect((await finish(c, cancelled.setupId)).body.data.status).toBe('CANCELLED');
      let list = (await w.api(c).get('/v1/app/payment-methods')).body.data.items;
      expect(
        list.map((x: { last4: string; isDefault: boolean }) => [x.last4, x.isDefault]),
      ).toEqual([
        ['5454', true],
        ['4242', false],
      ]);
      // nothing but display details is stored: never a card number
      const rows = await t.prisma.customerPaymentMethod.findMany({ where: { userId: c.me.id } });
      for (const r of rows) {
        expect(r.last4).toMatch(/^\d{4}$/);
        expect(JSON.stringify(r)).not.toMatch(/\d{12,19}/);
      }
      await expect(
        t.prisma.customerPaymentMethod.create({
          data: {
            userId: c.me.id,
            provider: 'mock',
            providerToken: `x-${randomUUID()}`,
            fingerprint: 'x',
            brand: 'VISA',
            last4: '4242424242424242',
            expMonth: 1,
            expYear: 2030,
          },
        }),
      ).rejects.toThrow();
      // default and remove
      const visaId = list.find((x: { last4: string }) => x.last4 === '4242').id;
      list = (await w.api(c).put(`/v1/app/payment-methods/${visaId}/default`).send({})).body.data
        .items;
      expect(list[0]).toMatchObject({ last4: '4242', isDefault: true });
      list = (await w.api(c).delete(`/v1/app/payment-methods/${visaId}`)).body.data.items;
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ last4: '5454', isDefault: true });
      // another customer can neither finish this customer's setup nor touch their cards
      const other = await w.newCustomer();
      expect((await finish(other, mc.setupId)).status).toBe(404);
      expect((await w.api(other).delete(`/v1/app/payment-methods/${list[0].id}`)).status).toBe(404);
      expect((await t.http.get('/v1/app/payment-methods')).status).toBe(401);
    });

    it('paying for a reservation with a saved card hands the provider its token; another customer’s card is refused before reserving', async () => {
      const c = await w.newCustomer();
      const { setupId } = await addCard(c, 'MADA_1234');
      const card = (await finish(c, setupId)).body.data.card;
      const deal = await w.publishHot('A', 5, { commitment: PREPAY });
      const res = await w
        .api(c)
        .post(`/v1/app/hot-deals/${deal.id}/reservations`)
        .set('Idempotency-Key', idem())
        .send({
          branchId: w.A.branchIds[0],
          quantity: 1,
          acceptTerms: true,
          returnUrl: `${app}/en/reservations/return`,
          paymentMethodId: card.id,
        });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const redirect = new URL(res.body.data.payment.redirectUrl);
      const token = redirect.searchParams.get('mock_card')!;
      expect(token).toMatch(/^mock_tok_/);
      expect((await t.http.get(`/v1/dev/payment-methods/cards/${token}`)).body.data).toEqual({
        brand: 'MADA',
        last4: '1234',
      });
      const ref = redirect.searchParams.get('mock_payment')!;
      await t.http.post(`/v1/dev/reservations/${ref}/complete`).send({ outcome: 'SUCCEEDED' });
      expect(
        (await w.api(c).get(`/v1/app/reservations/${res.body.data.id}`)).body.data,
      ).toMatchObject({
        displayState: 'HELD',
        payment: { status: 'PAID' },
      });
      // someone else's card: refused, nothing reserved
      const stranger = await w.newCustomer();
      const before = await t.prisma.reservation.count({ where: { dealId: deal.id } });
      const bad = await w
        .api(stranger)
        .post(`/v1/app/hot-deals/${deal.id}/reservations`)
        .set('Idempotency-Key', idem())
        .send({
          branchId: w.A.branchIds[0],
          quantity: 1,
          acceptTerms: true,
          paymentMethodId: card.id,
        });
      expect(bad.status).toBe(404);
      expect(bad.body.errors[0].code).toBe('PAYMENT_METHOD_NOT_FOUND');
      expect(await t.prisma.reservation.count({ where: { dealId: deal.id } })).toBe(before);
    });

    // ---------------------------------------------------------------- card-linked offers
    it('card offers: guests and customers without the card see which cards open it; activate on an added card; history', async () => {
      const program = await t.prisma.partnerCardProgram.create({
        data: {
          partnerOrganizationId: w.bank,
          code: `CX-${randomUUID().slice(0, 6)}`,
          nameEn: 'BankCo Signature',
          nameAr: 'بنك كو سيجنتشر',
          scheme: 'visa',
          issuerName: 'BankCo',
          productCode: `SIG-${randomUUID().slice(0, 6)}`,
          tier: 'signature',
          market: 'SA',
          status: 'ACTIVE',
          createdByUserId: randomUUID(),
        },
      });
      const deal = await w.publishHot('B', 3, {
        eligibility: { kind: 'BANK_CARD', valueRefs: [w.bank] },
      });
      const pub = await w.publishHot('B', 3);
      const guest = await t.http.get(`/v1/app/card-offers/hot/${deal.id}`);
      expect(guest.body.data).toMatchObject({ state: 'NEEDS_CARD', cards: [], activation: null });
      expect(guest.body.data.issuers.map((i: { id: string }) => i.id)).toContain(w.bank);
      expect((await t.http.get(`/v1/app/card-offers/hot/${pub.id}`)).body.data.state).toBe(
        'NOT_CARD_OFFER',
      );
      expect((await t.http.get(`/v1/app/card-offers/coupon/${pub.id}`)).status).toBe(404);
      const c = await w.newCustomer();
      expect((await w.api(c).get(`/v1/app/card-offers/hot/${deal.id}`)).body.data.state).toBe(
        'NEEDS_CARD',
      );
      const refused = await w
        .api(c)
        .post(`/v1/app/card-offers/hot/${deal.id}/activate`)
        .set('Idempotency-Key', idem())
        .send({ programId: program.id });
      expect(refused.status).toBe(422);
      expect(refused.body.errors[0].code).toBe('OFFER_ACTIVATION_NOT_ALLOWED');
      const added = await w
        .api(c)
        .post('/v1/app/benefits/cards')
        .set('Idempotency-Key', idem())
        .send({ programId: program.id });
      expect(added.status, JSON.stringify(added.body)).toBe(200);
      const avail = (await w.api(c).get(`/v1/app/card-offers/hot/${deal.id}`)).body.data;
      expect(avail).toMatchObject({ state: 'AVAILABLE', cards: [{ programId: program.id }] });
      const act = await w
        .api(c)
        .post(`/v1/app/card-offers/hot/${deal.id}/activate`)
        .set('Idempotency-Key', idem())
        .send({ programId: program.id });
      expect(act.status, JSON.stringify(act.body)).toBe(200);
      expect(act.body.data).toMatchObject({
        state: 'ACTIVATED',
        activation: { programId: program.id, cardName: { en: 'BankCo Signature' } },
      });
      // activating again changes nothing
      expect(
        (
          await w
            .api(c)
            .post(`/v1/app/card-offers/hot/${deal.id}/activate`)
            .set('Idempotency-Key', idem())
            .send({ programId: program.id })
        ).body.data.state,
      ).toBe('ACTIVATED');
      expect(await t.prisma.cardOfferActivation.count({ where: { userId: c.me.id } })).toBe(1);
      const hist = (await w.api(c).get('/v1/app/card-offers')).body.data;
      expect(hist).toEqual([
        expect.objectContaining({ product: 'HOT', offerId: deal.id, status: 'ACTIVE' }),
      ]);
      expect(
        (await w.api(c).get('/v1/app/benefits/history')).body.data.map(
          (h: { event: string }) => h.event,
        ),
      ).toContain('OFFER_ACTIVATED');
      // removing the card shows the activation as no longer usable
      await w.api(c).delete(`/v1/app/benefits/cards/${program.id}`);
      expect((await w.api(c).get('/v1/app/card-offers')).body.data[0].status).toBe('CARD_REMOVED');
    });

    // ---------------------------------------------------------------- Log my saving + per-deal reviews
    it('a redeemed reservation: log the saving once; review the deal once (only after using it)', async () => {
      const deal = await w.publishHot('B', 3);
      const c = await w.newCustomer();
      const reviews = () => w.api(c).get(`/v1/app/hot-deals/${deal.id}/reviews`);
      // guests read; nobody has reviewed yet
      expect((await t.http.get(`/v1/app/hot-deals/${deal.id}/reviews`)).body.data).toEqual({
        summary: { count: 0, average: null, distribution: [0, 0, 0, 0, 0] },
        items: [],
        mine: null,
      });
      expect((await reviews()).body.data.mine).toEqual({
        canReview: false,
        reason: 'NOT_REDEEMED',
      });
      const early = await w
        .api(c)
        .post(`/v1/app/hot-deals/${deal.id}/reviews`)
        .set('Idempotency-Key', idem())
        .send({ rating: 5, text: 'Lovely kabsa, generous portions.' });
      expect(early.status).toBe(403);
      expect(early.body.errors[0].code).toBe('REVIEW_NOT_ALLOWED');

      const r = (await w.reserve(c, deal.id, w.B.branchIds[0]!)).body.data;
      const logEarly = await w
        .api(c)
        .post('/v1/app/savings')
        .set('Idempotency-Key', idem())
        .send({ sourceType: 'RESERVATION', sourceId: r.id, amountMinor: 1_500 });
      expect(logEarly.status).toBe(422);
      expect(logEarly.body.errors[0].code).toBe('SAVING_NOT_ALLOWED');
      expect((await w.redeem(w.staffBorg, r.code.qr)).body.data.result).toBe('REDEEMED');

      // Log my saving
      const state = await w.api(c).get(`/v1/app/savings/RESERVATION/${r.id}`);
      expect(state.body.data).toMatchObject({
        canLog: true,
        logged: null,
        currency: expect.stringMatching(/^[A-Z]{3}$/),
      });
      const logged = await w
        .api(c)
        .post('/v1/app/savings')
        .set('Idempotency-Key', idem())
        .send({ sourceType: 'RESERVATION', sourceId: r.id, amountMinor: 1_500 });
      expect(logged.status, JSON.stringify(logged.body)).toBe(200);
      expect(logged.body.data).toMatchObject({ canLog: false, logged: { amountMinor: 1_500 } });
      const twice = await w
        .api(c)
        .post('/v1/app/savings')
        .set('Idempotency-Key', idem())
        .send({ sourceType: 'RESERVATION', sourceId: r.id, amountMinor: 900 });
      expect(twice.status).toBe(409);
      expect(twice.body.errors[0].code).toBe('SAVING_ALREADY_LOGGED');
      const summary = (await w.api(c).get('/v1/app/savings')).body.data;
      expect(summary.totals).toEqual([
        { currency: state.body.data.currency, amountMinor: 1_500, count: 1 },
      ]);
      expect(summary.items[0]).toMatchObject({ sourceId: r.id, title: { en: expect.any(String) } });
      // nobody else can log or read it
      const other = await w.newCustomer();
      expect((await w.api(other).get(`/v1/app/savings/RESERVATION/${r.id}`)).status).toBe(404);
      expect(
        (
          await w
            .api(other)
            .post('/v1/app/savings')
            .set('Idempotency-Key', idem())
            .send({ sourceType: 'RESERVATION', sourceId: r.id, amountMinor: 100 })
        ).status,
      ).toBe(404);

      // per-deal review
      expect((await reviews()).body.data.mine).toEqual({ canReview: true, reason: null });
      const post = await w
        .api(c)
        .post(`/v1/app/hot-deals/${deal.id}/reviews`)
        .set('Idempotency-Key', idem())
        .send({ rating: 4, text: 'Lovely kabsa, generous portions.' });
      expect(post.status, JSON.stringify(post.body)).toBe(201);
      expect(post.body.data).toMatchObject({
        subjectType: 'EXCLUSIVE',
        subjectId: deal.id,
        verified: true,
      });
      const after = (await reviews()).body.data;
      expect(after.summary).toEqual({ count: 1, average: 4, distribution: [0, 1, 0, 0, 0] });
      expect(after.items[0]).toMatchObject({ rating: 4, verified: true });
      expect(after.mine).toEqual({ canReview: false, reason: 'ALREADY_REVIEWED' });
      const dup = await w
        .api(c)
        .post(`/v1/app/hot-deals/${deal.id}/reviews`)
        .set('Idempotency-Key', idem())
        .send({ rating: 1, text: 'Changed my mind about this one.' });
      expect(dup.status).toBe(409);
      expect(dup.body.errors[0].code).toBe('REVIEW_ALREADY_EXISTS');
      // the deal review also counts for the merchant
      const merchant = (await t.http.get(`/v1/app/merchants/${w.B.orgId}/reviews`)).body.data;
      expect(merchant.items.map((i: { subjectId: string | null }) => i.subjectId)).toContain(
        deal.id,
      );
    });

    // ---------------------------------------------------------------- Employee Pass
    it('Employee Pass: inactive without an employer, active once verified (stable pass number), inactive when expired', async () => {
      const c = await w.newCustomer();
      expect((await w.api(c).get('/v1/app/benefits/employee-pass')).body.data).toMatchObject({
        status: 'INACTIVE',
        reason: 'NONE',
        employer: null,
        passNumber: null,
      });
      const attr = await t.prisma.eligibilityAttribute.create({
        data: {
          userId: c.me.id,
          attrType: 'EMPLOYER',
          valueRef: w.employer,
          level: 'OTP_VERIFIED',
          status: 'VERIFIED',
          verifiedAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 86_400_000),
          contactMasked: 's***@employer.example',
        },
      });
      const a = (await w.api(c).get('/v1/app/benefits/employee-pass')).body.data;
      expect(a).toMatchObject({
        status: 'ACTIVE',
        reason: 'VERIFIED',
        employer: { id: w.employer },
        maskedEmail: 's***@employer.example',
        passNumber: expect.stringMatching(/^EP-[0-9A-F]{4}-[0-9A-F]{4}$/),
      });
      expect((await w.api(c).get('/v1/app/benefits/employee-pass')).body.data.passNumber).toBe(
        a.passNumber,
      );
      await t.prisma.eligibilityAttribute.update({
        where: { id: attr.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await w.api(c).get('/v1/app/benefits/employee-pass')).body.data).toMatchObject({
        status: 'INACTIVE',
        reason: 'EXPIRED',
      });
      expect((await t.http.get('/v1/app/benefits/employee-pass')).status).toBe(401);
    });

    // ---------------------------------------------------------------- merchant gallery
    it('merchant gallery: the merchant page lists its gallery photos (empty when it has none)', async () => {
      const before = await t.http.get(`/v1/app/merchants/${w.B.orgId}`);
      expect(before.body.data.gallery).toEqual([]);
      const m = await t.prisma.merchant.findUniqueOrThrow({ where: { organizationId: w.A.orgId } });
      await t.prisma.merchant.update({
        where: { organizationId: w.A.orgId },
        data: { galleryFileIds: [w.fileA2, w.fileA] },
      });
      try {
        const page = await t.http.get(`/v1/app/merchants/${w.A.orgId}`);
        expect(page.status).toBe(200);
        expect(page.body.data.gallery).toHaveLength(2);
        for (const u of page.body.data.gallery) expect(typeof u).toBe('string');
      } finally {
        await t.prisma.merchant.update({
          where: { organizationId: w.A.orgId },
          data: { galleryFileIds: m.galleryFileIds ?? [] },
        });
      }
    });
  },
);
