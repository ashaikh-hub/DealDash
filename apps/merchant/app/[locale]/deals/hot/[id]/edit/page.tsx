'use client';

import { use } from 'react';
import { RequireAuth } from '@dealdash/app-shell';
import { HotDealBuilder } from '../../../../../../features/hot-builder';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireAuth>
      <HotDealBuilder dealId={id} />
    </RequireAuth>
  );
}
