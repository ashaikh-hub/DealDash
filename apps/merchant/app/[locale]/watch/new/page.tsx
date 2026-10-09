'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { WatchBuilder } from '../../../../features/watch-builder';

export default function Page() {
  return (
    <RequireAuth>
      <WatchBuilder />
    </RequireAuth>
  );
}
