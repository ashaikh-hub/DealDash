'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { AccountPage } from '../../../features/history-account';

export default function Page() {
  return (
    <RequireAuth>
      <AccountPage />
    </RequireAuth>
  );
}
