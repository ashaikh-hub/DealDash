'use client';

import { Suspense } from 'react';
import { RewardsPage } from '../../../features/watch';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <RewardsPage />
    </Suspense>
  );
}
