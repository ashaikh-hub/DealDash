'use client';

import { use } from 'react';
import { VoucherPage } from '../../../../features/vouchers';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <VoucherPage id={id} />;
}
