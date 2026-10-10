'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { PartnerUsersPage } from '../../../features/users';

export default function Page() {
  return (
    <RequireAuth>
      <PartnerUsersPage />
    </RequireAuth>
  );
}
