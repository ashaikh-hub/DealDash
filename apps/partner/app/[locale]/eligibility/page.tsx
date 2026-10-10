'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { PartnerEligibilityPage } from '../../../features/eligibility';

export default function Page() {
  return (
    <RequireAuth>
      <PartnerEligibilityPage />
    </RequireAuth>
  );
}
