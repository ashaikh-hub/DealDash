'use client';

import { use } from 'react';
import { RequireAuth } from '@dealdash/app-shell';
import { HotDealDetail } from '../../../../../features/hot-detail';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireAuth>
      <HotDealDetail dealId={id} />
    </RequireAuth>
  );
}
