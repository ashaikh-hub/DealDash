'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AdminLoyaltyPage } from '../../../features/loyalty';

export default function Page() {
  return (
    <RequireAuth>
      <AdminLoyaltyPage />
    </RequireAuth>
  );
}
