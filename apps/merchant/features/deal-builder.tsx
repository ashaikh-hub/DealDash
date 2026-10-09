'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DealCardView,
  DealDetailView,
  RequirePermission,
  errorMessage,
  fieldErrors,
  useApi,
  useAuth,
} from '@dealdash/app-shell';
import { createTranslator, withLocale, type Locale } from '@dealdash/localization';
import { LIVE_DEAL_MECHANICS, WEEKDAYS } from '@dealdash/types';
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
  diffLiveDealContent,
  emptyLiveDealContent,
  liveDealIssues,
  translationStatus,
  type DealDetail,
  type DealIssue,
  type LiveDealContent,
  type LiveDealView,
} from '@dealdash/validation';
import {
  DealStatusChip,
  fromRiyadhInput,
  stepOfField,
  toRiyadhInput,
  useOrgId,
} from './deal-utils';

interface Options {
  categories: Array<{ id: string; code: string; nameEn: string; nameAr: string }>;
  eligibility: {
    employers: Array<{ id: string; nameEn: string; nameAr: string }>;
    banks: Array<{ id: string; nameEn: string; nameAr: string }>;
    schemes: Array<{ id: string; nameEn: string; nameAr: string }>;
    cities: string[];
  };
}
interface BranchOption {
  id: string;
  nameEn: string;
  nameAr: string;
  status: string;
  city: string;
}

const STEPS = ['basics', 'branches', 'eligibility', 'media', 'review'] as const;
const STEP_FIELDS: Array<(f: string) => boolean> = STEPS.map((_, i) => (f) => stepOfField(f) === i);
const MAX_IMAGE_MB = 5;
const MIN_W = 400;
const MIN_H = 250;

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function DealBuilder({ dealId }: { dealId?: string }) {
  return (
    <RequirePermission any={['merchant.deals.manage']}>
      <BuilderInner dealId={dealId} />
    </RequirePermission>
  );
}

