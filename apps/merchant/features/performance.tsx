'use client';

import {
  AiAssistantPanel,
  AiDraftsList,
  BillingWorkspace,
  PerformanceWorkspace,
  RequirePermission,
  useAuth,
} from '@dealdash/app-shell';
import { createTranslator } from '@dealdash/localization';
import { useOrgId } from './deal-utils';

/** Performance, targets, alerts, alert rules and notification preferences for the business (backend-enforced scope). */
export function MerchantPerformancePage() {
  return (
    <RequirePermission any={['merchant.performance.read']}>
      <PerformanceInner />
    </RequirePermission>
  );
}

function PerformanceInner() {
  const orgId = useOrgId();
  const { me } = useAuth();
  const perms = me?.permissions ?? [];
  if (!orgId) return null;
  return (
    <PerformanceWorkspace
      orgId={orgId}
      canTargets={perms.includes('merchant.targets.manage')}
      canAlerts={perms.includes('merchant.alerts.manage')}
    />
  );
}

/** Billing accounts, invoices and notes, receivables, purchase orders, statements and reconciliation. */
export function MerchantBillingPage() {
  return (
    <RequirePermission any={['merchant.finance.read']}>
      <BillingInner />
    </RequirePermission>
  );
}

function BillingInner() {
  const orgId = useOrgId();
  const { me } = useAuth();
  if (!orgId) return null;
  return (
    <BillingWorkspace
      orgId={orgId}
      canManage={(me?.permissions ?? []).includes('merchant.finance.manage')}
    />
  );
}

/** The Merchant Growth assistant: explains, recommends and drafts; a person approves before anything happens. */
export function MerchantAssistantPage() {
  return (
    <RequirePermission any={['merchant.ai.use']}>
      <AssistantInner />
    </RequirePermission>
  );
}

function AssistantInner() {
  const orgId = useOrgId();
  const { me, locale } = useAuth();
  const t = createTranslator(locale);
  const canApprove = (me?.permissions ?? []).includes('merchant.ai.approve');
  if (!orgId) return null;
  return (
    <div className="dd-stack" style={{ gap: 16 }}>
      <h1 className="dd-title-xl">{t('ai.agentName.MERCHANT_GROWTH')}</h1>
      <AiAssistantPanel
        askPath={`/v1/orgs/${orgId}/ai/ask`}
        draftsBase={`/v1/orgs/${orgId}/ai/drafts`}
        canApprove={canApprove}
        examples={['ai.ex.performance', 'ai.ex.targets', 'ai.ex.plan']}
      />
      <AiDraftsList path={`/v1/orgs/${orgId}/ai/drafts`} canApprove={canApprove} />
    </div>
  );
}
