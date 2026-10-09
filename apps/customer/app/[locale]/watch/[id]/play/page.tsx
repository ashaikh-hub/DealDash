'use client';

import { use } from 'react';
import { WatchPlayerPage } from '../../../../../features/watch';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <WatchPlayerPage id={id} />;
}
