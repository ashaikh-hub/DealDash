'use client';

import { Suspense } from 'react';
import { HotListPage } from '../../../features/hot';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <HotListPage />
    </Suspense>
  );
}
