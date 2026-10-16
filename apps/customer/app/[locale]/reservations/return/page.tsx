'use client';

import { Suspense } from 'react';
import { ReservationReturnPage } from '../../../../features/hot';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ReservationReturnPage />
    </Suspense>
  );
}
