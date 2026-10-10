'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AdminReconciliationPage } from '../../../features/ops-finance';

export default function Page() {
  return (
    <RequireAuth>
      <AdminReconciliationPage />
    </RequireAuth>
  );
}
