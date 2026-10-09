'use client';

import { Suspense } from 'react';
import { ProfilePage } from '../../../features/screens';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ProfilePage />
    </Suspense>
  );
}
