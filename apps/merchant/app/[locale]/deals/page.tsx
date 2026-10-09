'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { DealsHub } from '../../../features/deals-hub';

export default function Page() {
  return (
    <RequireAuth>
      <DealsHub />
    </RequireAuth>
  );
}
