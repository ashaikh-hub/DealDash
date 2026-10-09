'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { VoucherBuilder } from '../../../../features/voucher-builder';

export default function Page() {
  return (
    <RequireAuth>
      <VoucherBuilder />
    </RequireAuth>
  );
}
