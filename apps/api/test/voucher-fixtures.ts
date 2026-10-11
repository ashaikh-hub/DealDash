import { CommercialService } from '../src/finance/commercial.service';
import {
  createBusinessUser,
  createDealDashOrg,
  idem,
  passwordSession,
  type Session,
} from './helpers';
import { buildHotWorld } from './hot-fixtures';
import { PAYMENT_PROVIDER } from '../src/providers/interfaces';
import { MockPaymentProvider } from '../src/providers/mocks';
import { RefundsService } from '../src/vouchers/refunds.service';
import { VoucherLifecycleService } from '../src/vouchers/voucher-lifecycle.service';

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
/** Fixed per test file so repeated content() calls describe the SAME schedule (an edit must not accidentally move dates). */
const SALE_START = hoursFromNow(-1);
const SALE_END = hoursFromNow(24 * 14);

export const VOUCHER_TERMS = {
  blocks: {
    fullPriceItemsOnly: false,
    notCombinable: true,
    validDays: [],
    minimumSpendHalalas: null,
    validFrom: null,
    validTo: null,
  },
  textEn: 'One voucher per visit. Not redeemable for cash.',
  textAr: 'قسيمة واحدة لكل زيارة. لا تُستبدل بنقد.',
};

/** Complete, valid voucher content (bilingual): face SAR 100, price SAR 80, 10 vouchers, valid 30 days from purchase. */
export function validVoucherContent(args: {
  categoryId: string;
  fileId: string;
  branchIds: string[];
  overrides?: Record<string, unknown>;
}) {
  return {
    categoryId: args.categoryId,
    title: { en: 'SAR 100 dining voucher', ar: 'قسيمة طعام بقيمة 100 ريال' },
    shortDescription: { en: 'Pay SAR 80, spend SAR 100', ar: 'ادفع 80 ريالاً واستخدم 100 ريال' },
    description: {
      en: 'A SAR 100 voucher you can use on anything on the menu, at the listed branches.',
      ar: 'قسيمة بقيمة 100 ريال تستخدمها على أي صنف في القائمة في الفروع المحددة.',
    },
    media: [{ fileId: args.fileId, altEn: 'Dining table', altAr: 'طاولة طعام' }],
    faceValueHalalas: 10_000,
    sellingPriceHalalas: 8_000,
    totalQty: 10,
    perCustomerLimit: 2,
    validity: { type: 'DAYS_FROM_PURCHASE', days: 30, validUntil: null },
    saleStartAt: SALE_START,
    saleEndAt: SALE_END,
    branchIds: args.branchIds,
    eligibility: { kind: 'PUBLIC', valueRefs: [] },
    redemptionRules: {
      en: 'Show the QR code at the counter before ordering.',
      ar: 'اعرض رمز QR عند الكاشير قبل الطلب.',
    },
    terms: VOUCHER_TERMS,
    ...(args.overrides ?? {}),
  };
}

