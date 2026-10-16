'use client';

import { useEffect, useState } from 'react';
import { useApi, useAuth } from '@dealdash/app-shell';
import { createTranslator, formatMoney, type DictionaryKey } from '@dealdash/localization';
import { COMMITMENT_METHODS, type CommitmentMethod } from '@dealdash/types';
import { Alert, Checkbox, Field, Input } from '@dealdash/ui';
import type { CommitmentPolicy, HotDealContent, HotDealIssue } from '@dealdash/validation';

/** The effective reservation policy for this deal (GET hot-deal-reservation-policy): limits set by DealDash, never edited here. */
export interface MerchantResPolicy {
  market: string;
  marketStatus: string | null;
  currency: string | null;
  currencyDecimals: number;
  freeAllowed: boolean;
  fields: {
    allowedMethods: string[];
    depositMinMinor: number;
    depositMaxMinor: number;
    nonRefundableDepositAllowed: boolean;
    preauthMaxMinor: number;
    cutoffMinMinutes: number;
    cutoffMaxMinutes: number;
    paymentWindowMinutes: number;
    prepaymentRefundMinPercent: number;
    prepaymentRefundMaxPercent: number;
    prepaymentRefundDefaultPercent: number;
    commissionBps: number;
    additionalRedemptionFee: boolean;
    preauthImmediateCapture: boolean;
    preauthPartialCaptureAllowed: boolean;
    preauthOnRedemption: 'RELEASE' | 'CAPTURE';
  };
  problems: string[];
}

/** The shape the shared commitment check takes (RC-04 / RC-05 / RC-20). */
export const commitmentPolicyOf = (p: MerchantResPolicy): CommitmentPolicy => ({
  ...p.fields,
  freeAllowed: p.freeAllowed,
});

/** Loads the effective policy for the deal's category and first branch (it changes when either changes). */
export function useReservationPolicy(
  orgId: string | null | undefined,
  categoryId: string | null,
  branchId: string | null,
) {
  const { call } = useApi();
  const [policy, setPolicy] = useState<MerchantResPolicy | null>(null);
  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    void call<MerchantResPolicy>('GET', `/v1/merchants/${orgId}/hot-deal-reservation-policy`, {
      query: { categoryId: categoryId ?? undefined, branchId: branchId ?? undefined },
    }).then((r) => {
      if (alive && r.ok && r.data) setPolicy(r.data);
    });
    return () => {
      alive = false;
    };
  }, [call, orgId, categoryId, branchId]);
  return policy;
}

const pow = (d: number) => 10 ** Math.max(0, Math.min(4, d));
const toMajor = (minor: number | null, d: number) => (minor === null ? '' : String(minor / pow(d)));
const toMinor = (s: string, d: number) => (s.trim() === '' ? null : Math.round(Number(s) * pow(d)));

/**
 * Reservation commitment (phase 4, RC-20): the method customers commit with, its amount, the deposit refund choice, the free
 * cancellation cut-off and the late-cancellation / not-completed share. Every value is limited by the policy DealDash sets for
 * the merchant's market, category and business; the server re-checks all of it on save and on submit.
 */
