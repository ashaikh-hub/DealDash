'use client';

import { Suspense } from 'react';
import { MyVouchersPage } from '../../../features/vouchers';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <MyVouchersPage />
    </Suspense>
  );
}
