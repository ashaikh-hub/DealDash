'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AdminMarketsPage } from '../../../features/markets';

export default function Page() {
  return (
    <RequireAuth>
      <AdminMarketsPage />
    </RequireAuth>
  );
}
