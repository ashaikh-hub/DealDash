'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  Countdown,
  HotCardView,
  HotDetailView,
  RequirePermission,
  errorMessage,
  fieldLabel,
  historyReason,
  useApi,
  useAuth,
} from '@dealdash/app-shell';
import {
  createTranslator,
  formatDateTime,
  withLocale,
  type DictionaryKey,
  type Locale,
} from '@dealdash/localization';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  LoadingState,
  Modal,
  StatusChip,
  Textarea,
  Timeline,
  type TimelineItem,
} from '@dealdash/ui';
import type { AdminHotDetail, HotMonitor } from '@dealdash/validation';
import { HOT_TONE } from './hot-deals';

type Action =
  | 'approve'
  | 'request-changes'
  | 'reject'
  | 'pause'
  | 'resume'
  | 'suspend'
  | 'reinstate'
  | 'cancel';
const LABEL: Record<string, DictionaryKey> = {
  approve: 'ah.approve',
  request_changes: 'ah.requestChanges',
  reject: 'ah.reject',
  pause: 'ah.pause',
  resume: 'ah.resume',
  suspend: 'ah.suspend',
  reinstate: 'ah.reinstate',
  cancel: 'ah.cancelDeal',
};

export function HotReviewPage({ id }: { id: string }) {
  return (
    <RequirePermission any={['admin.campaigns.review']}>
      <Inner id={id} />
    </RequirePermission>
  );
}

interface ActivityItem {
  id: string;
  at: string;
  source: 'deal' | 'reservation';
  code: string;
  note: string | null;
  actor: string | null;
  ref: string | null;
}

