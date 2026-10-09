'use client';

import { use } from 'react';
import { RequireAuth } from '@dealdash/app-shell';
import { VoucherBuilder } from '../../../../../features/voucher-builder';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireAuth>
      <VoucherBuilder voucherId={id} />
    </RequireAuth>
  );
}
