'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AdminOpsReportsPage } from '../../../features/ops-control';

export default function Page() {
  return (
    <RequireAuth>
      <AdminOpsReportsPage />
    </RequireAuth>
  );
}