/** Per-Hot-Deal activity: deal decisions and reservation events (created, used, not completed, cancelled) in one feed. */
function ActivityFeed({ id }: { id: string }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [show, setShow] = useState(15);
  const load = useCallback(async () => {
    setFailed(false);
    const r = await call<ActivityItem[]>('GET', `/v1/admin/hot-deals/${id}/activity`);
    if (r.ok) setItems(Array.isArray(r.data) ? r.data : []);
    else setFailed(true);
  }, [call, id]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Card data-testid="hot-activity-feed">
      <div className="dd-row" style={{ justifyContent: 'space-between' }}>
        <h2 className="dd-title">{t('ah.activity')}</h2>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          {t('ah.activityRefresh')}
        </Button>
      </div>
      <div style={{ marginBlockStart: 12 }}>
        {failed ? (
          <Alert tone="danger">{t('state.error')}</Alert>
        ) : !items ? (
          <LoadingState label={t('state.loading')} />
        ) : items.length === 0 ? (
          <EmptyState title={t('ah.activityEmpty')} />
        ) : (
          <>
            <ul
              style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}
              aria-label={t('ah.activity')}
            >
              {items.slice(0, show).map((a) => (
                <li key={a.id} className="dd-row" style={{ alignItems: 'flex-start' }}>
                  <span className="dd-caption dd-ltr" style={{ minInlineSize: 150 }}>
                    {formatDateTime(locale, a.at)}
                  </span>
                  <div>
                    <strong>
                      {t(
                        (a.source === 'deal'
                          ? `hotaction.${a.code}`
                          : `resevent.${a.code}`) as DictionaryKey,
                      )}
                    </strong>
                    {a.ref ? <span className="dd-caption dd-ltr"> …{a.ref}</span> : null}
                    {a.actor ? <span className="dd-caption"> · {a.actor}</span> : null}
                    {a.note ? <div className="dd-caption">{a.note}</div> : null}
                  </div>
                </li>
              ))}
            </ul>
            {items.length > show ? (
              <Button
                size="sm"
                variant="outline"
                style={{ marginBlockStart: 12 }}
                onClick={() => setShow((n) => n + 15)}
              >
                {t('ah.activityMore')}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}

function Inner({ id }: { id: string }) {
  const { locale, me } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [d, setD] = useState<AdminHotDetail | null>(null);
  const [mon, setMon] = useState<HotMonitor | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [error, setError] = useState('');
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [reasonAr, setReasonAr] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [done, setDone] = useState(false);
  const [previewLang, setPreviewLang] = useState<Locale>(locale);

  const load = useCallback(async () => {
    const [r, m] = await Promise.all([
      call<AdminHotDetail>('GET', `/v1/admin/hot-deals/${id}`),
      call<HotMonitor>('GET', `/v1/admin/hot-deals/${id}/monitor`),
    ]);
    if (r.ok && r.data) {
      setD(r.data);
      if (m.ok && m.data) setMon(m.data);
      setState('ready');
    } else if (r.status === 404) setState('missing');
    else {
      setError(errorMessage(locale, r.errors));
      setState('error');
    }
  }, [call, id, locale]);
  useEffect(() => {
    void load();
  }, [load]);

  const open = (a: Action) => {
    setAction(a);
    setReason(a === 'approve' ? 'Offer is clear and limits are reasonable.' : '');
    setReasonAr(a === 'approve' ? 'العرض واضح والحدود معقولة.' : '');
    setFormError('');
  };
  const submit = async () => {
    if (!action) return;
    if (reason.trim().length < 3) return setFormError(t('modal.reasonRequired'));
    setBusy(true);
    const r = await call<AdminHotDetail>('POST', `/v1/admin/hot-deals/${id}/${action}`, {
      body: { reason: reason.trim(), reasonAr: reasonAr.trim() || undefined },
    });
    setBusy(false);
    if (!r.ok || !r.data) return setFormError(errorMessage(locale, r.errors));
    setD(r.data);
    setAction(null);
    setDone(true);
    void load();
  };

  if (state === 'loading') return <LoadingState label={t('state.loading')} />;
  if (state === 'missing')
    return (
      <EmptyState
        title={t('adeal.notFound')}
        action={
          <Link className="dd-btn dd-btn--secondary" href={withLocale('/hot-deals', locale)}>
            {t('adeal.back')}
          </Link>
        }
      />
    );
  if (state === 'error' || !d)
    return (
      <Alert tone="danger">
        {error}{' '}
        <Button size="sm" variant="outline" onClick={() => void load()}>
          {t('state.retry')}
        </Button>
      </Alert>
    );

  const c = d.content;
  const kebab = (a: string) => a.replace('_', '-') as Action;
  const actions = d.adminActions;
  const items: TimelineItem[] = d.history.map((h) => ({
    id: h.id,
    title: t(`hotaction.${h.action}` as DictionaryKey),
    meta: `${formatDateTime(locale, h.createdAt)} · ${h.actorName ?? h.actorRole ?? t('adeal.actorSystem')}${h.actorRole && h.actorName ? ` (${h.actorRole})` : ''}`,
    body:
      [
        historyReason(locale, h.reason),
        h.reasonAr,
        h.fields.length
          ? t('history.fields', {
              fields: [...new Set(h.fields.map((f) => fieldLabel(locale, f)))].join(', '),
            })
          : null,
      ]
        .filter(Boolean)
        .join('\n') || undefined,
    tone: /REJECT|SUSPEND|CANCEL/.test(h.action)
      ? 'danger'
      : /REQUEST_CHANGES|SOLD_OUT/.test(h.action)
        ? 'warning'
        : /APPROVE|ACTIVATE|REOPEN/.test(h.action)
          ? 'success'
          : 'info',
  }));

  const columns = (['en', 'ar'] as const).map((lang) => (
    <Card key={lang} flat>
      <div
        className="dd-stack"
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        lang={lang}
        data-testid={`content-${lang}`}
      >
        <span className="dd-bi__lang">
          {lang === 'en' ? t('adeal.english') : t('adeal.arabic')}
        </span>
        <div className="dd-kpi__l">{t('field.offerLabel')}</div>
        <strong style={{ fontSize: 22 }}>{c.offerLabel[lang]}</strong>
        <div className="dd-kpi__l">{t('field.title')}</div>
        <strong>{c.title[lang]}</strong>
        <div className="dd-kpi__l">{t('field.shortDescription')}</div>
        <div>{c.shortDescription[lang]}</div>
        <div className="dd-kpi__l">{t('field.description')}</div>
        <div className="dd-pre">{c.description[lang]}</div>
        <div className="dd-kpi__l">{t('adeal.terms')}</div>
        <div className="dd-pre">{lang === 'en' ? c.terms.textEn : c.terms.textAr}</div>
      </div>
    </Card>
  ));
  const rules = d.reservationRules;
  const canAct = (a: string) => actions.includes(a);

  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="hot-review">
      <Link className="dd-link" href={withLocale('/hot-deals', locale)}>
        ← {t('adeal.back')}
      </Link>
      <div className="dd-topbar">
        <div className="dd-row">
          <h1 className="dd-title-xl dd-clamp">{d.preview.title[locale] || d.preview.title.en}</h1>
          <StatusChip tone={HOT_TONE[d.status]}>
            {t(`hotstatus.${d.status}` as DictionaryKey)}
          </StatusChip>
          <StatusChip tone="neutral">{t(`hotlimit.${c.limitType}` as DictionaryKey)}</StatusChip>
        </div>
      </div>
      {done ? <Alert tone="success">{t('ah.done')}</Alert> : null}

      <div className="dd-review">
        <div className="dd-stack" style={{ gap: 16 }}>
          <Card>
            <h2 className="dd-title">{t('adeal.merchant')}</h2>
            <dl className="dd-kv" style={{ marginBlockStart: 8 }}>
              <div className="dd-kv__row">
                <dt>{t('adeal.merchant')}</dt>
                <dd>{locale === 'ar' ? d.merchant.nameAr : d.merchant.nameEn}</dd>
              </div>
              <div className="dd-kv__row">
                <dt>{t('adeal.merchantStatus')}</dt>
                <dd>{d.merchant.status}</dd>
              </div>
              <div className="dd-kv__row">
                <dt>{t('adeal.col.merchant')}</dt>
                <dd>{t(`adeal.trust.${d.merchant.trustLevel}` as DictionaryKey)}</dd>
              </div>
              <div className="dd-kv__row">
                <dt>{t('adeal.risk')}</dt>
                <dd>{d.merchant.riskTier}</dd>
              </div>
            </dl>
          </Card>

          <Card data-testid="hot-rules">
            <h2 className="dd-title">{t('ah.detail.rules')}</h2>
            <dl className="dd-kv" style={{ marginBlockStart: 8 }}>
              <div className="dd-kv__row">
                <dt>{t('ah.rule.enabled')}</dt>
                <dd>{rules.reservationsEnabled ? t('ah.on') : t('ah.off')}</dd>
              </div>
              {rules.reservationsEnabled ? (
                <>
                  <div className="dd-kv__row">
                    <dt>{t('ah.rule.hold')}</dt>
                    <dd>{t('res.minutes', { n: rules.holdMinutes })}</dd>
                  </div>
                  <div className="dd-kv__row">
                    <dt>{t('ah.rule.perCustomer')}</dt>
                    <dd className="dd-ltr">{rules.perCustomerLimit}</dd>
                  </div>
                  <div className="dd-kv__row">
                    <dt>{t('ah.rule.maxActive')}</dt>
                    <dd className="dd-ltr">{rules.maxActivePerCustomer}</dd>
                  </div>
                  <div className="dd-kv__row">
                    <dt>{t('ah.rule.noShow')}</dt>
                    <dd>
                      {t('ah.rule.noShowValue', {
                        n: rules.noShowThreshold,
                        days: rules.noShowBlockDays,
                      })}
                    </dd>
                  </div>
                </>
              ) : null}
              <div className="dd-kv__row">
                <dt>{t('adeal.dates')}</dt>
                <dd>
                  {c.startAt ? formatDateTime(locale, c.startAt) : '-'} –{' '}
                  {c.endAt ? formatDateTime(locale, c.endAt) : t('mh.untilStock')}
                </dd>
              </div>
              <div className="dd-kv__row">
                <dt>{t('adeal.eligibility')}</dt>
                <dd>
                  {t(`elig.${c.eligibility.kind}` as DictionaryKey)}
                  {c.eligibility.valueRefs.length ? ` (${c.eligibility.valueRefs.length})` : ''}
                </dd>
              </div>
            </dl>
          </Card>

          <Card>
            <h2 className="dd-title">{t('ah.detail.inventory')}</h2>
            <div className="dd-table-wrap" style={{ marginBlockStart: 8 }}>
              <table className="dd-table" data-testid="admin-inventory">
                <thead>
                  <tr>
                    <th scope="col">{t('mm.col.branch')}</th>
                    <th scope="col" className="dd-num">
                      {t('mm.total')}
                    </th>
                    <th scope="col" className="dd-num">
                      {t('mm.available')}
                    </th>
                    <th scope="col" className="dd-num">
                      {t('mm.reserved')}
                    </th>
                    <th scope="col" className="dd-num">
                      {t('mm.redeemed')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.inventory.map((i) => (
                    <tr key={i.branchId}>
                      <td>{i.branchName[locale] || i.branchName.en}</td>
                      <td className="dd-num">{i.tracked ? i.stock.total : '–'}</td>
                      <td className="dd-num">{i.tracked ? i.stock.available : '–'}</td>
                      <td className="dd-num">{i.tracked ? i.stock.reserved : '–'}</td>
                      <td className="dd-num">{i.tracked ? i.stock.redeemed : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {mon ? (
              <p className="dd-caption" style={{ marginBlockStart: 8 }}>
                {t('mm.timeLeft')}:{' '}
                <Countdown target={mon.endAt} serverNow={mon.serverNow} locale={locale} /> ·{' '}
                {t('mm.funnel')}: {mon.funnel.impressions} / {mon.funnel.detailViews} /{' '}
                {mon.funnel.reservationsCreated} / {mon.funnel.redeemed}
              </p>
            ) : null}
          </Card>

          <div>
            <h2 className="dd-title" style={{ marginBlockEnd: 8 }}>
              {t('adeal.content')}
            </h2>
            <div className="dd-compare">{columns}</div>
          </div>

          <Card>
            <h2 className="dd-title">{t('adeal.media')}</h2>
            <div className="dd-media-grid" style={{ marginBlockStart: 8 }}>
              {d.media.map((m) => (
                <figure key={m.fileId} className="dd-media-item" style={{ margin: 0 }}>
                  {m.url ? (
                    <img src={m.url} alt={(locale === 'ar' ? m.altAr : m.altEn) || ''} />
                  ) : null}
                  <figcaption className="dd-caption">
                    {m.altEn}
                    <br />
                    {m.altAr}
                  </figcaption>
                </figure>
              ))}
            </div>
          </Card>

          <Card>
            <h2 className="dd-title">{t('ah.history')}</h2>
            <div style={{ marginBlockStart: 12 }}>
              {items.length ? (
                <Timeline items={items} label={t('ah.history')} />
              ) : (
                <EmptyState title={t('history.empty')} />
              )}
            </div>
          </Card>

          <ActivityFeed id={id} />
        </div>

        <aside className="dd-review__aside">
          <Card>
            <h2 className="dd-title">{t('adeal.decision')}</h2>
            <div className="dd-stack" style={{ marginBlockStart: 8 }}>
              <Alert
                tone={d.guardrail.outcome === 'AUTO_PUBLISH' ? 'success' : 'info'}
                title={t('adeal.guardrail')}
              >
                {d.guardrail.outcome === 'AUTO_PUBLISH'
                  ? t('guardrail.auto')
                  : t('guardrail.manual')}
              </Alert>
              {d.issues.length ? (
                <Alert tone="warning">
                  {d.issues.map((i) => `${i.field}: ${i.code}`).join(' · ')}
                </Alert>
              ) : null}
              {actions.length === 0 ? (
                <p className="dd-muted">
                  {me?.permissions.includes('admin.campaigns.control')
                    ? t('adeal.nothingToReview')
                    : t('ah.noPermission')}
                </p>
              ) : null}
              {actions.map((a) => (
                <Button
                  key={a}
                  variant={
                    a === 'approve'
                      ? 'primary'
                      : a === 'reject' || a === 'suspend'
                        ? 'danger'
                        : 'outline'
                  }
                  block
                  onClick={() => open(kebab(a))}
                  data-testid={`act-${a}`}
                >
                  {t(LABEL[a]!)}
                </Button>
              ))}
              {canAct('suspend') || canAct('pause') || canAct('resume') || canAct('reinstate') ? (
                <Button
                  variant="outline"
                  block
                  onClick={() => open('cancel')}
                  data-testid="act-cancel"
                >
                  {t('ah.cancelDeal')}
                </Button>
              ) : null}
            </div>
          </Card>
          <Card>
            <div className="dd-stack">
              <div className="dd-row" style={{ justifyContent: 'space-between' }}>
                <h2 className="dd-title">{t('ah.preview')}</h2>
                <div className="dd-lang">
                  {(['en', 'ar'] as const).map((l) => (
                    <a
                      key={l}
                      href="#preview"
                      aria-current={previewLang === l ? 'true' : undefined}
                      onClick={(e) => {
                        e.preventDefault();
                        setPreviewLang(l);
                      }}
                    >
                      {l === 'en' ? 'EN' : 'عربي'}
                    </a>
                  ))}
                </div>
              </div>
              <div
                dir={previewLang === 'ar' ? 'rtl' : 'ltr'}
                lang={previewLang}
                data-testid="admin-preview"
                style={{ maxBlockSize: 640, overflow: 'auto' }}
              >
                <div style={{ display: 'flex', justifyContent: 'center', marginBlockEnd: 12 }}>
                  <HotCardView deal={d.preview} locale={previewLang} />
                </div>
                <HotDetailView detail={d.preview} locale={previewLang} embedded />
              </div>
            </div>
          </Card>
        </aside>
      </div>

      <Modal
        open={action !== null}
        onClose={() => setAction(null)}
        closeLabel={t('common.close')}
        title={action ? t(LABEL[action.replace('-', '_')]!) : ''}
        footer={
          <>
            <Button variant="outline" onClick={() => setAction(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={
                action === 'reject' || action === 'suspend' || action === 'cancel'
                  ? 'danger'
                  : 'primary'
              }
              loading={busy}
              onClick={() => void submit()}
              data-testid="decision-confirm"
            >
              {t('adeal.confirm')}
            </Button>
          </>
        }
      >
        <div className="dd-stack">
          <p className="dd-help">{t('adeal.reasonHelp')}</p>
          <Field label={t('adeal.reason')} htmlFor="dec-reason" error={formError || undefined}>
            <Textarea
              id="dec-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              invalid={!!formError}
            />
          </Field>
          <Field label={t('ah.reasonAr')} htmlFor="dec-reason-ar">
            <Textarea
              id="dec-reason-ar"
              rows={3}
              dir="rtl"
              lang="ar"
              value={reasonAr}
              onChange={(e) => setReasonAr(e.target.value)}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
