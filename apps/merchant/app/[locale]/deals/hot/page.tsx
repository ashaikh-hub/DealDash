'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { HotDealsHub } from '../../../../features/hot-hub';

export default function Page() {
  return (
    <RequireAuth>
      <HotDealsHub />
    </RequireAuth>
  );
}
