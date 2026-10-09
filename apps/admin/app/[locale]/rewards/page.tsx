'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AdminRewardsPage } from '../../../features/rewards';

export default function Page() {
  return (
    <RequireAuth>
      <AdminRewardsPage />
    </RequireAuth>
  );
}
