'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { HotDealsAdminPage } from '../../../features/hot-deals';

export default function Page() {
  return (
    <RequireAuth>
      <HotDealsAdminPage />
    </RequireAuth>
  );
}
