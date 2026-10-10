'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { PartnerNetworkPage } from '../../../features/network';

export default function Page() {
  return (
    <RequireAuth>
      <PartnerNetworkPage />
    </RequireAuth>
  );
}
