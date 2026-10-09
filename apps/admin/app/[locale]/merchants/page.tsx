'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { MerchantsPage } from '../../../features/merchants-list';

export default function Page() {
  return (
    <RequireAuth>
      <MerchantsPage />
    </RequireAuth>
  );
}