/** The Stage 4 world plus voucher, payment and finance helpers. */
export async function buildVoucherWorld(t: Parameters<typeof buildHotWorld>[0]) {
  const w = await buildHotWorld(t);
  const dd = await createDealDashOrg(t.prisma);
  const adm = async (role: Parameters<typeof createBusinessUser>[1]['role']) =>
    passwordSession(
      t,
      await createBusinessUser(t.prisma, { role, orgId: dd.id, userType: 'ADMIN_USER', mfa: true }),
      'admin',
      { completeMfa: true },
    );
  const finance = await adm('DEALDASH_FINANCE');
  const finance2 = await adm('DEALDASH_FINANCE');
  const provider = t.app.get(PAYMENT_PROVIDER) as MockPaymentProvider;
  const lifecycle = t.app.get(VoucherLifecycleService);
  const refundsSvc = t.app.get(RefundsService);

  const vbase = (org: 'A' | 'B') => `/v1/merchants/${org === 'A' ? w.A.orgId : w.B.orgId}`;
  const owner = (org: 'A' | 'B') => (org === 'A' ? w.ownerA : w.ownerB);

  const voucherContent = (org: 'A' | 'B' = 'A', overrides: Record<string, unknown> = {}) =>
    validVoucherContent({
      categoryId: w.dining.id,
      fileId: org === 'A' ? w.fileA : w.fileB,
      branchIds: org === 'A' ? [w.A.branchIds[0]!] : w.B.branchIds,
      overrides,
    });

  async function createVoucher(org: 'A' | 'B', content: Record<string, unknown>) {
    const res = await w
      .api(owner(org))
      .post(`${vbase(org)}/vouchers`)
      .set('Idempotency-Key', idem())
      .send({ content });
    if (res.status !== 201)
      throw new Error(`voucher create failed ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.data as Record<string, any>;
  }
  const commercialReady = (id: string) => t.app.get(CommercialService).devComplete('VOUCHER', id);
  const submitVoucher = async (
    org: 'A' | 'B',
    id: string,
  ): Promise<{ status: number; body: any }> => {
    await commercialReady(id);
    return w
      .api(owner(org))
      .post(`${vbase(org)}/vouchers/${id}/submit`)
      .send({});
  };
  const decideVoucher = (
    s: Session,
    id: string,
    action: string,
    body: Record<string, unknown> = { reason: 'Reviewed by test' },
  ) => w.api(s).post(`/v1/admin/vouchers/${id}/${action}`).send(body);

  /** Create, submit and approve as DealDash. Returns the admin detail (status ON_SALE). */
  async function publishVoucher(org: 'A' | 'B' = 'A', overrides: Record<string, unknown> = {}) {
    const v = await createVoucher(org, voucherContent(org, overrides));
    const sub = await submitVoucher(org, v.id);
    if (sub.status !== 200)
      throw new Error(`voucher submit failed ${sub.status} ${JSON.stringify(sub.body)}`);
    const ap = await decideVoucher(w.ops, v.id, 'approve');
    if (ap.status !== 200)
      throw new Error(`voucher approve failed ${ap.status} ${JSON.stringify(ap.body)}`);
    return ap.body.data as Record<string, any>;
  }

  // ---- customer side
  const checkout = (s: Session, voucherId: string, key = idem()) =>
    w.api(s).post('/v1/app/checkout').set('Idempotency-Key', key).send({ voucherId });
  const pay = (s: Session, orderId: string, key = idem()) =>
    w
      .api(s)
      .post(`/v1/app/orders/${orderId}/pay`)
      .set('Idempotency-Key', key)
      .send({ acceptTerms: true });
  const getOrder = (s: Session, orderId: string) => w.api(s).get(`/v1/app/orders/${orderId}`);
  const cancelOrder = (s: Session, orderId: string) =>
    w.api(s).post(`/v1/app/orders/${orderId}/cancel`).send({});
  const wallet = (s: Session, tab = 'active') => w.api(s).get(`/v1/app/wallet?tab=${tab}`);
  const walletOne = (s: Session, id: string) => w.api(s).get(`/v1/app/wallet/${id}`);
  const requestRefund = (s: Session, id: string, body: Record<string, unknown> = {}) =>
    w
      .api(s)
      .post(`/v1/app/wallet/${id}/refund`)
      .set('Idempotency-Key', idem())
      .send({ reasonCode: 'CHANGED_MIND', ...body });

  // ---- the provider side (what the PSP would send)
  let eventSeq = 0;
  const webhook = (
    providerReference: string,
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'PENDING',
    over: Record<string, unknown> = {},
  ) => {
    const { rawBody, signature } = MockPaymentProvider.buildWebhook({
      eventId: `evt-${Date.now()}-${++eventSeq}`,
      kind: 'PAYMENT',
      providerReference,
      status,
      ...over,
    } as never);
    return { rawBody, signature };
  };
  const sendWebhook = (rawBody: string, signature: string | undefined) =>
    t.http
      .post('/v1/webhooks/payments')
      .set('Content-Type', 'application/json')
      .set('x-dealdash-signature', signature ?? '')
      .send(rawBody);

  /** Checkout + pay + a signed provider webhook: the whole purchase. Returns the order and the issued voucher id. */
  async function buy(
    customer: Session,
    voucherId: string,
    outcome: 'SUCCEEDED' | 'FAILED' = 'SUCCEEDED',
  ) {
    const co = await checkout(customer, voucherId);
    if (co.status !== 201)
      throw new Error(`checkout failed ${co.status} ${JSON.stringify(co.body)}`);
    const p = await pay(customer, co.body.data.id);
    if (p.status !== 200) throw new Error(`pay failed ${p.status} ${JSON.stringify(p.body)}`);
    const ref = await providerRef(p.body.data.payment.id);
    provider.settle(ref, outcome);
    const wh = webhook(ref, outcome);
    const res = await sendWebhook(wh.rawBody, wh.signature);
    if (res.status !== 200)
      throw new Error(`webhook failed ${res.status} ${JSON.stringify(res.body)}`);
    const order = (await getOrder(customer, co.body.data.id)).body.data;
    return {
      orderId: co.body.data.id as string,
      order,
      instanceId: order.voucherInstanceId as string | null,
    };
  }

  const providerRef = async (paymentId: string) =>
    (await t.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).providerReference!;

  /** A voucher bought and ready to use: returns its QR and manual code. */
  async function owned(customer: Session, voucherId: string) {
    const b = await buy(customer, voucherId);
    const d = (await walletOne(customer, b.instanceId!)).body.data;
    return { ...b, wallet: d, qr: d.code.qr as string, manual: d.code.manual as string };
  }

  const adminOrder = (s: Session, orderId: string) =>
    w.api(s).get(`/v1/admin/finance/orders/${orderId}`);

  return {
    ...w,
    finance,
    finance2,
    provider,
    lifecycle,
    refundsSvc,
    vbase,
    voucherContent,
    createVoucher,
    submitVoucher,
    commercialReady,
    decideVoucher,
    publishVoucher,
    checkout,
    pay,
    getOrder,
    cancelOrder,
    wallet,
    walletOne,
    requestRefund,
    webhook,
    sendWebhook,
    providerRef,
    buy,
    owned,
    adminOrder,
  };
}
export type VoucherWorld = Awaited<ReturnType<typeof buildVoucherWorld>>;
