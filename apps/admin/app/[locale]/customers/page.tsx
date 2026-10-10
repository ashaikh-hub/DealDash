'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AdminSupportPage } from '../../../features/ops-service';

export default function Page() {
  return (
    <RequireAuth>
      <AdminSupportPage />
    </RequireAuth>
  );
}
