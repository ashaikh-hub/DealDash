'use client';

import { use } from 'react';
import { RequireAuth } from '@dealdash/app-shell';
import { FinanceOrderPage } from '../../../../../features/finance';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireAuth>
      <FinanceOrderPage id={id} />
    </RequireAuth>
  );
}
