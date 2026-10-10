'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AdminCasesPage } from '../../../features/ops-control';

export default function Page() {
  return (
    <RequireAuth>
      <AdminCasesPage />
    </RequireAuth>
  );
}
