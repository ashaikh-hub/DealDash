'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { PartnerWatchPage } from '../../../features/workspaces';

export default function Page() {
  return (
    <RequireAuth>
      <PartnerWatchPage />
    </RequireAuth>
  );
}
