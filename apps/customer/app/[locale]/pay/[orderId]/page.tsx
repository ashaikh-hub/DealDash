'use client';

import { Suspense, use } from 'react';
import { MockPayPage } from '../../../../features/vouchers';

export default function Page({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  return (
    <Suspense fallback={null}>
      <MockPayPage orderId={orderId} />
    </Suspense>
  );
}
