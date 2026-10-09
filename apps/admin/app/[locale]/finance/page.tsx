'use client';

import { RequireAuth } from '@dealdash/app-shell';
import { FinanceWorkbench } from '../../../features/finance';

export default function Page() {
  return (
    <RequireAuth>
      <FinanceWorkbench />
    </RequireAuth>
  );
}
