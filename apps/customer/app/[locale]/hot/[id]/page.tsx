'use client';

import { use } from 'react';
import { HotDealPage } from '../../../../features/hot';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <HotDealPage id={id} />;
}
