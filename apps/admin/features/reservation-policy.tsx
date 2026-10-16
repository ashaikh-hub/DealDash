'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { RequirePermission, useApi, useResource } from '@dealdash/app-shell';
import { formatMoney, withLocale, type DictionaryKey } from '@dealdash/localization';
import { Alert, Button, Card, Field, Input, Select, StatusChip, Tabs } from '@dealdash/ui';
import {
  OpsHeader,
  OpsStates,
  ReasonField,
  reasonOk,
  useOpsCommand,
  usePerms,
  useT,
} from './ops-kit';

/**
 * Reservation policy (phase 4; RC-04..RC-12, RC-52, RC-74, RC-96). One screen for how customers commit to reservations: the platform
 * default, market defaults, category overrides and merchant overrides of the governed `reservation.policy`, the not-completed limits
 * (`reservation.noshow`) and the finance alert threshold. Nothing changes directly: every edit is a change request with a reason that
 * a DIFFERENT person approves in Rules and controls (maker-checker), validated by the server against the policy schema.
 */
type Scope = 'baseline' | 'market' | 'category' | 'merchant';
type Fields = Record<string, unknown>;
interface PolicyConfig {
  baseline: Fields;
  market: Record<string, Fields>;
  category: Record<string, Fields>;
  merchant: Record<string, Fields>;
}
interface GovernedConfig {
  key: string;
  value: unknown;
  version: number;
}
interface ChangeRequest {
  id: string;
  key: string;
  status: string;
}
interface Overview {
  configs: GovernedConfig[];
  open: ChangeRequest[];
}
interface Effective {
  market: string;
  marketStatus: string | null;
  currency: string | null;
  currencyDecimals: number;
  freeAllowed: boolean;
  fields: Fields;
  source: Record<string, string>;
  problems: string[];
}
interface NoShow {
  threshold: number;
  windowDays: number;
  blockDays: number;
}

type Kind = 'free' | 'methods' | 'minor' | 'bool' | 'int' | 'redemption';
interface Spec {
  name: string;
  kind: Kind;
  section: 'methods' | 'amounts' | 'cancel' | 'preauth' | 'fees' | 'finance';
  min?: number;
  max?: number;
  /** Shown only for this scope (the extra redemption fee is a contracted, per-merchant exception). */
  only?: Scope;
}
const SPECS: Spec[] = [
  { name: 'freeAllowed', kind: 'free', section: 'methods' },
  { name: 'allowedMethods', kind: 'methods', section: 'methods' },
  { name: 'depositMinMinor', kind: 'minor', section: 'amounts' },
  { name: 'depositMaxMinor', kind: 'minor', section: 'amounts' },
  { name: 'nonRefundableDepositAllowed', kind: 'bool', section: 'amounts' },
  { name: 'preauthMaxMinor', kind: 'minor', section: 'amounts' },
  { name: 'cutoffMinMinutes', kind: 'int', section: 'cancel', min: 0, max: 1440 },
  { name: 'cutoffMaxMinutes', kind: 'int', section: 'cancel', min: 0, max: 1440 },
  { name: 'paymentWindowMinutes', kind: 'int', section: 'cancel', min: 1, max: 120 },
  { name: 'prepaymentRefundMinPercent', kind: 'int', section: 'cancel', min: 0, max: 100 },
  { name: 'prepaymentRefundMaxPercent', kind: 'int', section: 'cancel', min: 0, max: 100 },
  { name: 'prepaymentRefundDefaultPercent', kind: 'int', section: 'cancel', min: 0, max: 100 },
  { name: 'preauthImmediateCapture', kind: 'bool', section: 'preauth' },
  { name: 'preauthPartialCaptureAllowed', kind: 'bool', section: 'preauth' },
  { name: 'preauthOnRedemption', kind: 'redemption', section: 'preauth' },
  { name: 'commissionBps', kind: 'int', section: 'fees', min: 0, max: 10_000 },
  { name: 'additionalRedemptionFee', kind: 'bool', section: 'fees', only: 'merchant' },
  { name: 'captureFailureAlertThreshold', kind: 'int', section: 'finance', min: 1, max: 20 },
];
const SECTIONS = ['methods', 'amounts', 'cancel', 'preauth', 'fees', 'finance'] as const;
const METHODS = ['FULL_PREPAYMENT', 'DEPOSIT', 'CARD_PREAUTH'] as const;
const POLICY_KEY = 'reservation.policy';
const NOSHOW_KEY = 'reservation.noshow';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function ReservationPolicyPage() {
  return (
    <RequirePermission any={['admin.config.read']}>
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { t } = useT();
  const res = useResource<Overview>('/v1/admin/controls');
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="reservation-policy">
      <OpsHeader title={t('nav.reservationPolicy')} intro={t('apol.intro')} />
      <OpsStates res={res}>
        {(d) => {
          const policy = d.configs.find((c) => c.key === POLICY_KEY);
          const noshow = d.configs.find((c) => c.key === NOSHOW_KEY);
          const pending = d.open.some((r) => r.key === POLICY_KEY || r.key === NOSHOW_KEY);
          return (
            <>
              {pending ? (
                <Alert tone="warning">
                  <span data-testid="apol-pending">{t('apol.pending')}</span>
                </Alert>
              ) : null}
              {policy ? (
                <PolicyEditor
                  config={policy.value as PolicyConfig}
                  version={policy.version}
                  onChanged={() => void res.reload()}
                />
              ) : null}
              {noshow ? (
                <NoShowEditor
                  value={noshow.value as NoShow}
                  version={noshow.version}
                  onChanged={() => void res.reload()}
                />
              ) : null}
              <StrikeCard />
            </>
          );
        }}
      </OpsStates>
    </div>
  );
}

