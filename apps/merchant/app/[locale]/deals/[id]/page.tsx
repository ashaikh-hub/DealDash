'use client';

import { use } from 'react';
import { RequireAuth } from '@dealdash/app-shell';
import { DealDetailPage } from '../../../../features/deal-detail';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireAuth>
      <DealDetailPage id={id} />
    </RequireAuth>
  );
}
