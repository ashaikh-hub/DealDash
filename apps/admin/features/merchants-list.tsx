'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RequirePermission, errorMessage, useApi, useAuth } from '@dealdash/app-shell';
import { createTranslator, formatDateTime, withLocale } from '@dealdash/localization';
import {
  APPLICATION_STATUSES,
  ORGANIZATION_STATUSES,
  RISK_TIERS,
  TRUST_LEVELS,
} from '@dealdash/types';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  LoadingState,
  Select,
  StatusChip,
  Table,
  Tabs,
} from '@dealdash/ui';
import type { AdminMerchantRow } from '@dealdash/validation';
import { appTone, orgTone } from './tones';

/** Cursor-paginated list: reloads when filters change, "load more" appends the next page. */
function usePagedList(path: string, query: Record<string, string | undefined>) {
  const { call } = useApi();
  const [items, setItems] = useState<AdminMerchantRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Array<{ code: string; message: string }>>([]);
  const key = JSON.stringify([path, query]);
  const seq = useRef(0);

  const load = useCallback(
    async (after?: string | null) => {
      const mine = ++seq.current;
      setLoading(true);
      const res = await call<AdminMerchantRow[]>('GET', path, {
        query: { ...JSON.parse(key)[1], limit: 25, cursor: after ?? undefined },
      });
      if (mine !== seq.current) return;
      setLoading(false);
      setErrors(res.errors);
      if (res.ok) {
        setItems((prev) => (after ? [...prev, ...(res.data ?? [])] : (res.data ?? [])));
        setCursor(res.nextCursor);
      }
    },
    [call, key, path],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  return { items, cursor, loading, errors, more: () => load(cursor), reload: () => load(null) };
}

export function MerchantsPage() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const [tab, setTab] = useState<'queue' | 'all'>('queue');
  const [qText, setQText] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [trust, setTrust] = useState('');
  const [risk, setRisk] = useState('');
  const [assigned, setAssigned] = useState('');
  const [appStatus, setAppStatus] = useState('');

  const queue = usePagedList(
    tab === 'queue' ? '/v1/admin/merchants/queue' : '/v1/admin/merchants',
    tab === 'queue'
      ? { risk: risk || undefined, assigned: assigned || undefined, status: appStatus || undefined }
      : {
          q: q || undefined,
          status: status || undefined,
          trust: trust || undefined,
          risk: risk || undefined,
        },
  );

  return (
    <RequirePermission any={['admin.merchants.review']}>
      <div className="dd-stack">
        <h1 className="dd-title-xl">{t('nav.merchants')}</h1>
        <Tabs
          label={t('merchants.views')}
          value={tab}
          onChange={(id) => setTab(id as 'queue' | 'all')}
          tabs={[
            { id: 'queue', label: t('merchants.queue') },
            { id: 'all', label: t('merchants.all') },
          ]}
        />
        <Card>
          <form
            className="dd-row"
            style={{ alignItems: 'flex-end' }}
            onSubmit={(e) => {
              e.preventDefault();
              setQ(qText.trim());
            }}
          >
            {tab === 'all' ? (
              <>
                <Field label={t('merchants.search')} htmlFor="m-q">
                  <Input
                    id="m-q"
                    value={qText}
                    onChange={(e) => setQText(e.target.value)}
                    placeholder={t('merchants.searchHint')}
                  />
                </Field>
                <Field label={t('merchants.orgStatus')} htmlFor="m-status">
                  <Select id="m-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">{t('common.all')}</option>
                    {ORGANIZATION_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {t(`orgStatus.${s}` as never)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('merchants.trust')} htmlFor="m-trust">
                  <Select id="m-trust" value={trust} onChange={(e) => setTrust(e.target.value)}>
                    <option value="">{t('common.all')}</option>
                    {TRUST_LEVELS.map((s) => (
                      <option key={s} value={s}>
                        {t(`trust.${s}` as never)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </>
            ) : (
              <>
                <Field label={t('merchants.appStatus')} htmlFor="m-appstatus">
                  <Select
                    id="m-appstatus"
                    value={appStatus}
                    onChange={(e) => setAppStatus(e.target.value)}
                  >
                    <option value="">{t('merchants.queueDefault')}</option>
                    {APPLICATION_STATUSES.filter((s) => s !== 'DRAFT').map((s) => (
                      <option key={s} value={s}>
                        {t(`appStatus.${s}` as never)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('merchants.assigned')} htmlFor="m-assigned">
                  <Select
                    id="m-assigned"
                    value={assigned}
                    onChange={(e) => setAssigned(e.target.value)}
                  >
                    <option value="">{t('common.all')}</option>
                    <option value="me">{t('merchants.assignedMe')}</option>
                    <option value="unassigned">{t('merchants.unassigned')}</option>
                  </Select>
                </Field>
              </>
            )}
            <Field label={t('merchants.risk')} htmlFor="m-risk">
              <Select id="m-risk" value={risk} onChange={(e) => setRisk(e.target.value)}>
                <option value="">{t('common.all')}</option>
                {RISK_TIERS.map((s) => (
                  <option key={s} value={s}>
                    {t(`risk.${s}` as never)}
                  </option>
                ))}
              </Select>
            </Field>
            {tab === 'all' ? (
              <Button type="submit" variant="secondary">
                {t('merchants.apply')}
              </Button>
            ) : null}
          </form>
        </Card>

        {queue.errors.length ? (
          <Alert tone="danger">{errorMessage(locale, queue.errors)}</Alert>
        ) : null}
        {queue.loading && queue.items.length === 0 ? (
          <LoadingState label={t('state.loading')} />
        ) : (
          <Table
            caption={tab === 'queue' ? t('merchants.queue') : t('merchants.all')}
            columns={[
              {
                key: 'merchant',
                header: t('merchants.merchant'),
                render: (m) => (
                  <Link href={withLocale(`/merchants/${m.organizationId}`, locale)}>
                    <strong>{locale === 'ar' ? m.tradeNameAr : m.tradeNameEn}</strong>
                    <div className="dd-caption dd-ltr">{m.reference ?? ''}</div>
                  </Link>
                ),
              },
              {
                key: 'app',
                header: t('merchants.appStatus'),
                render: (m) =>
                  m.applicationStatus ? (
                    <StatusChip tone={appTone[m.applicationStatus]}>
                      {t(`appStatus.${m.applicationStatus}` as never)}
                    </StatusChip>
                  ) : (
                    '-'
                  ),
              },
              {
                key: 'status',
                header: t('merchants.orgStatus'),
                render: (m) => (
                  <StatusChip tone={orgTone[m.status]}>
                    {t(`orgStatus.${m.status}` as never)}
                  </StatusChip>
                ),
              },
              {
                key: 'risk',
                header: t('merchants.risk'),
                render: (m) => (
                  <StatusChip tone={m.riskTier === 'ENHANCED' ? 'warning' : 'neutral'}>
                    {t(`risk.${m.riskTier}` as never)}
                  </StatusChip>
                ),
              },
              {
                key: 'trust',
                header: t('merchants.trust'),
                render: (m) => t(`trust.${m.trustLevel}` as never),
              },
              { key: 'branches', header: t('merchants.branches'), numeric: true },
              {
                key: 'submitted',
                header: t('merchants.submitted'),
                render: (m) => (m.submittedAt ? formatDateTime(locale, m.submittedAt) : '-'),
              },
              {
                key: 'assigned',
                header: t('merchants.assigned'),
                render: (m) => m.assignedTo ?? '-',
              },
            ]}
            rows={queue.items as unknown as Array<AdminMerchantRow & Record<string, unknown>>}
            rowKey={(m) => m.organizationId}
            empty={<EmptyState title={t('merchants.empty')} />}
          />
        )}
        {queue.cursor ? (
          <div>
            <Button variant="outline" loading={queue.loading} onClick={() => void queue.more()}>
              {t('common.loadMore')}
            </Button>
          </div>
        ) : null}
      </div>
    </RequirePermission>
  );
}
