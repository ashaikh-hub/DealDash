'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AdminPartnersPage } from '../../../features/partners';

export default function Page() {
  return (
    <RequireAuth>
      <AdminPartnersPage />
    </RequireAuth>
  );
}
