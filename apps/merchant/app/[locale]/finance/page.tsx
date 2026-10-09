'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { MerchantFinancePage } from '../../../features/voucher-finance';

export default function Page() {
  return (
    <RequireAuth>
      <MerchantFinancePage />
    </RequireAuth>
  );
}
