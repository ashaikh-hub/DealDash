'use client';

import { useState } from 'react';
import { RequirePermission, errorMessage, useApi, useAuth, useResource } from '@dealdash/app-shell';
import { createTranslator, type DictionaryKey } from '@dealdash/localization';
import { Alert, Button, Card, EmptyState, LoadingState, StatusChip } from '@dealdash/ui';
import { useOrgId } from './deal-utils';

interface Benefit {
  id: string;
  reference: string;
  liveDealId: string;
  partnerNameEn: string | null;
  partnerNameAr: string | null;
  kind: string;
  labelEn: string;
  labelAr: string;
  termsEn: string;
  termsAr: string;
  status: string;
}
const k = (p: string, v: string) => `${p}.${v}` as DictionaryKey;

/** Stage 7: partners propose extra benefits for their customers on this merchant's Live Deals; the merchant decides first. */
export function MerchantPartnerBenefitsPage() {
  return (
    <RequirePermission any={['merchant.deals.read']}>
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { locale, me } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const orgId = useOrgId();
  const canDecide = (me?.permissions ?? []).includes('merchant.deals.manage');
  const res = useResource<Benefit[]>(orgId ? `/v1/merchants/${orgId}/partner-benefits` : null);
  const [banner, setBanner] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const decide = async (id: string, decision: 'APPROVE' | 'REJECT') => {
    const r = await call('POST', `/v1/merchants/${orgId}/partner-benefits/${id}/decision`, {
      body: { decision, reason: decision === 'REJECT' ? t('pt.ben.reject') : undefined },
      idempotent: true,
    });
    setBanner(
      r.ok
        ? { tone: 'success', text: t('pt.saved') }
        : { tone: 'danger', text: errorMessage(locale, r.errors) },
    );
    if (r.ok) await res.reload();
  };
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="mp-benefits">
      <h1 className="dd-title-xl">{t('nav.partnerBenefits')}</h1>
      <p className="dd-muted" style={{ margin: 0 }}>
        {t('pt.ben.merchantIntro')}
      </p>
      {banner ? <Alert tone={banner.tone}>{banner.text}</Alert> : null}
      <Card>
        {res.loading && !res.data ? (
          <LoadingState label={t('state.loading')} />
        ) : !res.data?.length ? (
          <EmptyState title={t('pt.state.empty')} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="dd-table">
              <tbody>
                {res.data.map((b) => (
                  <tr key={b.id} data-testid={`mp-benefit-${b.id}`}>
                    <td>
                      {locale === 'ar' ? b.labelAr : b.labelEn}
                      <div className="dd-muted">{locale === 'ar' ? b.termsAr : b.termsEn}</div>
                    </td>
                    <td>
                      {t('pt.ben.partner')}: {locale === 'ar' ? b.partnerNameAr : b.partnerNameEn}
                    </td>
                    <td>{t(k('pt.bkind', b.kind))}</td>
                    <td>
                      <StatusChip
                        tone={
                          b.status === 'ACTIVE'
                            ? 'success'
                            : b.status === 'PROPOSED' || b.status === 'MERCHANT_APPROVED'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {t(k('pt.bstate', b.status))}
                      </StatusChip>
                    </td>
                    <td>
                      {canDecide && b.status === 'PROPOSED' ? (
                        <span className="dd-row" style={{ gap: 4 }}>
                          <Button
                            size="sm"
                            onClick={() => void decide(b.id, 'APPROVE')}
                            data-testid={`mp-approve-${b.id}`}
                          >
                            {t('pt.ben.approve')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void decide(b.id, 'REJECT')}
                          >
                            {t('pt.ben.reject')}
                          </Button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
