'use client';

import { use } from 'react';
import { DealPage } from '../../../../features/screens';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <DealPage id={id} />;
}
