'use client';

import {
  AdminAiWorkspace,
  AdminBillingWorkspace,
  CommandCentreWorkspace,
  PerformanceWorkspace,
  RequirePermission,
  useAuth,
} from '@dealdash/app-shell';

const usePerms = () => useAuth().me?.permissions ?? [];

/** Operations Command Centre: campaign, transaction, financial, integration, risk and platform health; alerts; support timeline. */
export function AdminCommandCentrePage() {
  return (
    <RequirePermission any={['admin.operations.read']}>
      <CommandCentreInner />
    </RequirePermission>
  );
}
function CommandCentreInner() {
  const perms = usePerms();
  return (
    <CommandCentreWorkspace
      canTimeline={perms.includes('admin.customers.read')}
      canAlerts={perms.includes('admin.alerts.manage')}
    />
  );
}

/** DealDash-wide analytics with drill-down from business to transaction, targets and platform alert rules. */
export function AdminAnalyticsPage() {
  return (
    <RequirePermission any={['admin.analytics.read']}>
      <AnalyticsInner />
    </RequirePermission>
  );
}
function AnalyticsInner() {
  const perms = usePerms();
  return (
    <PerformanceWorkspace
      orgId={null}
      admin
      canTargets={false}
      canAlerts={perms.includes('admin.alerts.manage')}
    />
  );
}

/** Billing, invoices, receivables, payments, purchase orders, exchange rates and reconciliation (maker-checker enforced by the API). */
export function AdminBillingPage() {
  return (
    <RequirePermission any={['admin.finance.read']}>
      <BillingInner />
    </RequirePermission>
  );
}
function BillingInner() {
  const perms = usePerms();
  return (
    <AdminBillingWorkspace
      canManage={perms.includes('admin.finance.manage')}
      canApprove={perms.includes('admin.finance.approve')}
    />
  );
}

/** Operations and Finance assistants, AI drafts, audit, usage metering and the evaluation pack. */
export function AdminAiPage() {
  return (
    <RequirePermission any={['admin.ai.use']}>
      <AiInner />
    </RequirePermission>
  );
}
function AiInner() {
  const perms = usePerms();
  return <AdminAiWorkspace canManage={perms.includes('admin.ai.manage')} />;
}
