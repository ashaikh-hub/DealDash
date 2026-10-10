'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AdminSlaPage } from '../../../features/ops-control';

export default function Page() {
  return (
    <RequireAuth>
      <AdminSlaPage />
    </RequireAuth>
  );
}
