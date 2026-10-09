'use client';

import { Suspense } from 'react';
import { WatchHubPage } from '../../../features/watch';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <WatchHubPage />
    </Suspense>
  );
}
