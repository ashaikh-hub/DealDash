'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { OnboardingPage } from '../../../features/onboarding';

export default function Page() {
  return (
    <RequireAuth>
      <OnboardingPage />
    </RequireAuth>
  );
}
