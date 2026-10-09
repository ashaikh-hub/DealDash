'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  DealCardView,
  DealDetailView,
  RequirePermission,
  errorMessage,
  fieldLabel,
  historyReason,
  useApi,
  useAuth,
} from '@dealdash/app-shell';
import {
  createTranslator,
  formatDate,
  formatDateTime,
  formatMoney,
  withLocale,
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
import type { AdminDealDetail } from '@dealdash/validation';
import { DEAL_TONE } from './live-deals';

type Action =
  'approve' | 'request-changes' | 'reject' | 'pause' | 'resume' | 'suspend' | 'reinstate';
const ACTION_LABEL: Record<string, string> = {
  approve: 'adeal.approve',
  request_changes: 'adeal.requestChanges',
  reject: 'adeal.reject',
  pause: 'adeal.pause',
  resume: 'adeal.resume',
  suspend: 'adeal.suspend',
  reinstate: 'adeal.reinstate',
};

export function DealReviewPage({ id }: { id: string }) {
  return (
    <RequirePermission any={['admin.campaigns.review']}>
      <Inner id={id} />
    </RequirePermission>
  );
}

function Inner({ id }: { id: string }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [d, setD] = useState<AdminDealDetail | null>(null);
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
    const r = await call<AdminDealDetail>('GET', `/v1/admin/live-deals/${id}`);
    if (r.ok && r.data) {
      setD(r.data);
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
    setReason(a === 'approve' ? 'Content is complete and accurate.' : '');
    setReasonAr(a === 'approve' ? 'المحتوى كامل ودقيق.' : '');
    setFormError('');
  };
  const submit = async () => {
    if (!action) return;
    if (reason.trim().length < 3) return setFormError(t('modal.reasonRequired'));
    setBusy(true);
    const r = await call<AdminDealDetail>('POST', `/v1/admin/live-deals/${id}/${action}`, {
      body: { reason: reason.trim(), reasonAr: reasonAr.trim() || undefined },
    });
    setBusy(false);
    if (!r.ok || !r.data) return setFormError(errorMessage(locale, r.errors));
    setD(r.data);
    setAction(null);
    setDone(true);
  };

  if (state === 'loading') return <LoadingState label={t('state.loading')} />;
  if (state === 'missing')
    return (
      <EmptyState
        title={t('adeal.notFound')}
        action={
          <Link className="dd-btn dd-btn--secondary" href={withLocale('/live-deals', locale)}>
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

  const merchantName = locale === 'ar' ? d.merchant.nameAr : d.merchant.nameEn;
  const live = d.content;
  const proposed = d.reviewTarget === 'REVISION' ? d.revision?.content : null;
  const shown = proposed ?? live;
  const actions = d.adminActions
    .filter((a) => a !== 'request_changes')
    .concat(d.adminActions.includes('request_changes') ? ['request_changes'] : []);
  const kebab = (a: string) => a.replace('_', '-') as Action;
  const primary = ['approve'];
  const title = d.preview.title[locale] || d.preview.title.en;

  const items: TimelineItem[] = d.history.map((h) => ({
    id: h.id,
    title: t(`history.${h.action}` as never),
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
    tone: /REJECT|SUSPEND/.test(h.action)
      ? 'danger'
      : /REQUEST_CHANGES/.test(h.action)
        ? 'warning'
        : /APPROVE|ACTIVATE/.test(h.action)
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
        <strong style={{ fontSize: 22 }}>{shown.offerLabel[lang]}</strong>
        <div className="dd-kpi__l">{t('field.title')}</div>
        <strong>{shown.title[lang]}</strong>
        <div className="dd-kpi__l">{t('field.shortDescription')}</div>
        <div>{shown.shortDescription[lang]}</div>
        <div className="dd-kpi__l">{t('field.description')}</div>
        <div className="dd-pre">{shown.description[lang]}</div>
        <div className="dd-kpi__l">{t('adeal.terms')}</div>
        <div className="dd-pre">{lang === 'en' ? shown.terms.textEn : shown.terms.textAr}</div>
      </div>
    </Card>
  ));

  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="deal-review">
      <Link className="dd-link" href={withLocale('/live-deals', locale)}>
        ← {t('adeal.back')}
      </Link>
      <div className="dd-topbar">
        <div className="dd-row">
          <h1 className="dd-title-xl dd-clamp">{title}</h1>
          <StatusChip tone={DEAL_TONE[d.status]}>{t(`dealStatus.${d.status}` as never)}</StatusChip>
          {d.reviewTarget === 'REVISION' ? (
            <StatusChip tone="info">{t('adeal.kind.REVISION')}</StatusChip>
          ) : null}
        </div>
      </div>
      {done ? <Alert tone="success">{t('adeal.done')}</Alert> : null}
      {d.reviewTarget === 'REVISION' ? (
        <Alert tone="info">{t('adeal.reviewingRevision')}</Alert>
      ) : null}

      <div className="dd-review">
        <div className="dd-stack" style={{ gap: 16 }}>
          <Card>
            <h2 className="dd-title">{t('adeal.merchant')}</h2>
            <dl className="dd-kv" style={{ marginBlockStart: 8 }}>
              <div className="dd-kv__row">
                <dt>{t('adeal.merchant')}</dt>
                <dd>{merchantName}</dd>
              </div>
              <div className="dd-kv__row">
                <dt>{t('adeal.merchantStatus')}</dt>
                <dd>{d.merchant.status}</dd>
              </div>
              <div className="dd-kv__row">
                <dt>{t('adeal.col.merchant')}</dt>
                <dd>{t(`adeal.trust.${d.merchant.trustLevel}` as never)}</dd>
              </div>
              <div className="dd-kv__row">
                <dt>{t('adeal.risk')}</dt>
                <dd>{d.merchant.riskTier}</dd>
              </div>
            </dl>
          </Card>

          {proposed ? (
            <Alert tone="warning" title={t('adeal.changedFields')}>
              {(d.revision?.materialFields ?? [])
                .map((f) => t(`field.mat.${f}` as never))
                .join(', ')}
            </Alert>
          ) : null}

          <div>
            <h2 className="dd-title" style={{ marginBlockEnd: 8 }}>
              {proposed ? t('adeal.proposed') : t('adeal.content')}
            </h2>
            <div className="dd-compare">{columns}</div>
          </div>

          <Card>
            <dl className="dd-kv">
              <div className="dd-kv__row">
                <dt>{t('adeal.dates')}</dt>
                <dd>
                  {shown.startAt ? formatDateTime(locale, shown.startAt) : '-'} –{' '}
                  {shown.endAt ? formatDateTime(locale, shown.endAt) : t('mdeal.openEnded')}
                </dd>
              </div>
              <div className="dd-kv__row">
                <dt>{t('adeal.branches')}</dt>
                <dd>
                  {d.preview.branches.map((b) => b.name[locale] || b.name.en).join(', ') || '-'}
                </dd>
              </div>
              <div className="dd-kv__row">
                <dt>{t('adeal.eligibility')}</dt>
                <dd>
                  {t(`elig.${shown.eligibility.kind}` as never)}
                  {shown.eligibility.valueRefs.length
                    ? ` (${shown.eligibility.valueRefs.length})`
                    : ''}
                </dd>
              </div>
              <div className="dd-kv__row">
                <dt>{t('field.mechanic')}</dt>
                <dd>
                  {shown.mechanic ? t(`mechanic.${shown.mechanic}` as never) : '-'}
                  {shown.valueNumber !== null ? ` · ${shown.valueNumber}` : ''}
                </dd>
              </div>
              <div className="dd-kv__row">
                <dt>{t('adeal.terms')}</dt>
                <dd>
                  {shown.terms.blocks.minimumSpendHalalas
                    ? formatMoney(locale, shown.terms.blocks.minimumSpendHalalas)
                    : '-'}
                </dd>
              </div>
              <div className="dd-kv__row">
                <dt>{t('detail.redemption')}</dt>
                <dd>{t('field.redemptionGeneral')}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <h2 className="dd-title">{t('adeal.media')}</h2>
            <div className="dd-media-grid" style={{ marginBlockStart: 8 }}>
              {(proposed ? (d.revision?.media ?? []) : d.media).map((m) => (
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
            <h2 className="dd-title">{t('adeal.history')}</h2>
            <div style={{ marginBlockStart: 12 }}>
              {items.length ? (
                <Timeline items={items} label={t('adeal.history')} />
              ) : (
                <EmptyState title={t('history.empty')} />
              )}
            </div>
          </Card>
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
                  {d.reviewTarget === 'NONE' ? t('adeal.nothingToReview') : t('adeal.noPermission')}
                </p>
              ) : null}
              {actions.map((a) => (
                <Button
                  key={a}
                  variant={
                    primary.includes(a)
                      ? 'primary'
                      : a === 'reject' || a === 'suspend'
                        ? 'danger'
                        : 'outline'
                  }
                  block
                  onClick={() => open(kebab(a))}
                >
                  {t(ACTION_LABEL[a] as never)}
                </Button>
              ))}
            </div>
          </Card>
          <Card>
            <div className="dd-stack">
              <div className="dd-row" style={{ justifyContent: 'space-between' }}>
                <h2 className="dd-title">{t('adeal.preview')}</h2>
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
                  <DealCardView deal={d.preview} locale={previewLang} />
                </div>
                <DealDetailView detail={d.preview} locale={previewLang} embedded />
              </div>
            </div>
          </Card>
        </aside>
      </div>

      <Modal
        open={action !== null}
        onClose={() => setAction(null)}
        closeLabel={t('common.close')}
        title={action ? t(ACTION_LABEL[action.replace('-', '_')] as never) : ''}
        footer={
          <>
            <Button variant="outline" onClick={() => setAction(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={action === 'reject' || action === 'suspend' ? 'danger' : 'primary'}
              loading={busy}
              onClick={() => void submit()}
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
          <Field label={t('adeal.reasonAr')} htmlFor="dec-reason-ar">
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
      <span hidden>{formatDate(locale, d.updatedAt)}</span>
    </div>
  );
}
