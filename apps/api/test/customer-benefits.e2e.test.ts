import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BenefitsService } from '../src/benefits/benefits.service';
import { EMAIL_PROVIDER } from '../src/providers/interfaces';
import type { MockEmailProvider } from '../src/providers/mocks';
import { DB_READY, createTestApp, type Session, type TestApp } from './helpers';
import { buildHotWorld, type HotWorld } from './hot-fixtures';

/**
 * Customer "My benefits" end to end (Business Rules §5 EL, §6 EM, §7 BC): employer work-email verification, added cards, benefit
 * offers across products (unlocked / available) with partner attribution, usage with redemption status, history, notifications,
 * expiry and renewal reminders.
 */
describe.skipIf(!DB_READY)('Customer My benefits', () => {
  let t: TestApp;
  let w: HotWorld;
  let email: MockEmailProvider;
  let employerProgram: string;
  let cardProgram: string;
  let draftProgram: string;
  const domain = `emp${Date.now().toString(36)}.example`;

  beforeAll(async () => {
    t = await createTestApp();
    w = await buildHotWorld(t);
    email = t.app.get(EMAIL_PROVIDER) as MockEmailProvider;
    const by = randomUUID();
    employerProgram = (
      await t.prisma.partnerEmployerProgram.create({
        data: {
          partnerOrganizationId: w.employer,
          code: `EMP-${randomUUID().slice(0, 6)}`,
          nameEn: 'EmployerCo staff',
          nameAr: 'موظفو الشركة',
          domains: [domain],
          market: 'SA',
          status: 'ACTIVE',
          createdByUserId: by,
        },
      })
    ).id;
    cardProgram = (
      await t.prisma.partnerCardProgram.create({
        data: {
          partnerOrganizationId: w.bank,
          code: `CARD-${randomUUID().slice(0, 6)}`,
          nameEn: 'BankCo Platinum',
          nameAr: 'بنك كو بلاتينيوم',
          scheme: 'visa',
          issuerName: 'BankCo',
          productCode: `PLAT-${randomUUID().slice(0, 6)}`,
          tier: 'platinum',
          market: 'SA',
          status: 'ACTIVE',
          createdByUserId: by,
        },
      })
    ).id;
    draftProgram = (
      await t.prisma.partnerCardProgram.create({
        data: {
          partnerOrganizationId: w.bank,
          code: `DRAFT-${randomUUID().slice(0, 6)}`,
          nameEn: 'BankCo Draft',
          nameAr: 'مسودة',
          scheme: 'visa',
          issuerName: 'BankCo',
          productCode: `DRAFT-${randomUUID().slice(0, 6)}`,
          tier: 'gold',
          market: 'SA',
          status: 'DRAFT',
          createdByUserId: by,
        },
      })
    ).id;
  });
  afterAll(() => t?.close());

  const b = (s: Session) => w.api(s);
  const codeFor = (to: string) =>
    /\b(\d{6})\b/.exec(email.lastTo(to, 'benefit.employer_code')?.body ?? '')?.[1] ?? '';

  it('needs a signed-in customer', async () => {
    expect((await t.http.get('/v1/app/benefits')).status).toBe(401);
  });

  it('lists only ACTIVE programmes of active partners (EM-01 / BC-01)', async () => {
    const c = await w.newCustomer();
    const res = await b(c).get('/v1/app/benefits/options');
    expect(res.status).toBe(200);
    const ids = [
      ...res.body.data.employers.map((e: { programId: string }) => e.programId),
      ...res.body.data.cards.map((e: { programId: string }) => e.programId),
    ];
    expect(ids).toContain(employerProgram);
    expect(ids).toContain(cardProgram);
    expect(ids).not.toContain(draftProgram);
    const card = res.body.data.cards.find(
      (x: { programId: string }) => x.programId === cardProgram,
    );
    expect(JSON.stringify(card)).not.toMatch(/bin|prefix|pan|cvv/i);
  });

  it('employer: rejects personal / shared and wrong-domain emails, verifies by work-email code, unlocks employer offers', async () => {
    const deal = await w.publish('A', {
      title: { en: 'Employer only brunch', ar: 'غداء للموظفين' },
      eligibility: { kind: 'EMPLOYER', valueRefs: [w.employer] },
    });
    const c = await w.newCustomer();

    const personal = await b(c)
      .post('/v1/app/benefits/employer/code')
      .send({ programId: employerProgram, email: 'someone@gmail.com' });
    expect(personal.status).toBe(422);
    expect(personal.body.errors[0].code).toBe('BENEFIT_EMAIL_NOT_ALLOWED');
    const shared = await b(c)
      .post('/v1/app/benefits/employer/code')
      .send({ programId: employerProgram, email: `hr@${domain}` });
    expect(shared.body.errors[0].code).toBe('BENEFIT_EMAIL_NOT_ALLOWED');
    const wrong = await b(c)
      .post('/v1/app/benefits/employer/code')
      .send({ programId: employerProgram, email: 'sara@other-company.example' });
    expect(wrong.body.errors[0].code).toBe('BENEFIT_EMAIL_DOMAIN');

    // before: the employer offer is available to unlock, not unlocked
    const before = await b(c).get('/v1/app/benefits/offers?tab=available');
    const avail = before.body.data.find((o: { card: { id: string } }) => o.card.id === deal.id);
    expect(avail).toMatchObject({ product: 'LIVE' });
    expect(avail.card.eligibility).toMatchObject({
      result: 'LOCKED_UNLOCKABLE',
      unlockAction: 'VERIFY_EMPLOYER',
    });
    expect(avail.partners.map((p: { id: string }) => p.id)).toEqual([w.employer]);

    const addr = `sara.k@mail.${domain}`; // subdomain of the approved domain
    const start = await b(c)
      .post('/v1/app/benefits/employer/code')
      .send({ programId: employerProgram, email: addr });
    expect(start.status).toBe(200);
    expect(start.body.data.maskedEmail).toBe(`s***@mail.${domain}`);
    const pending = await b(c).get('/v1/app/benefits');
    expect(pending.body.data.employer).toMatchObject({
      status: 'PENDING',
      maskedEmail: `s***@mail.${domain}`,
    });

    const bad = await b(c)
      .post('/v1/app/benefits/employer/verify')
      .send({
        programId: employerProgram,
        email: addr,
        code: '000000' === codeFor(addr) ? '111111' : '000000',
      });
    expect(bad.status).toBe(400);
    expect(bad.body.errors[0].code).toBe('OTP_INVALID');

    const ok = await b(c)
      .post('/v1/app/benefits/employer/verify')
      .send({ programId: employerProgram, email: addr, code: codeFor(addr) });
    expect(ok.status).toBe(200);
    expect(ok.body.data.employer).toMatchObject({
      status: 'VERIFIED',
      partner: { id: w.employer },
      maskedEmail: `s***@mail.${domain}`,
    });
    expect(ok.body.data.employer.expiresAt).toBeTruthy();
    expect(JSON.stringify(ok.body.data)).not.toContain(addr);

    // stored: OTP-verified, hashed + encrypted address, never in clear
    const attr = await t.prisma.eligibilityAttribute.findFirstOrThrow({
      where: { userId: c.me.id, attrType: 'EMPLOYER', valueRef: w.employer },
    });
    expect(attr).toMatchObject({
      level: 'OTP_VERIFIED',
      status: 'VERIFIED',
      programId: employerProgram,
    });
    expect(attr.contactEnc).toMatch(/^v1:/);
    expect(attr.contactHash).toBeTruthy();
    expect(JSON.stringify(attr)).not.toContain(addr);

    const after = await b(c).get('/v1/app/benefits/offers?tab=unlocked');
    const unlocked = after.body.data.find((o: { card: { id: string } }) => o.card.id === deal.id);
    expect(unlocked.card.eligibility.result).toBe('ELIGIBLE');
    // and everywhere else the same engine is used
    const detail = await b(c).get(`/v1/app/live-deals/${deal.id}`);
    expect(detail.body.data.eligibility.result).toBe('ELIGIBLE');

    // EM-06: the same work email cannot be linked to a second account
    const other = await w.newCustomer();
    const dup = await b(other)
      .post('/v1/app/benefits/employer/code')
      .send({ programId: employerProgram, email: addr });
    expect(dup.status).toBe(409);
    expect(dup.body.errors[0].code).toBe('BENEFIT_EMAIL_IN_USE');

    // notification + history
    const inbox = await b(c).get('/v1/app/notifications');
    expect(
      inbox.body.data.items.some(
        (n: { type: string; data: { event: string } }) =>
          n.type === 'BENEFIT_UPDATED' && n.data.event === 'EMPLOYER_VERIFIED',
      ),
    ).toBe(true);
    const hist = await b(c).get('/v1/app/benefits/history');
    expect(hist.body.data.map((h: { event: string }) => h.event)).toEqual(
      expect.arrayContaining(['EMPLOYER_CODE_SENT', 'EMPLOYER_VERIFIED']),
    );

    // EL-12: removing the employer locks the offer again at once
    const rm = await b(c).delete('/v1/app/benefits/employer');
    expect(rm.status).toBe(200);
    expect(rm.body.data.employer).toBeNull();
    const locked = await b(c).get(`/v1/app/live-deals/${deal.id}`);
    expect(locked.body.data.eligibility.result).toBe('LOCKED_UNLOCKABLE');
    const removed = await t.prisma.eligibilityAttribute.findFirstOrThrow({
      where: { id: attr.id },
    });
    expect(removed).toMatchObject({ status: 'REVOKED', contactEnc: null, contactHash: null });
  });

  it('wrong codes lock the attempt after the configured maximum', async () => {
    const c = await w.newCustomer();
    const addr = `lock.test@${domain}`;
    await b(c)
      .post('/v1/app/benefits/employer/code')
      .send({ programId: employerProgram, email: addr });
    const right = codeFor(addr);
    const wrongCode = right === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++)
      await b(c)
        .post('/v1/app/benefits/employer/verify')
        .send({ programId: employerProgram, email: addr, code: wrongCode });
    const locked = await b(c)
      .post('/v1/app/benefits/employer/verify')
      .send({ programId: employerProgram, email: addr, code: right });
    expect(locked.status).toBe(429);
    expect(locked.body.errors[0].code).toBe('OTP_LOCKED');
    const ov = await b(c).get('/v1/app/benefits');
    expect(ov.body.data.employer.status).toBe('FAILED');
  });

  it('cards: added (never verified), unlock card offers, show usage with redemption status, removal locks again', async () => {
    const hot = await w.publishHot('A', 5, {
      title: { en: 'Card holders tasting', ar: 'تذوق لحاملي البطاقات' },
      eligibility: { kind: 'BANK_CARD', valueRefs: [w.bank] },
    });
    const c = await w.newCustomer();
    const draft = await b(c)
      .post('/v1/app/benefits/cards')
      .set('Idempotency-Key', randomUUID())
      .send({ programId: draftProgram });
    expect(draft.status).toBe(422);
    expect(draft.body.errors[0].code).toBe('BENEFIT_PROGRAM_UNAVAILABLE');

    const add = await b(c)
      .post('/v1/app/benefits/cards')
      .set('Idempotency-Key', randomUUID())
      .send({ programId: cardProgram });
    expect(add.status).toBe(200);
    expect(add.body.data.cards).toEqual([
      expect.objectContaining({
        programId: cardProgram,
        scheme: 'visa',
        tier: 'platinum',
        issuer: expect.objectContaining({ id: w.bank }),
      }),
    ]);
    expect(JSON.stringify(add.body.data)).not.toMatch(/verified/i);
    const rows = await t.prisma.eligibilityAttribute.findMany({
      where: { userId: c.me.id, attrType: { in: ['CARD', 'CARD_PRODUCT', 'CARD_TIER'] } },
    });
    expect(rows.map((r) => r.attrType).sort()).toEqual(['CARD', 'CARD_PRODUCT', 'CARD_TIER']);
    expect(
      rows.every((r) => r.level === 'SELF_DECLARED' && !r.verificationSource && !r.evidenceRef),
    ).toBe(true);

    const unlocked = await b(c).get('/v1/app/benefits/offers?tab=unlocked');
    const offer = unlocked.body.data.find((o: { card: { id: string } }) => o.card.id === hot.id);
    expect(offer).toMatchObject({ product: 'HOT', partners: [{ id: w.bank }] });

    // use the benefit: a free reservation shows up as an active benefit, with its status and partner
    const res = await w.reserve(c, hot.id, w.A.branchIds[0]!);
    expect(res.status).toBe(201);
    const active = await b(c).get('/v1/app/benefits/usage?tab=active');
    expect(active.body.data).toEqual([
      expect.objectContaining({
        kind: 'RESERVATION',
        status: 'HELD',
        partners: [expect.objectContaining({ id: w.bank })],
      }),
    ]);
    const ov = await b(c).get('/v1/app/benefits');
    expect(ov.body.data.counts).toMatchObject({ active: 1 });

    // removing the card locks the offer; the issued reservation is untouched (EL-13)
    const rm = await b(c).delete(`/v1/app/benefits/cards/${cardProgram}`);
    expect(rm.status).toBe(200);
    expect(rm.body.data.cards).toEqual([]);
    const avail = await b(c).get('/v1/app/benefits/offers?tab=available');
    expect(avail.body.data.some((o: { card: { id: string } }) => o.card.id === hot.id)).toBe(true);
    const still = await b(c).get('/v1/app/benefits/usage?tab=active');
    expect(still.body.data).toHaveLength(1);
    const hist = await b(c).get('/v1/app/benefits/history');
    expect(hist.body.data.map((h: { event: string }) => h.event)).toEqual(
      expect.arrayContaining(['CARD_ADDED', 'CARD_REMOVED']),
    );
  });

  it('expiry and renewal: reminder before expiry, expired after, offers lock (EM-20)', async () => {
    const c = await w.newCustomer();
    const addr = `renew.me@${domain}`;
    await b(c)
      .post('/v1/app/benefits/employer/code')
      .send({ programId: employerProgram, email: addr });
    await b(c)
      .post('/v1/app/benefits/employer/verify')
      .send({ programId: employerProgram, email: addr, code: codeFor(addr) });
    const attr = await t.prisma.eligibilityAttribute.findFirstOrThrow({
      where: { userId: c.me.id, attrType: 'EMPLOYER', status: 'VERIFIED' },
    });
    const svc = t.app.get(BenefitsService);

    await t.prisma.eligibilityAttribute.update({
      where: { id: attr.id },
      data: { expiresAt: new Date(Date.now() + 2 * 86_400_000) },
    });
    await svc.sweep();
    const due = await b(c).get('/v1/app/benefits');
    expect(due.body.data.employer.status).toBe('REVERIFICATION_DUE');
    await svc.sweep(); // a second run never repeats the reminder
    const reminders = await t.prisma.notification.count({
      where: {
        userId: c.me.id,
        type: 'BENEFIT_UPDATED',
        dedupeKey: { startsWith: 'benefit:employer:renew:' },
      },
    });
    expect(reminders).toBe(1);

    await t.prisma.eligibilityAttribute.update({
      where: { id: attr.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await svc.sweep();
    const exp = await b(c).get('/v1/app/benefits');
    expect(exp.body.data.employer.status).toBe('EXPIRED');
    const hist = await b(c).get('/v1/app/benefits/history');
    expect(hist.body.data.map((h: { event: string }) => h.event)).toEqual(
      expect.arrayContaining(['EMPLOYER_RENEWAL_DUE', 'EMPLOYER_EXPIRED']),
    );
  });
});
