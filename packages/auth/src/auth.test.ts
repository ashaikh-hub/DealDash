import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS } from '@dealdash/types';
import {
  NAV_BY_AUDIENCE,
  filterNav,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
} from './index';

describe('permission helpers', () => {
  it('checks single, any and all', () => {
    const granted = ROLE_PERMISSIONS.MERCHANT_STAFF;
    expect(hasPermission(granted, 'merchant.redemptions.perform')).toBe(true);
    expect(hasPermission(granted, 'merchant.finance.read')).toBe(false);
    expect(hasAnyPermission(granted, ['merchant.finance.read', 'merchant.branch.read'])).toBe(true);
    expect(hasAllPermissions(granted, ['merchant.branch.read', 'merchant.finance.read'])).toBe(
      false,
    );
    expect(hasAnyPermission(granted, [])).toBe(true);
  });
});

describe('permission-aware navigation (UI hint only)', () => {
  const keys = (audience: keyof typeof NAV_BY_AUDIENCE, role: keyof typeof ROLE_PERMISSIONS) =>
    filterNav(NAV_BY_AUDIENCE[audience], ROLE_PERMISSIONS[role]).map((i) => i.key);

  it('hides finance from merchant admins but shows it to finance and owners', () => {
    expect(keys('merchant', 'MERCHANT_ADMIN')).not.toContain('finance');
    expect(keys('merchant', 'MERCHANT_FINANCE')).toContain('finance');
    expect(keys('merchant', 'MERCHANT_OWNER')).toContain('finance');
  });

  it('Stage 8: operations screens follow least privilege', () => {
    expect(keys('admin', 'DEALDASH_OPERATIONS')).toEqual(
      expect.arrayContaining(['cases', 'restrictions', 'notifications', 'sla', 'ops-reports']),
    );
    expect(keys('admin', 'DEALDASH_FINANCE')).toEqual(
      expect.arrayContaining(['adjustments', 'settlements', 'reconciliation']),
    );
    expect(keys('admin', 'DEALDASH_RISK_COMPLIANCE')).toEqual(
      expect.arrayContaining(['fraud', 'restrictions', 'cases']),
    );
    expect(keys('admin', 'DEALDASH_SUPPORT')).toEqual(expect.arrayContaining(['support', 'cases']));
    expect(keys('admin', 'DEALDASH_SUPPORT')).not.toEqual(expect.arrayContaining(['settlements']));
    expect(keys('admin', 'DEALDASH_ANALYST')).not.toEqual(expect.arrayContaining(['cases']));
    expect(keys('admin', 'DEALDASH_ANALYST')).not.toContain('fraud');
    expect(keys('admin', 'DEALDASH_ANALYST')).not.toContain('restrictions');
    expect(keys('merchant', 'MERCHANT_OWNER')).toContain('reviews');
    expect(keys('staff', 'MERCHANT_STAFF')).not.toContain('reviews');
  });

  it('shows staff only scan, history and account', () => {
    expect(keys('staff', 'MERCHANT_STAFF')).toEqual(['scan', 'history', 'account']);
  });

  it('hides users and finance from partner read-only users', () => {
    const k = keys('partner', 'PARTNER_READ_ONLY');
    expect(k).not.toContain('users');
    expect(k).toContain('reports');
  });

  it('shows audit and configuration only to roles that have them', () => {
    expect(keys('admin', 'DEALDASH_SUPER_ADMIN')).toEqual(
      expect.arrayContaining(['audit', 'configuration', 'jobs']),
    );
    expect(keys('admin', 'DEALDASH_ANALYST')).not.toContain('audit');
    // Phase 3 workspaces appear only for roles that can act in them
    expect(keys('admin', 'DEALDASH_SUPER_ADMIN')).toEqual(
      expect.arrayContaining(['operations', 'loyalty']),
    );
    expect(keys('admin', 'DEALDASH_ANALYST')).not.toEqual(
      expect.arrayContaining(['operations', 'loyalty']),
    );
    expect(keys('merchant', 'MERCHANT_OWNER')).toEqual(
      expect.arrayContaining(['operations', 'loyalty']),
    );
    expect(keys('merchant', 'MERCHANT_FINANCE')).not.toContain('loyalty');
    expect(keys('staff', 'MERCHANT_STAFF')).not.toContain('operations');
    expect(keys('admin', 'DEALDASH_RISK_COMPLIANCE')).toContain('audit');
  });

  it('shows the subscription screens only to people who can read the agreement', () => {
    expect(keys('admin', 'DEALDASH_SUPER_ADMIN')).toContain('subscriptions');
    expect(keys('admin', 'DEALDASH_FINANCE')).toContain('subscriptions');
    expect(keys('merchant', 'MERCHANT_OWNER')).toContain('plan');
    expect(keys('merchant', 'MERCHANT_FINANCE')).toContain('plan');
    expect(keys('merchant', 'MERCHANT_CAMPAIGN_MANAGER')).not.toContain('plan');
    expect(keys('staff', 'MERCHANT_STAFF')).not.toContain('plan');
    // the partner portal screens are Stage 7: no partner subscription page yet
    expect(keys('partner', 'PARTNER_ADMIN')).not.toContain('plan');
  });

  it('shows Phase 4 / 5 screens by role: performance, billing, assistant, Command Centre, analytics and AI governance', () => {
    expect(keys('merchant', 'MERCHANT_OWNER')).toEqual(
      expect.arrayContaining(['performance', 'billing', 'assistant']),
    );
    expect(keys('merchant', 'MERCHANT_CAMPAIGN_MANAGER')).toEqual(
      expect.arrayContaining(['performance', 'assistant']),
    );
    expect(keys('merchant', 'MERCHANT_CAMPAIGN_MANAGER')).not.toContain('billing');
    expect(keys('merchant', 'MERCHANT_FINANCE')).toEqual(
      expect.arrayContaining(['performance', 'billing']),
    );
    expect(keys('staff', 'MERCHANT_STAFF')).not.toEqual(expect.arrayContaining(['performance']));
    expect(keys('admin', 'DEALDASH_OPERATIONS')).toEqual(
      expect.arrayContaining(['command-centre', 'analytics', 'billing', 'ai']),
    );
    expect(keys('admin', 'DEALDASH_FINANCE')).toEqual(
      expect.arrayContaining(['billing', 'analytics', 'ai']),
    );
    expect(keys('admin', 'DEALDASH_SUPPORT')).toEqual(
      expect.arrayContaining(['command-centre', 'ai']),
    );
    expect(keys('admin', 'DEALDASH_SUPPORT')).not.toContain('billing');
    expect(keys('admin', 'DEALDASH_ANALYST')).toContain('analytics');
    expect(keys('admin', 'DEALDASH_ANALYST')).not.toEqual(
      expect.arrayContaining(['command-centre', 'ai']),
    );
    // Stage 7 (the Partner Portal) superseded the earlier "no partner performance page yet" placeholder check
    expect(keys('partner', 'PARTNER_ADMIN')).toEqual(expect.arrayContaining(['performance']));
  });

  it('Stage 7: the partner portal navigation follows the partner roles', () => {
    expect(keys('partner', 'PARTNER_ADMIN')).toEqual(
      expect.arrayContaining([
        'dashboard',
        'campaigns',
        'merchants',
        'offers',
        'eligibility',
        'loyalty',
        'watch',
        'performance',
        'finance',
        'integrations',
        'alerts',
        'tasks',
        'reports',
        'assistant',
        'users',
        'organization',
        'settings',
      ]),
    );
    expect(keys('partner', 'PARTNER_ANALYST')).not.toEqual(expect.arrayContaining(['users']));
    expect(keys('partner', 'PARTNER_ANALYST')).not.toContain('integrations');
    expect(keys('partner', 'PARTNER_FINANCE_MANAGER')).toContain('finance');
    expect(keys('partner', 'PARTNER_INTEGRATION_MANAGER')).toEqual(
      expect.arrayContaining(['integrations', 'merchants']),
    );
    expect(keys('partner', 'PARTNER_INTEGRATION_MANAGER')).not.toContain('finance');
    expect(keys('partner', 'PARTNER_READ_ONLY')).not.toContain('assistant');
  });

  it('shows Markets to DealDash roles that can read market configuration', () => {
    expect(keys('admin', 'DEALDASH_SUPER_ADMIN')).toContain('markets');
    expect(keys('admin', 'DEALDASH_FINANCE')).toContain('markets');
    expect(keys('admin', 'DEALDASH_OPERATIONS')).toContain('markets');
    expect(keys('admin', 'DEALDASH_MARKETING_OPS')).not.toContain('markets');
    expect(keys('merchant', 'MERCHANT_OWNER')).not.toContain('markets');
  });
});
