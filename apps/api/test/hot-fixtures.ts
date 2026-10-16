import { CommercialService } from '../src/finance/commercial.service';
import { createStaffUser, idem, otpSession, type Session } from './helpers';
import { buildWorld, type World } from './deal-fixtures';

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const START = hoursFromNow(-1);
const END = hoursFromNow(6);

export const TERMS = {
  blocks: {
    fullPriceItemsOnly: true,
    notCombinable: true,
    validDays: [],
    minimumSpendHalalas: null,
    validFrom: null,
    validTo: null,
  },
  textEn: 'Show your reservation code at the counter.',
  textAr: 'اعرض رمز الحجز عند الكاشير.',
};

/** Complete, valid Exclusive Deal content (bilingual, quantity + time limited, reservations on). Starts an hour ago. */
export function validHotContent(args: {
  categoryId: string;
  fileId: string;
  allocations: Array<{ branchId: string; units: number }>;
  overrides?: Record<string, unknown>;
}) {
  return {
    categoryId: args.categoryId,
    mechanic: 'PERCENTAGE_OFF',
    valueNumber: 40,
    offerLabel: { en: '40% off', ar: 'خصم 40%' },
    title: { en: '40% off today only', ar: 'خصم 40% لليوم فقط' },
    shortDescription: { en: 'Limited tables, tonight', ar: 'طاولات محدودة الليلة' },
    description: {
      en: 'A flash offer on the dinner menu, limited units per branch.',
      ar: 'عرض سريع على قائمة العشاء بكمية محدودة لكل فرع.',
    },
    media: [{ fileId: args.fileId, altEn: 'Dinner plate', altAr: 'طبق العشاء' }],
    limitType: 'TIME_AND_QUANTITY',
    reservationsEnabled: true,
    allocations: args.allocations,
    // walk-in deals (no tracked stock) need a stated redemption cap so the commercial liability is bounded
    commercial: { maxRedemptions: 100 },
    perCustomerLimit: 1,
    holdMinutes: null,
    startAt: START,
    endAt: END,
    eligibility: { kind: 'PUBLIC', valueRefs: [] },
    terms: TERMS,
    ...(args.overrides ?? {}),
  };
}

/** The Stage 3 world plus Exclusive Deal helpers (merchant A and B, staff for each branch, customers, DealDash roles). */
export async function buildHotWorld(t: Parameters<typeof buildWorld>[0]) {
  const w = await buildWorld(t);
  const staffB1User = await createStaffUser(t.prisma, w.A.orgId, w.A.branchIds[1]!);
  const staffA2 = await otpSession(t, staffB1User.mobile!, 'staff');
  const staffBUser = await createStaffUser(t.prisma, w.B.orgId, w.B.branchIds[0]!);
  const staffBorg = await otpSession(t, staffBUser.mobile!, 'staff');

  const base = (org: 'A' | 'B') => `/v1/merchants/${org === 'A' ? w.A.orgId : w.B.orgId}`;
  const owner = (org: 'A' | 'B') => (org === 'A' ? w.ownerA : w.ownerB);

  const hotContent = (org: 'A' | 'B' = 'A', units = 5, overrides: Record<string, unknown> = {}) =>
    validHotContent({
      categoryId: w.dining.id,
      fileId: org === 'A' ? w.fileA : w.fileB,
      allocations: (org === 'A' ? [w.A.branchIds[0]!] : w.B.branchIds).map((branchId) => ({
        branchId,
        units,
      })),
      overrides,
    });

  async function createHot(org: 'A' | 'B', content: Record<string, unknown>) {
    const res = await w
      .api(owner(org))
      .post(`${base(org)}/hot-deals`)
      .set('Idempotency-Key', idem())
      .send({ content });
    if (res.status !== 201)
      throw new Error(`hot create failed ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.data as Record<string, any>;
  }
  /** Commercial governance: fixtures walk the real flow (quotation, acceptances, mock funding) and are marked as development fixtures. */
  const commercialReady = (id: string) => t.app.get(CommercialService).devComplete('EXCLUSIVE', id);
  const submitHot = async (org: 'A' | 'B', id: string): Promise<{ status: number; body: any }> => {
    await commercialReady(id);
    return w
      .api(owner(org))
      .post(`${base(org)}/hot-deals/${id}/submit`)
      .send({});
  };
  const decideHot = (
    s: Session,
    id: string,
    action: string,
    body: Record<string, unknown> = { reason: 'Reviewed by test' },
  ) => w.api(s).post(`/v1/admin/hot-deals/${id}/${action}`).send(body);

  /** Create, submit and approve as DealDash. Returns the admin detail (status LIVE). */
  async function publishHot(
    org: 'A' | 'B' = 'A',
    units = 5,
    overrides: Record<string, unknown> = {},
  ) {
    const deal = await createHot(org, hotContent(org, units, overrides));
    const sub = await submitHot(org, deal.id);
    if (sub.status !== 200)
      throw new Error(`hot submit failed ${sub.status} ${JSON.stringify(sub.body)}`);
    const ap = await decideHot(w.ops, deal.id, 'approve');
    if (ap.status !== 200)
      throw new Error(`hot approve failed ${ap.status} ${JSON.stringify(ap.body)}`);
    return ap.body.data as Record<string, any>;
  }

  const reserve = (s: Session, dealId: string, branchId: string, quantity = 1) =>
    w
      .api(s)
      .post(`/v1/app/hot-deals/${dealId}/reservations`)
      .set('Idempotency-Key', idem())
      // paid methods need the terms accepted (RC-81); ignored for free reservations
      .send({ branchId, quantity, acceptTerms: true });
  const cancelRes = (s: Session, id: string) =>
    w.api(s).post(`/v1/app/reservations/${id}/cancel`).send({});
  const myRes = (s: Session, tab: 'active' | 'past' = 'active') =>
    w.api(s).get(`/v1/app/reservations?tab=${tab}`);

  const validate = (s: Session, code: string, source: 'QR' | 'MANUAL' = 'QR') =>
    w.api(s).post('/v1/staff/redemptions/validate').send({ code, source });
  const redeem = (s: Session, code: string, source: 'QR' | 'MANUAL' = 'QR', key = idem()) =>
    w.api(s).post('/v1/staff/redemptions').set('Idempotency-Key', key).send({ code, source });

  return {
    ...w,
    staffA2,
    staffBorg,
    base,
    hotContent,
    createHot,
    submitHot,
    commercialReady,
    decideHot,
    publishHot,
    reserve,
    cancelRes,
    myRes,
    validate,
    redeem,
  };
}
export type HotWorld = Awaited<ReturnType<typeof buildHotWorld>>;
export type { World };
