'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AdminAiPage } from '../../../features/visibility';

export default function Page() {
  return (
    <RequireAuth>
      <AdminAiPage />
    </RequireAuth>
  );
}
