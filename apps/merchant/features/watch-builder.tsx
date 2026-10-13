'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  RequirePermission,
  WatchCardView,
  WatchDetailView,
  WatchStatusChip,
  errorMessage,
  fieldErrors,
  useApi,
  useAuth,
  CommercialPanel,
} from '@dealdash/app-shell';
import {
  createTranslator,
  displayTimeZone,
  formatMoney,
  formatNumber,
  withLocale,
  type DictionaryKey,
  type Locale,
} from '@dealdash/localization';
import { WATCH_LINK_TYPES } from '@dealdash/types';
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
  DEFAULT_WATCH_LIMITS,
  emptyWatchContent,
  watchIssues,
  watchMaterialChanges,
  watchTranslationStatus,
  type WatchCampaignView,
  type WatchContent,
  type WatchDetail,
  type WatchLimits,
} from '@dealdash/validation';
import { fromMarketInput, toMarketInput, useOrgId } from './deal-utils';

interface Options {
  eligibility: {
    employers: Array<{ id: string; nameEn: string; nameAr: string }>;
    banks: Array<{ id: string; nameEn: string; nameAr: string }>;
    schemes: Array<{ id: string; nameEn: string; nameAr: string }>;
    cities: string[];
  };
}
interface WatchOptions {
  limits: WatchLimits;
  rateCard: { chargePerViewHalalas: number; version: number };
  minRepeatWindowHours: number;
  cities: string[];
  unusedBudgetTreatment: string;
}
interface OfferRow {
  id: string;
  title: { en: string; ar: string };
  status: string;
}

const STEPS = ['video', 'content', 'audience', 'schedule', 'budget', 'review'] as const;
const MAX_IMAGE_MB = 5;
const MIN_W = 400;
const MIN_H = 250;
const KINDS = ['PUBLIC', 'GEOGRAPHY', 'EMPLOYER', 'BANK_CARD', 'SCHEME'] as const;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Which builder step a content field belongs to (for "Fix" links and step badges). */
export function stepOfWatchField(field: string): number {
  if (['videoFileId', 'durationSec', 'thumbnailFileId'].includes(field)) return 0;
  if (['title', 'description', 'ctaLabel'].includes(field)) return 1;
  if (field.startsWith('targeting') || field === 'link') return 2;
  if (['startAt', 'endAt'].includes(field) || field.startsWith('frequency')) return 3;
  if (field === 'paidViews') return 4;
  return 0;
}

/** Reads a video's length in the browser (also works for recorded WebM files that report an unknown length). */
function readDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    const done = (n: number | null) => {
      v.removeAttribute('src');
      resolve(n);
    };
    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration)) return done(Math.round(v.duration));
      v.currentTime = 1e9;
      v.ontimeupdate = () => done(Number.isFinite(v.duration) ? Math.round(v.duration) : null);
    };
    v.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    v.src = url;
  });
}

