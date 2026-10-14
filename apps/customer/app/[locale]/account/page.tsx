'use client';

import { Suspense } from 'react';
import { AccountSettingsPage } from '../../../features/account';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AccountSettingsPage />
    </Suspense>
  );
}
