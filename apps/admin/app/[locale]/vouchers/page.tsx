'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AdminVouchersPage } from '../../../features/vouchers';

export default function Page() {
  return (
    <RequireAuth>
      <AdminVouchersPage />
    </RequireAuth>
  );
}
