'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AdminModerationPage } from '../../../features/ops-trust';

export default function Page() {
  return (
    <RequireAuth>
      <AdminModerationPage />
    </RequireAuth>
  );
}
