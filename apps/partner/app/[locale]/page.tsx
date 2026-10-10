'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { PartnerHome } from '../../features/home';

export default function Page() {
  return (
    <RequireAuth>
      <PartnerHome />
    </RequireAuth>
  );
}
