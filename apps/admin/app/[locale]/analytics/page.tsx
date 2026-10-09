'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AdminAnalyticsPage } from '../../../features/visibility';

export default function Page() {
  return (
    <RequireAuth>
      <AdminAnalyticsPage />
    </RequireAuth>
  );
}
