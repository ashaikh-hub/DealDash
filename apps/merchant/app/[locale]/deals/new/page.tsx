'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { DealBuilder } from '../../../../features/deal-builder';

export default function Page() {
  return (
    <RequireAuth>
      <DealBuilder />
    </RequireAuth>
  );
}
