import {
  createBusinessUser,
  createDealDashOrg,
  createMerchantOrg,
  createPartnerOrg,
  idem,
  passwordSession,
  type Session,
  type TestApp,
} from './helpers';
import { buildWorld } from './deal-fixtures';

/** A world for the subscription engine tests: fresh merchants and partners with their own owners, and two different DealDash people. */
export async function subscriptionWorld(t: TestApp) {
  const w = await buildWorld(t);
  const dd = await createDealDashOrg(t.prisma);
  const finance = await passwordSession(
    t,
    await createBusinessUser(t.prisma, {
      role: 'DEALDASH_FINANCE',
      orgId: dd.id,
      userType: 'ADMIN_USER',
      mfa: true,
      label: 'sub-fin',
    }),
    'admin',
    { completeMfa: true },
  );
  const admin = w.superAdmin;
  const api = (s: Session) => w.api(s);
  const post = (s: Session, path: string, body: unknown = {}, withKey = true) => {
    const r = api(s).post(path);
    return (withKey ? r.set('Idempotency-Key', idem()) : r).send(body as object);
  };
  const get = (s: Session, path: string) => api(s).get(path);
  const AS = '/v1/admin/subscriptions';

  const mkMerchant = async (label: string, branches = 1) => {
    const org = await createMerchantOrg(t.prisma, label, branches);
    const u = await createBusinessUser(t.prisma, {
      role: 'MERCHANT_OWNER',
      orgId: org.orgId,
      userType: 'MERCHANT_USER',
      label: `${label}-owner`.toLowerCase(),
    });
    const owner = await passwordSession(t, u, 'merchant');
    const mk = async (role: 'MERCHANT_FINANCE' | 'MERCHANT_CAMPAIGN_MANAGER' | 'MERCHANT_ADMIN') =>
      passwordSession(
        t,
        await createBusinessUser(t.prisma, {
          role,
          orgId: org.orgId,
          userType: 'MERCHANT_USER',
          label: `${label}-${role}`.toLowerCase(),
        }),
        'merchant',
      );
    return { ...org, owner, mk, ownerId: u.id };
  };
  const mkPartner = async (label: string, type: 'BANK' | 'SCHEME' | 'EMPLOYER') => {
    const orgId = await createPartnerOrg(t.prisma, label, type);
    const u = await createBusinessUser(t.prisma, {
      role: 'PARTNER_ADMIN',
      orgId,
      userType: 'PARTNER_USER',
      label: `${label}-admin`.toLowerCase(),
    });
    return { orgId, admin: await passwordSession(t, u, 'partner') };
  };

  /** Assigns a plan as DealDash and (for a paid plan) lets the business's own authorised person accept it. */
  const assign = async (
    orgId: string,
    planCode: string,
    owner: Session | null,
    extra: Record<string, unknown> = {},
  ) => {
    const a = await post(admin, `${AS}/contracts/assign`, {
      organizationId: orgId,
      planCode,
      market: 'PK',
      ...extra,
    });
    if (a.status !== 201 && a.status !== 200)
      throw new Error(`assign failed ${a.status} ${JSON.stringify(a.body)}`);
    const contract = a.body.data;
    if (contract.status === 'PENDING_ACTIVATION' && owner) {
      const acc = await post(owner, `/v1/orgs/${orgId}/subscription/accept`, {
        language: 'en',
        confirm: true,
      });
      if (acc.status !== 200)
        throw new Error(`accept failed ${acc.status} ${JSON.stringify(acc.body)}`);
      return acc.body.data.contract as typeof contract;
    }
    return contract as { id: string; status: string; [k: string]: unknown };
  };

  return { ...w, t, finance, admin, api, post, get, AS, mkMerchant, mkPartner, assign };
}
export type SubWorld = Awaited<ReturnType<typeof subscriptionWorld>>;
