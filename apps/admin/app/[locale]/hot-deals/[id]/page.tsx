'use client';

import { use } from 'react';
import { RequireAuth } from '@dealdash/app-shell';
import { HotReviewPage } from '../../../../features/hot-review';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireAuth>
      <HotReviewPage id={id} />
    </RequireAuth>
  );
}
