'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { PartnerFinancePage } from '../../../features/workspaces';

export default function Page() {
  return (
    <RequireAuth>
      <PartnerFinancePage />
    </RequireAuth>
  );
}
