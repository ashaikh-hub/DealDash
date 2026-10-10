'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { MerchantPartnerBenefitsPage } from '../../../features/partner-benefits';

export default function Page() {
  return (
    <RequireAuth>
      <MerchantPartnerBenefitsPage />
    </RequireAuth>
  );
}
