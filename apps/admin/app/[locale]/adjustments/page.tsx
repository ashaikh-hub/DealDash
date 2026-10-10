'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AdminAdjustmentsPage } from '../../../features/ops-finance';

export default function Page() {
  return (
    <RequireAuth>
      <AdminAdjustmentsPage />
    </RequireAuth>
  );
}
