'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Alert } from '@dealdash/ui';
import { PartnerAcceptInvite } from '../../../features/accept-invite';

function Inner() {
  const token = useSearchParams().get('token');
  return token ? <PartnerAcceptInvite token={token} /> : <Alert tone="danger">Invalid link</Alert>;
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
