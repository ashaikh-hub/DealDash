'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { PartnerTasksPage } from '../../../features/workspaces';

export default function Page() {
  return (
    <RequireAuth>
      <PartnerTasksPage />
    </RequireAuth>
  );
}
