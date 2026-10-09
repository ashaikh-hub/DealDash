'use client';

import { AiAssistantPanel, RequireAuth } from '@dealdash/app-shell';

/**
 * The Best-Deal assistant: finds offers the customer is eligible for now and explains why. It never reserves, buys, pays, spends
 * points or redeems: every such step opens the normal screen for the customer to confirm.
 */
export function CustomerAssistantPage() {
  return (
    <RequireAuth>
      <div className="dd-stack" style={{ gap: 16 }}>
        <AiAssistantPanel askPath="/v1/app/ai/ask" allowDrafting={false} examples={['ai.ex.deals', 'ai.ex.points', 'ai.ex.vouchers']} />
      </div>
    </RequireAuth>
  );
}