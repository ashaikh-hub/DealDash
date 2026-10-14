'use client';

import { Suspense } from 'react';
import { BenefitsPage } from '../../../features/benefits';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <BenefitsPage />
    </Suspense>
  );
}