/** Proposes a governed change (reason + approval by someone else). */
function ProposeBar({
  cfgKey,
  section,
  value,
  baseVersion,
  onChanged,
  invalid,
}: {
  cfgKey: string;
  section: string;
  value: unknown;
  baseVersion: number;
  onChanged: () => void;
  invalid?: boolean;
}) {
  const { t } = useT();
  const perms = usePerms();
  const cmd = useOpsCommand();
  const [reason, setReason] = useState('');
  if (!perms.includes('admin.config.manage'))
    return <p className="dd-caption">{t('s8.cfg.readOnly')}</p>;
  return (
    <div className="dd-stack" style={{ gap: 8 }} data-testid={`apol-propose-${section}`}>
      {cmd.banner}
      <ReasonField id={`apol-reason-${section}`} value={reason} onChange={setReason} />
      <div>
        <Button
          disabled={invalid || !reasonOk(reason) || cmd.busy}
          onClick={() =>
            void cmd.run(
              '/v1/admin/controls/requests',
              { key: cfgKey, section, value, baseVersion, reason, effectiveFrom: null },
              t('s9.cfg.proposed'),
              () => {
                setReason('');
                onChanged();
              },
            )
          }
          data-testid={`apol-submit-${section}`}
        >
          {t('s9.cfg.propose')}
        </Button>
      </div>
      <p className="dd-caption">{t('s9.cfg.approvalNote')}</p>
    </div>
  );
}

interface Option {
  id: string;
  label: string;
}

