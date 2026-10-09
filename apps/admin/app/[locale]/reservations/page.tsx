'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { ReservationToolsPage } from '../../../features/reservation-tools';

export default function Page() {
  return (
    <RequireAuth>
      <ReservationToolsPage />
    </RequireAuth>
  );
}
