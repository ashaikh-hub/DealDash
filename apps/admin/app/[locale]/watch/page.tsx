'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AdminWatchPage } from '../../../features/watch';

export default function Page() {
  return (
    <RequireAuth>
      <AdminWatchPage />
    </RequireAuth>
  );
}
