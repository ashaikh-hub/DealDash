'use client';

import { LoyaltyWorkspace, RequirePermission } from '@dealdash/app-shell';
import { useOrgId } from './deal-utils';

/** Loyalty rules a merchant pays for itself. DealDash approves a rule, and its commercial terms, before it gives any points. */
export function MerchantLoyaltyPage() {
  return (
    <RequirePermission any={['merchant.loyalty.manage']}>
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const orgId = useOrgId();
  if (!orgId) return null;
  return (
    <LoyaltyWorkspace
      scope={{ audience: 'org', orgId }}
      canManage
      canApprove={false}
      fundingOptions={['MERCHANT', 'CAMPAIGN']}
    />
  );
}
