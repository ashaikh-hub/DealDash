'use client';

import { use } from 'react';
import { RequireAuth } from '@dealdash/app-shell';
import { DealReviewPage } from '../../../../features/deal-review';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireAuth>
      <DealReviewPage id={id} />
    </RequireAuth>
  );
}
