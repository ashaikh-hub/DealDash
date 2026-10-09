'use client';

import { use } from 'react';
import { RequireAuth } from '@dealdash/app-shell';
import { VoucherDetailPage } from '../../../../features/voucher-detail';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireAuth>
      <VoucherDetailPage voucherId={id} />
    </RequireAuth>
  );
}
