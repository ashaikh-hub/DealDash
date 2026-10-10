'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { PartnerCampaignsPage } from '../../../features/campaigns';

export default function Page() {
  return (
    <RequireAuth>
      <PartnerCampaignsPage />
    </RequireAuth>
  );
}
