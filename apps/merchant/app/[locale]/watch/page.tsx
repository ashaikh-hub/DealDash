'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { WatchHub } from '../../../features/watch-hub';

export default function Page() {
  return (
    <RequireAuth>
      <WatchHub />
    </RequireAuth>
  );
}
