'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { RedemptionsPage } from '../../../features/redemptions';

export default function Page() {
  return (
    <RequireAuth>
      <RedemptionsPage />
    </RequireAuth>
  );
}
