import { ALL_LIMIT_KEYS, SUBSCRIPTION_FEATURES, SUBSCRIPTION_PRODUCTS } from './subscription';

/**
 * Shared platform vocabulary (organization units, scoped access, entitlements, markets).
 *
 * The existing Organization stays the tenant boundary and the Business Account. It is NOT automatically the legal entity: a
 * Business Account owns one or more LegalEntity records, each with its own country, currency, tax profile, contracts and billing.
 * OrganizationUnit is a flexible hierarchy whose kinds are configuration.
 */

/** Scope kinds a role can be held in. Brand, region and city are unit kinds, reached through UNIT. */
export const SCOPE_KINDS = [
  'ORGANIZATION',
  'LEGAL_ENTITY',
  'UNIT',
  'COUNTRY',
  'BRANCH',
  'PRODUCT',
  'CAMPAIGN',
] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

/** Scope kinds that can only NARROW access: they never grant more than their envelope (or the organization). */
export const NARROWING_SCOPE_KINDS: readonly ScopeKind[] = ['PRODUCT', 'CAMPAIGN'];

/** Products an organization can be entitled to (campaign products, loyalty and paid placements). The full vocabulary lives in subscription.ts. */
export const PLATFORM_PRODUCTS = SUBSCRIPTION_PRODUCTS;
export type PlatformProduct = (typeof PLATFORM_PRODUCTS)[number];

/** Features that contracts can switch on. */
export const PLATFORM_FEATURES = SUBSCRIPTION_FEATURES;
export type PlatformFeature = (typeof PLATFORM_FEATURES)[number];

/** Limits that contracts can set (no limit row = not limited by the contract). */
export const PLATFORM_LIMITS = ALL_LIMIT_KEYS;
export type PlatformLimit = (typeof PLATFORM_LIMITS)[number];

export const CONTRACT_ENTITLEMENT_KINDS = ['PRODUCT', 'FEATURE', 'LIMIT'] as const;
export type ContractEntitlementKind = (typeof CONTRACT_ENTITLEMENT_KINDS)[number];

/** Maps a commercial product code to the entitlement product code. */
export const ENTITLEMENT_PRODUCT_OF = {
  VOUCHER: 'VOUCHER',
  WATCH: 'WATCH',
  EXCLUSIVE: 'EXCLUSIVE',
  LIVE_BENEFIT: 'LIVE_DEAL',
  LOYALTY: 'LOYALTY',
} as const satisfies Record<string, PlatformProduct>;

export interface ScopeSpec {
  kind: ScopeKind;
  /** Unit / legal entity / branch / campaign id, country code or product code. Null for ORGANIZATION. */
  ref: string | null;
  /** CAMPAIGN scope: the product the campaign belongs to. */
  product?: string | null;
  /** Optional broader envelope for PRODUCT and CAMPAIGN scopes. */
  envelope?: { kind: ScopeKind; ref: string | null } | null;
}

/** Defaults for `platform.unit_kinds` (configuration; Admin can extend it). */
export const DEFAULT_UNIT_KINDS = [
  'BRAND',
  'OPERATING_COMPANY',
  'FRANCHISEE',
  'COUNTRY',
  'REGION',
  'CITY',
  'BUSINESS_UNIT',
  'BRANCH',
  'OUTLET',
  'DEPARTMENT',
] as const;

/** A label for a scope in audit records, for example "BRANCH:<id>". */
export const scopeLabel = (s: Pick<ScopeSpec, 'kind' | 'ref' | 'product'>) =>
  `${s.kind}${s.ref ? `:${s.ref}` : ''}${s.product ? `@${s.product}` : ''}`;
