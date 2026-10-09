'use client';

import { use } from 'react';
import { RequireAuth } from '@dealdash/app-shell';
import { AdminVoucherReviewPage } from '../../../../features/vouchers';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireAuth>
      <AdminVoucherReviewPage id={id} />
    </RequireAuth>
  );
}
