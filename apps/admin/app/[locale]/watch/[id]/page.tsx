'use client';

import { use } from 'react';
import { RequireAuth } from '@dealdash/app-shell';
import { AdminWatchReviewPage } from '../../../../features/watch';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireAuth>
      <AdminWatchReviewPage id={id} />
    </RequireAuth>
  );
}
