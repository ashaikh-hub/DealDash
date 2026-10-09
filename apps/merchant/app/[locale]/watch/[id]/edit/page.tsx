'use client';

import { use } from 'react';
import { RequireAuth } from '@dealdash/app-shell';
import { WatchBuilder } from '../../../../../features/watch-builder';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireAuth>
      <WatchBuilder campaignId={id} />
    </RequireAuth>
  );
}
