'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AdminCommandCentrePage } from '../../../features/visibility';

export default function Page() {
  return (
    <RequireAuth>
      <AdminCommandCentrePage />
    </RequireAuth>
  );
}
