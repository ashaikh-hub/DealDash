'use client';

import { use } from 'react';
import { RequireAuth } from '@dealdash/app-shell';
import { WatchDetailPage } from '../../../../features/watch-detail';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireAuth>
      <WatchDetailPage campaignId={id} />
    </RequireAuth>
  );
}
