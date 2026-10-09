'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AdminRiskPage } from '../../../features/risk';

export default function Page() {
  return (
    <RequireAuth>
      <AdminRiskPage />
    </RequireAuth>
  );
}
