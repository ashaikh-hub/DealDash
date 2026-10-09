'use client';

import { Suspense } from 'react';
import { ExplorePage } from '../../../features/explore';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ExplorePage />
    </Suspense>
  );
}
