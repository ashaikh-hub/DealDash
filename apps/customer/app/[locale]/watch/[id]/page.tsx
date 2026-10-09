'use client';

import { use } from 'react';
import { WatchPage } from '../../../../features/watch';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <WatchPage id={id} />;
}
