'use client';

import { Suspense } from 'react';
import { SearchPage } from '../../../features/screens';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SearchPage />
    </Suspense>
  );
}
