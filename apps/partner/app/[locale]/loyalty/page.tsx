'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { PartnerLoyaltyPage } from '../../../features/workspaces';

export default function Page() {
  return (
    <RequireAuth>
      <PartnerLoyaltyPage />
    </RequireAuth>
  );
}
