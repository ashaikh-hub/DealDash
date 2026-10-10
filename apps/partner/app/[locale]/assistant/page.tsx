'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { PartnerAssistantPage } from '../../../features/workspaces';

export default function Page() {
  return (
    <RequireAuth>
      <PartnerAssistantPage />
    </RequireAuth>
  );
}
