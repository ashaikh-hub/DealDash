'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { PartnerOffersPage } from '../../../features/network';

export default function Page() {
  return (
    <RequireAuth>
      <PartnerOffersPage />
    </RequireAuth>
  );
}
