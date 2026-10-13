'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  HotCardView,
  HotDetailView,
  RequirePermission,
  errorMessage,
  fieldErrors,
  useApi,
  useAuth,
  CommercialPanel,
  CommercialInputsEditor,
} from '@dealdash/app-shell';
import {
  createTranslator,
  displayTimeZone,
  withLocale,
  type DictionaryKey,
  type Locale,
} from '@dealdash/localization';
import { HOT_DEAL_LIMIT_TYPES, LIVE_DEAL_MECHANICS, WEEKDAYS } from '@dealdash/types';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  FileField,
  Input,
  LoadingState,
  Select,
  StatusChip,
  Stepper,
  Textarea,
  type StepItem,
} from '@dealdash/ui';
import {
  DEFAULT_HOT_LIMITS,
  emptyHotDealContent,
  hotDealIssues,
  hotMaterialChanges,
  hotTranslationStatus,
  needsInventory,
  type HotDealContent,
  type HotDealDetail,
  type HotDealIssue,
  type HotDealLimits,
  type HotDealView,
} from '@dealdash/validation';
import { fromMarketInput, toMarketInput, useOrgId } from './deal-utils';
import { HotStatusChip, stepOfHotField } from './hot-utils';

interface Options {
  categories: Array<{ id: string; code: string; nameEn: string; nameAr: string }>;
  eligibility: {
    employers: Array<{ id: string; nameEn: string; nameAr: string }>;
    banks: Array<{ id: string; nameEn: string; nameAr: string }>;
    schemes: Array<{ id: string; nameEn: string; nameAr: string }>;
    cities: string[];
  };
}
interface HotOptions {
  limits: HotDealLimits;
  defaultHoldMinutes: number;
  maxActiveReservations: number;
}
interface BranchOption {
  id: string;
  nameEn: string;
  nameAr: string;
  status: string;
  city: string;
}

const STEPS = ['basics', 'content', 'limits', 'stock', 'rules', 'review'] as const;
const STEP_FIELDS: Array<(f: string) => boolean> = STEPS.map(
  (_, i) => (f) => stepOfHotField(f) === i,
);
const MAX_IMAGE_MB = 5;
const MIN_W = 400;
const MIN_H = 250;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function HotDealBuilder({ dealId }: { dealId?: string }) {
  return (
    <RequirePermission any={['merchant.deals.manage']}>
      <BuilderInner dealId={dealId} />
    </RequirePermission>
  );
}

