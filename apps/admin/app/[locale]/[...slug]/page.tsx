'use client';

import { PlaceholderPage } from '@dealdash/app-shell';
import { use } from 'react';

export default function SlugPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = use(params);
  return <PlaceholderPage slug={slug} />;
}
