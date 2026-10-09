'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { MerchantLoyaltyPage } from '../../../features/loyalty';

export default function Page() {
  return (
    <RequireAuth>
      <MerchantLoyaltyPage />
    </RequireAuth>
  );
}
