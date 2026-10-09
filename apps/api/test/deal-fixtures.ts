import {
  call,
  createBusinessUser,
  createDealDashOrg,
  createLiveMerchant,
  createPartnerOrg,
  createStaffUser,
  idem,
  makeDealImage,
  otpSession,
  passwordSession,
  validContent,
  type Session,
  type TestApp,
} from './helpers';

/** A reusable world for the Stage 3 API tests: two live merchants, every merchant role, DealDash roles, a customer. */
export async function buildWorld(t: TestApp) {
  const dining = await t.prisma.category.findFirstOrThrow({ where: { code: 'dining' } });
  const cafes = await t.prisma.category.findFirstOrThrow({ where: { code: 'cafes' } });
  const A = await createLiveMerchant(
    t.prisma,
    'Alpha Grill',
    [
      { lat: 24.7136, lng: 46.6753, name: 'Alpha Olaya' },
      { lat: 24.8094, lng: 46.6336, name: 'Alpha Malqa' },
    ],
    { nameAr: 'ألفا غريل' },
  );
  const B = await createLiveMerchant(t.prisma, 'Beta Cafe', [{ lat: 24.7664, lng: 46.6432 }], {
    nameAr: 'بيتا كافيه',
  });
  const fileA = await makeDealImage(t.prisma, A.orgId);
  const fileA2 = await makeDealImage(t.prisma, A.orgId);
  const fileB = await makeDealImage(t.prisma, B.orgId);

  const mk = async (
    role: Parameters<typeof createBusinessUser>[1]['role'],
    orgId: string,
    extra: { branchId?: string } = {},
  ) => createBusinessUser(t.prisma, { role, orgId, userType: 'MERCHANT_USER', ...extra });
  const ownerA = await passwordSession(t, await mk('MERCHANT_OWNER', A.orgId), 'merchant');
  const campaignsA = await passwordSession(
    t,
    await mk('MERCHANT_CAMPAIGN_MANAGER', A.orgId),
    'merchant',
  );
  const financeA = await passwordSession(t, await mk('MERCHANT_FINANCE', A.orgId), 'merchant');
  const adminA = await passwordSession(t, await mk('MERCHANT_ADMIN', A.orgId), 'merchant');
  const branchScopedA = await passwordSession(
    t,
    await mk('MERCHANT_ADMIN', A.orgId, { branchId: A.branchIds[0] }),
    'merchant',
  );
  const staffUser = await createStaffUser(t.prisma, A.orgId, A.branchIds[0]!);
  const staffA = await otpSession(t, staffUser.mobile!, 'staff');
  const ownerB = await passwordSession(t, await mk('MERCHANT_OWNER', B.orgId), 'merchant');

  const dd = await createDealDashOrg(t.prisma);
  const adm = async (role: Parameters<typeof createBusinessUser>[1]['role']) =>
    passwordSession(
      t,
      await createBusinessUser(t.prisma, { role, orgId: dd.id, userType: 'ADMIN_USER', mfa: true }),
      'admin',
      { completeMfa: true },
    );
  const ops = await adm('DEALDASH_OPERATIONS');
  const support = await adm('DEALDASH_SUPPORT');
  const analyst = await adm('DEALDASH_ANALYST');
  const superAdmin = await adm('DEALDASH_SUPER_ADMIN');
  const merchantMgmt = await adm('DEALDASH_MERCHANT_MANAGEMENT');
  const marketing = await adm('DEALDASH_MARKETING_OPS');

  const employer = await createPartnerOrg(t.prisma, 'EmployerCo', 'EMPLOYER');
  const bank = await createPartnerOrg(t.prisma, 'BankCo', 'BANK');
  const scheme = await createPartnerOrg(t.prisma, 'SchemeCo', 'SCHEME');

  const mobile = () => `+96655${Math.floor(1000000 + Math.random() * 8999999)}`;
  const newCustomer = async () => otpSession(t, mobile(), 'customer');

  const content = (org: 'A' | 'B' = 'A', overrides: Record<string, unknown> = {}) =>
    validContent({
      categoryId: dining.id,
      branchIds: org === 'A' ? [A.branchIds[0]!] : B.branchIds,
      fileId: org === 'A' ? fileA : fileB,
      overrides,
    });

  const api = (s: Session) => call(t, s);

  /** Create a deal as the merchant. Returns the deal view. */
  async function createDeal(s: Session, orgId: string, c: Record<string, unknown>) {
    const res = await api(s)
      .post(`/v1/merchants/${orgId}/live-deals`)
      .set('Idempotency-Key', idem())
      .send({ content: c });
    if (res.status !== 200 && res.status !== 201)
      throw new Error(`create failed ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.data as Record<string, any>;
  }
  const submit = (s: Session, orgId: string, id: string) =>
    api(s).post(`/v1/merchants/${orgId}/live-deals/${id}/submit`).send({});
  const decide = (
    s: Session,
    id: string,
    action: string,
    body: Record<string, unknown> = { reason: 'Reviewed by test' },
  ) => api(s).post(`/v1/admin/live-deals/${id}/${action}`).send(body);

  /** Submit, then approve as DealDash. Returns the admin detail. */
  async function publish(org: 'A' | 'B' = 'A', overrides: Record<string, unknown> = {}) {
    const owner = org === 'A' ? ownerA : ownerB;
    const orgId = org === 'A' ? A.orgId : B.orgId;
    const deal = await createDeal(owner, orgId, content(org, overrides));
    const sub = await submit(owner, orgId, deal.id);
    if (sub.status !== 200)
      throw new Error(`submit failed ${sub.status} ${JSON.stringify(sub.body)}`);
    const ap = await decide(ops, deal.id, 'approve');
    if (ap.status !== 200)
      throw new Error(`approve failed ${ap.status} ${JSON.stringify(ap.body)}`);
    return ap.body.data as Record<string, any>;
  }

  /** Ids of deals customers can currently see for a merchant (the merchant page lists only visible deals). */
  async function visibleDealIds(orgId: string, query = '') {
    const res = await t.http.get(`/v1/app/merchants/${orgId}${query}`);
    if (res.status !== 200) return [] as string[];
    return (res.body.data.deals as Array<{ id: string }>).map((d) => d.id);
  }

  return {
    t,
    dining,
    cafes,
    A,
    B,
    fileA,
    fileA2,
    fileB,
    ownerA,
    campaignsA,
    financeA,
    adminA,
    branchScopedA,
    staffA,
    ownerB,
    ops,
    support,
    analyst,
    superAdmin,
    merchantMgmt,
    marketing,
    employer,
    bank,
    scheme,
    newCustomer,
    content,
    api,
    createDeal,
    submit,
    decide,
    publish,
    visibleDealIds,
  };
}
export type World = Awaited<ReturnType<typeof buildWorld>>;
