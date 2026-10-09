'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { ScanPage } from '../../features/redeem';

export default function HomePage() {
  return (
    <RequireAuth>
      <ScanPage />
    </RequireAuth>
  );
}
