'use client';

import { use } from 'react';
import { RequireAuth } from '@dealdash/app-shell';
import { DealBuilder } from '../../../../../features/deal-builder';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireAuth>
      <DealBuilder dealId={id} />
    </RequireAuth>
  );
}