export function WatchBuilder({ campaignId }: { campaignId?: string }) {
  return (
    <RequirePermission any={['merchant.watch.manage']}>
      <BuilderInner campaignId={campaignId} />
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
  hasError,
}: {
  id: string;
  label: string;
  value: { en: string; ar: string };
  onChange: (v: { en: string; ar: string }) => void;
  max: number;
  multiline?: boolean;
  hasError: (lang: 'EN' | 'AR') => boolean;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const Control = multiline ? Textarea : Input;
  return (
    <div className="dd-bi">
      {(['en', 'ar'] as const).map((lang) => {
        const bad = hasError(lang === 'en' ? 'EN' : 'AR');
        return (
          <div className="dd-bi__col" key={lang}>
            <Field
              label={`${label} (${t(lang === 'en' ? 'builder.langEn' : 'builder.langAr')}) *`}
              htmlFor={`${id}-${lang}`}
              error={
                bad
                  ? t(`issue.REQUIRED_${lang === 'en' ? 'EN' : 'AR'}` as DictionaryKey)
                  : undefined
              }
            >
              <Control
                id={`${id}-${lang}`}
                value={value[lang]}
                maxLength={max}
                dir={lang === 'ar' ? 'rtl' : 'ltr'}
                lang={lang}
                invalid={bad}
                onChange={(e) => onChange({ ...value, [lang]: e.target.value })}
                {...(multiline ? { rows: 3 } : {})}
              />
            </Field>
            <span className="dd-caption dd-ltr">
              {t('field.chars', { n: value[lang].length, max })}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function BuilderInner({ campaignId }: { campaignId?: string }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call, upload } = useApi();
  const orgId = useOrgId();

  const [id, setId] = useState<string | undefined>(campaignId);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState<WatchCampaignView | null>(null);
  const [content, setContent] = useState<WatchContent>(emptyWatchContent());
  const [options, setOptions] = useState<Options | null>(null);
  const [wopts, setWopts] = useState<WatchOptions | null>(null);
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [step, setStep] = useState(0);
  const [visited, setVisited] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [cmReady, setCmReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [funding, setFunding] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{
    tone: 'info' | 'warning' | 'danger' | 'success';
    text: string;
  } | null>(null);
  const [preview, setPreview] = useState<WatchDetail | null>(null);
  const [previewLang, setPreviewLang] = useState<Locale>(locale);
  const [previewKind, setPreviewKind] = useState<'card' | 'detail'>('card');
  const [localVideo, setLocalVideo] = useState<string | null>(null);
  const [localThumb, setLocalThumb] = useState<string | null>(null);
  const [uploading, setUploading] = useState<null | 'video' | 'cover'>(null);
  const [mediaError, setMediaError] = useState('');
  const [result, setResult] = useState<null | { outcome: string; id: string }>(null);
  const contentRef = useRef(content);
  contentRef.current = content;

  const status = view?.status ?? 'DRAFT';
  const live = !!view && !['DRAFT', 'NEEDS_CHANGES'].includes(status);
  const editableLive = ['SCHEDULED', 'LIVE', 'PAUSED'].includes(status);
  const limits = wopts?.limits ?? DEFAULT_WATCH_LIMITS;
  const minRepeat = wopts?.minRepeatWindowHours ?? 24;
  const charge = wopts?.rateCard.chargePerViewHalalas ?? view?.budget.chargePerViewHalalas ?? 0;

  const issues = useMemo(
    () => watchIssues(content, { now: new Date(), limits, minRepeatWindowHours: minRepeat }),
    [content, limits, minRepeat],
  );
  const translation = useMemo(() => watchTranslationStatus(content), [content]);
  const required = content.paidViews * charge;

  const applyView = useCallback((v: WatchCampaignView) => {
    setView(v);
    setContent(clone(v.content));
    setSavedAt(new Date(v.updatedAt));
  }, []);

  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    (async () => {
      const [o, w, d] = await Promise.all([
        call<Options>('GET', `/v1/merchants/${orgId}/hot-deal-choices`),
        call<WatchOptions>('GET', `/v1/merchants/${orgId}/watch-options`),
        campaignId
          ? call<WatchCampaignView>('GET', `/v1/merchants/${orgId}/watch/${campaignId}`)
          : Promise.resolve(null),
      ]);
      if (!alive) return;
      const failed = [o, w, d].find((r) => r && !r.ok);
      if (failed) {
        setLoadError(errorMessage(locale, failed.errors));
        setLoading(false);
        return;
      }
      setOptions(o.data);
      setWopts(w.data);
      if (d?.data) {
        applyView(d.data);
        setVisited(STEPS.length - 1);
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [call, orgId, campaignId, locale, applyView]);

  // the merchant's own offers to link to (loaded when the type needs them)
  const linkType = content.link.type;
  useEffect(() => {
    if (!orgId || !['LIVE_DEAL', 'HOT_DEAL', 'VOUCHER'].includes(linkType)) {
      setOffers([]);
      return;
    }
    const path =
      linkType === 'LIVE_DEAL' ? 'live-deals' : linkType === 'HOT_DEAL' ? 'hot-deals' : 'vouchers';
    void call<OfferRow[]>('GET', `/v1/merchants/${orgId}/${path}`, { query: { limit: 100 } }).then(
      (r) => setOffers(r.ok ? (r.data ?? []) : []),
    );
  }, [call, orgId, linkType]);

  const refreshPreview = useCallback(
    async (target: string) => {
      if (!orgId) return;
      const r = await call<WatchDetail>('GET', `/v1/merchants/${orgId}/watch/${target}/preview`);
      if (r.ok && r.data) setPreview(r.data);
    },
    [call, orgId],
  );
  useEffect(() => {
    if (id && !loading) void refreshPreview(id);
  }, [id, loading, refreshPreview]);

  const edit = (patch: Partial<WatchContent>) => {
    setContent((c) => ({ ...c, ...patch }));
    setDirty(true);
    setServerErrors({});
  };
  const editTargeting = (patch: Partial<WatchContent['targeting']>) =>
    edit({ targeting: { ...content.targeting, ...patch } });

  const save = useCallback(
    async (
      opts: { quiet?: boolean } = {},
    ): Promise<{ ok: boolean; id?: string; outcome?: string }> => {
      if (!orgId) return { ok: false };
      const body = contentRef.current;
      setSaving(true);
      const res = !id
        ? await call<WatchCampaignView>('POST', `/v1/merchants/${orgId}/watch`, {
            body: { content: body },
            idempotent: true,
          })
        : await call<{ campaign: WatchCampaignView; outcome: string }>(
            'PUT',
            `/v1/merchants/${orgId}/watch/${id}`,
            { body: { content: body, expectedVersion: view?.version } },
          );
      setSaving(false);
      if (!res.ok || !res.data) {
        const e = res.errors[0];
        if (e?.code === 'VERSION_CONFLICT')
          setBanner({ tone: 'danger', text: t('detail.conflict') });
        else if (!opts.quiet || e?.code === 'MATERIAL_EDIT_LOCKED')
          setBanner({ tone: 'danger', text: errorMessage(locale, res.errors) });
        setServerErrors(fieldErrors(locale, res.errors));
        return { ok: false };
      }
      const v = id
        ? (res.data as { campaign: WatchCampaignView }).campaign
        : (res.data as WatchCampaignView);
      const outcome = id ? (res.data as { outcome: string }).outcome : 'SAVED';
      setView(v);
      setContent(clone(v.content));
      setDirty(false);
      setSavedAt(new Date());
      setBanner(null);
      if (!id) {
        setId(v.id);
        window.history.replaceState(null, '', withLocale(`/watch/${v.id}/edit`, locale));
      }
      if (outcome === 'APPLIED_MINOR') setBanner({ tone: 'success', text: t('mw.minorApplied') });
      void refreshPreview(v.id);
      return { ok: true, id: v.id, outcome };
    },
    [orgId, id, view?.version, call, locale, t, refreshPreview],
  );

  // autosave drafts every 30 s (approved campaigns are saved on purpose, never silently)
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

  const stepIssues = (i: number) => issues.filter((x) => stepOfWatchField(x.field) === i);
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

  const fund = async () => {
    if (!orgId) return;
    const saved = dirty || !id ? await save({ quiet: true }) : { ok: true, id };
    if (!saved.ok || !saved.id) return;
    const current = view?.budget.fundedHalalas ?? 0;
    const amount = Math.max(0, required - current);
    if (amount < 100) return;
    setFunding(true);
    const r = await call<WatchCampaignView>(
      'POST',
      `/v1/merchants/${orgId}/watch/${saved.id}/fund`,
      {
        body: { amountHalalas: amount },
        idempotent: true,
      },
    );
    setFunding(false);
    if (!r.ok || !r.data) {
      setBanner({ tone: 'danger', text: errorMessage(locale, r.errors) });
      return;
    }
    setView(r.data);
    setBanner({ tone: 'success', text: t('mw.funded') });
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
    const s = await call<{ campaign: WatchCampaignView; outcome: string }>(
      'POST',
      `/v1/merchants/${orgId}/watch/${r.id}/submit`,
      { body: {} },
    );
    if (!s.ok || !s.data) {
      setBanner({ tone: 'danger', text: errorMessage(locale, s.errors) });
      if (s.errors[0]?.code === 'FUNDING_REQUIRED') go(4);
      return;
    }
    setView(s.data.campaign);
    setResult({ outcome: s.data.outcome, id: r.id });
  };

  const onVideo = async (file: File) => {
    setMediaError('');
    if (!['video/mp4', 'video/webm'].includes(file.type))
      return setMediaError(t('wmedia.wrongType'));
    if (file.size > limits.maxVideoBytes)
      return setMediaError(
        t('wmedia.tooBig', { size: Math.round(limits.maxVideoBytes / 1024 / 1024) }),
      );
    const url = URL.createObjectURL(file);
    const secs = await readDuration(url);
    if (secs !== null && (secs < limits.minDurationSec || secs > limits.maxDurationSec))
      return setMediaError(
        t('wmedia.length', { min: limits.minDurationSec, max: limits.maxDurationSec }),
      );
    setUploading('video');
    const up = await upload(orgId!, 'WATCH_VIDEO', file);
    setUploading(null);
    if (!up.ok) return setMediaError(errorMessage(locale, up.errors));
    setLocalVideo(url);
    edit({ videoFileId: up.file.fileId, durationSec: secs ?? content.durationSec });
  };

  const onCover = async (file: File) => {
    setMediaError('');
    if (!['image/jpeg', 'image/png'].includes(file.type))
      return setMediaError(t('media.wrongType'));
    if (file.size > MAX_IMAGE_MB * 1024 * 1024)
      return setMediaError(t('media.tooBig', { size: MAX_IMAGE_MB }));
    const objectUrl = URL.createObjectURL(file);
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 0, h: 0 });
      img.src = objectUrl;
    });
    if (dims.w < MIN_W || dims.h < MIN_H)
      return setMediaError(t('media.rules', { size: MAX_IMAGE_MB, w: MIN_W, h: MIN_H }));
    setUploading('cover');
    const up = await upload(orgId!, 'DEAL_IMAGE', file);
    setUploading(null);
    if (!up.ok) return setMediaError(errorMessage(locale, up.errors));
    setLocalThumb(objectUrl);
    edit({ thumbnailFileId: up.file.fileId });
  };

  if (!orgId || loading) return <LoadingState label={t('state.loading')} />;
  if (loadError) return <Alert tone="danger">{loadError}</Alert>;
  if (result) {
    const title =
      result.outcome === 'PUBLISHED'
        ? t('mw.published')
        : result.outcome === 'SCHEDULED'
          ? t('mw.scheduled')
          : result.outcome === 'MINOR'
            ? t('mw.minorApplied')
            : t('mw.sentForReview');
    return (
      <Card>
        <div className="dd-stack" data-testid="builder-result">
          <h1 className="dd-title-xl">{title}</h1>
          {result.outcome === 'SENT_FOR_REVIEW' ? <p>{t('mw.reviewBody')}</p> : null}
          <div>
            <Link
              className="dd-btn dd-btn--primary"
              href={withLocale(`/watch/${result.id}`, locale)}
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
        <Link className="dd-btn dd-btn--secondary" href={withLocale(`/watch/${view.id}`, locale)}>
          {t('review.goToDeal')}
        </Link>
      </div>
    );
  if (view && !['DRAFT', 'NEEDS_CHANGES', 'SCHEDULED', 'LIVE', 'PAUSED'].includes(status))
    return (
      <EmptyState
        title={t('error.EDIT_LOCKED')}
        action={
          <Link className="dd-btn dd-btn--secondary" href={withLocale(`/watch/${view.id}`, locale)}>
            {t('review.goToDeal')}
          </Link>
        }
      />
    );

  const steps: StepItem[] = STEPS.map((s, i) => ({
    id: s,
    label: t(`mw.step.${s}` as DictionaryKey),
    hint: undefined,
    state: stepState(i),
  }));
  const nm = (x: { nameEn: string; nameAr: string }) =>
    locale === 'ar' ? x.nameAr || x.nameEn : x.nameEn || x.nameAr;
  const msg = (field: string) => serverErrors[`content.${field}`];
  const err = (field: string) => {
    const i = showErrors ? issues.find((x) => x.field === field) : undefined;
    return i ? t(`issue.${i.code}` as DictionaryKey) : undefined;
  };
  const hasReq = (field: string) => (lang: 'EN' | 'AR') =>
    showErrors && issues.some((i) => i.field === field && i.code === `REQUIRED_${lang}`);
  const lockedNote = live ? <span className="dd-help">{t('mw.lockedField')}</span> : null;
  const fieldLabel = (f: string) => {
    const k = `issue.field.${f}` as DictionaryKey;
    const v = t(k);
    return v === k ? f : v;
  };
  const videoSrc = localVideo ?? view?.videoUrl ?? null;
  const thumbSrc = localThumb ?? view?.thumbnailUrl ?? null;

  // ---------------------------------------------------------------- steps
  const videoStep = (
    <div className="dd-stack" style={{ gap: 16 }}>
      <p className="dd-help">
        {t('mw.videoHelp', { min: limits.minDurationSec, max: limits.maxDurationSec })}
      </p>
      {videoSrc ? (
        <video
          className="dd-videopreview"
          src={videoSrc}
          controls
          playsInline
          preload="metadata"
          data-testid="watch-video-preview"
        />
      ) : (
        <EmptyState title={t('wmedia.empty')} />
      )}
      {live ? null : (
        <FileField
          id="watch-video"
          label={
            uploading === 'video'
              ? t('media.uploading')
              : videoSrc
                ? t('wmedia.replace')
                : t('wmedia.add')
          }
          accept="video/mp4,video/webm"
          busy={uploading === 'video'}
          onFile={(f) => void onVideo(f)}
        />
      )}
      {mediaError ? (
        <span className="dd-error" role="alert">
          {mediaError}
        </span>
      ) : null}
      {err('videoFileId') ? (
        <span className="dd-error" role="alert">
          {err('videoFileId')}
        </span>
      ) : null}
      <Field
        label={`${t('mw.duration')} *`}
        htmlFor="f-duration"
        help={t('mw.durationHelp')}
        error={err('durationSec') ?? msg('durationSec')}
      >
        <Input
          id="f-duration"
          type="number"
          min={limits.minDurationSec}
          max={limits.maxDurationSec}
          dir="ltr"
          value={content.durationSec ?? ''}
          disabled={live}
          onChange={(e) =>
            edit({ durationSec: e.target.value === '' ? null : Number(e.target.value) })
          }
          style={{ maxInlineSize: 160 }}
        />
      </Field>
      <div className="dd-stack" style={{ gap: 8 }}>
        <strong>{t('mw.cover')}</strong>
        <p className="dd-help" style={{ margin: 0 }}>
          {t('mw.coverHelp')} {t('media.rules', { size: MAX_IMAGE_MB, w: MIN_W, h: MIN_H })}
        </p>
        {thumbSrc ? <img className="dd-coverpreview" src={thumbSrc} alt="" /> : null}
        <FileField
          id="watch-cover"
          label={
            uploading === 'cover'
              ? t('media.uploading')
              : thumbSrc
                ? t('mw.coverReplace')
                : t('mw.coverAdd')
          }
          accept="image/jpeg,image/png"
          busy={uploading === 'cover'}
          onFile={(f) => void onCover(f)}
        />
      </div>
      {lockedNote}
    </div>
  );

  const contentStep = (
    <div className="dd-stack" style={{ gap: 16 }}>
      <p className="dd-help">{t('mhb.langHint')}</p>
      <Bi
        id="f-title"
        label={t('mw.title2')}
        value={content.title}
        max={80}
        onChange={(v) => edit({ title: v })}
        hasError={hasReq('title')}
      />
      <Bi
        id="f-desc"
        label={t('mw.desc')}
        value={content.description}
        max={300}
        multiline
        onChange={(v) => edit({ description: v })}
        hasError={hasReq('description')}
      />
      <Bi
        id="f-cta"
        label={t('mw.cta')}
        value={content.ctaLabel}
        max={30}
        onChange={(v) => edit({ ctaLabel: v })}
        hasError={hasReq('ctaLabel')}
      />
      <Alert tone="info">{t('mw.noRewardNote')}</Alert>
    </div>
  );

  const partnerList =
    content.targeting.eligibility.kind === 'EMPLOYER'
      ? options?.eligibility.employers
      : content.targeting.eligibility.kind === 'BANK_CARD'
        ? options?.eligibility.banks
        : content.targeting.eligibility.kind === 'SCHEME'
          ? options?.eligibility.schemes
          : null;
  const elig = content.targeting.eligibility;
  const audienceStep = (
    <div className="dd-stack" style={{ gap: 16 }}>
      <fieldset className="dd-stack" style={{ border: 0, padding: 0, margin: 0 }} disabled={live}>
        <legend className="dd-label">{t('mw.cities')} *</legend>
        <div className="dd-stack" role="group" aria-label={t('mw.cities')}>
          {(wopts?.cities ?? []).map((c) => (
            <Checkbox
              key={c}
              label={c}
              checked={content.targeting.cities.includes(c)}
              onChange={() =>
                editTargeting({
                  cities: content.targeting.cities.includes(c)
                    ? content.targeting.cities.filter((x) => x !== c)
                    : [...content.targeting.cities, c],
                })
              }
            />
          ))}
        </div>
        {(err('targeting.cities') ?? msg('targeting.cities')) ? (
          <span className="dd-error" role="alert">
            {err('targeting.cities') ?? msg('targeting.cities')}
          </span>
        ) : null}
      </fieldset>

      <fieldset className="dd-stack" style={{ border: 0, padding: 0, margin: 0 }} disabled={live}>
        <legend className="dd-label">{t('mv.eligibility')}</legend>
        {KINDS.map((k) => (
          <label key={k} className="dd-checkbox">
            <input
              type="radio"
              name="elig"
              checked={elig.kind === k}
              onChange={() =>
                editTargeting({
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
        {elig.kind === 'GEOGRAPHY' ? (
          <Field label={t('field.eligibilityCity')} htmlFor="f-city">
            <Select
              id="f-city"
              value={elig.valueRefs[0] ?? ''}
              onChange={(e) =>
                editTargeting({ eligibility: { kind: 'GEOGRAPHY', valueRefs: [e.target.value] } })
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
                  checked={elig.valueRefs.includes(p.id)}
                  onChange={() =>
                    editTargeting({
                      eligibility: {
                        kind: elig.kind,
                        valueRefs: elig.valueRefs.includes(p.id)
                          ? elig.valueRefs.filter((x) => x !== p.id)
                          : [...elig.valueRefs, p.id],
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
        {elig.kind !== 'PUBLIC' ? <span className="dd-help">{t('elig.noCardData')}</span> : null}
      </fieldset>

      <fieldset className="dd-stack" style={{ border: 0, padding: 0, margin: 0 }} disabled={live}>
        <legend className="dd-label">{t('mw.link')}</legend>
        <p className="dd-help" style={{ margin: 0 }}>
          {t('mw.linkHelp')}
        </p>
        <Select
          id="f-link-type"
          value={content.link.type}
          onChange={(e) =>
            edit({ link: { type: e.target.value as WatchContent['link']['type'], id: null } })
          }
          aria-label={t('mw.link')}
        >
          {WATCH_LINK_TYPES.map((k) => (
            <option key={k} value={k}>
              {t(`mw.linkType.${k}` as DictionaryKey)}
            </option>
          ))}
        </Select>
        {['LIVE_DEAL', 'HOT_DEAL', 'VOUCHER'].includes(content.link.type) ? (
          <Field
            label={`${t('mw.linkOffer')} *`}
            htmlFor="f-link-id"
            error={err('link') ?? msg('link')}
          >
            <Select
              id="f-link-id"
              value={content.link.id ?? ''}
              onChange={(e) => edit({ link: { ...content.link, id: e.target.value || null } })}
            >
              <option value="">{t('mw.linkPick')}</option>
              {offers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title[locale] || o.title.en || o.title.ar}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </fieldset>

      <fieldset className="dd-stack" style={{ border: 0, padding: 0, margin: 0 }} disabled={live}>
        <legend className="dd-label">{t('mw.window')}</legend>
        <Checkbox
          label={t('mw.windowOn')}
          checked={!!content.targeting.timeWindow}
          onChange={(e) =>
            editTargeting({ timeWindow: e.target.checked ? { startHour: 9, endHour: 22 } : null })
          }
        />
        {content.targeting.timeWindow ? (
          <div className="dd-grid dd-grid--2">
            <Field label={t('mw.windowFrom')} htmlFor="f-wfrom">
              <Input
                id="f-wfrom"
                type="number"
                min={0}
                max={23}
                dir="ltr"
                value={content.targeting.timeWindow.startHour}
                onChange={(e) =>
                  editTargeting({
                    timeWindow: {
                      ...content.targeting.timeWindow!,
                      startHour: Number(e.target.value) || 0,
                    },
                  })
                }
              />
            </Field>
            <Field label={t('mw.windowTo')} htmlFor="f-wto">
              <Input
                id="f-wto"
                type="number"
                min={1}
                max={24}
                dir="ltr"
                value={content.targeting.timeWindow.endHour}
                onChange={(e) =>
                  editTargeting({
                    timeWindow: {
                      ...content.targeting.timeWindow!,
                      endHour: Number(e.target.value) || 24,
                    },
                  })
                }
              />
            </Field>
          </div>
        ) : null}
      </fieldset>
      {lockedNote}
    </div>
  );

  const scheduleStep = (
    <div className="dd-stack" style={{ gap: 16 }}>
      {live ? <Alert tone="info">{t('mw.liveEditNote')}</Alert> : null}
      <div className="dd-grid dd-grid--2">
        <Field
          label={`${t('mw.start')} (${t('field.riyadhTime')}) *`}
          htmlFor="f-start"
          error={err('startAt') ?? msg('startAt')}
        >
          <Input
            id="f-start"
            type="datetime-local"
            dir="ltr"
            value={toMarketInput(content.startAt)}
            disabled={live}
            onChange={(e) => edit({ startAt: fromMarketInput(e.target.value) })}
          />
        </Field>
        <Field
          label={`${t('mw.end')} (${t('field.riyadhTime')}) *`}
          htmlFor="f-end"
          error={err('endAt') ?? msg('endAt')}
        >
          <Input
            id="f-end"
            type="datetime-local"
            dir="ltr"
            value={toMarketInput(content.endAt)}
            disabled={live}
            onChange={(e) => edit({ endAt: fromMarketInput(e.target.value) })}
          />
        </Field>
      </div>
      <p className="dd-help">{t('mw.periodHelp', { days: limits.maxCampaignDays })}</p>
      <Field
        label={t('mw.repeat')}
        htmlFor="f-repeat"
        help={t('mw.repeatHelp', { hours: minRepeat })}
        error={err('frequency.repeatWindowHours') ?? msg('frequency.repeatWindowHours')}
      >
        <Input
          id="f-repeat"
          type="number"
          min={minRepeat}
          dir="ltr"
          placeholder={String(minRepeat)}
          value={content.frequency.repeatWindowHours ?? ''}
          disabled={live}
          onChange={(e) =>
            edit({
              frequency: {
                repeatWindowHours: e.target.value === '' ? null : Number(e.target.value),
              },
            })
          }
          style={{ maxInlineSize: 160 }}
        />
      </Field>
    </div>
  );

  const funded = view?.budget.fundedHalalas ?? 0;
  const remainingToFund = Math.max(0, required - funded);
  const budgetStep = (
    <div className="dd-stack" style={{ gap: 16 }}>
      <Alert tone="info">{t('mw.budgetNote', { price: formatMoney(locale, charge) })}</Alert>
      <Field
        label={`${t('mw.paid')} *`}
        htmlFor="f-paid"
        help={t('mw.paidHelp', {
          min: formatNumber(locale, limits.minPaidViews),
          max: formatNumber(locale, limits.maxPaidViews),
        })}
        error={err('paidViews') ?? msg('paidViews')}
      >
        <Input
          id="f-paid"
          type="number"
          min={limits.minPaidViews}
          max={limits.maxPaidViews}
          dir="ltr"
          value={content.paidViews || ''}
          disabled={live}
          onChange={(e) =>
            edit({ paidViews: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
          }
          style={{ maxInlineSize: 200 }}
        />
      </Field>
      <Card flat>
        <dl className="dd-kv">
          <div className="dd-kv__row">
            <dt>{t('wmon.charge')}</dt>
            <dd className="dd-ltr">{formatMoney(locale, charge)}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('wmon.required')}</dt>
            <dd className="dd-ltr" data-testid="builder-required">
              {formatMoney(locale, required)}
            </dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('wmon.funded')}</dt>
            <dd className="dd-ltr" data-testid="builder-funded">
              {formatMoney(locale, funded)}
            </dd>
          </div>
        </dl>
      </Card>
      {remainingToFund > 0 ? (
        <div className="dd-stack">
          <Alert tone="warning">
            {t('mw.fundNeeded', { amount: formatMoney(locale, remainingToFund) })}
          </Alert>
          <div>
            <Button
              onClick={() => void fund()}
              loading={funding}
              disabled={required < 100 || saving}
              data-testid="watch-fund"
            >
              {t('mw.fundNow', { amount: formatMoney(locale, remainingToFund) })}
            </Button>
          </div>
          <p className="dd-caption">{t('mw.devPayment')}</p>
        </div>
      ) : required > 0 && funded >= required ? (
        <Alert tone="success">
          <span data-testid="builder-fully-funded">{t('mw.fullyFunded')}</span>
        </Alert>
      ) : null}
      <p className="dd-caption">{t('mw.unusedNote')}</p>
    </div>
  );

  const g = view?.guardrail;
  const material = view && live ? watchMaterialChanges(view.content, content) : [];
  const reviewStep = (
    <div className="dd-stack" style={{ gap: 16 }}>
      {issues.length ? (
        <Alert tone="warning" title={t('review.fixFirst')}>
          <ul style={{ margin: '8px 0 0', paddingInlineStart: 18 }}>
            {issues.map((i, n) => (
              <li key={`${i.field}-${i.code}-${n}`}>
                {fieldLabel(i.field)}: {t(`issue.${i.code}` as DictionaryKey)}{' '}
                <button
                  type="button"
                  className="dd-link"
                  style={{ background: 'none', border: 0, cursor: 'pointer' }}
                  onClick={() => go(stepOfWatchField(i.field))}
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
      {!live && funded < required ? (
        <Alert tone="warning">
          <span data-testid="review-unfunded">{t('mw.fundBeforeSubmit')}</span>{' '}
          <button
            type="button"
            className="dd-link"
            style={{ background: 'none', border: 0, cursor: 'pointer' }}
            onClick={() => go(4)}
          >
            {t('review.go')}
          </button>
        </Alert>
      ) : null}
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
        <Alert tone="info" title={t('mw.liveEditNote')}>
          {material.length ? <div>{material.map((f) => fieldLabel(f)).join(', ')}</div> : null}
        </Alert>
      ) : g ? (
        <Alert tone={g.outcome === 'AUTO_PUBLISH' ? 'success' : 'warning'}>
          {g.outcome === 'AUTO_PUBLISH' ? t('mw.guardrail.auto') : t('mw.guardrail.manual')}
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
            <dt>{t('mw.title2')}</dt>
            <dd>{content.title[locale] || content.title.en || '-'}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('mw.duration')}</dt>
            <dd className="dd-ltr">{content.durationSec ?? '-'}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('mw.paid')}</dt>
            <dd className="dd-ltr">{formatNumber(locale, content.paidViews)}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('wmon.required')}</dt>
            <dd className="dd-ltr">{formatMoney(locale, required)}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('mw.cities')}</dt>
            <dd>{content.targeting.cities.join(', ') || '-'}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('mv.eligibility')}</dt>
            <dd>{t(`elig.${elig.kind}` as DictionaryKey)}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('mw.period')}</dt>
            <dd className="dd-ltr">
              {toMarketInput(content.startAt).replace('T', ' ')} →{' '}
              {toMarketInput(content.endAt).replace('T', ' ')}
            </dd>
          </div>
        </dl>
      </Card>
      <Alert tone="info">{t('mw.contentRules')}</Alert>
      {orgId ? (
        <CommercialPanel
          orgId={orgId}
          product="WATCH"
          subjectId={id ?? null}
          content={content}
          dirty={dirty}
          onReady={setCmReady}
          refreshKey={view?.version}
        />
      ) : null}
    </div>
  );

  const body = [videoStep, contentStep, audienceStep, scheduleStep, budgetStep, reviewStep][
    step
  ] as ReactNode;
  const last = step === STEPS.length - 1;

  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="watch-builder">
      <div className="dd-builder__bar">
        <div className="dd-row">
          <Link className="dd-link" href={withLocale(id ? `/watch/${id}` : '/watch', locale)}>
            ← {t('mdeal.back')}
          </Link>
          <h1 className="dd-title">{id ? t('mw.editTitle') : t('mw.newTitle')}</h1>
          <WatchStatusChip status={status} locale={locale} />
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
                        {
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: displayTimeZone(),
                        },
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
      {editableLive && !banner ? <Alert tone="info">{t('mw.liveEditNote')}</Alert> : null}

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
              <h2 className="dd-title">{t(`mw.step.${STEPS[step]}` as DictionaryKey)}</h2>
              <p className="dd-muted" style={{ margin: 0 }}>
                {t(`mw.stepHelp.${STEPS[step]}` as DictionaryKey)}
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
                  data-testid="watch-save"
                >
                  {live ? t('builder.saveChanges') : t('mhb.save')}
                </Button>
                {last ? (
                  <Button
                    onClick={() => void submit()}
                    loading={saving}
                    disabled={!live && !cmReady}
                    data-testid="watch-submit"
                  >
                    {live ? t('builder.saveChanges') : t('mhb.submit')}
                  </Button>
                ) : (
                  <Button onClick={() => void next()} data-testid="builder-next">
                    {t('mhb.next')}
                  </Button>
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
                  className="dd-previewframe"
                  data-testid="watch-preview"
                >
                  {previewKind === 'card' ? (
                    <WatchCardView campaign={preview} locale={previewLang} variant="list" />
                  ) : (
                    <WatchDetailView detail={preview} locale={previewLang} embedded />
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
