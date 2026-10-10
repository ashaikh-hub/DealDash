'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { PartnerOrganizationPage } from '../../../features/organization';

export default function Page() {
  return (
    <RequireAuth>
      <PartnerOrganizationPage />
    </RequireAuth>
  );
}
