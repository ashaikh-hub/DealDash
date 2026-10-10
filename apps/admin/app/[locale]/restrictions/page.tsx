'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AdminRestrictionsPage } from '../../../features/ops-trust';

export default function Page() {
  return (
    <RequireAuth>
      <AdminRestrictionsPage />
    </RequireAuth>
  );
}
