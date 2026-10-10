'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { PartnerIntegrationsPage } from '../../../features/workspaces';

export default function Page() {
  return (
    <RequireAuth>
      <PartnerIntegrationsPage />
    </RequireAuth>
  );
}
