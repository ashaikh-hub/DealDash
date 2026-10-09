'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AdminOperationsPage } from '../../../features/operations';

export default function Page() {
  return (
    <RequireAuth>
      <AdminOperationsPage />
    </RequireAuth>
  );
}
