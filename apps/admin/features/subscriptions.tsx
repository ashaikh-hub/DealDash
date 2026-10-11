'use client';

import { RequirePermission, SubscriptionAdminWorkspace, useAuth } from '@dealdash/app-shell';

/** Plans, prices, agreements (enterprise included), lifecycle, amendments, billing hooks, signals and readiness for DealDash staff. */
export function AdminSubscriptionsPage() {
  return (
    <RequirePermission any={['admin.subscriptions.read']}>
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { me } = useAuth();
  const perms = me?.permissions ?? [];
  return (
    <SubscriptionAdminWorkspace
      canManage={perms.includes('admin.subscriptions.manage')}
      canApprove={perms.includes('admin.subscriptions.approve')}
    />
  );
}
