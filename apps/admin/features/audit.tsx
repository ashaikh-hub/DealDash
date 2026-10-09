'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RequirePermission, errorMessage, useApi, useAuth } from '@dealdash/app-shell';
import { createTranslator, formatDateTime } from '@dealdash/localization';
import { Alert, Button, Card, EmptyState, Field, Input, LoadingState, Table } from '@dealdash/ui';

interface Row {
  id: string;
  occurredAt: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorUserId: string | null;
  actorRole: string | null;
  actorOrganizationId: string | null;
  subjectOrganizationId?: string | null;
  reason: string | null;
  requestId: string | null;
}

/** Read-only audit log viewer (append-only on the server; there is no edit or delete anywhere). */
export function AuditPage() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Array<{ code: string; message: string }>>([]);
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [applied, setApplied] = useState({ action: '', entityType: '' });
  const seq = useRef(0);

  const load = useCallback(
    async (after?: string | null) => {
      const mine = ++seq.current;
      setLoading(true);
      const res = await call<Row[]>('GET', '/v1/admin/audit', {
        query: {
          limit: 50,
          cursor: after ?? undefined,
          action: applied.action || undefined,
          entityType: applied.entityType || undefined,
        },
      });
      if (mine !== seq.current) return;
      setLoading(false);
      setErrors(res.errors);
      if (res.ok) {
        setRows((prev) => (after ? [...prev, ...(res.data ?? [])] : (res.data ?? [])));
        setCursor(res.nextCursor);
      }
    },
    [call, applied],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  return (
    <RequirePermission any={['admin.audit.read']}>
      <div className="dd-stack">
        <h1 className="dd-title-xl">{t('nav.audit')}</h1>
        <Card>
          <form
            className="dd-row"
            style={{ alignItems: 'flex-end' }}
            onSubmit={(e) => {
              e.preventDefault();
              setApplied({ action: action.trim(), entityType: entityType.trim() });
            }}
          >
            <Field label={t('audit.action')} htmlFor="a-action">
              <Input
                id="a-action"
                dir="ltr"
                placeholder="merchant.application.approved"
                value={action}
                onChange={(e) => setAction(e.target.value)}
              />
            </Field>
            <Field label={t('audit.entity')} htmlFor="a-entity">
              <Input
                id="a-entity"
                dir="ltr"
                placeholder="MerchantApplication"
                value={entityType}
                onChange={(e) => setEntityType(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="secondary">
              {t('merchants.apply')}
            </Button>
          </form>
        </Card>
        {errors.length ? <Alert tone="danger">{errorMessage(locale, errors)}</Alert> : null}
        {loading && rows.length === 0 ? (
          <LoadingState label={t('state.loading')} />
        ) : (
          <Table
            caption={t('nav.audit')}
            columns={[
              {
                key: 'at',
                header: t('audit.when'),
                render: (r) => formatDateTime(locale, r.occurredAt),
              },
              {
                key: 'action',
                header: t('audit.action'),
                render: (r) => <span className="dd-ltr">{r.action}</span>,
              },
              {
                key: 'entity',
                header: t('audit.entity'),
                render: (r) => <span className="dd-ltr">{r.entityType}</span>,
              },
              { key: 'role', header: t('audit.role'), render: (r) => r.actorRole ?? '-' },
              { key: 'reason', header: t('common.reason'), render: (r) => r.reason ?? '-' },
              {
                key: 'req',
                header: t('audit.request'),
                render: (r) => (
                  <span className="dd-ltr dd-caption">{r.requestId?.slice(0, 8) ?? '-'}</span>
                ),
              },
            ]}
            rows={rows as unknown as Array<Row & Record<string, unknown>>}
            rowKey={(r) => r.id}
            empty={<EmptyState title={t('state.empty')} />}
          />
        )}
        {cursor ? (
          <div>
            <Button variant="outline" loading={loading} onClick={() => void load(cursor)}>
              {t('common.loadMore')}
            </Button>
          </div>
        ) : null}
      </div>
    </RequirePermission>
  );
}
