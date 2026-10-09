'use client';

import { Suspense } from 'react';
import { VoucherListPage } from '../../../features/vouchers';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <VoucherListPage />
    </Suspense>
  );
}
