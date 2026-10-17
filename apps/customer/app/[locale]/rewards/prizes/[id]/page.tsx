'use client';

import { Suspense, use } from 'react';
import { PrizePage } from '../../../../../features/watch';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={null}>
      <PrizePage id={id} />
    </Suspense>
  );
}
