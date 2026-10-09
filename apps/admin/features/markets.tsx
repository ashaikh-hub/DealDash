'use client';

import { MarketsWorkspace, RequirePermission, useAuth } from '@dealdash/app-shell';

/** Admin -> Markets: market / country configuration, product availability, tax, invoices, payments, settlement, providers, compliance, readiness. */
export function AdminMarketsPage() {
  return (
    <RequirePermission any={['admin.markets.read']}>
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const perms = useAuth().me?.permissions ?? [];
  return (
    <MarketsWorkspace
      canManage={perms.includes('admin.markets.manage')}
      canApprove={perms.includes('admin.markets.approve')}
    />
  );
}
