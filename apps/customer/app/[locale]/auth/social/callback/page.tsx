'use client';

import { Suspense } from 'react';
import { SocialCallbackPage } from '../../../../../features/cx-account';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SocialCallbackPage />
    </Suspense>
  );
}