function PolicyEditor({
  config,
  version,
  onChanged,
}: {
  config: PolicyConfig;
  version: number;
  onChanged: () => void;
}) {
  const { t, locale } = useT();
  const { call } = useApi();
  const [scope, setScope] = useState<Scope>('baseline');
  const [draft, setDraft] = useState<PolicyConfig>(() => clone(config));
  const [market, setMarket] = useState('');
  const [category, setCategory] = useState('');
  const [merchant, setMerchant] = useState('');
  const [markets, setMarkets] = useState<Array<Option & { status: string }>>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [merchantQ, setMerchantQ] = useState('');
  const [merchantHits, setMerchantHits] = useState<Option[]>([]);
  const [effective, setEffective] = useState<Effective | null>(null);

  useEffect(() => setDraft(clone(config)), [config]);
  useEffect(() => {
    void call<Array<{ code: string; nameEn: string; nameAr: string; status: string }>>(
      'GET',
      '/v1/admin/markets',
    ).then((r) => {
      const list = (r.ok ? (r.data ?? []) : []).map((m) => ({
        id: m.code,
        label: `${locale === 'ar' ? m.nameAr : m.nameEn} (${m.code})`,
        status: m.status,
      }));
      setMarkets(list);
      setMarket((cur) => cur || list[0]?.id || Object.keys(config.market)[0] || 'SA');
    });
    void call<Array<{ id: string; nameEn: string; nameAr: string }>>(
      'GET',
      '/v1/app/categories',
    ).then((r) =>
      setCategories(
        (r.ok ? (r.data ?? []) : []).map((c) => ({
          id: c.id,
          label: locale === 'ar' ? c.nameAr : c.nameEn,
        })),
      ),
    );
  }, [call, locale, config.market]);

  const searchMerchants = useCallback(async () => {
    if (merchantQ.trim().length < 2) return;
    const r = await call<
      Array<{ organizationId: string; tradeNameEn: string; tradeNameAr: string }>
    >('GET', '/v1/admin/merchants', { query: { q: merchantQ.trim(), limit: 10 } });
    setMerchantHits(
      (r.ok ? (r.data ?? []) : []).map((m) => ({
        id: m.organizationId,
        label: locale === 'ar' ? m.tradeNameAr : m.tradeNameEn,
      })),
    );
  }, [call, merchantQ, locale]);

  // the stored policy as it applies now, for the chosen market (and category / merchant)
  useEffect(() => {
    if (!market) return;
    let alive = true;
    void call<Effective>('GET', '/v1/admin/reservations/policy', {
      query: {
        market,
        categoryId: category || undefined,
        organizationId: merchant || undefined,
      },
    }).then((r) => {
      if (alive) setEffective(r.ok ? (r.data ?? null) : null);
    });
    return () => {
      alive = false;
    };
  }, [call, market, category, merchant, version]);

  const key = scope === 'market' ? market : scope === 'category' ? category : merchant;
  const layer: Fields | null =
    scope === 'baseline' ? draft.baseline : key ? (draft[scope][key] ?? {}) : null;
  const setField = (name: string, value: unknown) =>
    setDraft((d) => {
      const next = clone(d);
      if (scope === 'baseline') next.baseline[name] = value;
      else {
        const l = { ...(next[scope][key] ?? {}) };
        if (value === undefined) delete l[name];
        else l[name] = value;
        if (Object.keys(l).length) next[scope][key] = l;
        else delete next[scope][key];
      }
      return next;
    });
  const removeOverride = () =>
    setDraft((d) => {
      const next = clone(d);
      if (scope !== 'baseline') delete next[scope][key];
      return next;
    });
  const changed = useMemo(() => JSON.stringify(draft) !== JSON.stringify(config), [draft, config]);
  const decimals = effective?.currencyDecimals ?? 2;
  const ccy = effective?.currency ?? null;
  const pickerOptions =
    scope === 'market'
      ? markets.length
        ? markets
        : Object.keys(draft.market).map((c) => ({ id: c, label: c }))
      : scope === 'category'
        ? categories
        : [
            ...merchantHits,
            ...Object.keys(draft.merchant)
              .filter((id) => !merchantHits.some((h) => h.id === id))
              .map((id) => ({ id, label: id.slice(0, 8) })),
          ];
  const selectedMarket = markets.find((m) => m.id === market);

  return (
    <Card>
      <div className="dd-stack" style={{ gap: 14 }} data-testid="apol-editor">
        <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
          <Tabs
            label={t('apol.scope')}
            value={scope}
            onChange={(v) => setScope(v as Scope)}
            tabs={(['baseline', 'market', 'category', 'merchant'] as const).map((s) => ({
              id: s,
              label: t(`apol.scope.${s}` as DictionaryKey),
            }))}
          />
        </div>

        <div className="dd-grid dd-grid--2">
          <Field label={t('apol.market')} htmlFor="apol-market">
            <Select id="apol-market" value={market} onChange={(e) => setMarket(e.target.value)}>
              {(markets.length ? markets : [{ id: market, label: market }]).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          {scope === 'category' ? (
            <Field label={t('apol.category')} htmlFor="apol-category">
              <Select
                id="apol-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">{t('apol.choose')}</option>
                {pickerOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                    {draft.category[o.id] ? ' •' : ''}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {scope === 'merchant' ? (
            <div className="dd-stack" style={{ gap: 6 }}>
              <form
                className="dd-inline-fields"
                onSubmit={(e) => {
                  e.preventDefault();
                  void searchMerchants();
                }}
              >
                <Field label={t('apol.merchantSearch')} htmlFor="apol-mq">
                  <Input
                    id="apol-mq"
                    value={merchantQ}
                    onChange={(e) => setMerchantQ(e.target.value)}
                    style={{ maxInlineSize: 220 }}
                  />
                </Field>
                <Button type="submit" variant="outline" disabled={merchantQ.trim().length < 2}>
                  {t('ah.search')}
                </Button>
              </form>
              <Field label={t('apol.merchant')} htmlFor="apol-merchant">
                <Select
                  id="apol-merchant"
                  value={merchant}
                  onChange={(e) => setMerchant(e.target.value)}
                >
                  <option value="">{t('apol.choose')}</option>
                  {pickerOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                      {draft.merchant[o.id] ? ' •' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          ) : null}
        </div>

        <Alert tone="info">
          <span>
            {t('apol.freeNote')}{' '}
            {effective ? (
              <strong data-testid="apol-free-now">
                {effective.freeAllowed ? t('apol.freeAllowedNow') : t('apol.freeBlockedNow')}
                {selectedMarket ? ` · ${selectedMarket.label} · ${selectedMarket.status}` : ''}
              </strong>
            ) : null}
          </span>
        </Alert>
        {scope !== 'baseline' ? <p className="dd-caption">{t('apol.inheritHelp')}</p> : null}

        {layer ? (
          <>
            {scope !== 'baseline' && Object.keys(layer).length === 0 ? (
              <p className="dd-caption" data-testid="apol-no-override">
                {t('apol.noOverride')}
              </p>
            ) : null}
            {SECTIONS.map((sec) => {
              const specs = SPECS.filter((s) => s.section === sec && (!s.only || s.only === scope));
              if (!specs.length) return null;
              return (
                <fieldset
                  key={sec}
                  className="dd-stack"
                  style={{ border: 0, padding: 0, margin: 0, gap: 10 }}
                  data-testid={`apol-sec-${sec}`}
                >
                  <legend className="dd-title-sm">{t(`apol.sec.${sec}` as DictionaryKey)}</legend>
                  {specs.map((s) => (
                    <PolicyField
                      key={s.name}
                      spec={s}
                      value={layer[s.name]}
                      inheritable={scope !== 'baseline'}
                      effective={effective}
                      decimals={decimals}
                      currency={ccy}
                      onChange={(v) => setField(s.name, v)}
                    />
                  ))}
                  {sec === 'fees' && scope === 'merchant' ? (
                    <p className="dd-caption">{t('apol.extraFeeWarn')}</p>
                  ) : null}
                </fieldset>
              );
            })}
            {scope !== 'baseline' && Object.keys(layer).length ? (
              <div>
                <Button variant="ghost" size="sm" onClick={removeOverride}>
                  {t('apol.removeOverride')}
                </Button>
              </div>
            ) : null}
          </>
        ) : null}

        {effective ? <EffectiveTable effective={effective} locale={locale} /> : null}

        <ProposeBar
          cfgKey={POLICY_KEY}
          section={`reservation.${scope}`}
          value={draft}
          baseVersion={version}
          onChanged={onChanged}
          invalid={!changed}
        />
      </div>
    </Card>
  );
}

function PolicyField({
  spec,
  value,
  inheritable,
  effective,
  decimals,
  currency,
  onChange,
}: {
  spec: Spec;
  value: unknown;
  inheritable: boolean;
  effective: Effective | null;
  decimals: number;
  currency: string | null;
  onChange: (v: unknown) => void;
}) {
  const { t, locale } = useT();
  const id = `apol-f-${spec.name}`;
  const inherited = value === undefined;
  const label = t(`apol.f.${spec.name}` as DictionaryKey);
  const from = effective?.source[spec.name];
  const pow = 10 ** decimals;
  const help =
    inheritable && inherited && from
      ? `${t('apol.inherit')} · ${t('apol.from', { level: t(`apol.level.${from}` as DictionaryKey) })}`
      : spec.kind === 'minor' && currency
        ? t('apol.minorHelp', { currency })
        : undefined;

  const inheritToggle = inheritable ? (
    <label className="dd-row dd-caption" style={{ gap: 6 }}>
      <input
        type="checkbox"
        checked={!inherited}
        onChange={(e) =>
          onChange(
            e.target.checked ? (effective?.fields[spec.name] ?? defaultFor(spec)) : undefined,
          )
        }
        data-testid={`${id}-override`}
      />
      {t('apol.override')}
    </label>
  ) : null;

  let control: ReactNode = null;
  if (!inherited) {
    if (spec.kind === 'free')
      control = (
        <Select
          id={id}
          value={String(value)}
          onChange={(e) => onChange(e.target.value === 'null' ? null : e.target.value === 'true')}
        >
          {(['null', 'true', 'false'] as const).map((v) => (
            <option key={v} value={v}>
              {t(`apol.free.${v}` as DictionaryKey)}
            </option>
          ))}
        </Select>
      );
    else if (spec.kind === 'methods') {
      const list = (value as string[]) ?? [];
      control = (
        <div className="dd-row" style={{ gap: 14, flexWrap: 'wrap' }} id={id}>
          {METHODS.map((m) => (
            <label key={m} className="dd-row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={list.includes(m)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? METHODS.filter((x) => x === m || list.includes(x))
                      : list.filter((x) => x !== m),
                  )
                }
                data-testid={`${id}-${m}`}
              />
              {t(`mrsv.method.${m}` as DictionaryKey)}
            </label>
          ))}
        </div>
      );
    } else if (spec.kind === 'bool')
      control = (
        <Select id={id} value={String(value)} onChange={(e) => onChange(e.target.value === 'true')}>
          <option value="true">{t('apol.yes')}</option>
          <option value="false">{t('apol.no')}</option>
        </Select>
      );
    else if (spec.kind === 'redemption')
      control = (
        <Select id={id} value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {(['RELEASE', 'CAPTURE'] as const).map((v) => (
            <option key={v} value={v}>
              {t(`apol.f.preauthOnRedemption.${v}` as DictionaryKey)}
            </option>
          ))}
        </Select>
      );
    else if (spec.kind === 'minor')
      control = (
        <Input
          id={id}
          type="number"
          min={0}
          step="any"
          dir="ltr"
          value={value === null || value === undefined ? '' : Number(value) / pow}
          onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value || 0) * pow)))}
          style={{ maxInlineSize: 200 }}
        />
      );
    else
      control = (
        <Input
          id={id}
          type="number"
          min={spec.min}
          max={spec.max}
          dir="ltr"
          value={value === null || value === undefined ? '' : Number(value)}
          onChange={(e) => onChange(Math.round(Number(e.target.value || 0)))}
          style={{ maxInlineSize: 160 }}
        />
      );
  }
  const eff = effective?.fields[spec.name];
  return (
    <div className="dd-stack" style={{ gap: 4 }} data-testid={id}>
      <Field label={label} htmlFor={id} help={help}>
        {control ?? (
          <span className="dd-caption dd-ltr">
            {formatValue(spec, eff, locale, decimals, currency, t)}
          </span>
        )}
      </Field>
      {inheritToggle}
    </div>
  );
}

