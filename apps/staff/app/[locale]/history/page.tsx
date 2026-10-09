'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { HistoryPage } from '../../../features/history-account';

export default function Page() {
  return (
    <RequireAuth>
      <HistoryPage />
    </RequireAuth>
  );
}
