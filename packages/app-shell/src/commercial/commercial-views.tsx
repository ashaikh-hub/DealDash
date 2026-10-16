'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createTranslator,
  formatMoney,
  formatNumber,
  type DictionaryKey,
  type Locale,
} from '@dealdash/localization';
import type { AcceptanceCheck, CommercialProduct } from '@dealdash/types';
import { Alert, Button, Card, Checkbox, Field, Input, StatusChip } from '@dealdash/ui';
import type {
  ActivationBlocker,
  CommercialCaseView,
  CommercialInput,
  CommercialPreview,
} from '@dealdash/validation';
import { useApi } from '../api';
import { errorMessage } from '../gates';
import { useAuth } from '../auth-context';

/** Halalas <-> SAR text for the money inputs (the API only ever sees integer halalas). */
const toHalalas = (v: string): number | null => {
  const n = Number(v.replace(',', '.'));
  return v.trim() === '' || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 100);
};
const fromHalalas = (h: number | null) => (h === null || h === undefined ? '' : String(h / 100));

/** SAR text box that keeps what the user typed (so "30." is not rewritten to "30") and reports integer halalas. */
function MoneyInput({
  id,
  value,
  onChange,
  nullable,
  disabled,
}: {
  id: string;
  value: number | null;
  onChange: (halalas: number | null) => void;
  nullable?: boolean;
  disabled?: boolean;
}) {
  const [text, setText] = useState(fromHalalas(value));
  useEffect(() => {
    // only follow the outside value when it really differs from what the text means
    if ((toHalalas(text) ?? (nullable ? null : 0)) !== value) setText(fromHalalas(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      id={id}
      inputMode="decimal"
      disabled={disabled}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const h = toHalalas(e.target.value);
        onChange(nullable ? h : (h ?? 0));
      }}
    />
  );
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  PRICING_DRAFT: 'neutral',
  AWAITING_ACCEPTANCE: 'warning',
  ACCEPTED: 'info',
  AWAITING_FUNDING: 'warning',
  PARTIALLY_FUNDED: 'warning',
  FULLY_FUNDED: 'success',
  CREDIT_APPROVED: 'success',
  FINANCIAL_HOLD: 'danger',
  RECONCILED: 'success',
  CLOSED: 'neutral',
};
export const commercialTone = (s: string) => STATUS_TONE[s] ?? 'neutral';

interface EditorProps {
  value: CommercialInput;
  onChange: (next: CommercialInput) => void;
  product: CommercialProduct;
  disabled?: boolean;
}

/**
 * The commercial inputs a business states for a campaign: who else funds it, what the customer saves, how many redemptions it can
 * generate. Charges are NEVER entered here: they come from the DealDash pricing agreement and are shown in the summary.
 */
export function CommercialInputsEditor({ value, onChange, product, disabled }: EditorProps) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const set = (patch: Partial<CommercialInput>) => onChange({ ...value, ...patch });
  const exclusive = product === 'EXCLUSIVE';
  return (
    <Card flat>
      <div className="dd-stack" data-testid="cm-inputs" style={{ gap: 12 }}>
        <div>
          <h2 className="dd-title">{t('cm.inputs.title')}</h2>
          <p className="dd-muted" style={{ margin: 0 }}>
            {t('cm.inputs.help')}
          </p>
        </div>
        {exclusive ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
            }}
          >
            <Field label={t('cm.inputs.normalPrice')} htmlFor="cm-normal">
              <MoneyInput
                id="cm-normal"
                nullable
                disabled={disabled}
                value={value.normalPriceHalalas}
                onChange={(h) => set({ normalPriceHalalas: h })}
              />
            </Field>
            <Field label={t('cm.inputs.dealPrice')} htmlFor="cm-deal">
              <MoneyInput
                id="cm-deal"
                nullable
                disabled={disabled}
                value={value.dealPriceHalalas}
                onChange={(h) => set({ dealPriceHalalas: h })}
              />
            </Field>
            <Field
              label={t('cm.inputs.benefitValue')}
              htmlFor="cm-benefit"
              help={t('cm.inputs.benefitHelp')}
            >
              <MoneyInput
                id="cm-benefit"
                nullable
                disabled={disabled}
                value={value.benefitValueHalalas}
                onChange={(h) => set({ benefitValueHalalas: h })}
              />
            </Field>
            <Field
              label={t('cm.inputs.maxRedemptions')}
              htmlFor="cm-max"
              help={t('cm.inputs.maxHelp')}
            >
              <Input
                id="cm-max"
                inputMode="numeric"
                disabled={disabled}
                value={value.maxRedemptions ?? ''}
                onChange={(e) =>
                  set({
                    maxRedemptions:
                      e.target.value === '' ? null : Math.max(1, Number(e.target.value) || 1),
                  })
                }
              />
            </Field>
          </div>
        ) : null}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12,
          }}
        >
          <Field
            label={t('cm.inputs.merchantCash')}
            htmlFor="cm-mcash"
            help={t('cm.inputs.merchantCashHelp')}
          >
            <MoneyInput
              id="cm-mcash"
              disabled={disabled}
              value={value.merchantCashPerUnitHalalas}
              onChange={(h) => set({ merchantCashPerUnitHalalas: h ?? 0 })}
            />
          </Field>
          <Field
            label={t('cm.inputs.fulfilment')}
            htmlFor="cm-fulfil"
            help={t('cm.inputs.fulfilmentHelp')}
          >
            <Input
              id="cm-fulfil"
              disabled={disabled}
              dir="ltr"
              value={value.fulfilmentOrganizationId ?? ''}
              onChange={(e) => set({ fulfilmentOrganizationId: e.target.value.trim() || null })}
            />
          </Field>
        </div>
        <div className="dd-stack" style={{ gap: 8 }}>
          <strong>{t('cm.inputs.sponsors')}</strong>
          <p className="dd-muted" style={{ margin: 0 }}>
            {t('cm.inputs.sponsorsHelp')}
          </p>
          {value.sponsors.map((s, i) => (
            <div className="dd-row" key={i} style={{ alignItems: 'flex-end' }}>
              <Field label={t('cm.inputs.sponsorOrg')} htmlFor={`cm-sp-org-${i}`}>
                <Input
                  id={`cm-sp-org-${i}`}
                  dir="ltr"
                  disabled={disabled}
                  value={s.organizationId}
                  onChange={(e) =>
                    set({
                      sponsors: value.sponsors.map((x, j) =>
                        j === i ? { ...x, organizationId: e.target.value.trim() } : x,
                      ),
                    })
                  }
                />
              </Field>
              <Field label={t('cm.inputs.sponsorPerUnit')} htmlFor={`cm-sp-amt-${i}`}>
                <MoneyInput
                  id={`cm-sp-amt-${i}`}
                  disabled={disabled}
                  value={s.perUnitHalalas}
                  onChange={(h) =>
                    set({
                      sponsors: value.sponsors.map((x, j) =>
                        j === i ? { ...x, perUnitHalalas: h ?? 0 } : x,
                      ),
                    })
                  }
                />
              </Field>
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() => set({ sponsors: value.sponsors.filter((_, j) => j !== i) })}
              >
                {t('cm.inputs.remove')}
              </Button>
            </div>
          ))}
          {value.sponsors.length < 5 ? (
            <div>
              <Button
                variant="outline"
                disabled={disabled}
                data-testid="cm-add-sponsor"
                onClick={() =>
                  set({
                    sponsors: [
                      ...value.sponsors,
                      { organizationId: '', perUnitHalalas: 0, trigger: 'VERIFIED_REDEMPTION' },
                    ],
                  })
                }
              >
                {t('cm.inputs.addSponsor')}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

const key = (prefix: string, v: string) => `${prefix}.${v}` as DictionaryKey;

/** Money cell: amounts are always integer halalas, shown as SAR with two decimals. */
function Money({ locale, v, testid }: { locale: Locale; v: number; testid?: string }) {
  return (
    <span className="dd-ltr" data-testid={testid}>
      {formatMoney(locale, v)}
    </span>
  );
}

interface SummaryProps {
  preview: CommercialPreview;
  locale: Locale;
  /** Amendment figures when a live campaign is being changed. */
  delta?: Record<string, { original: number; additional: number; revised: number }> | null;
}

/** The commercial summary: what is charged, who funds what, the maximum liability and the merchant's non-cash benefit. */
export function CommercialSummary({ preview, locale, delta }: SummaryProps) {
  const t = createTranslator(locale);
  const { totals, lines } = preview;
  const nm = (l: { label: { en: string; ar: string } }) => l.label[locale];
  const group = (kind: string) =>
    lines.filter((l) => l.kind === kind && (l.amountHalalas > 0 || l.kind === 'TAX'));
  const section = (kind: string, titleKey: DictionaryKey) => {
    const rows = group(kind);
    if (!rows.length) return null;
    return (
      <div key={kind} data-testid={`cm-line-${kind}`}>
        <strong>{t(titleKey)}</strong>
        <dl className="dd-kv" style={{ marginBlockStart: 4 }}>
          {rows.map((l, i) => (
            <div className="dd-kv__row" key={`${l.code}-${i}`}>
              <dt>
                {nm(l)}
                {l.trigger ? (
                  <span className="dd-muted"> · {t(key('cm.trigger', l.trigger))}</span>
                ) : null}
                {l.collection === 'NETTED' ? (
                  <span className="dd-muted"> · {t('cm.netted')}</span>
                ) : null}
              </dt>
              <dd>
                <Money locale={locale} v={l.amountHalalas} />
              </dd>
            </div>
          ))}
        </dl>
      </div>
    );
  };
  const row = (k: DictionaryKey, v: number, testid: string, emphasise = false) => (
    <div className="dd-kv__row" key={testid}>
      <dt style={emphasise ? { fontWeight: 700 } : undefined}>{t(k)}</dt>
      <dd style={emphasise ? { fontWeight: 700 } : undefined}>
        <Money locale={locale} v={v} testid={testid} />
      </dd>
    </div>
  );
  return (
    <div className="dd-stack" style={{ gap: 12 }} data-testid="cm-summary">
      {totals.issues.length ? (
        <div data-testid="cm-issues">
          <Alert tone="danger" title={t('cm.unbounded')}>
            {[...new Set(totals.issues.map((i) => (i.startsWith('UNBOUNDED') ? 'UNBOUNDED' : i)))]
              .map((i) => t(key('cm.issue', i)))
              .join(' · ')}
          </Alert>
        </div>
      ) : null}
      {section('DEALDASH_CHARGE', 'cm.sec.charges')}
      {totals.taxStatus === 'NOT_CONFIGURED' ? (
        <p className="dd-muted" style={{ margin: 0 }} data-testid="cm-tax-note">
          {t('cm.taxNotConfigured')}
        </p>
      ) : null}
      {group('TAX').length && totals.taxStatus === 'APPLIED' ? section('TAX', 'cm.sec.tax') : null}
      {section('SPONSOR_FUNDING', 'cm.sec.sponsors')}
      {section('MERCHANT_CASH_CONTRIBUTION', 'cm.sec.merchantCash')}
      {section('MERCHANT_BENEFIT', 'cm.sec.merchantBenefit')}
      {section('CUSTOMER_FUNDING', 'cm.sec.customer')}
      <dl className="dd-kv">
        {/* a count of units, not money (Stage 7 QA found it formatted as currency) */}
        <div className="dd-kv__row" key="cm-total-units">
          <dt>{t('cm.total.units')}</dt>
          <dd data-testid="cm-total-units">{formatNumber(locale, totals.maxUnits)}</dd>
        </div>
        {row('cm.total.cash', totals.maxCashPayableToDealDashHalalas, 'cm-total-cash', true)}
        {totals.nettedChargesHalalas > 0
          ? row('cm.total.netted', totals.nettedChargesHalalas, 'cm-total-netted')
          : null}
        {totals.maxSponsorLiabilityHalalas > 0
          ? row('cm.total.sponsor', totals.maxSponsorLiabilityHalalas, 'cm-total-sponsor', true)
          : null}
        {totals.merchantCashContributionHalalas > 0
          ? row('cm.total.merchantCash', totals.merchantCashContributionHalalas, 'cm-total-mcash')
          : null}
        {row(
          'cm.total.benefit',
          totals.maxMerchantBenefitCommitmentHalalas,
          'cm-total-benefit',
          true,
        )}
      </dl>
      <p className="dd-muted" style={{ margin: 0 }}>
        {t('cm.nonCashNote')}
      </p>
      {delta ? (
        <Alert tone="warning" title={t('cm.amendment.title')}>
          <dl className="dd-kv" data-testid="cm-delta">
            {(
              [
                ['maxCashPayableToDealDash', 'cm.total.cash'],
                ['maxSponsorLiability', 'cm.total.sponsor'],
                ['maxMerchantBenefitCommitment', 'cm.total.benefit'],
              ] as const
            ).map(([k, label]) =>
              delta[k] ? (
                <div className="dd-kv__row" key={k}>
                  <dt>{t(label)}</dt>
                  <dd>
                    <Money locale={locale} v={delta[k].original} /> →{' '}
                    <Money locale={locale} v={delta[k].revised} />{' '}
                    <span className="dd-muted">
                      (+
                      <Money locale={locale} v={delta[k].additional} />)
                    </span>
                  </dd>
                </div>
              ) : null,
            )}
          </dl>
        </Alert>
      ) : null}
      <p className="dd-muted" style={{ margin: 0 }}>
        {preview.pricing.source === 'AGREEMENT'
          ? t('cm.pricingAgreement', { ref: preview.pricing.reference ?? '' })
          : t('cm.pricingDefault')}
      </p>
    </div>
  );
}

const blockerText = (t: ReturnType<typeof createTranslator>, b: ActivationBlocker) =>
  t(key('cm.blocker', b.code));

interface PanelProps {
  orgId: string;
  product: CommercialProduct;
  /** The saved campaign. Null until the draft has been saved once. */
  subjectId: string | null;
  /** The builder's current content: used for the live preview before the draft is saved. */
  content: unknown;
  /** True while the builder holds unsaved changes (the stored terms may be out of date). */
  dirty?: boolean;
  /** Tells the builder whether the owner has accepted the current terms (the Submit button waits for it). */
  onReady?: (ready: boolean) => void;
  /** Refresh trigger: change it after saving. */
  refreshKey?: string | number;
  /** Stage 7: the commercial routes of the business (default: the merchant's own). The partner portal passes its own. */
  base?: string;
  /** Extra fields of the preview request (the partner portal sends the fulfilment merchant). */
  previewExtra?: Record<string, unknown>;
}

/**
 * Commercial summary, explicit acknowledgement and funding for one campaign. The server decides everything (economics, who must
 * accept, which acknowledgements, what blocks activation): this component only shows it and sends the user's decisions.
 */
export function CommercialPanel({
  orgId,
  product,
  subjectId,
  content,
  dirty,
  onReady,
  refreshKey,
  base: baseProp,
  previewExtra,
}: PanelProps) {
  const base = baseProp ?? `/v1/merchants/${orgId}/commercial`;
  const { locale, me } = useAuth();
  const { call } = useApi();
  const t = createTranslator(locale);
  const perms = me?.permissions ?? [];
  const [view, setView] = useState<CommercialCaseView | null>(null);
  const [preview, setPreview] = useState<CommercialPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState<AcceptanceCheck[]>([]);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);

  // answers that arrive after the panel has gone (page left, test torn down) are dropped
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    if (subjectId && !dirty) {
      const r = await call<CommercialCaseView>('GET', `${base}/case`, {
        query: { product, subjectId },
      });
      if (!mounted.current) return;
      if (r.ok && r.data) {
        setView(r.data);
        setPreview(r.data.preview);
        setLoading(false);
        return;
      }
    }
    const p = await call<CommercialPreview>('POST', `${base}/preview`, {
      body: { product, content, ...(previewExtra ?? {}) },
    });
    if (!mounted.current) return;
    setView(null);
    setPreview(p.ok ? p.data : null);
    setLoading(false);
  }, [call, base, previewExtra, product, subjectId, dirty, content]);

  // Refresh whenever the saved campaign changes (not on every keystroke: unsaved edits are previewed on save).
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, product, subjectId, dirty, refreshKey]);

  const ownerAccepted = Boolean(view && view.quotation && view.submitBlockers.length === 0);
  useEffect(() => {
    onReady?.(ownerAccepted && !dirty);
  }, [ownerAccepted, dirty, onReady]);

  const myParty = useMemo(
    () => view?.preview?.parties.find((p) => p.organizationId === orgId) ?? null,
    [view, orgId],
  );
  const canAccept = Boolean(
    view?.allowedActions.includes('ACCEPT') &&
    (perms.includes('merchant.commercial.accept') || perms.includes('partner.commercial.accept')),
  );
  const required = myParty?.requiredChecks ?? [];
  const allChecked = required.length > 0 && required.every((c) => checks.includes(c));

  const accept = async () => {
    if (!view || !view.quotation) return;
    setBusy(true);
    const r = await call('POST', `${base}/cases/${view.id}/accept`, {
      body: { quotationId: view.quotation.id, checks, language: locale },
      idempotent: true,
    });
    setBusy(false);
    if (!r.ok) return setBanner({ tone: 'danger', text: errorMessage(locale, r.errors) });
    setBanner({ tone: 'success', text: t('cm.accepted') });
    setChecks([]);
    await load();
  };
  const pay = async () => {
    if (!view) return;
    setBusy(true);
    const r = await call<{ paidHalalas: number }>('POST', `${base}/cases/${view.id}/pay`, {
      body: {},
      idempotent: true,
    });
    setBusy(false);
    if (!r.ok) return setBanner({ tone: 'danger', text: errorMessage(locale, r.errors) });
    setBanner({
      tone: 'success',
      text: t('cm.paid', { amount: formatMoney(locale, r.data?.paidHalalas ?? 0) }),
    });
    await load();
  };

  if (loading && !preview) return <p className="dd-muted">{t('state.loading')}</p>;
  if (!preview)
    return (
      <div data-testid="cm-unavailable">
        <Alert tone="info">{t('cm.unavailable')}</Alert>
      </div>
    );

  const mine = view?.acceptances.find(
    (a) => a.organizationId === orgId && a.quotationId === view.quotation?.id,
  );
  const delta = (view?.quotation?.delta ?? null) as SummaryProps['delta'];
  const myFunding = view?.funding.filter((f) => f.organizationId === orgId) ?? [];
  const owing = myFunding.some((f) => f.mode === 'PREPAID' && f.outstandingHalalas > 0);
  return (
    <Card flat>
      <div className="dd-stack" style={{ gap: 14 }} data-testid="cm-panel">
        <div className="dd-row" style={{ justifyContent: 'space-between' }}>
          <h2 className="dd-title">{t('cm.title')}</h2>
          {view ? (
            <StatusChip tone={commercialTone(view.status)}>
              <span data-testid="cm-status">{t(key('cm.status', view.status))}</span>
            </StatusChip>
          ) : null}
        </div>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('cm.intro')}
        </p>
        {banner ? (
          <div data-testid="cm-banner">
            <Alert tone={banner.tone}>{banner.text}</Alert>
          </div>
        ) : null}
        {dirty && subjectId ? <Alert tone="warning">{t('cm.saveToRefresh')}</Alert> : null}
        {!subjectId ? <Alert tone="info">{t('cm.saveFirst')}</Alert> : null}
        <CommercialSummary preview={preview} locale={locale} delta={delta} />

        {view ? (
          <>
            <div className="dd-stack" style={{ gap: 6 }}>
              <strong>{t('cm.parties')}</strong>
              <ul className="dd-list" style={{ margin: 0, paddingInlineStart: 18 }}>
                {view.preview?.parties.map((p) => {
                  const a = view.acceptances.find(
                    (x) =>
                      x.organizationId === p.organizationId &&
                      x.role === p.role &&
                      x.quotationId === view.quotation?.id,
                  );
                  return (
                    <li key={`${p.role}-${p.organizationId}`} data-testid={`cm-party-${p.role}`}>
                      {t(key('cm.role', p.role))}:{' '}
                      {a ? (
                        <>
                          <StatusChip tone="success">{t('cm.party.accepted')}</StatusChip>{' '}
                          <span className="dd-muted dd-ltr">{a.reference}</span>
                          {a.onBehalf ? (
                            <span className="dd-muted"> · {t('cm.onBehalf')}</span>
                          ) : null}
                        </>
                      ) : (
                        <StatusChip tone="warning">{t('cm.party.pending')}</StatusChip>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            {canAccept && !dirty ? (
              <div className="dd-stack" style={{ gap: 8 }} data-testid="cm-accept-form">
                <strong>{t('cm.ack.title')}</strong>
                {required.map((c) => (
                  <Checkbox
                    key={c}
                    data-testid={`cm-check-${c}`}
                    checked={checks.includes(c)}
                    onChange={(e) =>
                      setChecks((cur) =>
                        e.target.checked ? [...cur, c] : cur.filter((x) => x !== c),
                      )
                    }
                    label={t(key('cm.check', c))}
                  />
                ))}
                <div>
                  <Button
                    disabled={!allChecked}
                    loading={busy}
                    onClick={() => void accept()}
                    data-testid="cm-accept"
                  >
                    {t('cm.accept')}
                  </Button>
                </div>
              </div>
            ) : null}
            {mine ? (
              <div data-testid="cm-accepted-ref">
                <Alert tone="success">
                  {t('cm.acceptedBy', { ref: mine.reference, who: mine.userName ?? '' })}
                </Alert>
              </div>
            ) : null}

            {view.funding.length ? (
              <div className="dd-stack" style={{ gap: 6 }} data-testid="cm-funding">
                <strong>{t('cm.funding.title')}</strong>
                <div style={{ overflowX: 'auto' }}>
                  <table className="dd-table">
                    <thead>
                      <tr>
                        <th>{t('cm.funding.party')}</th>
                        <th>{t('cm.funding.mode')}</th>
                        <th>{t('cm.funding.max')}</th>
                        <th>{t('cm.funding.received')}</th>
                        <th>{t('cm.funding.used')}</th>
                        <th>{t('cm.funding.outstanding')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.funding.map((f) => (
                        <tr key={f.id}>
                          <td>{t(key('cm.role', f.role))}</td>
                          <td>{t(key('cm.mode', f.mode))}</td>
                          <td>
                            <Money locale={locale} v={f.maxHalalas} />
                          </td>
                          <td>
                            <Money locale={locale} v={f.receivedHalalas} />
                          </td>
                          <td>
                            <Money locale={locale} v={f.earnedHalalas} />
                          </td>
                          <td>
                            <Money locale={locale} v={f.outstandingHalalas} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {owing && view.allowedActions.includes('PAY') ? (
                  <div>
                    <Button loading={busy} onClick={() => void pay()} data-testid="cm-pay">
                      {t('cm.pay')}
                    </Button>
                    <p className="dd-muted" style={{ marginBlockStart: 4 }}>
                      {t('cm.payMock')}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {view.approvals.length ? (
              <div className="dd-stack" style={{ gap: 6 }} data-testid="cm-approvals">
                <strong>{t('cm.approvals')}</strong>
                <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                  {view.approvals.map((a) => (
                    <li key={a.step}>
                      {t(key('cm.step', a.step))}:{' '}
                      <StatusChip
                        tone={
                          a.status === 'APPROVED'
                            ? 'success'
                            : a.status === 'REJECTED'
                              ? 'danger'
                              : 'warning'
                        }
                      >
                        {t(key('cm.approval', a.status))}
                      </StatusChip>
                      {view.allowedActions.includes(
                        a.step === 'INTERNAL_APPROVER' ? 'APPROVE_INTERNAL' : 'APPROVE_FINANCE',
                      ) && a.status === 'PENDING' ? (
                        <ApprovalButtons
                          base={base}
                          caseId={view.id}
                          quotationId={view.quotation!.id}
                          step={a.step}
                          onDone={load}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {view.blockers.length ? (
              <div data-testid="cm-blockers">
                <strong>{t('cm.blockers.title')}</strong>
                <ul style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>
                  {view.blockers.map((b, i) => (
                    <li key={`${b.code}-${i}`} data-testid={`cm-blocker-${b.code}`}>
                      {blockerText(t, b)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : view.quotation ? (
              <div data-testid="cm-clear">
                <Alert tone="success">{t('cm.clear')}</Alert>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Card>
  );
}

function ApprovalButtons({
  base,
  caseId,
  quotationId,
  step,
  onDone,
}: {
  base: string;
  caseId: string;
  quotationId: string;
  step: string;
  onDone: () => Promise<void>;
}) {
  const { locale } = useAuth();
  const { call } = useApi();
  const t = createTranslator(locale);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const decide = async (decision: 'APPROVED' | 'REJECTED') => {
    setBusy(true);
    const r = await call('POST', `${base}/cases/${caseId}/approvals/${step}`, {
      body: {
        quotationId,
        decision,
        reason: decision === 'REJECTED' ? t('cm.rejectedReason') : undefined,
      },
      idempotent: true,
    });
    setBusy(false);
    if (!r.ok) return setErr(errorMessage(locale, r.errors));
    await onDone();
  };
  return (
    <span className="dd-row" style={{ display: 'inline-flex', marginInlineStart: 8 }}>
      <Button
        variant="secondary"
        loading={busy}
        onClick={() => void decide('APPROVED')}
        data-testid={`cm-approve-${step}`}
      >
        {t('cm.approve')}
      </Button>
      <Button variant="outline" loading={busy} onClick={() => void decide('REJECTED')}>
        {t('cm.reject')}
      </Button>
      {err ? <span className="dd-error">{err}</span> : null}
    </span>
  );
}
