'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AdminSubscriptionsPage } from '../../../features/subscriptions';

export default function Page() {
  return (
    <RequireAuth>
      <AdminSubscriptionsPage />
    </RequireAuth>
  );
}
