'use client';

import { Suspense, use } from 'react';
import { WalletVoucherPage } from '../../../../features/vouchers';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={null}>
      <WalletVoucherPage id={id} />
    </Suspense>
  );
}
