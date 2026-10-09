'use client';

import { use } from 'react';
import { OrderStatusPage } from '../../../../features/vouchers';

export default function Page({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  return <OrderStatusPage orderId={orderId} />;
}
