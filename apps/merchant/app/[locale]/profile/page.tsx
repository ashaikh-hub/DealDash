'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { ProfilePage } from '../../../features/profile-home';

export default function Page() {
  return (
    <RequireAuth>
      <ProfilePage />
    </RequireAuth>
  );
}
