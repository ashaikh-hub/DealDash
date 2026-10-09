'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { MerchantOperationsPage } from '../../../features/operations';

export default function Page() {
  return (
    <RequireAuth>
      <MerchantOperationsPage />
    </RequireAuth>
  );
}
