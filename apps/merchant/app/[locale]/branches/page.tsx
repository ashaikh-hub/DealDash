'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { BranchesPage } from '../../../features/branches';

export default function Page() {
  return (
    <RequireAuth>
      <BranchesPage />
    </RequireAuth>
  );
}
