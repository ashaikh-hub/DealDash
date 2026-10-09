'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  RequirePermission,
  VoucherCardView,
  VoucherDetailView,
  errorMessage,
  fieldErrors,
  useApi,
  useAuth,
  CommercialPanel,
  CommercialInputsEditor,
} from '@dealdash/app-shell';
import {
  createTranslator,
  formatMoney,
  withLocale,
  type DictionaryKey,
  type Locale,
} from '@dealdash/localization';
import { WEEKDAYS } from '@dealdash/types';
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
  DEFAULT_VOUCHER_LIMITS,
  emptyVoucherContent,
  voucherIssues,
  voucherMaterialChanges,
  voucherSavings,
  voucherTranslationStatus,
  type VoucherContent,
  type VoucherDetail,
  type VoucherLimits,
  type VoucherView,
} from '@dealdash/validation';
import { fromRiyadhInput, toRiyadhInput, useOrgId } from './deal-utils';
import {
  VoucherStatusChip,
  halalasToInput,
  inputToHalalas,
  stepOfVoucherField,
} from './voucher-utils';

interface Options {
  categories: Array<{ id: string; code: string; nameEn: string; nameAr: string }>;
  eligibility: {
    employers: Array<{ id: string; nameEn: string; nameAr: string }>;
    banks: Array<{ id: string; nameEn: string; nameAr: string }>;
    schemes: Array<{ id: string; nameEn: string; nameAr: string }>;
    cities: string[];
  };
}
interface VoucherOptions {
  limits: VoucherLimits;
  checkoutHoldMinutes: number;
  refundPolicy: { windowHours: number; outsideWindow: 'REVIEW' | 'BLOCK' };
  payableRule: { accrualPoint: string };
}
interface BranchOption {
  id: string;
  nameEn: string;
  nameAr: string;
  status: string;
  city: string;
}

const STEPS = ['offer', 'content', 'validity', 'branches', 'rules', 'review'] as const;
const MAX_IMAGE_MB = 5;
const MIN_W = 400;
const MIN_H = 250;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const KINDS = ['PUBLIC', 'GEOGRAPHY', 'EMPLOYER', 'BANK_CARD', 'SCHEME'] as const;

