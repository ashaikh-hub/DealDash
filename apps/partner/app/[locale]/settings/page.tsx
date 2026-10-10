'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { PartnerSettingsPage } from '../../../features/workspaces';

export default function Page() {
  return (
    <RequireAuth>
      <PartnerSettingsPage />
    </RequireAuth>
  );
}
