'use client';

import { Suspense, use } from 'react';
import { ReservationPage } from '../../../../features/hot';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={null}>
      <ReservationPage id={id} />
    </Suspense>
  );
}
