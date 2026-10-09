'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AdminCommercialPage } from '../../../features/commercial';

export default function Page() {
  return (
    <RequireAuth>
      <AdminCommercialPage />
    </RequireAuth>
  );
}
