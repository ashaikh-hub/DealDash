'use client';

import { use } from 'react';
import { RequireAuth } from '@dealdash/app-shell';
import { PartnerCampaignDetailPage } from '../../../../../features/campaigns';

export default function Page({ params }: { params: Promise<{ product: string; id: string }> }) {
  const { product, id } = use(params);
  return (
    <RequireAuth>
      <PartnerCampaignDetailPage product={product} id={id} />
    </RequireAuth>
  );
}
