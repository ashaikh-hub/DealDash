'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { PartnerPerformancePage } from '../../../features/workspaces';

export default function Page() {
  return (
    <RequireAuth>
      <PartnerPerformancePage />
    </RequireAuth>
  );
}
