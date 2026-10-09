'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { HotDealBuilder } from '../../../../../features/hot-builder';

export default function Page() {
  return (
    <RequireAuth>
      <HotDealBuilder />
    </RequireAuth>
  );
}
