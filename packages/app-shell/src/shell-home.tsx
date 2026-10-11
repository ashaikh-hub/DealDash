import { useEffect, useState } from 'react';
import { createTranslator, formatMoney, formatDate, isolateLtr } from '@dealdash/localization';
import { Alert, Card, EmptyState, LoadingState, StatusChip, Table } from '@dealdash/ui';
import { useAuth } from './auth-context';
import { LoginPanel } from './login-panel';

type Health = {
  status: string;
  database: { migrationsCurrent: boolean };
  postgis: { enabled: boolean; version: string | null };
};

/** Foundation home page: auth state, role and permissions, API status, and an RTL/bilingual demonstration. */
export function ShellHome() {
  const { status, me, locale, client, track, needsMfa } = useAuth();
  const t = createTranslator(locale);
  const [health, setHealth] = useState<'loading' | 'down' | Health>('loading');

  useEffect(() => {
    let alive = true;
    client
      .GET('/v1/health')
      .then((r) => {
        if (!alive) return;
        const d = (r.data as { data?: Health } | undefined)?.data;
        setHealth(d ?? 'down');
      })
      .catch(() => alive && setHealth('down'));
    return () => {
      alive = false;
    };
  }, [client]);

  useEffect(() => {
    track('screen.viewed', { screen: 'home' });
  }, [track]);

  if (status === 'loading') return <LoadingState label={t('state.loading')} />;

  const rows = [
    {
      id: '1',
      merchant: locale === 'ar' ? 'مطعم نوبو' : 'Nobu',
      branch: locale === 'ar' ? 'العليا' : 'Olaya',
      status: t('status.active'),
    },
    { id: '2', merchant: 'Daily Dose | ديلي دوز', branch: 'KAFD', status: t('status.pending') },
  ];

  return (
    <div className="dd-stack">
      {status !== 'authenticated' || needsMfa ? <LoginPanel heading="h1" /> : null}

      {status === 'authenticated' && me && !needsMfa ? (
        <Card>
          <div className="dd-stack">
            <h2 className="dd-title">
              {t('auth.signedInAs')} {me.displayName}
            </h2>
            <div className="dd-row">
              <StatusChip tone="info">{me.activeMembership?.roleCode ?? me.userType}</StatusChip>
              {me.activeMembership ? (
                <StatusChip tone="neutral">
                  {me.activeMembership.organizationName[locale]}
                </StatusChip>
              ) : null}
              <StatusChip tone="success">
                {t('shell.permissionCount', { count: me.permissions.length })}
              </StatusChip>
            </div>
            <ul className="dd-perm-list" aria-label={t('auth.permissions')}>
              {me.permissions.map((p) => (
                <li key={p}>
                  <span className="dd-chip dd-chip--neutral dd-ltr">{p}</span>
                </li>
              ))}
            </ul>
            <p className="dd-caption">{t('shell.permissionAware')}</p>
          </div>
        </Card>
      ) : null}

      <div className="dd-grid dd-grid--2">
        <Card>
          <div className="dd-stack">
            <h2 className="dd-title">{t('shell.apiStatus')}</h2>
            {health === 'loading' ? (
              <LoadingState label={t('state.loading')} />
            ) : health === 'down' ? (
              <Alert tone="danger">{t('shell.apiDown')}</Alert>
            ) : (
              <div className="dd-row">
                <StatusChip tone="success">{t('shell.apiOk')}</StatusChip>
                <StatusChip tone={health.database.migrationsCurrent ? 'success' : 'warning'}>
                  migrations
                </StatusChip>
                <StatusChip tone={health.postgis.enabled ? 'success' : 'warning'}>
                  PostGIS {health.postgis.version ?? '-'}
                </StatusChip>
              </div>
            )}
            <p className="dd-caption">{t('shell.foundationNote')}</p>
          </div>
        </Card>

        <Card>
          <div className="dd-stack" data-testid="rtl-demo">
            <h2 className="dd-title">{t('rtl.title')}</h2>
            <p>{t('rtl.body')}</p>
            <p>{t('rtl.mixed')}</p>
            <div className="dd-row">
              <span className="dd-ltr">{formatMoney(locale, 8000)}</span>
              <span>{formatDate(locale, '2026-10-31')}</span>
              <span className="dd-ltr">{isolateLtr('RSV-7K3Q9')}</span>
            </div>
          </div>
        </Card>
      </div>

      <Table
        caption={t('rtl.title')}
        rowKey={(r) => r.id}
        columns={[
          { key: 'merchant', header: t('rtl.tableMerchant') },
          { key: 'branch', header: t('rtl.tableBranch') },
          { key: 'status', header: t('rtl.tableStatus') },
        ]}
        rows={rows}
        empty={<EmptyState title={t('state.empty')} />}
      />
    </div>
  );
}
