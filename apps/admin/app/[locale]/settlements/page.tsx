'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AdminSettlementsPage } from '../../../features/ops-finance';

export default function Page() {
  return (
    <RequireAuth>
      <AdminSettlementsPage />
    </RequireAuth>
  );
}
