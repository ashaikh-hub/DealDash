'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { TeamPage } from '../../../features/team';

export default function Page() {
  return (
    <RequireAuth>
      <TeamPage />
    </RequireAuth>
  );
}
