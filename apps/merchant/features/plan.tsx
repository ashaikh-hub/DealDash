'use client';

import { PlanUsageWorkspace, RequirePermission, useAuth } from '@dealdash/app-shell';
import { useOrgId } from './deal-utils';

/**
 * Plan and usage: the business's own plan, status, price, renewal, usage, entitlements, add-ons, promotions, upgrade / downgrade with
 * the impact shown first, plan history and why something is unavailable. Invoices and payments are in Finance, not here.
 */
export function MerchantPlanPage() {
  return (
    <RequirePermission any={['merchant.subscription.read']}>
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const orgId = useOrgId();
  const { me } = useAuth();
  const perms = me?.permissions ?? [];
  if (!orgId) return null;
  return <PlanUsageWorkspace orgId={orgId} canManage={perms.includes('merchant.subscription.manage')} canAccept={perms.includes('merchant.commercial.accept')} />;
}
