'use client';

import { Suspense } from 'react';
import { PaymentMethodsPage } from '../../../features/cx-account';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PaymentMethodsPage />
    </Suspense>
  );
}
