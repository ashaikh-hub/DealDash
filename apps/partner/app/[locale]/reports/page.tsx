'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { PartnerReportsPage } from '../../../features/workspaces';

export default function Page() {
  return (
    <RequireAuth>
      <PartnerReportsPage />
    </RequireAuth>
  );
}
