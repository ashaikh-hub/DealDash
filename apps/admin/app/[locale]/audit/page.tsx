'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AuditPage } from '../../../features/audit';

export default function Page() {
  return (
    <RequireAuth>
      <AuditPage />
    </RequireAuth>
  );
}