function defaultFor(spec: Spec): unknown {
  if (spec.kind === 'free') return null;
  if (spec.kind === 'methods') return [...METHODS];
  if (spec.kind === 'bool') return false;
  if (spec.kind === 'redemption') return 'RELEASE';
  return spec.min ?? 0;
}

function formatValue(
  spec: Spec,
  v: unknown,
  locale: ReturnType<typeof useT>['locale'],
  decimals: number,
  currency: string | null,
  t: ReturnType<typeof useT>['t'],
): string {
  if (v === undefined) return '-';
  if (spec.kind === 'free') return t(`apol.free.${String(v)}` as DictionaryKey);
  if (spec.kind === 'methods')
    return (v as string[]).map((m) => t(`mrsv.method.${m}` as DictionaryKey)).join(', ') || '-';
  if (spec.kind === 'bool') return v ? t('apol.yes') : t('apol.no');
  if (spec.kind === 'redemption')
    return t(`apol.f.preauthOnRedemption.${String(v)}` as DictionaryKey);
  if (spec.kind === 'minor')
    return currency ? formatMoney(locale, Number(v), currency) : String(Number(v) / 10 ** decimals);
  return String(v);
}

/** The policy as it applies now (stored values), field by field, with the level each value comes from. */
function EffectiveTable({
  effective,
  locale,
}: {
  effective: Effective;
  locale: ReturnType<typeof useT>['locale'];
}) {
  const { t } = useT();
  return (
    <div className="dd-stack" style={{ gap: 8 }} data-testid="apol-effective">
      <div>
        <h3 className="dd-title-sm" style={{ margin: 0 }}>
          {t('apol.effective')}
        </h3>
        <p className="dd-caption" style={{ margin: 0 }}>
          {t('apol.effectiveHelp')}
        </p>
      </div>
      {effective.problems.length ? (
        <Alert tone="danger">
          {t('apol.problems', {
            list: effective.problems.map((p) => t(`apol.f.${p}` as DictionaryKey)).join(', '),
          })}
        </Alert>
      ) : null}
      {/* a stacked list rather than a table: every value and its level stay readable at phone width */}
      <dl className="dd-stack" style={{ gap: 0, margin: 0 }}>
        {SPECS.map((s) => (
          <div
            key={s.name}
            className="dd-stack"
            style={{ gap: 4, padding: '8px 0', borderBlockEnd: '1px solid var(--dd-line)' }}
            data-testid={`apol-eff-${s.name}`}
          >
            <dt className="dd-caption">{t(`apol.f.${s.name}` as DictionaryKey)}</dt>
            <dd
              className="dd-row"
              style={{ margin: 0, gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}
            >
              <strong className="dd-ltr">
                {formatValue(
                  s,
                  effective.fields[s.name],
                  locale,
                  effective.currencyDecimals,
                  effective.currency,
                  t,
                )}
              </strong>
              <StatusChip tone={effective.source[s.name] === 'BASELINE' ? 'neutral' : 'info'}>
                {t(`apol.level.${effective.source[s.name] ?? 'BASELINE'}` as DictionaryKey)}
              </StatusChip>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** RC-52 strike values: how many not-completed reservations, over how many days, block new reservations for how long. */
function NoShowEditor({
  value,
  version,
  onChanged,
}: {
  value: NoShow;
  version: number;
  onChanged: () => void;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState<NoShow>(value);
  useEffect(() => setDraft(value), [value]);
  const limits: Record<keyof NoShow, [number, number]> = {
    threshold: [1, 20],
    windowDays: [1, 365],
    blockDays: [1, 365],
  };
  const valid = (Object.keys(limits) as Array<keyof NoShow>).every(
    (k) => Number.isInteger(draft[k]) && draft[k] >= limits[k][0] && draft[k] <= limits[k][1],
  );
  const changed = JSON.stringify(draft) !== JSON.stringify(value);
  return (
    <Card>
      <div className="dd-stack" style={{ gap: 12 }} data-testid="apol-noshow">
        <div>
          <h2 className="dd-title-sm" style={{ margin: 0 }}>
            {t('apol.noshow')}
          </h2>
          <p className="dd-caption" style={{ margin: 0 }}>
            {t('apol.noshowHelp')}
          </p>
        </div>
        <div className="dd-grid dd-grid--2">
          {(Object.keys(limits) as Array<keyof NoShow>).map((k) => (
            <Field key={k} label={t(`apol.noshow.${k}` as DictionaryKey)} htmlFor={`apol-ns-${k}`}>
              <Input
                id={`apol-ns-${k}`}
                type="number"
                min={limits[k][0]}
                max={limits[k][1]}
                dir="ltr"
                value={draft[k]}
                onChange={(e) =>
                  setDraft({ ...draft, [k]: Math.round(Number(e.target.value || 0)) })
                }
                style={{ maxInlineSize: 140 }}
              />
            </Field>
          ))}
        </div>
        <ProposeBar
          cfgKey={NOSHOW_KEY}
          section="noshow"
          value={draft}
          baseVersion={version}
          onChanged={onChanged}
          invalid={!valid || !changed}
        />
      </div>
    </Card>
  );
}

function StrikeCard() {
  const { t, locale } = useT();
  return (
    <Card>
      <div className="dd-stack" style={{ gap: 8 }} data-testid="apol-strikes">
        <h2 className="dd-title-sm" style={{ margin: 0 }}>
          {t('apol.strikes')}
        </h2>
        <p className="dd-caption" style={{ margin: 0 }}>
          {t('apol.strikesHelp')}
        </p>
        <div>
          <Link className="dd-btn dd-btn--outline" href={withLocale('/reservations', locale)}>
            {t('apol.openTools')}
          </Link>
        </div>
      </div>
    </Card>
  );
}
