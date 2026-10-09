'use client';

import { useEffect, useState } from 'react';
import { useApi, useAuth } from '@dealdash/app-shell';
import { createTranslator, formatDate } from '@dealdash/localization';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Field,
  FileField,
  Input,
  KeyValue,
  OtpInput,
  Select,
  StatusChip,
  Textarea,
} from '@dealdash/ui';
import {
  agreementAcceptSchema,
  businessDetailsSchema,
  representativeSchema,
  settlementSchema,
} from '@dealdash/validation';
import { useApplication } from './application-context';
import { BranchesManager } from './branches';
import { emptyToUndefined, useCommand, validateWith } from './forms';

const ACCEPT = 'application/pdf,image/jpeg,image/png';

function SaveRow({
  busy,
  disabled,
  onSave,
  label,
}: {
  busy: boolean;
  disabled?: boolean;
  onSave: () => void;
  label?: string;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  return (
    <div className="dd-row">
      <Button loading={busy} disabled={disabled} onClick={onSave}>
        {label ?? t('common.save')}
      </Button>
    </div>
  );
}

function Saved({ show }: { show: boolean }) {
  const { locale } = useAuth();
  return show ? <Alert tone="success">{createTranslator(locale)('common.saved')}</Alert> : null;
}

// ------------------------------------------------------------------ 1. business details
export function BusinessStep() {
  const { app, run } = useApplication();
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const cmd = useCommand();
  const b = app.business;
  const [saved, setSaved] = useState(false);
  const [f, setF] = useState({
    legalNameEn: b.legalNameEn ?? '',
    legalNameAr: b.legalNameAr ?? '',
    tradeNameEn: b.tradeNameEn ?? '',
    tradeNameAr: b.tradeNameAr ?? '',
    commercialRegistrationNumber: b.commercialRegistrationNumber ?? '',
    taxNumber: b.taxNumber ?? '',
    businessType: b.businessType ?? '',
    registeredAddress: b.registeredAddress ?? '',
    businessPhone: b.businessPhone ?? '',
    businessEmail: b.businessEmail ?? '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setSaved(false);
    setF((x) => ({ ...x, [k]: e.target.value }));
  };

  async function save() {
    const v = validateWith(
      businessDetailsSchema,
      {
        ...f,
        taxNumber: emptyToUndefined(f.taxNumber),
        businessType: emptyToUndefined(f.businessType),
        businessPhone: emptyToUndefined(f.businessPhone),
        businessEmail: emptyToUndefined(f.businessEmail),
      },
      locale,
    );
    if (!v.ok) return cmd.fail(t('form.fixErrors'), v.fields);
    const res = await cmd.exec(() => run('PUT', '/business', v.data));
    setSaved(res.ok);
  }

  const dis = !app.editable;
  const field = (
    k: keyof typeof f,
    label: string,
    opts: { rtl?: boolean; ltr?: boolean; help?: string; span?: boolean } = {},
  ) => (
    <Field label={label} htmlFor={`biz-${k}`} error={cmd.fields[k]} help={opts.help}>
      <Input
        id={`biz-${k}`}
        value={f[k]}
        onChange={set(k)}
        disabled={dis}
        invalid={!!cmd.fields[k]}
        dir={opts.rtl ? 'rtl' : opts.ltr ? 'ltr' : undefined}
      />
    </Field>
  );

  return (
    <div className="dd-stack">
      {cmd.error ? <Alert tone="danger">{cmd.error}</Alert> : null}
      <div className="dd-grid dd-grid--2">
        {field('legalNameEn', t('biz.legalNameEn'))}
        {field('legalNameAr', t('biz.legalNameAr'), { rtl: true })}
        {field('tradeNameEn', t('biz.tradeNameEn'))}
        {field('tradeNameAr', t('biz.tradeNameAr'), { rtl: true })}
        {field('commercialRegistrationNumber', t('biz.crNumber'), {
          ltr: true,
          help: t('biz.crHelp'),
        })}
        {field('taxNumber', t('biz.taxNumber'), { ltr: true })}
        {field('businessType', t('biz.businessType'))}
        {field('registeredAddress', t('biz.registeredAddress'))}
        {field('businessPhone', t('biz.phone'), { ltr: true })}
        {field('businessEmail', t('biz.email'), { ltr: true })}
      </div>
      <Saved show={saved} />
      {!dis ? <SaveRow busy={cmd.busy} onSave={() => void save()} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------ 2. category and branding
export function CategoryStep() {
  const { app, run, orgId } = useApplication();
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { upload } = useApi();
  const cmd = useCommand();
  const b = app.business;
  const [saved, setSaved] = useState(false);
  const [f, setF] = useState({
    categoryCode: b.categoryCode ?? '',
    subCategory: b.subCategory ?? '',
    descriptionEn: b.descriptionEn ?? '',
    descriptionAr: b.descriptionAr ?? '',
  });
  const [logo, setLogo] = useState<{
    id: string | null;
    name: string | null;
    preview: string | null;
  }>({ id: b.logoFileId, name: null, preview: b.logoUrl });
  const [cover, setCover] = useState<{
    id: string | null;
    name: string | null;
    preview: string | null;
  }>({ id: b.coverFileId, name: null, preview: b.coverUrl });
  const [busyKind, setBusyKind] = useState<'LOGO' | 'COVER' | null>(null);
  const dis = !app.editable;

  async function pick(kind: 'LOGO' | 'COVER', file: File) {
    cmd.clear();
    setBusyKind(kind);
    const res = await upload(orgId, kind, file);
    setBusyKind(null);
    if (!res.ok) {
      const code = res.errors[0]?.code === 'NETWORK' ? 'error.NETWORK' : 'error.FILE_INVALID';
      return cmd.fail(t(code as never));
    }
    const next = { id: res.file.fileId, name: file.name, preview: URL.createObjectURL(file) };
    (kind === 'LOGO' ? setLogo : setCover)(next);
    setSaved(false);
  }

  async function save() {
    if (!f.categoryCode) return cmd.fail(t('form.fixErrors'), { categoryCode: t('form.required') });
    if (!f.descriptionEn.trim() || !f.descriptionAr.trim())
      return cmd.fail(t('form.fixErrors'), {
        descriptionEn: f.descriptionEn.trim() ? '' : t('form.required'),
        descriptionAr: f.descriptionAr.trim() ? '' : t('form.required'),
      });
    const res = await cmd.exec(() =>
      run('PUT', '/category', {
        categoryCode: f.categoryCode,
        subCategory: emptyToUndefined(f.subCategory),
        descriptionEn: f.descriptionEn.trim(),
        descriptionAr: f.descriptionAr.trim(),
        logoFileId: logo.id,
        coverFileId: cover.id,
      }),
    );
    setSaved(res.ok);
  }

  const img = (title: string, state: typeof logo, kind: 'LOGO' | 'COVER') => (
    <Field label={title} htmlFor={`img-${kind}`} help={t('category.imageHelp')}>
      <div className="dd-stack">
        {state.preview ? (
          <img
            src={state.preview}
            alt={title}
            style={{
              maxInlineSize: kind === 'LOGO' ? 96 : 240,
              borderRadius: 12,
              border: '1px solid var(--dd-line)',
            }}
          />
        ) : null}
        <FileField
          id={`img-${kind}`}
          label={state.id ? t('files.replace') : t('files.choose')}
          accept="image/jpeg,image/png"
          onFile={(file) => void pick(kind, file)}
          busy={busyKind === kind}
          disabled={dis}
          fileName={state.name}
        />
      </div>
    </Field>
  );

  return (
    <div className="dd-stack">
      {cmd.error ? <Alert tone="danger">{cmd.error}</Alert> : null}
      <div className="dd-grid dd-grid--2">
        <Field label={t('category.category')} htmlFor="cat-code" error={cmd.fields.categoryCode}>
          <Select
            id="cat-code"
            value={f.categoryCode}
            onChange={(e) => setF({ ...f, categoryCode: e.target.value })}
            disabled={dis}
            invalid={!!cmd.fields.categoryCode}
          >
            <option value="">{t('category.choose')}</option>
            {app.categories.map((c) => (
              <option key={c.code} value={c.code}>
                {locale === 'ar' ? c.nameAr : c.nameEn}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('category.subCategory')} htmlFor="cat-sub">
          <Input
            id="cat-sub"
            value={f.subCategory}
            onChange={(e) => setF({ ...f, subCategory: e.target.value })}
            disabled={dis}
          />
        </Field>
        <Field
          label={t('category.descriptionEn')}
          htmlFor="cat-den"
          error={cmd.fields.descriptionEn}
        >
          <Textarea
            id="cat-den"
            value={f.descriptionEn}
            onChange={(e) => setF({ ...f, descriptionEn: e.target.value })}
            disabled={dis}
            invalid={!!cmd.fields.descriptionEn}
          />
        </Field>
        <Field
          label={t('category.descriptionAr')}
          htmlFor="cat-dar"
          error={cmd.fields.descriptionAr}
        >
          <Textarea
            id="cat-dar"
            dir="rtl"
            value={f.descriptionAr}
            onChange={(e) => setF({ ...f, descriptionAr: e.target.value })}
            disabled={dis}
            invalid={!!cmd.fields.descriptionAr}
          />
        </Field>
        {img(t('category.logo'), logo, 'LOGO')}
        {img(t('category.cover'), cover, 'COVER')}
      </div>
      <Saved show={saved} />
      {!dis ? <SaveRow busy={cmd.busy} onSave={() => void save()} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------ 3. authorised representative
export function RepresentativeStep() {
  const { app, run } = useApplication();
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const cmd = useCommand();
  const r = app.representative;
  const [saved, setSaved] = useState(false);
  const [f, setF] = useState({
    fullName: r?.fullName ?? '',
    role: r?.role ?? '',
    idReference: '',
    mobile: r?.mobile ?? '',
    email: r?.email ?? '',
    isSignatory: r?.isSignatory ?? true,
  });
  const dis = !app.editable;
  const set =
    (k: 'fullName' | 'role' | 'idReference' | 'mobile' | 'email') =>
    (e: { target: { value: string } }) => {
      setSaved(false);
      setF((x) => ({ ...x, [k]: e.target.value }));
    };

  async function save() {
    const v = validateWith(representativeSchema, f, locale);
    if (!v.ok) return cmd.fail(t('form.fixErrors'), v.fields);
    const res = await cmd.exec(() => run('PUT', '/representative', v.data));
    setSaved(res.ok);
    if (res.ok) setF((x) => ({ ...x, idReference: '' }));
  }

  return (
    <div className="dd-stack">
      <Alert tone="info">{t('rep.intro')}</Alert>
      {cmd.error ? <Alert tone="danger">{cmd.error}</Alert> : null}
      <div className="dd-grid dd-grid--2">
        <Field label={t('rep.fullName')} htmlFor="rep-name" error={cmd.fields.fullName}>
          <Input
            id="rep-name"
            value={f.fullName}
            onChange={set('fullName')}
            disabled={dis}
            invalid={!!cmd.fields.fullName}
          />
        </Field>
        <Field label={t('rep.role')} htmlFor="rep-role" error={cmd.fields.role}>
          <Input
            id="rep-role"
            value={f.role}
            onChange={set('role')}
            disabled={dis}
            invalid={!!cmd.fields.role}
          />
        </Field>
        <Field
          label={t('rep.idReference')}
          htmlFor="rep-id"
          error={cmd.fields.idReference}
          help={r ? t('rep.idStored', { masked: r.idReferenceMasked }) : t('rep.idHelp')}
        >
          <Input
            id="rep-id"
            dir="ltr"
            autoComplete="off"
            value={f.idReference}
            onChange={set('idReference')}
            disabled={dis}
            invalid={!!cmd.fields.idReference}
          />
        </Field>
        <Field label={t('rep.mobile')} htmlFor="rep-mobile" error={cmd.fields.mobile}>
          <Input
            id="rep-mobile"
            dir="ltr"
            inputMode="tel"
            placeholder="+966500000000"
            value={f.mobile}
            onChange={set('mobile')}
            disabled={dis}
            invalid={!!cmd.fields.mobile}
          />
        </Field>
        <Field label={t('rep.email')} htmlFor="rep-email" error={cmd.fields.email}>
          <Input
            id="rep-email"
            type="email"
            dir="ltr"
            value={f.email}
            onChange={set('email')}
            disabled={dis}
            invalid={!!cmd.fields.email}
          />
        </Field>
      </div>
      <Checkbox
        label={t('rep.isSignatory')}
        checked={f.isSignatory}
        disabled={dis}
        onChange={(e) => setF({ ...f, isSignatory: e.target.checked })}
      />
      <Saved show={saved} />
      {!dis ? <SaveRow busy={cmd.busy} onSave={() => void save()} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------ 4. branches
export function BranchesStep() {
  const { app, orgId, reload } = useApplication();
  const { me } = useAuth();
  return (
    <BranchesManager
      orgId={orgId}
      branches={app.branches}
      editable={app.editable}
      canManage={me?.permissions.includes('merchant.branch.manage') ?? false}
      onChanged={() => void reload()}
    />
  );
}

// ------------------------------------------------------------------ 5. documents
const docTone = {
  UPLOADED: 'info',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  SUPERSEDED: 'neutral',
} as const;

export function DocumentsStep() {
  const { app, orgId, run } = useApplication();
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { upload } = useApi();
  const cmd = useCommand();
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<Record<string, string>>({});
  const dis = !app.editable;

  async function onFile(code: string, expiryRequired: boolean, file: File) {
    cmd.clear();
    if (expiryRequired && !expiry[code])
      return cmd.fail(t('form.fixErrors'), { [code]: t('docs.expiryNeeded') });
    setBusyCode(code);
    const up = await upload(orgId, 'DOCUMENT', file);
    if (!up.ok) {
      setBusyCode(null);
      return cmd.fail(t('error.FILE_INVALID'));
    }
    const res = await cmd.exec(() =>
      run('POST', '/documents', {
        requirementCode: code,
        fileId: up.file.fileId,
        expiryDate: expiry[code] || undefined,
      }),
    );
    setBusyCode(null);
    if (res.ok) setExpiry((e) => ({ ...e, [code]: '' }));
  }

  return (
    <div className="dd-stack">
      <Alert tone="warning">{t('docs.placeholderNote')}</Alert>
      <p className="dd-caption">{t('docs.fileRules')}</p>
      {cmd.error ? <Alert tone="danger">{cmd.error}</Alert> : null}
      {app.requirements.map((req) => {
        const docs = app.documents.filter((d) => d.requirementCode === req.code);
        return (
          <Card key={req.code} flat>
            <div className="dd-stack">
              <div className="dd-row" style={{ justifyContent: 'space-between' }}>
                <strong>{locale === 'ar' ? req.nameAr : req.nameEn}</strong>
                <span className="dd-row">
                  <StatusChip tone={req.required ? 'warning' : 'neutral'}>
                    {req.required ? t('docs.required') : t('docs.optional')}
                  </StatusChip>
                  {req.placeholder ? (
                    <StatusChip tone="info">{t('docs.toConfirm')}</StatusChip>
                  ) : null}
                </span>
              </div>
              {docs.map((d) => (
                <div key={d.id} className="dd-row" style={{ justifyContent: 'space-between' }}>
                  <span className="dd-row">
                    <span className="dd-ltr">{d.fileName}</span>
                    <StatusChip tone={docTone[d.status]}>
                      {t(`docs.status.${d.status}` as never)}
                    </StatusChip>
                    {d.expiryDate ? (
                      <span className="dd-caption">
                        {t('docs.expires', { date: formatDate(locale, d.expiryDate) })}
                      </span>
                    ) : null}
                  </span>
                  {!dis ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void cmd.exec(() => run('DELETE', `/documents/${d.id}`))}
                    >
                      {t('common.remove')}
                    </Button>
                  ) : null}
                  {d.status === 'REJECTED' && d.reviewerNote ? (
                    <Alert tone="danger">{d.reviewerNote}</Alert>
                  ) : null}
                </div>
              ))}
              {!dis ? (
                <div className="dd-row" style={{ alignItems: 'flex-end' }}>
                  {req.expiryRequired ? (
                    <Field
                      label={t('docs.expiryDate')}
                      htmlFor={`exp-${req.code}`}
                      error={cmd.fields[req.code]}
                    >
                      <Input
                        id={`exp-${req.code}`}
                        type="date"
                        dir="ltr"
                        value={expiry[req.code] ?? ''}
                        onChange={(e) => setExpiry({ ...expiry, [req.code]: e.target.value })}
                      />
                    </Field>
                  ) : null}
                  <FileField
                    id={`doc-${req.code}`}
                    label={docs.length ? t('files.replace') : t('files.choose')}
                    accept={ACCEPT}
                    onFile={(file) => void onFile(req.code, req.expiryRequired, file)}
                    busy={busyCode === req.code}
                  />
                </div>
              ) : null}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ 6. settlement
export function SettlementStep() {
  const { app, run } = useApplication();
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const cmd = useCommand();
  const s = app.settlement;
  const [saved, setSaved] = useState(false);
  const [f, setF] = useState({
    bankName: s?.bankName ?? '',
    iban: '',
    accountHolderName: s?.accountHolderName ?? app.business.legalNameEn ?? '',
  });
  const dis = !app.editable;

  async function save() {
    const v = validateWith(settlementSchema, f, locale);
    if (!v.ok) return cmd.fail(t('form.fixErrors'), v.fields);
    const res = await cmd.exec(() => run('PUT', '/settlement', v.data));
    setSaved(res.ok);
    if (res.ok) setF((x) => ({ ...x, iban: '' }));
  }

  return (
    <div className="dd-stack">
      <Alert tone="info">{t('settle.intro')}</Alert>
      {s ? (
        <Card flat>
          <KeyValue
            items={[
              { label: t('settle.bankName'), value: s.bankName },
              { label: t('settle.iban'), value: <span className="dd-ltr">{s.ibanMasked}</span> },
              { label: t('settle.holder'), value: s.accountHolderName },
              {
                label: t('settle.status'),
                value: (
                  <StatusChip tone={s.verificationStatus === 'VERIFIED' ? 'success' : 'warning'}>
                    {s.verificationStatus === 'VERIFIED'
                      ? t('settle.verified')
                      : t('settle.unverified')}
                  </StatusChip>
                ),
              },
            ]}
          />
          {!s.nameMatches ? <Alert tone="warning">{t('settle.nameMismatch')}</Alert> : null}
        </Card>
      ) : null}
      {cmd.error ? <Alert tone="danger">{cmd.error}</Alert> : null}
      <div className="dd-grid dd-grid--2">
        <Field label={t('settle.bankName')} htmlFor="st-bank" error={cmd.fields.bankName}>
          <Input
            id="st-bank"
            value={f.bankName}
            onChange={(e) => setF({ ...f, bankName: e.target.value })}
            disabled={dis}
            invalid={!!cmd.fields.bankName}
          />
        </Field>
        <Field
          label={t('settle.holder')}
          htmlFor="st-holder"
          error={cmd.fields.accountHolderName}
          help={t('settle.holderHelp')}
        >
          <Input
            id="st-holder"
            value={f.accountHolderName}
            onChange={(e) => setF({ ...f, accountHolderName: e.target.value })}
            disabled={dis}
            invalid={!!cmd.fields.accountHolderName}
          />
        </Field>
        <Field
          label={t('settle.iban')}
          htmlFor="st-iban"
          error={cmd.fields.iban}
          help={s ? t('settle.ibanReenter') : t('settle.ibanHelp')}
        >
          <Input
            id="st-iban"
            dir="ltr"
            autoComplete="off"
            placeholder="SA00 0000 0000 0000 0000 0000"
            value={f.iban}
            onChange={(e) => setF({ ...f, iban: e.target.value })}
            disabled={dis}
            invalid={!!cmd.fields.iban}
          />
        </Field>
      </div>
      <Saved show={saved} />
      {!dis ? <SaveRow busy={cmd.busy} onSave={() => void save()} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------ 7. agreement
export function AgreementStep() {
  const { app, run } = useApplication();
  const { locale, me } = useAuth();
  const t = createTranslator(locale);
  const cmd = useCommand();
  const [sig, setSig] = useState('');
  const [agree, setAgree] = useState(false);
  const ag = app.agreement;
  const canSign = me?.permissions.includes('merchant.agreement.sign') ?? false;
  const signable =
    (app.editable || app.application.status === 'APPROVED') && app.organizationStatus === 'DRAFT';

  async function accept() {
    const v = validateWith(agreementAcceptSchema, { signatureName: sig, accept: agree }, locale);
    if (!v.ok) return cmd.fail(t('form.fixErrors'), v.fields);
    await cmd.exec(() => run('POST', '/agreement/accept', v.data));
  }

  return (
    <div className="dd-stack">
      {ag.current.placeholder ? (
        <Alert tone="warning">{t('agreement.placeholderNote')}</Alert>
      ) : null}
      <Card flat>
        <div className="dd-stack">
          <div className="dd-row" style={{ justifyContent: 'space-between' }}>
            <h3 className="dd-title">
              {locale === 'ar' ? ag.current.titleAr : ag.current.titleEn}
            </h3>
            <StatusChip tone="neutral">
              {t('agreement.version', { version: ag.current.version })}
            </StatusChip>
          </div>
          <div
            className="dd-pre"
            dir={locale === 'ar' ? 'rtl' : 'ltr'}
            tabIndex={0}
            style={{ maxBlockSize: 280, overflow: 'auto' }}
          >
            {locale === 'ar' ? ag.current.bodyAr : ag.current.bodyEn}
          </div>
        </div>
      </Card>
      {ag.acceptance ? (
        <Alert tone="success" title={t('agreement.acceptedTitle')}>
          {t('agreement.acceptedBy', {
            name: ag.acceptance.signatoryName,
            role: ag.acceptance.signatoryRole,
            date: formatDate(locale, ag.acceptance.acceptedAt),
            version: ag.acceptance.agreementVersion,
          })}
        </Alert>
      ) : !app.representative ? (
        <Alert tone="warning">{t('agreement.needRepresentative')}</Alert>
      ) : !canSign ? (
        <Alert tone="warning">{t('agreement.ownerOnly')}</Alert>
      ) : signable ? (
        <div className="dd-stack">
          {cmd.error ? <Alert tone="danger">{cmd.error}</Alert> : null}
          <p className="dd-muted">{t('agreement.signAs', { name: app.representative.fullName })}</p>
          <Field
            label={t('agreement.signatureName')}
            htmlFor="ag-sig"
            error={cmd.fields.signatureName}
          >
            <Input
              id="ag-sig"
              value={sig}
              onChange={(e) => setSig(e.target.value)}
              invalid={!!cmd.fields.signatureName}
            />
          </Field>
          <Checkbox
            label={t('agreement.accept')}
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
          />
          <div>
            <Button
              loading={cmd.busy}
              disabled={!agree || !sig.trim()}
              onClick={() => void accept()}
            >
              {t('agreement.signButton')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ 8. verify and submit
export function ReviewStep({ onJump }: { onJump: (id: string) => void }) {
  const { app, orgId, run, reload } = useApplication();
  const { locale, apiUrl, me } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const cmd = useCommand();
  const mobileCmd = useCommand();
  const isDev = process.env.NODE_ENV !== 'production';
  const [mobile, setMobile] = useState(app.contact.mobile ?? '');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [declared, setDeclared] = useState(false);
  const canSubmit = me?.permissions.includes('merchant.application.manage') ?? false;

  useEffect(() => {
    setMobile(app.contact.mobile ?? '');
  }, [app.contact.mobile]);

  async function sendMobile() {
    const res = await mobileCmd.exec(() =>
      call('POST', `/v1/merchants/${orgId}/application/mobile/request`, { body: { mobile } }),
    );
    if (!res.ok) return;
    setSent(true);
    if (isDev) {
      try {
        const r = await fetch(`${apiUrl}/v1/dev/last-sms?to=${encodeURIComponent(mobile)}`);
        const json = (await r.json()) as { data?: { code?: string | null } | null };
        setDevCode(json.data?.code ?? null);
      } catch {
        setDevCode(null);
      }
    }
  }

  async function verifyMobile(value: string) {
    const res = await mobileCmd.exec(() => run('POST', '/mobile/verify', { mobile, code: value }));
    if (res.ok) setSent(false);
  }

  async function resendEmail() {
    await call('POST', `/v1/merchants/${orgId}/application/email/resend`);
    await reload();
  }

  return (
    <div className="dd-stack">
      <Card flat>
        <div className="dd-stack">
          <h3 className="dd-title">{t('review.verification')}</h3>
          <div className="dd-row">
            <span>
              {t('review.email')}: <span className="dd-ltr">{app.contact.email}</span>
            </span>
            <StatusChip tone={app.contact.emailVerified ? 'success' : 'warning'}>
              {app.contact.emailVerified ? t('review.verified') : t('review.notVerified')}
            </StatusChip>
            {!app.contact.emailVerified ? (
              <Button size="sm" variant="outline" onClick={() => void resendEmail()}>
                {t('auth.resend')}
              </Button>
            ) : null}
          </div>
          <div className="dd-row">
            <span>{t('review.mobile')}</span>
            <StatusChip tone={app.contact.mobileVerified ? 'success' : 'warning'}>
              {app.contact.mobileVerified ? t('review.verified') : t('review.notVerified')}
            </StatusChip>
          </div>
          {!app.contact.mobileVerified && app.editable ? (
            <div className="dd-stack">
              {mobileCmd.error ? <Alert tone="danger">{mobileCmd.error}</Alert> : null}
              <div className="dd-row" style={{ alignItems: 'flex-end' }}>
                <Field label={t('rep.mobile')} htmlFor="rv-mobile">
                  <Input
                    id="rv-mobile"
                    dir="ltr"
                    inputMode="tel"
                    placeholder="+966500000000"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value.trim())}
                  />
                </Field>
                <Button
                  variant="secondary"
                  loading={mobileCmd.busy && !sent}
                  onClick={() => void sendMobile()}
                  disabled={!mobile}
                >
                  {t('auth.sendCode')}
                </Button>
              </div>
              {sent ? (
                <>
                  <OtpInput
                    value={code}
                    onChange={setCode}
                    onComplete={(v) => void verifyMobile(v)}
                    aria-label={t('auth.code')}
                    invalid={!!mobileCmd.error}
                  />
                  {isDev && devCode ? (
                    <Alert tone="info" title={t('shell.devCode')}>
                      <span className="dd-ltr">{devCode}</span>
                    </Alert>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>

      <Card flat>
        <div className="dd-stack">
          <h3 className="dd-title">{t('review.checklist')}</h3>
          <ul className="dd-stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 8 }}>
            {app.completeness.map((c) => (
              <li key={c.section}>
                <div className="dd-row">
                  <StatusChip tone={c.complete ? 'success' : 'warning'}>
                    {c.complete ? t('review.complete') : t('review.incomplete')}
                  </StatusChip>
                  <strong>{t(`section.${c.section}` as never)}</strong>
                  {!c.complete && c.section !== 'VERIFICATION' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onJump(c.section.toLowerCase())}
                    >
                      {t('review.fix')}
                    </Button>
                  ) : null}
                </div>
                {!c.complete ? (
                  <ul className="dd-caption" style={{ margin: '4px 0 0', paddingInlineStart: 20 }}>
                    {c.issues.map((i) => (
                      <li key={i}>{locale === 'en' ? i : t('review.issueGeneric')}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {app.editable ? (
        <div className="dd-stack">
          {cmd.error ? <Alert tone="danger">{cmd.error}</Alert> : null}
          <Checkbox
            label={t('review.declaration')}
            checked={declared}
            onChange={(e) => setDeclared(e.target.checked)}
          />
          {!canSubmit ? <Alert tone="warning">{t('review.ownerOnly')}</Alert> : null}
          <div>
            <Button
              loading={cmd.busy}
              disabled={!app.ready || !declared || !canSubmit}
              onClick={() => void cmd.exec(() => run('POST', '/submit', { declaration: true }))}
            >
              {app.application.status === 'CHANGES_REQUESTED'
                ? t('review.resubmit')
                : t('review.submit')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
