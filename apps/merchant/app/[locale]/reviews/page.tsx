'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { MerchantReviewsPage } from '../../../features/settlements-reviews';

export default function Page() {
  return (
    <RequireAuth>
      <MerchantReviewsPage />
    </RequireAuth>
  );
}
