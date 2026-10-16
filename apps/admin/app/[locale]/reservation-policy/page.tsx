'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { ReservationPolicyPage } from '../../../features/reservation-policy';

export default function Page() {
  return (
    <RequireAuth>
      <ReservationPolicyPage />
    </RequireAuth>
  );
}
