'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { PartnerAlertsPage } from '../../../features/workspaces';

export default function Page() {
  return (
    <RequireAuth>
      <PartnerAlertsPage />
    </RequireAuth>
  );
}
