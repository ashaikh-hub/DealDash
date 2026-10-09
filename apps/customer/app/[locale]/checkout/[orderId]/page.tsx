'use client';

import { use } from 'react';
import { CheckoutPage } from '../../../../features/vouchers';

export default function Page({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  return <CheckoutPage orderId={orderId} />;
}