function Bi({
  id,
  label,
  value,
  onChange,
  max,
  multiline,
  issues,
  showErrors,
  disabled,
  help,
}: {
  id: string;
  label: string;
  value: { en: string; ar: string };
  onChange: (v: { en: string; ar: string }) => void;
  max: number;
  multiline?: boolean;
  issues: HotDealIssue[];
  showErrors: boolean;
  disabled?: boolean;
  help?: string;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const field = id.replace(/^f-/, '');
  const err = (lang: 'EN' | 'AR') =>
    showErrors && issues.some((i) => i.field === field && i.code === `REQUIRED_${lang}`)
      ? t(`issue.REQUIRED_${lang}` as DictionaryKey)
      : undefined;
  const Control = multiline ? Textarea : Input;
  return (
    <div className="dd-bi">
      {(['en', 'ar'] as const).map((lang) => (
        <div className="dd-bi__col" key={lang}>
          <Field
            label={`${label} (${t(lang === 'en' ? 'builder.langEn' : 'builder.langAr')}) *`}
            htmlFor={`${id}-${lang}`}
            error={err(lang === 'en' ? 'EN' : 'AR')}
            help={lang === 'en' ? help : undefined}
          >
            <Control
              id={`${id}-${lang}`}
              value={value[lang]}
              maxLength={max}
              disabled={disabled}
              dir={lang === 'ar' ? 'rtl' : 'ltr'}
              lang={lang}
              invalid={!!err(lang === 'en' ? 'EN' : 'AR')}
              onChange={(e) => onChange({ ...value, [lang]: e.target.value })}
              {...(multiline ? { rows: 4 } : {})}
            />
          </Field>
          <span className="dd-caption dd-ltr">
            {t('field.chars', { n: value[lang].length, max })}
          </span>
        </div>
      ))}
    </div>
  );
}

function BuilderInner({ dealId }: { dealId?: string }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call, upload } = useApi();
  const orgId = useOrgId();

  const [id, setId] = useState<string | undefined>(dealId);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState<HotDealView | null>(null);
  const [content, setContent] = useState<HotDealContent>(emptyHotDealContent());
  const [options, setOptions] = useState<Options | null>(null);
  const [hot, setHot] = useState<HotOptions | null>(null);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [step, setStep] = useState(0);
  const [visited, setVisited] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [cmReady, setCmReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{
    tone: 'info' | 'warning' | 'danger' | 'success';
    text: string;
  } | null>(null);
  const [preview, setPreview] = useState<HotDealDetail | null>(null);
  const [previewLang, setPreviewLang] = useState<Locale>(locale);
  const [previewKind, setPreviewKind] = useState<'card' | 'detail'>('card');
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [result, setResult] = useState<null | { outcome: string; id: string }>(null);
  const [startNow, setStartNow] = useState(false);
  const [noEnd, setNoEnd] = useState(false);
  const contentRef = useRef(content);
  contentRef.current = content;

  const status = view?.status ?? 'DRAFT';
  const live = !!view && !['DRAFT', 'NEEDS_CHANGES'].includes(status);
  const editableLive = ['SCHEDULED', 'LIVE', 'PAUSED', 'SOLD_OUT'].includes(status);
  const limits = hot?.limits ?? DEFAULT_HOT_LIMITS;

  const issues = useMemo(
    () => hotDealIssues(content, { now: new Date(), limits }),
    [content, limits],
  );
  const translation = useMemo(() => hotTranslationStatus(content), [content]);

  const applyView = useCallback((v: HotDealView) => {
    setView(v);
    const c = clone(v.content);
    setContent(c);
    setNoEnd(!c.endAt);
    const urls: Record<string, string> = {};
    for (const m of v.media) if (m.url) urls[m.fileId] = m.url;
    setThumbs((cur) => ({ ...cur, ...urls }));
    setSavedAt(new Date(v.updatedAt));
  }, []);

  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    (async () => {
      const [o, h, b, d] = await Promise.all([
        call<Options>('GET', `/v1/merchants/${orgId}/hot-deal-choices`),
        call<HotOptions>('GET', `/v1/merchants/${orgId}/hot-deal-options`),
        call<BranchOption[]>('GET', `/v1/merchants/${orgId}/branches`),
        dealId
          ? call<HotDealView>('GET', `/v1/merchants/${orgId}/hot-deals/${dealId}`)
          : Promise.resolve(null),
      ]);
      if (!alive) return;
      const failed = [o, h, b, d].find((r) => r && !r.ok);
      if (failed) {
        setLoadError(errorMessage(locale, failed.errors));
        setLoading(false);
        return;
      }
      setOptions(o.data);
      setHot(h.data);
      setBranches((b.data ?? []).filter((x) => x.status === 'ACTIVE'));
      if (d?.data) {
        applyView(d.data);
        setVisited(STEPS.length - 1);
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [call, orgId, dealId, locale, applyView]);

  const refreshPreview = useCallback(
    async (target: string) => {
      if (!orgId) return;
      const r = await call<HotDealDetail>(
        'GET',
        `/v1/merchants/${orgId}/hot-deals/${target}/preview`,
      );
      if (r.ok && r.data) setPreview(r.data);
    },
    [call, orgId],
  );
  useEffect(() => {
    if (id && !loading) void refreshPreview(id);
  }, [id, loading, refreshPreview]);

  const edit = (patch: Partial<HotDealContent>) => {
    setContent((c) => ({ ...c, ...patch }));
    setDirty(true);
    setServerErrors({});
  };

  const save = useCallback(
    async (
      opts: { quiet?: boolean } = {},
    ): Promise<{ ok: boolean; id?: string; outcome?: string }> => {
      if (!orgId) return { ok: false };
      let body = contentRef.current;
      if (startNow && !live) body = { ...body, startAt: new Date().toISOString() };
      if (noEnd) body = { ...body, endAt: null };
      setSaving(true);
      const res = !id
        ? await call<HotDealView>('POST', `/v1/merchants/${orgId}/hot-deals`, {
            body: { content: body },
            idempotent: true,
          })
        : await call<{ deal: HotDealView; outcome: string }>(
            'PUT',
            `/v1/merchants/${orgId}/hot-deals/${id}`,
            {
              body: { content: body, expectedVersion: view?.version },
            },
          );
      setSaving(false);
      if (!res.ok || !res.data) {
        const e = res.errors[0];
        if (e?.code === 'VERSION_CONFLICT')
          setBanner({ tone: 'danger', text: t('detail.conflict') });
        else if (!opts.quiet || e?.code === 'MATERIAL_EDIT_LOCKED')
          setBanner({
            tone: e?.code === 'DEAL_INCOMPLETE' ? 'warning' : 'danger',
            text: errorMessage(locale, res.errors),
          });
        setServerErrors(fieldErrors(locale, res.errors));
        return { ok: false };
      }
      const v = id ? (res.data as { deal: HotDealView }).deal : (res.data as HotDealView);
      const outcome = id ? (res.data as { outcome: string }).outcome : 'SAVED';
      setView(v);
      setDirty(false);
      setSavedAt(new Date());
      setBanner(null);
      if (!id) {
        setId(v.id);
        window.history.replaceState(null, '', withLocale(`/deals/hot/${v.id}/edit`, locale));
      }
      if (outcome === 'APPLIED_MINOR') setBanner({ tone: 'success', text: t('mhb.minorApplied') });
      void refreshPreview(v.id);
      return { ok: true, id: v.id, outcome };
    },
    [orgId, id, view?.version, call, locale, t, startNow, noEnd, live, refreshPreview],
  );

  // autosave drafts every 30 s (live Exclusive Deals are saved on purpose, never silently)
  useEffect(() => {
    if (!id || !dirty || live) return;
    const timer = setTimeout(() => void save({ quiet: true }), 30_000);
    return () => clearTimeout(timer);
  }, [id, dirty, live, content, save]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const stepIssues = (i: number) => issues.filter((x) => STEP_FIELDS[i]!(x.field));
  const stepState = (i: number): StepItem['state'] =>
    i === step
      ? 'current'
      : i > visited
        ? 'todo'
        : i === STEPS.length - 1
          ? issues.length
            ? 'attention'
            : 'done'
          : stepIssues(i).length
            ? 'attention'
            : 'done';
  const go = (i: number) => {
    if (i > visited && i > step) return;
    setStep(i);
    setVisited((v) => Math.max(v, i));
    window.scrollTo({ top: 0 });
  };
  const next = async () => {
    setShowErrors(true);
    if (stepIssues(step).length) return;
    setShowErrors(false);
    const r = await save({ quiet: true });
    if (r.ok || !dirty) {
      setStep(step + 1);
      setVisited((v) => Math.max(v, step + 1));
    }
  };

  const submit = async () => {
    setShowErrors(true);
    if (issues.length) return;
    const r = await save();
    if (!r.ok || !r.id) return;
    if (live) {
      setResult({ outcome: 'MINOR', id: r.id });
      return;
    }
    const s = await call<{ deal: HotDealView; outcome: string }>(
      'POST',
      `/v1/merchants/${orgId}/hot-deals/${r.id}/submit`,
      { body: {} },
    );
    if (!s.ok || !s.data) {
      setBanner({ tone: 'danger', text: errorMessage(locale, s.errors) });
      return;
    }
    setView(s.data.deal);
    setResult({ outcome: s.data.outcome, id: r.id });
  };

  const onFile = async (file: File) => {
    setMediaError('');
    if (!['image/jpeg', 'image/png'].includes(file.type))
      return setMediaError(t('media.wrongType'));
    if (file.size > MAX_IMAGE_MB * 1024 * 1024)
      return setMediaError(t('media.tooBig', { size: MAX_IMAGE_MB }));
    if (content.media.length >= 5) return setMediaError(t('media.max', { n: 5 }));
    const objectUrl = URL.createObjectURL(file);
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 0, h: 0 });
      img.src = objectUrl;
    });
    if (dims.w < MIN_W || dims.h < MIN_H)
      return setMediaError(t('media.rules', { size: MAX_IMAGE_MB, w: MIN_W, h: MIN_H }));
    setUploading(true);
    const up = await upload(orgId!, 'DEAL_IMAGE', file);
    setUploading(false);
    if (!up.ok) return setMediaError(errorMessage(locale, up.errors));
    setThumbs((cur) => ({ ...cur, [up.file.fileId]: objectUrl }));
    edit({ media: [...content.media, { fileId: up.file.fileId, altEn: '', altAr: '' }] });
  };

  if (!orgId || loading) return <LoadingState label={t('state.loading')} />;
  if (loadError) return <Alert tone="danger">{loadError}</Alert>;
  if (result) {
    const title =
      result.outcome === 'PUBLISHED'
        ? t('mhb.published')
        : result.outcome === 'SCHEDULED'
          ? t('mhb.scheduled')
          : result.outcome === 'MINOR'
            ? t('mhb.minorApplied')
            : t('mhb.sentForReview');
    return (
      <Card>
        <div className="dd-stack" data-testid="builder-result">
          <h1 className="dd-title-xl">{title}</h1>
          {result.outcome === 'SENT_FOR_REVIEW' ? <p>{t('mhb.reviewBody')}</p> : null}
          <div>
            <Link
              className="dd-btn dd-btn--primary"
              href={withLocale(`/deals/hot/${result.id}`, locale)}
            >
              {t('review.goToDeal')}
            </Link>
          </div>
        </div>
      </Card>
    );
  }
  if (view && status === 'PENDING_REVIEW')
    return (
      <div className="dd-stack">
        <Alert tone="info">{t('mhb.pendingEdit')}</Alert>
        <Link
          className="dd-btn dd-btn--secondary"
          href={withLocale(`/deals/hot/${view.id}`, locale)}
        >
          {t('review.goToDeal')}
        </Link>
      </div>
    );
  if (
    view &&
    !['DRAFT', 'NEEDS_CHANGES', 'SCHEDULED', 'LIVE', 'PAUSED', 'SOLD_OUT'].includes(status)
  )
    return (
      <EmptyState
        title={t('error.EDIT_LOCKED')}
        action={
          <Link
            className="dd-btn dd-btn--secondary"
            href={withLocale(`/deals/hot/${view.id}`, locale)}
          >
            {t('review.goToDeal')}
          </Link>
        }
      />
    );

  const steps: StepItem[] = STEPS.map((s, i) => ({
    id: s,
    label: t(`mhs.${s}` as DictionaryKey),
    hint: undefined,
    state: stepState(i),
  }));
  const cats = options?.categories ?? [];
  const nm = (x: { nameEn: string; nameAr: string }) =>
    locale === 'ar' ? x.nameAr || x.nameEn : x.nameEn || x.nameAr;
  const msg = (field: string) => serverErrors[field];
  const err = (field: string) =>
    showErrors && issues.some((i) => i.field === field)
      ? t(`issue.${issues.find((i) => i.field === field)!.code}` as DictionaryKey)
      : undefined;
  const lockedNote = live ? <span className="dd-help">{t('mhb.lockedField')}</span> : null;
  const showValueField = content.mechanic === 'PERCENTAGE_OFF' || content.mechanic === 'AMOUNT_OFF';

  // ---------------------------------------------------------------- steps
  const basics = (
    <div className="dd-stack" style={{ gap: 16 }}>
      <div className="dd-grid dd-grid--2">
        <Field
          label={`${t('mhb.category')} *`}
          htmlFor="f-categoryId"
          error={err('categoryId') ?? msg('content.categoryId')}
        >
          <Select
            id="f-categoryId"
            value={content.categoryId ?? ''}
            disabled={live}
            onChange={(e) => edit({ categoryId: e.target.value || null })}
          >
            <option value="">{t('field.categoryPick')}</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {nm(c)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`${t('mhb.mechanic')} *`} htmlFor="f-mechanic" error={err('mechanic')}>
          <Select
            id="f-mechanic"
            value={content.mechanic ?? ''}
            disabled={live}
            onChange={(e) =>
              edit({
                mechanic: (e.target.value || null) as HotDealContent['mechanic'],
                valueNumber: null,
              })
            }
          >
            <option value="">{t('field.mechanicPick')}</option>
            {LIVE_DEAL_MECHANICS.map((m) => (
              <option key={m} value={m}>
                {t(`mechanic.${m}` as DictionaryKey)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {showValueField ? (
        <Field
          label={`${content.mechanic === 'PERCENTAGE_OFF' ? t('field.valuePercent') : t('field.valueAmount')} *`}
          htmlFor="f-valueNumber"
          error={err('valueNumber')}
        >
          <Input
            id="f-valueNumber"
            type="number"
            inputMode="decimal"
            min={1}
            max={content.mechanic === 'PERCENTAGE_OFF' ? 100 : undefined}
            value={content.valueNumber ?? ''}
            disabled={live}
            onChange={(e) =>
              edit({ valueNumber: e.target.value === '' ? null : Number(e.target.value) })
            }
            style={{ maxInlineSize: 200 }}
            dir="ltr"
          />
        </Field>
      ) : null}
      {lockedNote}
    </div>
  );

  const contentStep = (
    <div className="dd-stack" style={{ gap: 16 }}>
      <p className="dd-help">{t('mhb.langHint')}</p>
      <Bi
        id="f-offerLabel"
        label={t('mhb.offerLabel')}
        value={content.offerLabel}
        max={40}
        onChange={(v) => edit({ offerLabel: v })}
        issues={issues}
        showErrors={showErrors}
        disabled={live}
      />
      <Bi
        id="f-title"
        label={t('mhb.title')}
        value={content.title}
        max={80}
        onChange={(v) => edit({ title: v })}
        issues={issues}
        showErrors={showErrors}
      />
      <Bi
        id="f-shortDescription"
        label={t('mhb.shortDescription')}
        value={content.shortDescription}
        max={140}
        onChange={(v) => edit({ shortDescription: v })}
        issues={issues}
        showErrors={showErrors}
      />
      <Bi
        id="f-description"
        label={t('mhb.description')}
        value={content.description}
        max={1500}
        multiline
        onChange={(v) => edit({ description: v })}
        issues={issues}
        showErrors={showErrors}
      />
      <div className="dd-stack" style={{ gap: 12 }}>
        <div>
          <strong>{t('mhb.photos')}</strong>
          <p className="dd-help" style={{ margin: 0 }}>
            {t('mhb.photosHelp')} {t('media.rules', { size: MAX_IMAGE_MB, w: MIN_W, h: MIN_H })}
          </p>
        </div>
        {content.media.length === 0 ? <EmptyState title={t('media.empty')} /> : null}
        <div className="dd-media-grid">
          {content.media.map((m, i) => (
            <div
              key={m.fileId}
              className={`dd-media-item ${i === 0 ? 'dd-media-item--cover' : ''}`}
            >
              {thumbs[m.fileId] ? (
                <img src={thumbs[m.fileId]} alt={(locale === 'ar' ? m.altAr : m.altEn) || ''} />
              ) : (
                <div className="dd-dc__ph" style={{ aspectRatio: '16/10' }} />
              )}
              {i === 0 ? <StatusChip tone="info">{t('media.cover')}</StatusChip> : null}
              <Field
                label={`${t('field.altText')} (${t('builder.langEn')})`}
                htmlFor={`alt-en-${i}`}
              >
                <Input
                  id={`alt-en-${i}`}
                  value={m.altEn}
                  maxLength={200}
                  onChange={(e) =>
                    edit({
                      media: content.media.map((x, j) =>
                        j === i ? { ...x, altEn: e.target.value } : x,
                      ),
                    })
                  }
                />
              </Field>
              <Field
                label={`${t('field.altText')} (${t('builder.langAr')})`}
                htmlFor={`alt-ar-${i}`}
              >
                <Input
                  id={`alt-ar-${i}`}
                  dir="rtl"
                  lang="ar"
                  value={m.altAr}
                  maxLength={200}
                  onChange={(e) =>
                    edit({
                      media: content.media.map((x, j) =>
                        j === i ? { ...x, altAr: e.target.value } : x,
                      ),
                    })
                  }
                />
              </Field>
              <div className="dd-row" style={{ gap: 6 }}>
                {i > 0 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      edit({ media: [m, ...content.media.filter((x) => x.fileId !== m.fileId)] })
                    }
                  >
                    {t('media.makeCover')}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    edit({ media: content.media.filter((x) => x.fileId !== m.fileId) })
                  }
                >
                  {t('media.remove')}
                </Button>
              </div>
            </div>
          ))}
        </div>
        <FileField
          id="deal-image"
          label={uploading ? t('media.uploading') : t('media.add')}
          accept="image/jpeg,image/png"
          busy={uploading}
          disabled={content.media.length >= 5}
          onFile={(f) => void onFile(f)}
        />
        {mediaError ? (
          <span className="dd-error" role="alert">
            {mediaError}
          </span>
        ) : null}
        {showErrors && issues.some((i) => i.field === 'media') ? (
          <span className="dd-error" role="alert">
            {t('issue.REQUIRED')}
          </span>
        ) : null}
      </div>
    </div>
  );

  const setLimit = (kind: HotDealContent['limitType']) =>
    edit({ limitType: kind, reservationsEnabled: kind === 'TIME' ? false : true });
  const limitsStep = (
    <div className="dd-stack" style={{ gap: 16 }}>
      {live ? <Alert tone="info">{t('mhb.liveEditNote')}</Alert> : null}
      <fieldset className="dd-stack" style={{ border: 0, padding: 0, margin: 0 }} disabled={live}>
        <legend className="dd-label">{t('mhb.limitType')} *</legend>
        <span className="dd-help">{t('mhb.limitTypeHelp')}</span>
        <div className="dd-limitcards">
          {HOT_DEAL_LIMIT_TYPES.map((k) => (
            <button
              key={k}
              type="button"
              className="dd-limitcard"
              aria-pressed={content.limitType === k}
              onClick={() => setLimit(k)}
            >
              <strong>{t(`mhb.limit.${k}` as DictionaryKey)}</strong>
              <span className="dd-caption">{t(`mhb.limit.${k}.help` as DictionaryKey)}</span>
            </button>
          ))}
        </div>
        {err('limitType') ? (
          <span className="dd-error" role="alert">
            {err('limitType')}
          </span>
        ) : null}
        <Checkbox
          label={t('mhb.reservationsOn')}
          checked={content.reservationsEnabled}
          onChange={(e) =>
            edit({
              reservationsEnabled: e.target.checked,
              limitType:
                e.target.checked && content.limitType === 'TIME'
                  ? 'QUANTITY'
                  : !e.target.checked
                    ? 'TIME'
                    : content.limitType,
            })
          }
        />
        <span className="dd-help">{t('mhb.reservationsOnHelp')}</span>
      </fieldset>
      <div className="dd-grid dd-grid--2">
        <div className="dd-stack">
          <Field
            label={`${t('mhb.start')} * (${t('field.riyadhTime')})`}
            htmlFor="f-startAt"
            error={err('startAt') ?? msg('content.startAt')}
          >
            <Input
              id="f-startAt"
              type="datetime-local"
              dir="ltr"
              value={startNow ? '' : toMarketInput(content.startAt)}
              disabled={startNow || live}
              onChange={(e) => edit({ startAt: fromMarketInput(e.target.value) })}
            />
          </Field>
          {!live ? (
            <Checkbox
              label={t('mhb.startNow')}
              checked={startNow}
              onChange={(e) => {
                setStartNow(e.target.checked);
                setDirty(true);
                if (e.target.checked) edit({ startAt: new Date().toISOString() });
              }}
            />
          ) : (
            lockedNote
          )}
        </div>
        <div className="dd-stack">
          <Field
            label={`${t('mhb.end')}${content.limitType === 'QUANTITY' ? '' : ' *'} (${t('field.riyadhTime')})`}
            htmlFor="f-endAt"
            help={t('mhb.endHelp', { hours: limits.maxHours })}
            error={err('endAt') ?? msg('content.endAt')}
          >
            <Input
              id="f-endAt"
              type="datetime-local"
              dir="ltr"
              value={noEnd ? '' : toMarketInput(content.endAt)}
              disabled={noEnd || live}
              onChange={(e) => edit({ endAt: fromMarketInput(e.target.value) })}
            />
          </Field>
          {content.limitType === 'QUANTITY' && !live ? (
            <Checkbox
              label={t('field.endNone')}
              checked={noEnd}
              onChange={(e) => {
                setNoEnd(e.target.checked);
                edit({ endAt: e.target.checked ? null : content.endAt });
              }}
            />
          ) : null}
        </div>
      </div>
      {content.reservationsEnabled ? (
        <div className="dd-grid dd-grid--2">
          <Field
            label={`${t('mhb.perCustomer')} *`}
            htmlFor="f-perCustomerLimit"
            error={err('perCustomerLimit')}
          >
            <Input
              id="f-perCustomerLimit"
              type="number"
              min={1}
              max={limits.maxPerCustomer}
              dir="ltr"
              value={content.perCustomerLimit}
              disabled={live}
              onChange={(e) => edit({ perCustomerLimit: Math.max(1, Number(e.target.value) || 1) })}
              style={{ maxInlineSize: 160 }}
            />
          </Field>
          <Field
            label={t('mhb.hold')}
            htmlFor="f-holdMinutes"
            help={t('mhb.holdHelp', { min: hot?.defaultHoldMinutes ?? 30 })}
            error={err('holdMinutes')}
          >
            <Input
              id="f-holdMinutes"
              type="number"
              min={limits.holdMinMinutes}
              max={limits.holdMaxMinutes}
              dir="ltr"
              value={content.holdMinutes ?? ''}
              disabled={live}
              placeholder={String(hot?.defaultHoldMinutes ?? 30)}
              onChange={(e) =>
                edit({ holdMinutes: e.target.value === '' ? null : Number(e.target.value) })
              }
              style={{ maxInlineSize: 160 }}
            />
          </Field>
        </div>
      ) : null}
    </div>
  );

  const alloc = (bid: string) => content.allocations.find((a) => a.branchId === bid);
  const toggleBranch = (bid: string) =>
    edit({
      allocations: alloc(bid)
        ? content.allocations.filter((a) => a.branchId !== bid)
        : [...content.allocations, { branchId: bid, units: 0 }],
    });
  const tracked = needsInventory(content);
  const stockStep = (
    <div className="dd-stack" style={{ gap: 12 }}>
      <p className="dd-help">{t('mhb.branchesStockHelp')}</p>
      {live ? <Alert tone="info">{t('mhb.liveEditNote')}</Alert> : null}
      {branches.map((b) => {
        const a = alloc(b.id);
        return (
          <div key={b.id} className="dd-staffrow" data-testid="stock-row">
            <Checkbox
              label={nm(b)}
              checked={!!a}
              disabled={live}
              onChange={() => toggleBranch(b.id)}
            />
            <span className="dd-grow" />
            {a && tracked ? (
              <Field label={t('mhb.units')} htmlFor={`units-${b.id}`}>
                <Input
                  id={`units-${b.id}`}
                  type="number"
                  min={0}
                  max={limits.maxUnitsPerBranch}
                  dir="ltr"
                  value={a.units}
                  disabled={live}
                  style={{ inlineSize: 110 }}
                  onChange={(e) =>
                    edit({
                      allocations: content.allocations.map((x) =>
                        x.branchId === b.id
                          ? { ...x, units: Math.max(0, Math.floor(Number(e.target.value) || 0)) }
                          : x,
                      ),
                    })
                  }
                />
              </Field>
            ) : null}
          </div>
        );
      })}
      {err('allocations') ? (
        <span className="dd-error" role="alert">
          {err('allocations')}
        </span>
      ) : null}
      {msg('content.allocations') ? (
        <span className="dd-error" role="alert">
          {msg('content.allocations')}
        </span>
      ) : null}
      {live ? <p className="dd-help">{t('mm.stockHelp')}</p> : null}
    </div>
  );

  const kinds = ['PUBLIC', 'GEOGRAPHY', 'EMPLOYER', 'BANK_CARD', 'SCHEME'] as const;
  const partnerList =
    content.eligibility.kind === 'EMPLOYER'
      ? options?.eligibility.employers
      : content.eligibility.kind === 'BANK_CARD'
        ? options?.eligibility.banks
        : content.eligibility.kind === 'SCHEME'
          ? options?.eligibility.schemes
          : null;
  const blocks = content.terms.blocks;
  const setBlocks = (p: Partial<typeof blocks>) =>
    edit({ terms: { ...content.terms, blocks: { ...blocks, ...p } } });
  const rulesStep = (
    <div className="dd-stack" style={{ gap: 16 }}>
      <fieldset className="dd-stack" style={{ border: 0, padding: 0, margin: 0 }} disabled={live}>
        <legend className="dd-label">{t('mhb.eligibility')}</legend>
        {kinds.map((k) => (
          <label key={k} className="dd-checkbox">
            <input
              type="radio"
              name="elig"
              checked={content.eligibility.kind === k}
              onChange={() =>
                edit({
                  eligibility: {
                    kind: k,
                    valueRefs: k === 'GEOGRAPHY' ? [options?.eligibility.cities[0] ?? ''] : [],
                  },
                })
              }
            />
            <span>{t(`elig.${k}` as DictionaryKey)}</span>
          </label>
        ))}
        {content.eligibility.kind === 'GEOGRAPHY' ? (
          <Field label={t('field.eligibilityCity')} htmlFor="f-city">
            <Select
              id="f-city"
              value={content.eligibility.valueRefs[0] ?? ''}
              onChange={(e) =>
                edit({ eligibility: { kind: 'GEOGRAPHY', valueRefs: [e.target.value] } })
              }
            >
              {(options?.eligibility.cities ?? []).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
        ) : null}
        {partnerList ? (
          partnerList.length ? (
            <div className="dd-stack" role="group" aria-label={t('field.eligibilityPartners')}>
              {partnerList.map((p) => (
                <Checkbox
                  key={p.id}
                  label={nm(p)}
                  checked={content.eligibility.valueRefs.includes(p.id)}
                  onChange={() =>
                    edit({
                      eligibility: {
                        kind: content.eligibility.kind,
                        valueRefs: content.eligibility.valueRefs.includes(p.id)
                          ? content.eligibility.valueRefs.filter((x) => x !== p.id)
                          : [...content.eligibility.valueRefs, p.id],
                      },
                    })
                  }
                />
              ))}
            </div>
          ) : (
            <Alert tone="warning">{t('field.eligibilityNone')}</Alert>
          )
        ) : null}
        {err('eligibility') ? (
          <span className="dd-error" role="alert">
            {err('eligibility')}
          </span>
        ) : null}
        {msg('content.eligibility') ? (
          <span className="dd-error" role="alert">
            {msg('content.eligibility')}
          </span>
        ) : null}
        {content.eligibility.kind !== 'PUBLIC' ? (
          <span className="dd-help">{t('elig.noCardData')}</span>
        ) : null}
      </fieldset>

      <fieldset className="dd-stack" style={{ border: 0, padding: 0, margin: 0 }} disabled={live}>
        <legend className="dd-label">{t('mhb.terms')}</legend>
        <div className="dd-checklist">
          <Checkbox
            label={t('terms.fullPriceOnly')}
            checked={blocks.fullPriceItemsOnly}
            onChange={(e) => setBlocks({ fullPriceItemsOnly: e.target.checked })}
          />
          <Checkbox
            label={t('terms.notCombinable')}
            checked={blocks.notCombinable}
            onChange={(e) => setBlocks({ notCombinable: e.target.checked })}
          />
        </div>
        <div role="group" aria-label={t('terms.validDays')}>
          <span className="dd-label">{t('terms.validDays')}</span>
          <div className="dd-daychips">
            {WEEKDAYS.map((d) => (
              <button
                key={d}
                type="button"
                className={`dd-pill ${blocks.validDays.includes(d) ? 'dd-pill--active' : ''}`}
                aria-pressed={blocks.validDays.includes(d)}
                onClick={() =>
                  setBlocks({
                    validDays: blocks.validDays.includes(d)
                      ? blocks.validDays.filter((x) => x !== d)
                      : [...blocks.validDays, d],
                  })
                }
              >
                {t(`weekday.${d}` as DictionaryKey)}
              </button>
            ))}
          </div>
        </div>
      </fieldset>
      <div className="dd-bi">
        {(['en', 'ar'] as const).map((lang) => {
          const key = lang === 'en' ? 'textEn' : 'textAr';
          const bad = showErrors && issues.some((i) => i.field === `terms.${key}`);
          return (
            <Field
              key={lang}
              label={`${t('field.termsText')} (${t(lang === 'en' ? 'builder.langEn' : 'builder.langAr')}) *`}
              htmlFor={`f-terms-${lang}`}
              error={
                bad
                  ? t(`issue.REQUIRED_${lang === 'en' ? 'EN' : 'AR'}` as DictionaryKey)
                  : undefined
              }
            >
              <Textarea
                id={`f-terms-${lang}`}
                rows={3}
                maxLength={1500}
                lang={lang}
                dir={lang === 'ar' ? 'rtl' : 'ltr'}
                value={content.terms[key]}
                invalid={bad}
                onChange={(e) => edit({ terms: { ...content.terms, [key]: e.target.value } })}
              />
            </Field>
          );
        })}
      </div>
    </div>
  );

  const g = view?.guardrail;
  const material = view && live ? hotMaterialChanges(view.content, content) : [];
  const reviewStep = (
    <div className="dd-stack" style={{ gap: 16 }}>
      {issues.length ? (
        <Alert tone="warning" title={t('review.fixFirst')}>
          <ul style={{ margin: '8px 0 0', paddingInlineStart: 18 }}>
            {issues.map((i, n) => (
              <li key={`${i.field}-${i.code}-${n}`}>
                {t(`issue.field.${i.field}` as DictionaryKey)}:{' '}
                {t(`issue.${i.code}` as DictionaryKey)}{' '}
                <button
                  type="button"
                  className="dd-link"
                  style={{ background: 'none', border: 0, cursor: 'pointer' }}
                  onClick={() => go(stepOfHotField(i.field))}
                >
                  {t('review.go')}
                </button>
              </li>
            ))}
          </ul>
        </Alert>
      ) : (
        <Alert tone="success">{t('dreview.complete')}</Alert>
      )}
      <div className="dd-row">
        <StatusChip tone={translation.complete ? 'success' : 'warning'}>
          {translation.complete
            ? t('builder.translationComplete')
            : t('builder.translationMissing', {
                lang: translation.missing
                  .map((l) => t(l === 'en' ? 'builder.langEn' : 'builder.langAr'))
                  .join(' + '),
              })}
        </StatusChip>
      </div>
      {live ? (
        <Alert tone="info" title={t('mhb.liveEditNote')}>
          {material.length ? (
            <div>{material.map((f) => t(`issue.field.${f}` as DictionaryKey)).join(', ')}</div>
          ) : null}
        </Alert>
      ) : g ? (
        <Alert tone={g.outcome === 'AUTO_PUBLISH' ? 'success' : 'warning'}>
          {g.outcome === 'AUTO_PUBLISH' ? t('guardrail.auto') : t('guardrail.manual')}
          <ul style={{ margin: '6px 0 0', paddingInlineStart: 18, fontWeight: 500 }}>
            {g.reasons.map((r) => (
              <li key={r}>{t(`guardrail.reason.${r}` as DictionaryKey)}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <Card flat>
        <h2 className="dd-title">{t('review.summary')}</h2>
        <dl className="dd-kv" style={{ marginBlockStart: 8 }}>
          <div className="dd-kv__row">
            <dt>{t('mhb.category')}</dt>
            <dd>
              {cats.find((c) => c.id === content.categoryId)
                ? nm(cats.find((c) => c.id === content.categoryId)!)
                : '-'}
            </dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('mhb.limitType')}</dt>
            <dd>{t(`hotlimit.${content.limitType}` as DictionaryKey)}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('mhb.title')}</dt>
            <dd>{content.title[locale] || content.title.en || '-'}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('mhb.branchesStock')}</dt>
            <dd>
              {content.allocations
                .map((a) => {
                  const b = branches.find((x) => x.id === a.branchId);
                  return b ? `${nm(b)}${tracked ? ` (${a.units})` : ''}` : '';
                })
                .filter(Boolean)
                .join(', ') || '-'}
            </dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('mhb.eligibility')}</dt>
            <dd>{t(`elig.${content.eligibility.kind}` as DictionaryKey)}</dd>
          </div>
        </dl>
      </Card>
      {!live ? (
        <CommercialInputsEditor
          value={content.commercial}
          onChange={(commercial) => edit({ commercial })}
          product="EXCLUSIVE"
        />
      ) : null}
      {orgId ? (
        <CommercialPanel
          orgId={orgId}
          product="EXCLUSIVE"
          subjectId={id ?? null}
          content={content}
          dirty={dirty}
          onReady={setCmReady}
          refreshKey={view?.version}
        />
      ) : null}
    </div>
  );

  const body = [basics, contentStep, limitsStep, stockStep, rulesStep, reviewStep][
    step
  ] as ReactNode;
  const last = step === STEPS.length - 1;

  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="hot-builder">
      <div className="dd-builder__bar">
        <div className="dd-row">
          <Link
            className="dd-link"
            href={withLocale(id ? `/deals/hot/${id}` : '/deals/hot', locale)}
          >
            ← {t('mdeal.back')}
          </Link>
          <h1 className="dd-title">{id ? t('mhb.editTitle') : t('mhb.newTitle')}</h1>
          <HotStatusChip status={status} />
        </div>
        <div className="dd-row">
          <span className="dd-caption" aria-live="polite">
            {saving
              ? t('builder.saving')
              : dirty
                ? t('builder.unsaved')
                : savedAt
                  ? t('builder.saved', {
                      time: savedAt.toLocaleTimeString(
                        locale === 'ar' ? 'ar-SA-u-nu-latn' : 'en-GB',
                        { hour: '2-digit', minute: '2-digit', timeZone: displayTimeZone() },
                      ),
                    })
                  : ''}
          </span>
          <StatusChip tone={translation.complete ? 'success' : 'warning'}>
            {translation.complete
              ? t('builder.translationComplete')
              : t('builder.translationMissing', {
                  lang: translation.missing
                    .map((l) => t(l === 'en' ? 'builder.langEn' : 'builder.langAr'))
                    .join(' + '),
                })}
          </StatusChip>
        </div>
      </div>

      {view?.latestDecision && status === 'NEEDS_CHANGES' ? (
        <Alert tone="warning" title={t('banner.needsChanges')}>
          {(locale === 'ar' && view.latestDecision.reasonAr) || view.latestDecision.reason}
        </Alert>
      ) : null}
      {banner ? <Alert tone={banner.tone}>{banner.text}</Alert> : null}
      {editableLive && !banner ? <Alert tone="info">{t('mhb.liveEditNote')}</Alert> : null}

      <div className="dd-builder">
        <nav aria-label={t('builder.steps')}>
          <Card flat>
            <Stepper
              steps={steps}
              label={t('builder.steps')}
              onSelect={(sid) => go(STEPS.indexOf(sid as (typeof STEPS)[number]))}
            />
          </Card>
        </nav>

        <Card>
          <div className="dd-stack" style={{ gap: 16 }}>
            <div>
              <p className="dd-caption" style={{ margin: 0 }}>
                {t('builder.step', { n: step + 1, total: STEPS.length })}
              </p>
              <h2 className="dd-title">{t(`mhs.${STEPS[step]}` as DictionaryKey)}</h2>
              <p className="dd-muted" style={{ margin: 0 }}>
                {t(`mhsh.${STEPS[step]}` as DictionaryKey)}
              </p>
            </div>
            {body}
            <div
              className="dd-builder__bar"
              style={{ borderBlockStart: '1px solid var(--dd-line)', paddingBlockStart: 16 }}
            >
              <Button variant="outline" disabled={step === 0} onClick={() => go(step - 1)}>
                {t('mhb.back')}
              </Button>
              {showErrors && stepIssues(step).length && !last ? (
                <span className="dd-error" role="alert">
                  {t('builder.itemsNeedAttention', { n: stepIssues(step).length })}
                </span>
              ) : null}
              <div className="dd-row">
                <Button
                  variant="secondary"
                  loading={saving}
                  disabled={!dirty && !!id}
                  onClick={() => void save()}
                  data-testid="hot-save"
                >
                  {live ? t('builder.saveChanges') : t('mhb.save')}
                </Button>
                {last ? (
                  <Button
                    onClick={() => void submit()}
                    loading={saving}
                    disabled={!live && !cmReady}
                    data-testid="hot-submit"
                  >
                    {live ? t('builder.saveChanges') : t('mhb.submit')}
                  </Button>
                ) : (
                  <Button onClick={() => void next()}>{t('mhb.next')}</Button>
                )}
              </div>
            </div>
          </div>
        </Card>

        <aside className="dd-builder__preview" aria-label={t('mhb.preview')}>
          <Card>
            <div className="dd-stack">
              <div className="dd-row" style={{ justifyContent: 'space-between' }}>
                <h2 className="dd-title">{t('mhb.preview')}</h2>
                <div className="dd-lang" role="group" aria-label={t('mhb.preview')}>
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
              <div className="dd-tabs" role="tablist">
                {(['card', 'detail'] as const).map((k) => (
                  <button
                    key={k}
                    role="tab"
                    type="button"
                    className="dd-tab"
                    aria-selected={previewKind === k}
                    onClick={() => setPreviewKind(k)}
                  >
                    {k === 'card' ? t('review.previewCard') : t('review.previewDetail')}
                  </button>
                ))}
              </div>
              {preview ? (
                <div
                  dir={previewLang === 'ar' ? 'rtl' : 'ltr'}
                  lang={previewLang}
                  className="dd-previewframe"
                >
                  {previewKind === 'card' ? (
                    <HotCardView deal={preview} locale={previewLang} variant="list" />
                  ) : (
                    <HotDetailView detail={preview} locale={previewLang} embedded />
                  )}
                </div>
              ) : (
                <p className="dd-muted">{t('review.previewSaveFirst')}</p>
              )}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
