'use client';

import { Suspense } from 'react';
import { MyDealsPage } from '../../../features/hot';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <MyDealsPage />
    </Suspense>
  );
}
