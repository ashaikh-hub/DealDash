'use client';

import { Suspense, use } from 'react';
import { MerchantPageView } from '../../../../features/screens';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={null}>
      <MerchantPageView id={id} />
    </Suspense>
  );
}
