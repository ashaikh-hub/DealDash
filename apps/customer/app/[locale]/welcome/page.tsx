'use client';

import { Suspense } from 'react';
import { WelcomePage } from '../../../features/account';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <WelcomePage />
    </Suspense>
  );
}
