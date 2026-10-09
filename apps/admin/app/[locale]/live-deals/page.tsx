'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { LiveDealsPage } from '../../../features/live-deals';

export default function Page() {
  return (
    <RequireAuth>
      <LiveDealsPage />
    </RequireAuth>
  );
}
