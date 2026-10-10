import type { Audience, PermissionCode } from '@dealdash/types';
import type { DictionaryKeyLike } from './nav-types';

export type { DictionaryKeyLike } from './nav-types';

/**
 * IMPORTANT: everything here is a UI convenience. The API enforces every permission; hiding a menu item
 * never grants or removes access.
 */
export const hasPermission = (
  granted: readonly PermissionCode[],
  needed: PermissionCode,
): boolean => granted.includes(needed);

export const hasAnyPermission = (
  granted: readonly PermissionCode[],
  needed: readonly PermissionCode[],
): boolean => needed.length === 0 || needed.some((p) => granted.includes(p));

export const hasAllPermissions = (
  granted: readonly PermissionCode[],
  needed: readonly PermissionCode[],
): boolean => needed.every((p) => granted.includes(p));

export interface NavItem {
  key: string;
  /** Dictionary key resolved by the localization package. */
  labelKey: DictionaryKeyLike;
  href: string;
  /** Visible if the user has ANY of these. Empty or missing means visible to every signed-in user. */
  requiresAny?: readonly PermissionCode[];
}

/** Permission-aware navigation: hidden, never greyed (matches the approved designs). */
export const filterNav = (
  items: readonly NavItem[],
  granted: readonly PermissionCode[],
): NavItem[] => items.filter((i) => !i.requiresAny || hasAnyPermission(granted, i.requiresAny));

/**
 * Customer destinations that are approved but NOT built yet. They are kept out of the working navigation (no dead
 * placeholders) and are re-enabled by moving them into NAV_BY_AUDIENCE.customer when their stage ships.
 * (Watch & Earn and Rewards shipped in Stage 6; Play & Win is Phase 2 and is not listed.)
 */
export const CUSTOMER_NAV_WHEN_BUILT: readonly NavItem[] = [];

