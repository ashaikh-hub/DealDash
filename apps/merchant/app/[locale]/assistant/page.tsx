'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { MerchantAssistantPage } from '../../../features/performance';

export default function Page() {
  return (
    <RequireAuth>
      <MerchantAssistantPage />
    </RequireAuth>
  );
}
