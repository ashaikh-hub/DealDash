'use client';

import { LoyaltyWorkspace, RequirePermission, useAuth } from '@dealdash/app-shell';

const FUNDERS = [
  'DEALDASH',
  'MERCHANT',
  'BANK',
  'SCHEME',
  'CORPORATE',
  'CAMPAIGN',
  'SPONSOR',
] as const;

/** Every loyalty rule on the platform. A different person than the author approves a rule or a higher limit. */
export function AdminLoyaltyPage() {
  return (
    <RequirePermission any={['admin.loyalty.read']}>
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { me } = useAuth();
  const perms = me?.permissions ?? [];
  return (
    <LoyaltyWorkspace
      scope={{ audience: 'admin' }}
      canManage={perms.includes('admin.loyalty.manage')}
      canApprove={perms.includes('admin.loyalty.approve')}
      fundingOptions={FUNDERS}
    />
  );
}