export function VoucherBuilder({ voucherId }: { voucherId?: string }) {
  return (
    <RequirePermission any={['merchant.vouchers.manage']}>
      <BuilderInner voucherId={voucherId} />
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
  disabled,
}: {
  id: string;
  label: string;
  value: { en: string; ar: string };
  onChange: (v: { en: string; ar: string }) => void;
  max: number;
  multiline?: boolean;
  hasError: (lang: 'EN' | 'AR') => boolean;
  disabled?: boolean;
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
                disabled={disabled}
                dir={lang === 'ar' ? 'rtl' : 'ltr'}
                lang={lang}
                invalid={bad}
                onChange={(e) => onChange({ ...value, [lang]: e.target.value })}
                {...(multiline ? { rows: 4 } : {})}
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

function BuilderInner({ voucherId }: { voucherId?: string }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call, upload } = useApi();
  const orgId = useOrgId();

  const [id, setId] = useState<string | undefined>(voucherId);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState<VoucherView | null>(null);
  const [content, setContent] = useState<VoucherContent>(emptyVoucherContent());
  const [options, setOptions] = useState<Options | null>(null);
  const [vopts, setVopts] = useState<VoucherOptions | null>(null);
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
  const [preview, setPreview] = useState<VoucherDetail | null>(null);
  const [previewLang, setPreviewLang] = useState<Locale>(locale);
  const [previewKind, setPreviewKind] = useState<'card' | 'detail'>('card');
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [result, setResult] = useState<null | { outcome: string; id: string }>(null);
  const [noSaleEnd, setNoSaleEnd] = useState(true);
  const [faceText, setFaceText] = useState('');
  const [priceText, setPriceText] = useState('');
  const contentRef = useRef(content);
  contentRef.current = content;

  const status = view?.status ?? 'DRAFT';
  const live = !!view && !['DRAFT', 'NEEDS_CHANGES'].includes(status);
  const editableLive = ['SCHEDULED', 'ON_SALE', 'PAUSED', 'SOLD_OUT'].includes(status);
  const limits = vopts?.limits ?? DEFAULT_VOUCHER_LIMITS;

  const issues = useMemo(
    () => voucherIssues(content, { now: new Date(), limits }),
    [content, limits],
  );
  const translation = useMemo(() => voucherTranslationStatus(content), [content]);
  const savings = voucherSavings(content.faceValueHalalas, content.sellingPriceHalalas);

  const applyView = useCallback((v: VoucherView) => {
    setView(v);
    const c = clone(v.content);
    setContent(c);
    setNoSaleEnd(!c.saleEndAt);
    setFaceText(halalasToInput(c.faceValueHalalas));
    setPriceText(halalasToInput(c.sellingPriceHalalas));
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
        call<VoucherOptions>('GET', `/v1/merchants/${orgId}/voucher-options`),
        call<BranchOption[]>('GET', `/v1/merchants/${orgId}/branches`),
        voucherId
          ? call<VoucherView>('GET', `/v1/merchants/${orgId}/vouchers/${voucherId}`)
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
      setVopts(h.data);
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
  }, [call, orgId, voucherId, locale, applyView]);

  const refreshPreview = useCallback(
    async (target: string) => {
      if (!orgId) return;
      const r = await call<VoucherDetail>(
        'GET',
        `/v1/merchants/${orgId}/vouchers/${target}/preview`,
      );
      if (r.ok && r.data) setPreview(r.data);
    },
    [call, orgId],
  );
  useEffect(() => {
    if (id && !loading) void refreshPreview(id);
  }, [id, loading, refreshPreview]);

  const edit = (patch: Partial<VoucherContent>) => {
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
      if (noSaleEnd) body = { ...body, saleEndAt: null };
      setSaving(true);
      const res = !id
        ? await call<VoucherView>('POST', `/v1/merchants/${orgId}/vouchers`, {
            body: { content: body },
            idempotent: true,
          })
        : await call<{ voucher: VoucherView; outcome: string }>(
            'PUT',
            `/v1/merchants/${orgId}/vouchers/${id}`,
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
      const v = id ? (res.data as { voucher: VoucherView }).voucher : (res.data as VoucherView);
      const outcome = id ? (res.data as { outcome: string }).outcome : 'SAVED';
      setView(v);
      setDirty(false);
      setSavedAt(new Date());
      setBanner(null);
      if (!id) {
        setId(v.id);
        window.history.replaceState(null, '', withLocale(`/vouchers/${v.id}/edit`, locale));
      }
      if (outcome === 'APPLIED_MINOR') setBanner({ tone: 'success', text: t('mv.minorApplied') });
      void refreshPreview(v.id);
      return { ok: true, id: v.id, outcome };
    },
    [orgId, id, view?.version, call, locale, t, noSaleEnd, refreshPreview],
  );

  // autosave drafts every 30 s (live vouchers are saved on purpose, never silently)
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

  const stepIssues = (i: number) => issues.filter((x) => stepOfVoucherField(x.field) === i);
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
    const s = await call<{ voucher: VoucherView; outcome: string }>(
      'POST',
      `/v1/merchants/${orgId}/vouchers/${r.id}/submit`,
      { body: {} },
    );
    if (!s.ok || !s.data) {
      setBanner({ tone: 'danger', text: errorMessage(locale, s.errors) });
      return;
    }
    setView(s.data.voucher);
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
        ? t('mv.published')
        : result.outcome === 'SCHEDULED'
          ? t('mv.scheduled')
          : result.outcome === 'MINOR'
            ? t('mv.minorApplied')
            : t('mv.sentForReview');
    return (
      <Card>
        <div className="dd-stack" data-testid="builder-result">
          <h1 className="dd-title-xl">{title}</h1>
          {result.outcome === 'SENT_FOR_REVIEW' ? <p>{t('mv.reviewBody')}</p> : null}
          <div>
            <Link
              className="dd-btn dd-btn--primary"
              href={withLocale(`/vouchers/${result.id}`, locale)}
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
          href={withLocale(`/vouchers/${view.id}`, locale)}
        >
          {t('review.goToDeal')}
        </Link>
      </div>
    );
  if (
    view &&
    !['DRAFT', 'NEEDS_CHANGES', 'SCHEDULED', 'ON_SALE', 'PAUSED', 'SOLD_OUT'].includes(status)
  )
    return (
      <EmptyState
        title={t('error.EDIT_LOCKED')}
        action={
          <Link
            className="dd-btn dd-btn--secondary"
            href={withLocale(`/vouchers/${view.id}`, locale)}
          >
            {t('review.goToDeal')}
          </Link>
        }
      />
    );

  const steps: StepItem[] = STEPS.map((s, i) => ({
    id: s,
    label: t(`mv.step.${s}` as DictionaryKey),
    hint: undefined,
    state: stepState(i),
  }));
  const cats = options?.categories ?? [];
  const nm = (x: { nameEn: string; nameAr: string }) =>
    locale === 'ar' ? x.nameAr || x.nameEn : x.nameEn || x.nameAr;
  const msg = (field: string) => serverErrors[`content.${field}`];
  const err = (field: string) => {
    const i = showErrors ? issues.find((x) => x.field === field) : undefined;
    return i ? t(`issue.${i.code}` as DictionaryKey) : undefined;
  };
  const hasReq = (field: string) => (lang: 'EN' | 'AR') =>
    showErrors && issues.some((i) => i.field === field && i.code === `REQUIRED_${lang}`);
  const lockedNote = live ? <span className="dd-help">{t('mv.lockedField')}</span> : null;
  const fieldLabel = (f: string) => {
    const k = `issue.field.${f}` as DictionaryKey;
    const v = t(k);
    return v === k ? f : v;
  };

  // ---------------------------------------------------------------- steps
  const offer = (
    <div className="dd-stack" style={{ gap: 16 }}>
      <Field
        label={`${t('mhb.category')} *`}
        htmlFor="f-categoryId"
        error={err('categoryId') ?? msg('categoryId')}
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
      <div className="dd-grid dd-grid--2">
        <Field
          label={`${t('mv.face')} *`}
          htmlFor="f-face"
          help={t('mv.faceHelp')}
          error={err('faceValueHalalas') ?? msg('faceValueHalalas')}
        >
          <Input
            id="f-face"
            type="number"
            inputMode="decimal"
            min={1}
            step="0.01"
            dir="ltr"
            value={faceText}
            disabled={live}
            onChange={(e) => {
              setFaceText(e.target.value);
              edit({ faceValueHalalas: inputToHalalas(e.target.value) });
            }}
          />
        </Field>
        <Field
          label={`${t('mv.price')} *`}
          htmlFor="f-price"
          help={t('mv.priceHelp')}
          error={err('sellingPriceHalalas') ?? msg('sellingPriceHalalas')}
        >
          <Input
            id="f-price"
            type="number"
            inputMode="decimal"
            min={1}
            step="0.01"
            dir="ltr"
            value={priceText}
            disabled={live}
            onChange={(e) => {
              setPriceText(e.target.value);
              edit({ sellingPriceHalalas: inputToHalalas(e.target.value) });
            }}
          />
        </Field>
      </div>
      {savings.savingsHalalas > 0 ? (
        <Alert tone="info" title={t('mv.customerSaves')}>
          <span className="dd-ltr" data-testid="builder-savings">
            {formatMoney(locale, savings.savingsHalalas)} ({savings.savingsPercent}%)
          </span>{' '}
          <span className="dd-caption">{t('vch.savingsNote')}</span>
        </Alert>
      ) : null}
      <div className="dd-grid dd-grid--2">
        <Field
          label={`${t('mv.qty')} *`}
          htmlFor="f-qty"
          help={t('mv.qtyHelp')}
          error={err('totalQty') ?? msg('totalQty')}
        >
          <Input
            id="f-qty"
            type="number"
            min={1}
            max={limits.maxQtyPerVoucher}
            dir="ltr"
            value={content.totalQty || ''}
            disabled={live}
            onChange={(e) =>
              edit({ totalQty: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
            }
          />
        </Field>
        <Field
          label={`${t('mv.perCustomer')} *`}
          htmlFor="f-per"
          error={err('perCustomerLimit') ?? msg('perCustomerLimit')}
        >
          <Input
            id="f-per"
            type="number"
            min={1}
            max={limits.maxPerCustomer}
            dir="ltr"
            value={content.perCustomerLimit}
            disabled={live}
            onChange={(e) => edit({ perCustomerLimit: Math.max(1, Number(e.target.value) || 1) })}
          />
        </Field>
      </div>
      {lockedNote}
    </div>
  );

  const contentStep = (
    <div className="dd-stack" style={{ gap: 16 }}>
      <p className="dd-help">{t('mhb.langHint')}</p>
      <Bi
        id="f-title"
        label={t('mv.title2')}
        value={content.title}
        max={80}
        onChange={(v) => edit({ title: v })}
        hasError={hasReq('title')}
      />
      <Bi
        id="f-short"
        label={t('mv.short')}
        value={content.shortDescription}
        max={140}
        onChange={(v) => edit({ shortDescription: v })}
        hasError={hasReq('shortDescription')}
      />
      <Bi
        id="f-desc"
        label={t('mv.long')}
        value={content.description}
        max={1500}
        multiline
        onChange={(v) => edit({ description: v })}
        hasError={hasReq('description')}
      />
      <Bi
        id="f-rules"
        label={t('mv.rules')}
        value={content.redemptionRules}
        max={500}
        multiline
        onChange={(v) => edit({ redemptionRules: v })}
        hasError={hasReq('redemptionRules')}
      />
      <div className="dd-stack" style={{ gap: 12 }}>
        <div>
          <strong>{t('mv.photos')}</strong>
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
              {(['en', 'ar'] as const).map((lang) => (
                <Field
                  key={lang}
                  label={`${t('field.altText')} (${t(lang === 'en' ? 'builder.langEn' : 'builder.langAr')})`}
                  htmlFor={`alt-${lang}-${i}`}
                >
                  <Input
                    id={`alt-${lang}-${i}`}
                    dir={lang === 'ar' ? 'rtl' : 'ltr'}
                    lang={lang}
                    value={lang === 'en' ? m.altEn : m.altAr}
                    maxLength={200}
                    onChange={(e) =>
                      edit({
                        media: content.media.map((x, j) =>
                          j === i
                            ? { ...x, [lang === 'en' ? 'altEn' : 'altAr']: e.target.value }
                            : x,
                        ),
                      })
                    }
                  />
                </Field>
              ))}
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
          id="voucher-image"
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
        {err('media') ? (
          <span className="dd-error" role="alert">
            {err('media')}
          </span>
        ) : null}
      </div>
    </div>
  );

  const v = content.validity;
  const validityStep = (
    <div className="dd-stack" style={{ gap: 16 }}>
      {live ? <Alert tone="info">{t('mv.liveEditNote')}</Alert> : null}
      <fieldset className="dd-stack" style={{ border: 0, padding: 0, margin: 0 }} disabled={live}>
        <legend className="dd-label">{t('mv.validityType')} *</legend>
        {(['DAYS_FROM_PURCHASE', 'FIXED_DATE'] as const).map((k) => (
          <label key={k} className="dd-checkbox">
            <input
              type="radio"
              name="validity"
              checked={v.type === k}
              onChange={() =>
                edit({
                  validity: {
                    type: k,
                    days: k === 'DAYS_FROM_PURCHASE' ? 30 : null,
                    validUntil: null,
                  },
                })
              }
            />
            <span>{t(`validity.${k}` as DictionaryKey)}</span>
          </label>
        ))}
        {v.type === 'DAYS_FROM_PURCHASE' ? (
          <Field
            label={`${t('mv.validityDays')} *`}
            htmlFor="f-vdays"
            help={`${limits.minValidityDays}–${limits.maxValidityDays}`}
            error={err('validity.days') ?? msg('validity.days')}
          >
            <Input
              id="f-vdays"
              type="number"
              min={limits.minValidityDays}
              max={limits.maxValidityDays}
              dir="ltr"
              value={v.days ?? ''}
              onChange={(e) =>
                edit({
                  validity: { ...v, days: e.target.value === '' ? null : Number(e.target.value) },
                })
              }
              style={{ maxInlineSize: 160 }}
            />
          </Field>
        ) : (
          <Field
            label={`${t('mv.validityUntil')} *`}
            htmlFor="f-vuntil"
            error={err('validity.validUntil') ?? msg('validity.validUntil')}
          >
            <Input
              id="f-vuntil"
              type="datetime-local"
              dir="ltr"
              value={toRiyadhInput(v.validUntil)}
              onChange={(e) =>
                edit({ validity: { ...v, validUntil: fromRiyadhInput(e.target.value) } })
              }
            />
          </Field>
        )}
      </fieldset>
      <p className="dd-help">{t('mv.saleHelp')}</p>
      <div className="dd-grid dd-grid--2">
        <Field
          label={`${t('mv.saleStart')} (${t('field.riyadhTime')})`}
          htmlFor="f-sstart"
          error={err('saleStartAt') ?? msg('saleStartAt')}
        >
          <Input
            id="f-sstart"
            type="datetime-local"
            dir="ltr"
            value={toRiyadhInput(content.saleStartAt)}
            disabled={live}
            onChange={(e) => edit({ saleStartAt: fromRiyadhInput(e.target.value) })}
          />
        </Field>
        <div className="dd-stack">
          <Field
            label={`${t('mv.saleEnd')} (${t('field.riyadhTime')})`}
            htmlFor="f-send"
            error={err('saleEndAt') ?? msg('saleEndAt')}
          >
            <Input
              id="f-send"
              type="datetime-local"
              dir="ltr"
              value={noSaleEnd ? '' : toRiyadhInput(content.saleEndAt)}
              disabled={noSaleEnd || live}
              onChange={(e) => edit({ saleEndAt: fromRiyadhInput(e.target.value) })}
            />
          </Field>
          {!live ? (
            <Checkbox
              label={t('mv.noEnd')}
              checked={noSaleEnd}
              onChange={(e) => {
                setNoSaleEnd(e.target.checked);
                edit({ saleEndAt: e.target.checked ? null : content.saleEndAt });
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );

  const toggleBranch = (bid: string) =>
    edit({
      branchIds: content.branchIds.includes(bid)
        ? content.branchIds.filter((x) => x !== bid)
        : [...content.branchIds, bid],
    });
  const branchStep = (
    <div className="dd-stack" style={{ gap: 12 }}>
      <p className="dd-help">{t('mv.branchesHelp')}</p>
      {live ? <Alert tone="info">{t('mv.liveEditNote')}</Alert> : null}
      {branches.map((b) => (
        <div key={b.id} className="dd-staffrow" data-testid="voucher-branch-row">
          <Checkbox
            label={nm(b)}
            checked={content.branchIds.includes(b.id)}
            disabled={live}
            onChange={() => toggleBranch(b.id)}
          />
        </div>
      ))}
      {err('branchIds') ? (
        <span className="dd-error" role="alert">
          {err('branchIds')}
        </span>
      ) : null}
      {msg('branchIds') ? (
        <span className="dd-error" role="alert">
          {msg('branchIds')}
        </span>
      ) : null}
    </div>
  );

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
        <legend className="dd-label">{t('mv.eligibility')}</legend>
        {KINDS.map((k) => (
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
        {(err('eligibility') ?? msg('eligibility')) ? (
          <span className="dd-error" role="alert">
            {err('eligibility') ?? msg('eligibility')}
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
  const material = view && live ? voucherMaterialChanges(view.content, content) : [];
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
                  onClick={() => go(stepOfVoucherField(i.field))}
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
        <Alert tone="info" title={t('mv.liveEditNote')}>
          {material.length ? <div>{material.map((f) => fieldLabel(f)).join(', ')}</div> : null}
        </Alert>
      ) : g ? (
        <Alert tone={g.outcome === 'AUTO_PUBLISH' ? 'success' : 'warning'}>
          {g.outcome === 'AUTO_PUBLISH' ? t('mv.guardrail.auto') : t('mv.guardrail.manual')}
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
            <dt>{t('mv.title2')}</dt>
            <dd>{content.title[locale] || content.title.en || '-'}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('mv.summary.pricing')}</dt>
            <dd className="dd-ltr">
              {formatMoney(locale, content.faceValueHalalas)} /{' '}
              {formatMoney(locale, content.sellingPriceHalalas)}
            </dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('mv.qty')}</dt>
            <dd className="dd-ltr">{content.totalQty}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('mv.summary.validity')}</dt>
            <dd>
              {v.type === 'DAYS_FROM_PURCHASE'
                ? t('vch.validDays', { n: v.days ?? 0 })
                : v.validUntil
                  ? t('vch.validUntil', { date: toRiyadhInput(v.validUntil).slice(0, 10) })
                  : '-'}
            </dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('mv.summary.branches')}</dt>
            <dd>
              {content.branchIds
                .map((bid) => branches.find((x) => x.id === bid))
                .filter(Boolean)
                .map((b) => nm(b!))
                .join(', ') || '-'}
            </dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('mv.eligibility')}</dt>
            <dd>{t(`elig.${content.eligibility.kind}` as DictionaryKey)}</dd>
          </div>
        </dl>
      </Card>
      {vopts ? (
        <>
          <Alert tone="info">
            {t('mv.refundPolicy', { hours: vopts.refundPolicy.windowHours })}
          </Alert>
          <Alert tone="info">{t('mv.payableRule')}</Alert>
        </>
      ) : null}
      {!live ? <CommercialInputsEditor value={content.commercial} onChange={(commercial) => edit({ commercial })} product="VOUCHER" /> : null}
      {orgId ? (
        <CommercialPanel
          orgId={orgId}
          product="VOUCHER"
          subjectId={id ?? null}
          content={content}
          dirty={dirty}
          onReady={setCmReady}
          refreshKey={view?.version}
        />
      ) : null}
    </div>
  );

  const body = [offer, contentStep, validityStep, branchStep, rulesStep, reviewStep][
    step
  ] as ReactNode;
  const last = step === STEPS.length - 1;

  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="voucher-builder">
      <div className="dd-builder__bar">
        <div className="dd-row">
          <Link className="dd-link" href={withLocale(id ? `/vouchers/${id}` : '/vouchers', locale)}>
            ← {t('mdeal.back')}
          </Link>
          <h1 className="dd-title">{id ? t('mv.editTitle') : t('mv.newTitle')}</h1>
          <VoucherStatusChip status={status} />
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
                          timeZone: 'Asia/Riyadh',
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
      {editableLive && !banner ? <Alert tone="info">{t('mv.liveEditNote')}</Alert> : null}

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
              <h2 className="dd-title">{t(`mv.step.${STEPS[step]}` as DictionaryKey)}</h2>
              <p className="dd-muted" style={{ margin: 0 }}>
                {t(`mv.stepHelp.${STEPS[step]}` as DictionaryKey)}
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
                  data-testid="voucher-save"
                >
                  {live ? t('builder.saveChanges') : t('mhb.save')}
                </Button>
                {last ? (
                  <Button
                    onClick={() => void submit()}
                    loading={saving}
                    disabled={!live && !cmReady}
                    data-testid="voucher-submit"
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
                  data-testid="voucher-preview"
                >
                  {previewKind === 'card' ? (
                    <VoucherCardView voucher={preview} locale={previewLang} variant="list" />
                  ) : (
                    <VoucherDetailView detail={preview} locale={previewLang} embedded />
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
