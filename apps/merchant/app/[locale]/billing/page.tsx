'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { MerchantBillingPage } from '../../../features/performance';

export default function Page() {
  return (
    <RequireAuth>
      <MerchantBillingPage />
    </RequireAuth>
  );
}
