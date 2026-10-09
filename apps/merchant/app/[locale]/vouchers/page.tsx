'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { VouchersHub } from '../../../features/voucher-hub';

export default function Page() {
  return (
    <RequireAuth>
      <VouchersHub />
    </RequireAuth>
  );
}
