'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { CommercialHub } from '../../../features/commercial-hub';

export default function Page() {
  return (
    <RequireAuth>
      <CommercialHub />
    </RequireAuth>
  );
}
