'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { MerchantPerformancePage } from '../../../features/performance';

export default function Page() {
  return (
    <RequireAuth>
      <MerchantPerformancePage />
    </RequireAuth>
  );
}
