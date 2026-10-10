'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { PartnerCampaignBuilderPage } from '../../../../features/campaigns';

export default function Page() {
  return (
    <RequireAuth>
      <PartnerCampaignBuilderPage />
    </RequireAuth>
  );
}
