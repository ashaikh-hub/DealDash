'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AdminFraudPage } from '../../../features/ops-trust';

export default function Page() {
  return (
    <RequireAuth>
      <AdminFraudPage />
    </RequireAuth>
  );
}