/** Foundation navigation per app. Product pages are added in later stages. */
export const NAV_BY_AUDIENCE: Record<Audience, readonly NavItem[]> = {
  // Guests can browse, so the customer tabs need no permission (saving and benefits ask the guest to sign in).
  customer: [
    { key: 'home', labelKey: 'nav.home', href: '/' },
    { key: 'explore', labelKey: 'nav.explore', href: '/explore' },
    // Watch & Earn sits in the centre of the five-tab bar (approved navigation).
    { key: 'watch', labelKey: 'nav.watch', href: '/watch' },
    { key: 'rewards', labelKey: 'nav.rewards', href: '/rewards' },
    { key: 'profile', labelKey: 'nav.profile', href: '/profile' },
  ],
  merchant: [
    { key: 'dashboard', labelKey: 'nav.dashboard', href: '/' },
    {
      key: 'application',
      labelKey: 'nav.application',
      href: '/onboarding',
      requiresAny: ['merchant.application.manage'],
    },
    {
      key: 'profile',
      labelKey: 'nav.profile',
      href: '/profile',
      requiresAny: ['merchant.profile.read'],
    },
    {
      key: 'branches',
      labelKey: 'nav.branches',
      href: '/branches',
      requiresAny: ['merchant.branch.read'],
    },
    {
      key: 'team',
      labelKey: 'nav.team',
      href: '/team',
      requiresAny: ['merchant.staff.read', 'merchant.users.manage'],
    },
    {
      key: 'deals',
      labelKey: 'nav.campaigns',
      href: '/deals',
      requiresAny: ['merchant.deals.read'],
    },
    {
      key: 'vouchers',
      labelKey: 'nav.vouchers',
      href: '/vouchers',
      requiresAny: ['merchant.vouchers.manage'],
    },
    { key: 'watch', labelKey: 'nav.watch', href: '/watch', requiresAny: ['merchant.watch.read'] },
    {
      key: 'commercial',
      labelKey: 'nav.commercial',
      href: '/commercial',
      requiresAny: ['merchant.commercial.read'],
    },
    {
      key: 'plan',
      labelKey: 'nav.plan',
      href: '/plan',
      requiresAny: ['merchant.subscription.read'],
    },
    {
      key: 'performance',
      labelKey: 'nav.performance',
      href: '/performance',
      requiresAny: ['merchant.performance.read'],
    },
    {
      key: 'billing',
      labelKey: 'nav.billing',
      href: '/billing',
      requiresAny: ['merchant.finance.read'],
    },
    {
      key: 'assistant',
      labelKey: 'nav.assistant',
      href: '/assistant',
      requiresAny: ['merchant.ai.use'],
    },    {
      key: 'operations',
      labelKey: 'nav.operations',
      href: '/operations',
      requiresAny: ['merchant.deals.read', 'merchant.disputes.manage', 'merchant.activity.read'],
    },
    {
      key: 'loyalty',
      labelKey: 'nav.loyalty',
      href: '/loyalty',
      requiresAny: ['merchant.loyalty.manage'],
    },
    // Stage 7: partner benefits proposed for the merchant's own Live Deals (the merchant decides first)
    { key: 'partner-benefits', labelKey: 'nav.partnerBenefits', href: '/partner-benefits', requiresAny: ['merchant.deals.read'] },
    {
      key: 'redemptions',
      labelKey: 'nav.redemptions',
      href: '/redemptions',
      requiresAny: ['merchant.redemptions.read'],
    },
    {
      key: 'insights',
      labelKey: 'nav.insights',
      href: '/insights',
      requiresAny: ['merchant.insights.read'],
    },
    {
      key: 'finance',
      labelKey: 'nav.finance',
      href: '/finance',
      requiresAny: ['merchant.finance.read'],
    },
  ],
  staff: [
    { key: 'scan', labelKey: 'nav.scan', href: '/', requiresAny: ['merchant.redemptions.perform'] },
    {
      key: 'history',
      labelKey: 'nav.history',
      href: '/history',
      requiresAny: ['merchant.redemptions.read'],
    },
    { key: 'account', labelKey: 'nav.account', href: '/account' },
  ],
  // Stage 7: the Enterprise Partner Portal. Items are also hidden when the partner type / contract does not include the module.
  partner: [
    { key: 'dashboard', labelKey: 'nav.home', href: '/' },
    { key: 'campaigns', labelKey: 'nav.campaigns', href: '/campaigns', requiresAny: ['partner.campaigns.read'] },
    { key: 'merchants', labelKey: 'nav.network', href: '/network', requiresAny: ['partner.merchants.read'] },
    { key: 'offers', labelKey: 'nav.offers', href: '/offers', requiresAny: ['partner.merchants.read'] },
    { key: 'eligibility', labelKey: 'nav.eligibility', href: '/eligibility', requiresAny: ['partner.eligibility.read'] },
    { key: 'loyalty', labelKey: 'nav.loyalty', href: '/loyalty', requiresAny: ['partner.loyalty.manage'] },
    { key: 'watch', labelKey: 'nav.watch', href: '/watch', requiresAny: ['partner.campaigns.read'] },
    { key: 'performance', labelKey: 'nav.performance', href: '/performance', requiresAny: ['partner.performance.read'] },
    { key: 'finance', labelKey: 'nav.finance', href: '/finance', requiresAny: ['partner.finance.read', 'partner.commercial.read'] },
    { key: 'integrations', labelKey: 'nav.integrations', href: '/integrations', requiresAny: ['partner.integrations.manage', 'partner.imports.manage'] },
    { key: 'alerts', labelKey: 'nav.alerts', href: '/alerts', requiresAny: ['partner.performance.read', 'partner.alerts.manage'] },
    { key: 'tasks', labelKey: 'nav.tasks', href: '/tasks', requiresAny: ['partner.campaigns.read', 'partner.disputes.manage', 'partner.commercial.read'] },
    { key: 'reports', labelKey: 'nav.reports', href: '/reports', requiresAny: ['partner.reports.read'] },
    { key: 'assistant', labelKey: 'nav.copilot', href: '/assistant', requiresAny: ['partner.ai.use'] },
    { key: 'users', labelKey: 'nav.usersAccess', href: '/users', requiresAny: ['partner.users.manage'] },
    { key: 'organization', labelKey: 'nav.organization', href: '/organization', requiresAny: ['partner.profile.read'] },
    { key: 'settings', labelKey: 'nav.settings', href: '/settings', requiresAny: ['partner.profile.read'] },
  ],
  admin: [
    { key: 'dashboard', labelKey: 'nav.dashboard', href: '/' },
    {
      key: 'merchants',
      labelKey: 'nav.merchants',
      href: '/merchants',
      requiresAny: ['admin.merchants.review'],
    },
    {
      key: 'live-deals',
      labelKey: 'nav.liveDeals',
      href: '/live-deals',
      requiresAny: ['admin.campaigns.review'],
    },
    {
      key: 'hot-deals',
      labelKey: 'nav.hotDeals',
      href: '/hot-deals',
      requiresAny: ['admin.campaigns.review'],
    },
    {
      key: 'vouchers',
      labelKey: 'nav.vouchers',
      href: '/vouchers',
      requiresAny: ['admin.campaigns.review'],
    },
    {
      key: 'watch',
      labelKey: 'nav.watch',
      href: '/watch',
      requiresAny: ['admin.watch.read'],
    },
    {
      key: 'risk',
      labelKey: 'nav.risk',
      href: '/risk',
      requiresAny: ['admin.risk.manage'],
    },
    {
      key: 'rewards',
      labelKey: 'nav.rewards',
      href: '/rewards',
      requiresAny: ['admin.rewards.read', 'admin.rewards.request'],
    },
    {
      key: 'reservations',
      labelKey: 'nav.reservations',
      href: '/reservations',
      requiresAny: ['admin.reservations.manage'],
    },
    {
      key: 'finance',
      labelKey: 'nav.finance',
      href: '/finance',
      requiresAny: ['admin.vouchers.lookup'],
    },
    {
      key: 'commercial',
      labelKey: 'nav.commercial',
      href: '/commercial',
      requiresAny: ['admin.finance.read'],
    },
    {
      key: 'subscriptions',
      labelKey: 'nav.subscriptions',
      href: '/subscriptions',
      requiresAny: ['admin.subscriptions.read'],
    },
    {
      key: 'command-centre',
      labelKey: 'nav.commandCentre',
      href: '/command-centre',
      requiresAny: ['admin.operations.read'],
    },
    {
      key: 'analytics',
      labelKey: 'nav.analytics',
      href: '/analytics',
      requiresAny: ['admin.analytics.read'],
    },
    {
      key: 'billing',
      labelKey: 'nav.billing',
      href: '/billing',
      requiresAny: ['admin.finance.read'],
    },
    {
      key: 'ai',
      labelKey: 'nav.ai',
      href: '/ai',
      requiresAny: ['admin.ai.use'],
    },
    {
      key: 'markets',
      labelKey: 'nav.markets',
      href: '/markets',
      requiresAny: ['admin.markets.read'],
    },
    // Stage 7: partner Business Accounts (onboarding review, readiness, activation) and partner benefits
    { key: 'partners', labelKey: 'nav.partners', href: '/partners', requiresAny: ['admin.partners.review'] },
    {
      key: 'operations',
      labelKey: 'nav.operations',
      href: '/operations',
      requiresAny: ['admin.disputes.read', 'admin.conflicts.manage', 'admin.campaigns.review', 'admin.loyalty.approve', 'admin.master.manage', 'admin.platform.read'],
    },
    {
      key: 'loyalty',
      labelKey: 'nav.loyalty',
      href: '/loyalty',
      requiresAny: ['admin.loyalty.read'],
    },
    {
      key: 'organizations',
      labelKey: 'nav.organizations',
      href: '/organizations',
      requiresAny: ['admin.org.read'],
    },
    {
      key: 'customers',
      labelKey: 'nav.customers',
      href: '/customers',
      requiresAny: ['admin.customers.read'],
    },
    { key: 'users', labelKey: 'nav.users', href: '/users', requiresAny: ['admin.users.manage'] },
    { key: 'audit', labelKey: 'nav.audit', href: '/audit', requiresAny: ['admin.audit.read'] },
    {
      key: 'configuration',
      labelKey: 'nav.configuration',
      href: '/configuration',
      requiresAny: ['admin.config.read'],
    },
    { key: 'jobs', labelKey: 'nav.jobs', href: '/jobs', requiresAny: ['admin.jobs.manage'] },
    {
      key: 'support',
      labelKey: 'nav.support',
      href: '/support',
      requiresAny: ['admin.support.manage'],
    },
  ],
};
