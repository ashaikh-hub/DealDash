'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AdminBillingPage } from '../../../features/visibility';

export default function Page() {
  return (
    <RequireAuth>
      <AdminBillingPage />
    </RequireAuth>
  );
}