// ------------------------------------------------------------------ bilingual field
function Bi({
  id,
  label,
  value,
  onChange,
  max,
  multiline,
  issues,
  showErrors,
  help,
}: {
  id: string;
  label: string;
  value: { en: string; ar: string };
  onChange: (v: { en: string; ar: string }) => void;
  max: number;
  multiline?: boolean;
  issues: DealIssue[];
  showErrors: boolean;
  help?: string;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const field = id.replace(/^f-/, '');
  const err = (lang: 'EN' | 'AR') =>
    showErrors && issues.some((i) => i.field === field && i.code === `REQUIRED_${lang}`)
      ? t(`issue.REQUIRED_${lang}` as never)
      : undefined;
  const Control = multiline ? Textarea : Input;
  return (
    <div className="dd-stack" style={{ gap: 4 }}>
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
    </div>
  );
}

function BuilderInner({ dealId }: { dealId?: string }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call, upload } = useApi();
  const router = useRouter();
  const orgId = useOrgId();

  const [id, setId] = useState<string | undefined>(dealId);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState<LiveDealView | null>(null);
  const [content, setContent] = useState<LiveDealContent>(emptyLiveDealContent());
  const [options, setOptions] = useState<Options | null>(null);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [step, setStep] = useState(0);
  const [visited, setVisited] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{
    tone: 'info' | 'warning' | 'danger' | 'success';
    text: string;
  } | null>(null);
  const [preview, setPreview] = useState<DealDetail | null>(null);
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
  const approved = status === 'SCHEDULED' || status === 'LIVE' || status === 'PAUSED';
  const editable = !view || status === 'DRAFT' || status === 'NEEDS_CHANGES' || approved;
  const revisionPending = view?.revision?.status === 'PENDING_REVIEW';
  const startLocked =
    !!view?.content.startAt && new Date(view.content.startAt).getTime() <= Date.now();

  const issues = useMemo(() => liveDealIssues(content, { now: new Date() }), [content]);
  const translation = useMemo(() => translationStatus(content), [content]);

  // ---------------------------------------------------------------- load
  const applyView = useCallback((v: LiveDealView) => {
    setView(v);
    const source = v.revision && v.revision.status !== 'PENDING_REVIEW' ? v.revision : null;
    const c = clone(source ? source.content : (v.revision?.content ?? v.content));
    setContent(c);
    setNoEnd(!c.endAt);
    const urls: Record<string, string> = {};
    for (const m of [...v.media, ...(v.revision?.media ?? [])]) if (m.url) urls[m.fileId] = m.url;
    setThumbs((cur) => ({ ...cur, ...urls }));
    setSavedAt(new Date(v.updatedAt));
  }, []);

  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    (async () => {
      const [o, b, d] = await Promise.all([
        call<Options>('GET', `/v1/merchants/${orgId}/deal-options`),
        call<BranchOption[]>('GET', `/v1/merchants/${orgId}/branches`),
        dealId
          ? call<LiveDealView>('GET', `/v1/merchants/${orgId}/live-deals/${dealId}`)
          : Promise.resolve(null),
      ]);
      if (!alive) return;
      if (!o.ok || !b.ok || (d && !d.ok)) {
        setLoadError(errorMessage(locale, (!o.ok ? o : !b.ok ? b : d!).errors));
        setLoading(false);
        return;
      }
      setOptions(o.data);
      setBranches((b.data ?? []).filter((x) => x.status === 'ACTIVE'));
      if (d?.data) {
        applyView(d.data);
        setVisited(STEPS.length - 1); // an existing deal has been through every step
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
      const r = await call<DealDetail>(
        'GET',
        `/v1/merchants/${orgId}/live-deals/${target}/preview`,
      );
      if (r.ok && r.data) setPreview(r.data);
    },
    [call, orgId],
  );
  useEffect(() => {
    if (id && !loading) void refreshPreview(id);
  }, [id, loading, refreshPreview]);

  // ---------------------------------------------------------------- save
  const edit = (patch: Partial<LiveDealContent>) => {
    setContent((c) => ({ ...c, ...patch }));
    setDirty(true);
    setServerErrors({});
  };

  const save = useCallback(
    async (
      opts: { quiet?: boolean } = {},
    ): Promise<{ ok: boolean; id?: string; outcome?: string; view?: LiveDealView }> => {
      if (!orgId) return { ok: false };
      let body = contentRef.current;
      if (startNow && !startLocked) body = { ...body, startAt: new Date().toISOString() };
      if (noEnd) body = { ...body, endAt: null };
      setSaving(true);
      let res;
      if (!id) {
        res = await call<LiveDealView>('POST', `/v1/merchants/${orgId}/live-deals`, {
          body: { content: body },
          idempotent: true,
        });
      } else {
        res = await call<{ deal: LiveDealView; outcome: string; material: string[] }>(
          'PUT',
          `/v1/merchants/${orgId}/live-deals/${id}`,
          {
            body: { content: body, expectedVersion: view?.version },
          },
        );
      }
      setSaving(false);
      if (!res.ok || !res.data) {
        const e = res.errors[0];
        if (e?.code === 'VERSION_CONFLICT')
          setBanner({ tone: 'danger', text: t('detail.conflict') });
        else if (e?.code === 'DEAL_INCOMPLETE')
          setBanner({ tone: 'warning', text: errorMessage(locale, res.errors) });
        else if (!opts.quiet) setBanner({ tone: 'danger', text: errorMessage(locale, res.errors) });
        setServerErrors(fieldErrors(locale, res.errors));
        return { ok: false };
      }
      const v = id
        ? (res.data as unknown as { deal: LiveDealView }).deal
        : (res.data as LiveDealView);
      const outcome = id ? (res.data as unknown as { outcome: string }).outcome : 'SAVED';
      setView(v);
      setDirty(false);
      setSavedAt(new Date());
      setBanner(null);
      if (!id) {
        setId(v.id);
        window.history.replaceState(null, '', withLocale(`/deals/${v.id}/edit`, locale));
      }
      if (outcome === 'APPLIED_MINOR')
        setBanner({ tone: 'success', text: t('review.minorApplied') });
      if (outcome === 'REVISION_SAVED')
        setBanner({ tone: 'info', text: t('review.revisionSaved') });
      void refreshPreview(v.id);
      return { ok: true, id: v.id, outcome, view: v };
    },
    [orgId, id, view?.version, call, locale, t, startNow, noEnd, startLocked, refreshPreview],
  );

  // autosave every 30 s while editing a draft (live deals are saved on purpose, never silently)
  useEffect(() => {
    if (!id || !dirty || !(status === 'DRAFT' || status === 'NEEDS_CHANGES')) return;
    const timer = setTimeout(() => void save({ quiet: true }), 30_000);
    return () => clearTimeout(timer);
  }, [id, dirty, status, content, save]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // ---------------------------------------------------------------- navigation between steps
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

  // ---------------------------------------------------------------- submit
  const submit = async () => {
    setShowErrors(true);
    if (issues.length) return;
    const r = await save();
    if (!r.ok || !r.id) return;
    if (r.outcome === 'APPLIED_MINOR') {
      setResult({ outcome: 'MINOR', id: r.id });
      return;
    }
    const s = await call<{ deal: LiveDealView; outcome: string }>(
      'POST',
      `/v1/merchants/${orgId}/live-deals/${r.id}/submit`,
      { body: {} },
    );
    if (!s.ok || !s.data) {
      setBanner({ tone: 'danger', text: errorMessage(locale, s.errors) });
      return;
    }
    setView(s.data.deal);
    setResult({ outcome: s.data.outcome, id: r.id });
  };

  // ---------------------------------------------------------------- media
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
    if (dims.w < MIN_W || dims.h < MIN_H) {
      setMediaError(t('media.rules', { size: MAX_IMAGE_MB, w: MIN_W, h: MIN_H }));
      return;
    }
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
        ? t('review.publishedTitle')
        : result.outcome === 'SCHEDULED'
          ? t('review.scheduledTitle')
          : result.outcome === 'MINOR'
            ? t('review.minorApplied')
            : t('review.sentTitle');
    return (
      <Card>
        <div className="dd-stack" data-testid="builder-result">
          <h1 className="dd-title-xl">{title}</h1>
          {result.outcome === 'SENT_FOR_REVIEW' ? <p>{t('review.sentBody')}</p> : null}
          <div>
            <Link
              className="dd-btn dd-btn--primary"
              href={withLocale(`/deals/${result.id}`, locale)}
            >
              {t('review.goToDeal')}
            </Link>
          </div>
        </div>
      </Card>
    );
  }

  if (
    !editable ||
    (view && !['DRAFT', 'NEEDS_CHANGES', 'SCHEDULED', 'LIVE', 'PAUSED'].includes(status))
  )
    return (
      <EmptyState
        title={t('error.EDIT_LOCKED')}
        action={
          id ? (
            <Link className="dd-btn dd-btn--secondary" href={withLocale(`/deals/${id}`, locale)}>
              {t('review.goToDeal')}
            </Link>
          ) : undefined
        }
      />
    );
  if (revisionPending)
    return (
      <div className="dd-stack">
        <Alert tone="info">{t('banner.revisionPending')}</Alert>
        {id ? (
          <Link className="dd-btn dd-btn--secondary" href={withLocale(`/deals/${id}`, locale)}>
            {t('review.goToDeal')}
          </Link>
        ) : null}
      </div>
    );

  const steps: StepItem[] = STEPS.map((s, i) => ({
    id: s,
    label: t(`dstep.${s}` as never),
    hint: undefined,
    state: stepState(i),
  }));
  const cats = options?.categories ?? [];
  const nm = (x: { nameEn: string; nameAr: string }) =>
    locale === 'ar' ? x.nameAr || x.nameEn : x.nameEn || x.nameAr;
  const msg = (field: string) => serverErrors[field];
  const showValueField = content.mechanic === 'PERCENTAGE_OFF' || content.mechanic === 'AMOUNT_OFF';

  // ---------------------------------------------------------------- steps
  const basics = (
    <div className="dd-stack" style={{ gap: 16 }}>
      <div className="dd-grid dd-grid--2">
        <Field
          label={`${t('field.category')} *`}
          htmlFor="f-categoryId"
          error={
            showErrors && issues.some((i) => i.field === 'categoryId')
              ? t('issue.REQUIRED')
              : msg('content.categoryId')
          }
        >
          <Select
            id="f-categoryId"
            value={content.categoryId ?? ''}
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
        <Field
          label={`${t('field.mechanic')} *`}
          htmlFor="f-mechanic"
          error={
            showErrors && issues.some((i) => i.field === 'mechanic')
              ? t('issue.REQUIRED')
              : undefined
          }
        >
          <Select
            id="f-mechanic"
            value={content.mechanic ?? ''}
            onChange={(e) =>
              edit({
                mechanic: (e.target.value || null) as LiveDealContent['mechanic'],
                valueNumber: null,
              })
            }
          >
            <option value="">{t('field.mechanicPick')}</option>
            {LIVE_DEAL_MECHANICS.map((m) => (
              <option key={m} value={m}>
                {t(`mechanic.${m}` as never)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {showValueField ? (
        <Field
          label={`${content.mechanic === 'PERCENTAGE_OFF' ? t('field.valuePercent') : t('field.valueAmount')} *`}
          htmlFor="f-valueNumber"
          error={
            showErrors && issues.some((i) => i.field === 'valueNumber')
              ? t(`issue.${issues.find((i) => i.field === 'valueNumber')!.code}` as never)
              : undefined
          }
        >
          <Input
            id="f-valueNumber"
            type="number"
            inputMode="decimal"
            min={1}
            max={content.mechanic === 'PERCENTAGE_OFF' ? 100 : undefined}
            value={content.valueNumber ?? ''}
            onChange={(e) =>
              edit({ valueNumber: e.target.value === '' ? null : Number(e.target.value) })
            }
            style={{ maxInlineSize: 200 }}
            dir="ltr"
          />
        </Field>
      ) : null}
      <Bi
        id="f-offerLabel"
        label={t('field.offerLabel')}
        help={t('field.offerLabelHelp')}
        value={content.offerLabel}
        max={40}
        onChange={(v) => edit({ offerLabel: v })}
        issues={issues}
        showErrors={showErrors}
      />
      <Bi
        id="f-title"
        label={t('field.title')}
        value={content.title}
        max={80}
        onChange={(v) => edit({ title: v })}
        issues={issues}
        showErrors={showErrors}
      />
      <Bi
        id="f-shortDescription"
        label={t('field.shortDescription')}
        value={content.shortDescription}
        max={140}
        onChange={(v) => edit({ shortDescription: v })}
        issues={issues}
        showErrors={showErrors}
      />
      <Bi
        id="f-description"
        label={t('field.description')}
        value={content.description}
        max={1500}
        multiline
        onChange={(v) => edit({ description: v })}
        issues={issues}
        showErrors={showErrors}
      />
    </div>
  );

  const toggleBranch = (bid: string) =>
    edit({
      branchIds: content.branchIds.includes(bid)
        ? content.branchIds.filter((x) => x !== bid)
        : [...content.branchIds, bid],
    });
  const schedule = (
    <div className="dd-stack" style={{ gap: 16 }}>
      <fieldset className="dd-stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="dd-label">{t('field.branches')} *</legend>
        <span className="dd-help">{t('field.branchesHelp')}</span>
        {branches.map((b) => (
          <Checkbox
            key={b.id}
            label={nm(b)}
            checked={content.branchIds.includes(b.id)}
            onChange={() => toggleBranch(b.id)}
          />
        ))}
        {showErrors && issues.some((i) => i.field === 'branchIds') ? (
          <span className="dd-error" role="alert">
            {t('issue.REQUIRED')}
          </span>
        ) : null}
        {msg('content.branchIds') ? (
          <span className="dd-error" role="alert">
            {msg('content.branchIds')}
          </span>
        ) : null}
      </fieldset>
      <div className="dd-grid dd-grid--2">
        <div className="dd-stack">
          <Field
            label={`${t('field.startAt')} * (${t('field.riyadhTime')})`}
            htmlFor="f-startAt"
            error={
              showErrors && issues.some((i) => i.field === 'startAt')
                ? t('issue.REQUIRED')
                : msg('content.startAt')
            }
          >
            <Input
              id="f-startAt"
              type="datetime-local"
              dir="ltr"
              value={startNow ? '' : toRiyadhInput(content.startAt)}
              disabled={startNow || startLocked}
              onChange={(e) => edit({ startAt: fromRiyadhInput(e.target.value) })}
            />
          </Field>
          {!startLocked ? (
            <Checkbox
              label={t('field.startNow')}
              checked={startNow}
              onChange={(e) => {
                setStartNow(e.target.checked);
                setDirty(true);
                if (e.target.checked) edit({ startAt: new Date().toISOString() });
              }}
            />
          ) : (
            <span className="dd-help">{t('builder.lockedStart')}</span>
          )}
        </div>
        <div className="dd-stack">
          <Field
            label={`${t('field.endAt')} (${t('field.riyadhTime')})`}
            htmlFor="f-endAt"
            error={
              issues.some((i) => i.field === 'endAt' && showErrors)
                ? t(`issue.${issues.find((i) => i.field === 'endAt')!.code}` as never)
                : msg('content.endAt')
            }
          >
            <Input
              id="f-endAt"
              type="datetime-local"
              dir="ltr"
              value={noEnd ? '' : toRiyadhInput(content.endAt)}
              disabled={noEnd}
              onChange={(e) => edit({ endAt: fromRiyadhInput(e.target.value) })}
            />
          </Field>
          <Checkbox
            label={t('field.endNone')}
            checked={noEnd}
            onChange={(e) => {
              setNoEnd(e.target.checked);
              edit({ endAt: e.target.checked ? null : content.endAt });
            }}
          />
        </div>
      </div>
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
  const eligibilityStep = (
    <div className="dd-stack" style={{ gap: 16 }}>
      <fieldset className="dd-stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="dd-label">{t('field.eligibility')}</legend>
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
                    valueRefs:
                      k === 'GEOGRAPHY' ? [options?.eligibility.cities[0] ?? 'Riyadh'] : [],
                  },
                })
              }
            />
            <span>{t(`elig.${k}` as never)}</span>
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
        {showErrors && issues.some((i) => i.field === 'eligibility') ? (
          <span className="dd-error" role="alert">
            {t('issue.REQUIRED')}
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

      <fieldset className="dd-stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="dd-label">{t('field.terms')}</legend>
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
        <div className="dd-grid dd-grid--2">
          <Field label={t('terms.minSpend')} htmlFor="f-minspend">
            <Input
              id="f-minspend"
              type="number"
              min={0}
              dir="ltr"
              value={blocks.minimumSpendHalalas === null ? '' : blocks.minimumSpendHalalas / 100}
              onChange={(e) =>
                setBlocks({
                  minimumSpendHalalas:
                    e.target.value === '' ? null : Math.round(Number(e.target.value) * 100),
                })
              }
            />
          </Field>
          <div className="dd-inline-fields" dir="ltr">
            <Field label={t('terms.validFrom')} htmlFor="f-vf">
              <Input
                id="f-vf"
                type="time"
                value={blocks.validFrom ?? ''}
                onChange={(e) => setBlocks({ validFrom: e.target.value || null })}
              />
            </Field>
            <Field label={t('terms.validTo')} htmlFor="f-vt">
              <Input
                id="f-vt"
                type="time"
                value={blocks.validTo ?? ''}
                onChange={(e) => setBlocks({ validTo: e.target.value || null })}
              />
            </Field>
          </div>
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
                {t(`weekday.${d}` as never)}
              </button>
            ))}
          </div>
        </div>
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
                  bad ? t(`issue.REQUIRED_${lang === 'en' ? 'EN' : 'AR'}` as never) : undefined
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
      </fieldset>
    </div>
  );

  const mediaStep = (
    <div className="dd-stack" style={{ gap: 12 }}>
      <p className="dd-help">{t('media.rules', { size: MAX_IMAGE_MB, w: MIN_W, h: MIN_H })}</p>
      {content.media.length === 0 ? <EmptyState title={t('media.empty')} /> : null}
      <div className="dd-media-grid">
        {content.media.map((m, i) => (
          <div key={m.fileId} className={`dd-media-item ${i === 0 ? 'dd-media-item--cover' : ''}`}>
            {thumbs[m.fileId] ? (
              <img src={thumbs[m.fileId]} alt={(locale === 'ar' ? m.altAr : m.altEn) || ''} />
            ) : (
              <div className="dd-dc__ph" style={{ aspectRatio: '16/10' }} />
            )}
            {i === 0 ? <StatusChip tone="info">{t('media.cover')}</StatusChip> : null}
            <Field label={`${t('field.altText')} (${t('builder.langEn')})`} htmlFor={`alt-en-${i}`}>
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
            <Field label={`${t('field.altText')} (${t('builder.langAr')})`} htmlFor={`alt-ar-${i}`}>
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
                onClick={() => edit({ media: content.media.filter((x) => x.fileId !== m.fileId) })}
              >
                {t('media.remove')}
              </Button>
            </div>
          </div>
        ))}
      </div>
      <div className="dd-row">
        <FileField
          id="deal-image"
          label={uploading ? t('media.uploading') : t('media.add')}
          accept="image/jpeg,image/png"
          busy={uploading}
          disabled={content.media.length >= 5}
          onFile={(f) => void onFile(f)}
        />
      </div>
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
      {msg('content.media') ? (
        <span className="dd-error" role="alert">
          {msg('content.media')}
        </span>
      ) : null}
    </div>
  );

  const g = view?.guardrail;
  const material = view && approved ? diffLiveDealContent(view.content, content).material : [];
  const reviewStep = (
    <div className="dd-stack" style={{ gap: 16 }}>
      {issues.length ? (
        <Alert tone="warning" title={t('review.fixFirst')}>
          <ul style={{ margin: '8px 0 0', paddingInlineStart: 18 }}>
            {issues.map((i, n) => (
              <li key={`${i.field}-${i.code}-${n}`}>
                {t(`issue.field.${i.field}` as never)}: {t(`issue.${i.code}` as never)}{' '}
                <button
                  type="button"
                  className="dd-link"
                  style={{ background: 'none', border: 0, cursor: 'pointer' }}
                  onClick={() => go(stepOfField(i.field))}
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
      <Card flat>
        <h2 className="dd-title">{t('review.redemption')}</h2>
        <p style={{ margin: 0 }}>{t('field.redemptionGeneral')}</p>
      </Card>
      {approved ? (
        <Alert tone="info" title={t('edit.noticeTitle')}>
          {t('edit.notice')}
          {material.length ? (
            <div style={{ marginBlockStart: 8 }}>
              {t('edit.material', {
                fields: material.map((f) => t(`field.mat.${f}` as never)).join(', '),
              })}
            </div>
          ) : null}
        </Alert>
      ) : g ? (
        <Alert tone={g.outcome === 'AUTO_PUBLISH' ? 'success' : 'warning'}>
          {g.outcome === 'AUTO_PUBLISH' ? t('guardrail.auto') : t('guardrail.manual')}
          <ul style={{ margin: '6px 0 0', paddingInlineStart: 18, fontWeight: 500 }}>
            {g.reasons.map((r) => (
              <li key={r}>{t(`guardrail.reason.${r}` as never)}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <Card flat>
        <h2 className="dd-title">{t('review.summary')}</h2>
        <dl className="dd-kv" style={{ marginBlockStart: 8 }}>
          <div className="dd-kv__row">
            <dt>{t('field.category')}</dt>
            <dd>
              {cats.find((c) => c.id === content.categoryId)
                ? nm(cats.find((c) => c.id === content.categoryId)!)
                : '-'}
            </dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('field.mechanic')}</dt>
            <dd>{content.mechanic ? t(`mechanic.${content.mechanic}` as never) : '-'}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('field.title')}</dt>
            <dd>{content.title[locale] || content.title.en || '-'}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('field.branches')}</dt>
            <dd>
              {branches
                .filter((b) => content.branchIds.includes(b.id))
                .map(nm)
                .join(', ') || '-'}
            </dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('field.eligibility')}</dt>
            <dd>{t(`elig.${content.eligibility.kind}` as never)}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('field.images')}</dt>
            <dd>{content.media.length}</dd>
          </div>
        </dl>
      </Card>
    </div>
  );

  const body = [basics, schedule, eligibilityStep, mediaStep, reviewStep][step] as ReactNode;
  const last = step === STEPS.length - 1;
  const submitLabel = approved
    ? view?.revision || material.length
      ? t('builder.submitChanges')
      : t('builder.saveChanges')
    : t('builder.submit');

  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="deal-builder">
      <div className="dd-builder__bar">
        <div className="dd-row">
          <Link className="dd-link" href={withLocale(id ? `/deals/${id}` : '/deals', locale)}>
            ← {t('mdeal.back')}
          </Link>
          <h1 className="dd-title">{id ? t('builder.titleEdit') : t('builder.titleNew')}</h1>
          <DealStatusChip status={status} />
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
                        { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' },
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

      {view?.latestDecision &&
      (status === 'NEEDS_CHANGES' || view.revision?.status === 'NEEDS_CHANGES') ? (
        <Alert tone="warning" title={t('banner.needsChanges')}>
          {(locale === 'ar' && view.latestDecision.reasonAr) || view.latestDecision.reason}
        </Alert>
      ) : null}
      {banner ? <Alert tone={banner.tone}>{banner.text}</Alert> : null}

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
              <h2 className="dd-title">{t(`dstep.${STEPS[step]}` as never)}</h2>
              <p className="dd-muted" style={{ margin: 0 }}>
                {t(`dstep.${STEPS[step]}Help` as never)}
              </p>
            </div>
            {body}
            <div
              className="dd-builder__bar"
              style={{ borderBlockStart: '1px solid var(--dd-line)', paddingBlockStart: 16 }}
            >
              <Button variant="outline" disabled={step === 0} onClick={() => go(step - 1)}>
                {t('builder.back')}
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
                >
                  {approved ? t('builder.saveChanges') : t('builder.saveDraft')}
                </Button>
                {last ? (
                  <Button onClick={() => void submit()} loading={saving}>
                    {submitLabel}
                  </Button>
                ) : (
                  <Button onClick={() => void next()}>{t('builder.next')}</Button>
                )}
              </div>
            </div>
          </div>
        </Card>

        <aside className="dd-builder__preview" aria-label={t('review.previewTitle')}>
          <Card>
            <div className="dd-stack">
              <div className="dd-row" style={{ justifyContent: 'space-between' }}>
                <h2 className="dd-title">{t('review.previewTitle')}</h2>
                <div className="dd-lang" role="group" aria-label={t('review.previewTitle')}>
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
                  data-testid="deal-preview"
                  style={{
                    maxBlockSize: previewKind === 'detail' ? 640 : undefined,
                    overflow: 'auto',
                  }}
                >
                  {previewKind === 'card' ? (
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <DealCardView deal={preview} locale={previewLang} />
                    </div>
                  ) : (
                    <DealDetailView detail={preview} locale={previewLang} embedded />
                  )}
                </div>
              ) : (
                <p className="dd-muted">
                  {id ? t('review.previewLoading') : t('review.previewSaveFirst')}
                </p>
              )}
            </div>
          </Card>
        </aside>
      </div>
      <span hidden>{String(router !== null)}</span>
    </div>
  );
}
