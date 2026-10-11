'use client';

import {
  OperationsWorkspace,
  RequirePermission,
  useAuth,
  type InboxItem,
  type OpsTab,
} from '@dealdash/app-shell';
import { withLocale } from '@dealdash/localization';
import { useOrgId } from './deal-utils';

const ROUTE: Record<string, string> = { LIVE_DEAL: '/deals', EXCLUSIVE: '/deals/hot' };

/** Inbox, cases with evidence, and activity history for the business. Tabs follow the member's permissions. */
export function MerchantOperationsPage() {
  return (
    <RequirePermission
      any={['merchant.deals.read', 'merchant.disputes.manage', 'merchant.activity.read']}
    >
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { locale, me } = useAuth();
  const orgId = useOrgId();
  const perms = me?.permissions ?? [];
  if (!orgId) return null;
  const tabs: OpsTab[] = ['inbox'];
  if (perms.includes('merchant.disputes.manage')) tabs.push('cases');
  if (perms.includes('merchant.activity.read')) tabs.push('activity');
  return (
    <OperationsWorkspace
      scope={{ audience: 'org', orgId }}
      tabs={tabs}
      canManageCases={perms.includes('merchant.disputes.manage')}
      hrefFor={(i: InboxItem) =>
        ROUTE[i.entityType] ? withLocale(`${ROUTE[i.entityType]}/${i.entityId}`, locale) : null
      }
    />
  );
}
