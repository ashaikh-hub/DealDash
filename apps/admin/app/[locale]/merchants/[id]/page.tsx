'use client';

import { use } from 'react';
import { RequireAuth } from '@dealdash/app-shell';
import { WorkbenchPage } from '../../../../features/workbench';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireAuth>
      <WorkbenchPage orgId={id} />
    </RequireAuth>
  );
}
