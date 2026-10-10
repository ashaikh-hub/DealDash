'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AdminRulesPage } from '../../../features/ops-control';

export default function Page() {
  return (
    <RequireAuth>
      <AdminRulesPage />
    </RequireAuth>
  );
}
