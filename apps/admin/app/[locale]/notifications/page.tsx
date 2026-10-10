'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AdminNotificationsPage } from '../../../features/ops-service';

export default function Page() {
  return (
    <RequireAuth>
      <AdminNotificationsPage />
    </RequireAuth>
  );
}