export function CommitmentEditor({
  content,
  edit,
  policy,
  disabled,
  issues,
  showErrors,
  serverError,
}: {
  content: HotDealContent;
  edit: (patch: Partial<HotDealContent>) => void;
  policy: MerchantResPolicy | null;
  disabled?: boolean;
  issues: HotDealIssue[];
  showErrors: boolean;
  serverError: (field: string) => string | undefined;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const [depositBy, setDepositBy] = useState<'fixed' | 'percent'>('fixed');
  const [refPrice, setRefPrice] = useState('');
  const [depositPct, setDepositPct] = useState('');
  const c = content.commitment;
  const method: CommitmentMethod | null = c.method;
  const d = policy?.currencyDecimals ?? 2;
  const ccy = policy?.currency ?? null;
  const money = (minor: number) => formatMoney(locale, minor, ccy);
  const set = (patch: Partial<HotDealContent['commitment']>) =>
    edit({ commitment: { ...c, ...patch } });
  const err = (f: string) => {
    const field = `commitment.${f}`;
    const i = showErrors ? issues.find((x) => x.field === field) : undefined;
    return i
      ? t(`issue.${i.code}` as DictionaryKey)
      : (serverError(`content.${field}`) ?? undefined);
  };
  const methodErr =
    err('method') ??
    (showErrors && issues.some((x) => x.field === 'commitment')
      ? t('issue.METHOD_REQUIRED')
      : undefined);

  if (!policy) return null;
  const allowed = COMMITMENT_METHODS.filter((m) =>
    m === 'FREE'
      ? policy.freeAllowed || method === 'FREE'
      : policy.fields.allowedMethods.includes(m),
  );
  const f = policy.fields;

  const choose = (m: CommitmentMethod) =>
    set({
      method: m,
      // values that do not apply to the new method are cleared (the server keeps none of them either)
      amountMinor: m === 'FREE' ? null : c.amountMinor,
      depositRefundable: m === 'DEPOSIT' ? (c.depositRefundable ?? true) : null,
      depositLateRefund: m === 'DEPOSIT' ? (c.depositLateRefund ?? false) : null,
      depositCredited: m === 'DEPOSIT' ? (c.depositCredited ?? true) : null,
      cancelCutoffMinutes: m === 'FREE' ? null : (c.cancelCutoffMinutes ?? f.cutoffMinMinutes),
      noShowRefundPercent:
        m === 'FULL_PREPAYMENT' || m === 'CARD_PREAUTH' ? c.noShowRefundPercent : null,
    });

  const amountHelp =
    method === 'DEPOSIT'
      ? t('mrsv.rangeAmount', { min: money(f.depositMinMinor), max: money(f.depositMaxMinor) })
      : method === 'CARD_PREAUTH'
        ? t('mrsv.maxAmount', { max: money(f.preauthMaxMinor) })
        : undefined;

  const applyPercent = (price: string, pctS: string) => {
    const p = toMinor(price, d);
    const pc = Number(pctS);
    if (p !== null && pctS.trim() !== '' && pc >= 0 && pc <= 100)
      set({ amountMinor: Math.round((p * pc) / 100) });
  };

  return (
    <section className="dd-stack" style={{ gap: 14 }} data-testid="commitment-editor">
      <div>
        <h3 className="dd-title-sm" style={{ margin: 0 }}>
          {t('mrsv.title')}
        </h3>
        <p className="dd-help" style={{ margin: 0 }}>
          {t('mrsv.help')}
        </p>
      </div>
      <fieldset
        className="dd-stack"
        style={{ border: 0, padding: 0, margin: 0 }}
        disabled={disabled}
      >
        <legend className="dd-label">{t('mrsv.method')} *</legend>
        <div className="dd-limitcards">
          {allowed.map((m) => (
            <button
              key={m}
              type="button"
              className="dd-limitcard"
              aria-pressed={method === m}
              onClick={() => choose(m)}
              data-testid={`commitment-${m}`}
            >
              <strong>{t(`mrsv.method.${m}` as DictionaryKey)}</strong>
              <span className="dd-caption">{t(`mrsv.methodHelp.${m}` as DictionaryKey)}</span>
            </button>
          ))}
        </div>
        {methodErr ? (
          <span className="dd-error" role="alert">
            {methodErr}
          </span>
        ) : null}
      </fieldset>

      {method && method !== 'FREE' ? (
        <>
          {method === 'DEPOSIT' ? (
            <fieldset
              className="dd-stack"
              style={{ border: 0, padding: 0, margin: 0 }}
              disabled={disabled}
            >
              <legend className="dd-label">{t('mrsv.depositBy')}</legend>
              <div className="dd-row" style={{ gap: 16, flexWrap: 'wrap' }}>
                {(['fixed', 'percent'] as const).map((k) => (
                  <label key={k} className="dd-row" style={{ gap: 6 }}>
                    <input
                      type="radio"
                      name="deposit-by"
                      checked={depositBy === k}
                      onChange={() => setDepositBy(k)}
                    />
                    {k === 'fixed' ? t('mrsv.depositFixed') : t('mrsv.depositPercent')}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {method === 'DEPOSIT' && depositBy === 'percent' ? (
            <div className="dd-grid dd-grid--2">
              <Field
                label={`${t('mrsv.depositPrice')}${ccy ? ` (${ccy})` : ''}`}
                htmlFor="f-dep-price"
              >
                <Input
                  id="f-dep-price"
                  type="number"
                  min={0}
                  step="any"
                  dir="ltr"
                  value={refPrice}
                  disabled={disabled}
                  onChange={(e) => {
                    setRefPrice(e.target.value);
                    applyPercent(e.target.value, depositPct);
                  }}
                  style={{ maxInlineSize: 200 }}
                />
              </Field>
              <Field
                label={t('mrsv.depositPct')}
                htmlFor="f-dep-pct"
                help={
                  c.amountMinor !== null
                    ? t('mrsv.depositResult', { amount: money(c.amountMinor) })
                    : amountHelp
                }
                error={err('amountMinor')}
              >
                <Input
                  id="f-dep-pct"
                  type="number"
                  min={0}
                  max={100}
                  dir="ltr"
                  value={depositPct}
                  disabled={disabled}
                  onChange={(e) => {
                    setDepositPct(e.target.value);
                    applyPercent(refPrice, e.target.value);
                  }}
                  style={{ maxInlineSize: 140 }}
                />
              </Field>
            </div>
          ) : (
            <Field
              label={`${t(`mrsv.amount.${method}` as DictionaryKey)} *${ccy ? ` (${ccy})` : ''}`}
              htmlFor="f-commitment-amount"
              help={amountHelp}
              error={err('amountMinor')}
            >
              <Input
                id="f-commitment-amount"
                type="number"
                min={0}
                step="any"
                dir="ltr"
                value={toMajor(c.amountMinor, d)}
                disabled={disabled}
                onChange={(e) => set({ amountMinor: toMinor(e.target.value, d) })}
                style={{ maxInlineSize: 200 }}
              />
            </Field>
          )}

          {method === 'DEPOSIT' ? (
            // deposit treatment (founder UAT 2026-10-16): refundable on any cancellation, only before the cut-off, or (where the
            // policy permits) non-refundable; and whether it is credited toward the final bill or is a booking fee
            <fieldset
              className="dd-stack"
              style={{ border: 0, padding: 0, margin: 0, gap: 6 }}
              disabled={disabled}
              data-testid="deposit-terms"
            >
              <legend className="dd-label">{t('mrsv.depositRefund')}</legend>
              {(
                [
                  'ANY',
                  'BEFORE_CUTOFF',
                  ...(f.nonRefundableDepositAllowed ? (['NEVER'] as const) : []),
                ] as const
              ).map((mode) => {
                const current =
                  c.depositRefundable === false
                    ? 'NEVER'
                    : c.depositLateRefund
                      ? 'ANY'
                      : 'BEFORE_CUTOFF';
                return (
                  <label key={mode} className="dd-row" style={{ gap: 8, alignItems: 'flex-start' }}>
                    <input
                      type="radio"
                      name="deposit-refund"
                      checked={current === mode}
                      onChange={() =>
                        set({
                          depositRefundable: mode !== 'NEVER',
                          depositLateRefund: mode === 'ANY',
                        })
                      }
                      data-testid={`deposit-refund-${mode}`}
                    />
                    <span>{t(`mrsv.depositRefund.${mode}` as DictionaryKey)}</span>
                  </label>
                );
              })}
              {c.depositRefundable === false ? (
                <span className="dd-help">{t('mrsv.nonRefundableNote')}</span>
              ) : null}
              {err('depositRefundable') ? (
                <span className="dd-error" role="alert">
                  {err('depositRefundable')}
                </span>
              ) : null}
              <Checkbox
                label={t('mrsv.depositCredited')}
                checked={c.depositCredited !== false}
                disabled={disabled}
                onChange={(e) => set({ depositCredited: e.target.checked })}
                data-testid="deposit-credited"
              />
              <span className="dd-help">{t('mrsv.depositCreditedHelp')}</span>
            </fieldset>
          ) : null}

          <div className="dd-grid dd-grid--2">
            <Field
              label={`${t('mrsv.cutoff')} *`}
              htmlFor="f-commitment-cutoff"
              help={t('mrsv.cutoffHelp', { min: f.cutoffMinMinutes, max: f.cutoffMaxMinutes })}
              error={err('cancelCutoffMinutes')}
            >
              <Input
                id="f-commitment-cutoff"
                type="number"
                min={f.cutoffMinMinutes}
                max={f.cutoffMaxMinutes}
                dir="ltr"
                value={c.cancelCutoffMinutes ?? ''}
                disabled={disabled}
                onChange={(e) =>
                  set({
                    cancelCutoffMinutes: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
                style={{ maxInlineSize: 160 }}
              />
            </Field>
            {method === 'FULL_PREPAYMENT' ? (
              <Field
                label={t('mrsv.refundPct')}
                htmlFor="f-commitment-refund"
                help={t('mrsv.refundPctHelp', {
                  min: f.prepaymentRefundMinPercent,
                  max: f.prepaymentRefundMaxPercent,
                  def: f.prepaymentRefundDefaultPercent,
                })}
                error={err('noShowRefundPercent')}
              >
                <Input
                  id="f-commitment-refund"
                  type="number"
                  min={f.prepaymentRefundMinPercent}
                  max={f.prepaymentRefundMaxPercent}
                  dir="ltr"
                  value={c.noShowRefundPercent ?? ''}
                  placeholder={String(f.prepaymentRefundDefaultPercent)}
                  disabled={disabled}
                  onChange={(e) =>
                    set({
                      noShowRefundPercent: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                  style={{ maxInlineSize: 140 }}
                />
              </Field>
            ) : method === 'CARD_PREAUTH' ? (
              <Field
                label={t('mrsv.releasePct')}
                htmlFor="f-commitment-release"
                help={t('mrsv.releasePctHelp')}
                error={err('noShowRefundPercent')}
              >
                <Input
                  id="f-commitment-release"
                  type="number"
                  min={0}
                  max={100}
                  dir="ltr"
                  value={c.noShowRefundPercent ?? ''}
                  placeholder="0"
                  disabled={disabled}
                  onChange={(e) =>
                    set({
                      noShowRefundPercent: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                  style={{ maxInlineSize: 140 }}
                />
              </Field>
            ) : (
              <span className="dd-help">{t('mrsv.depositLate')}</span>
            )}
          </div>

          {method === 'CARD_PREAUTH' ? (
            <span className="dd-help">
              {t(`mrsv.onRedemption.${f.preauthOnRedemption}` as DictionaryKey)}
            </span>
          ) : null}
          <Alert tone="info">
            <span>
              {t('mrsv.limitsFrom')} {t('mrsv.commission', { pct: f.commissionBps / 100 })}
              {f.additionalRedemptionFee ? ` ${t('mrsv.extraFee')}` : ''}
            </span>
          </Alert>
        </>
      ) : null}
    </section>
  );
}
