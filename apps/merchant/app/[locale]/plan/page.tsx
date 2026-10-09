'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { MerchantPlanPage } from '../../../features/plan';

export default function Page() {
  return (
    <RequireAuth>
      <MerchantPlanPage />
    </RequireAuth>
  );
}
