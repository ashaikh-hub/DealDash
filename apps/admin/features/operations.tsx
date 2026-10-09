'use client';

import { OperationsWorkspace, RequirePermission, useAuth, type InboxItem, type OpsTab } from '@dealdash/app-shell';
import { withLocale } from '@dealdash/localization';

const ADMIN_ROUTE: Record<string, string> = { LIVE_DEAL: '/live-deals', EXCLUSIVE: '/hot-deals', VOUCHER: '/vouchers' };

/** Inbox, cases, offer conflicts and activity for DealDash staff. Each tab is shown only to people who can use it. */
export function AdminOperationsPage() {
  return (
    <RequirePermission
      any={['admin.disputes.read', 'admin.conflicts.manage', 'admin.campaigns.review', 'admin.loyalty.approve', 'admin.master.manage', 'admin.platform.read']}
    >
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { locale, me } = useAuth();
  const perms = me?.permissions ?? [];
  const tabs: OpsTab[] = ['inbox'];
  if (perms.includes('admin.disputes.read')) tabs.push('cases');
  if (perms.includes('admin.conflicts.manage')) tabs.push('conflicts');
  if (perms.includes('admin.platform.read')) tabs.push('activity');
  return (
    <OperationsWorkspace
      scope={{ audience: 'admin' }}
      tabs={tabs}
      canManageCases={perms.includes('admin.disputes.manage')}
      canManageConflicts={perms.includes('admin.conflicts.manage')}
      hrefFor={(i: InboxItem) => {
        if (i.kind === 'CAMPAIGN_REVIEW' && ADMIN_ROUTE[i.entityType]) return withLocale(`${ADMIN_ROUTE[i.entityType]}/${i.entityId}`, locale);
        return null;
      }}
    />
  );
}
