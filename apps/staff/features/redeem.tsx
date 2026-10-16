'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Countdown,
  Icon,
  RequirePermission,
  errorMessage,
  newIdempotencyKey,
  pickText,
  useApi,
  useAuth,
} from '@dealdash/app-shell';
import {
  createTranslator,
  formatDateTime,
  formatMoney,
  type DictionaryKey,
  type Locale,
} from '@dealdash/localization';
import type { ApiErrorItem, RedemptionResult } from '@dealdash/types';
import { Alert, BottomSheet, Button, Field, Input } from '@dealdash/ui';
import type { StaffRedeem, StaffValidation } from '@dealdash/validation';
import { CameraScanner, ScannerHint } from './scanner';

type Source = 'QR' | 'MANUAL';
type Outcome = StaffValidation | StaffRedeem;

type Phase =
  | { kind: 'scan' }
  | { kind: 'working'; label: 'checking' | 'confirming' }
  | { kind: 'valid'; res: StaffValidation; code: string; source: Source }
  | { kind: 'rejected'; res: Outcome }
  | { kind: 'done'; res: StaffRedeem }
  | { kind: 'offline'; retry: () => void }
  | { kind: 'error'; message: string };

const OK: RedemptionResult[] = ['VALID', 'REDEEMED'];
// green = success; amber = recoverable / informational restriction; red = hard failure (final Stage 4 decision)
const WARN: RedemptionResult[] = ['EXPIRED', 'NOT_VALID_YET', 'WRONG_BRANCH'];
const toneOf = (r: RedemptionResult) =>
  OK.includes(r) ? 'ok' : WARN.includes(r) ? 'warn' : 'stop';

/** Normalises what staff typed: any case or spacing; QR text passes through untouched. */
export const normaliseCode = (raw: string) => {
  const s = raw.trim();
  return s.startsWith('DD1.') || s.startsWith('DV1.')
    ? s
    : s.toUpperCase().replace(/[^A-Z0-9]/g, '');
};

export function ScanPage() {
  return (
    <RequirePermission any={['merchant.redemptions.perform']}>
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [phase, setPhase] = useState<Phase>({ kind: 'scan' });
  const [mode, setMode] = useState<'camera' | 'manual'>('camera');
  const [typed, setTyped] = useState('');
  const [cameraIssue, setCameraIssue] = useState<'denied' | 'unavailable' | null>(null);
  const [online, setOnline] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [counts, setCounts] = useState<{ redeemed: number; rejected: number } | null>(null);
  // one Idempotency-Key per redemption attempt: a retry after a bad connection reuses it, so it can never redeem twice
  const keys = useRef(new Map<string, string>());
  const busy = useRef(false);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  const refreshCounts = useCallback(async () => {
    const r = await call<{ counts: { redeemed: number; rejected: number } }>(
      'GET',
      '/v1/staff/history',
      { query: { day: 'today', limit: 1 } },
    );
    if (r.ok && r.data) setCounts(r.data.counts);
  }, [call]);
  const finished = phase.kind === 'done' || phase.kind === 'rejected';
  useEffect(() => {
    void refreshCounts();
  }, [refreshCounts, finished]);

  const fail = useCallback(
    (status: number, errors: ApiErrorItem[], retry: () => void) => {
      busy.current = false;
      if (status === 0) return setPhase({ kind: 'offline', retry });
      if (status === 429) return setPhase({ kind: 'error', message: t('st.rateLimited') });
      return setPhase({ kind: 'error', message: errorMessage(locale, errors) });
    },
    [t, locale],
  );

  const check = useCallback(
    async (raw: string, source: Source) => {
      if (busy.current) return;
      const code = normaliseCode(raw);
      if (code.length < 4) return;
      busy.current = true;
      setPhase({ kind: 'working', label: 'checking' });
      const run = async () => {
        const r = await call<StaffValidation>('POST', '/v1/staff/redemptions/validate', {
          body: { code, source },
        });
        if (!r.ok || !r.data) return fail(r.status, r.errors, () => void run());
        busy.current = false;
        navigator.vibrate?.(r.data.result === 'VALID' ? 40 : [60, 40, 60]);
        setPhase(
          r.data.result === 'VALID'
            ? { kind: 'valid', res: r.data, code, source }
            : { kind: 'rejected', res: r.data },
        );
      };
      await run();
    },
    [call, fail],
  );

  const confirm = useCallback(
    async (code: string, source: Source) => {
      if (busy.current) return;
      busy.current = true;
      setPhase({ kind: 'working', label: 'confirming' });
      const key = keys.current.get(code) ?? newIdempotencyKey();
      keys.current.set(code, key);
      const run = async () => {
        const r = await call<StaffRedeem>('POST', '/v1/staff/redemptions', {
          body: { code, source },
          idempotencyKey: key,
        });
        if (!r.ok || !r.data) return fail(r.status, r.errors, () => void run());
        busy.current = false;
        keys.current.delete(code);
        if (r.data.result === 'REDEEMED') {
          navigator.vibrate?.(80);
          setPhase({ kind: 'done', res: r.data });
        } else setPhase({ kind: 'rejected', res: r.data });
      };
      await run();
    },
    [call, fail],
  );

  const reset = () => {
    busy.current = false;
    setSheetOpen(false);
    setTyped('');
    setPhase({ kind: 'scan' });
  };

  return (
    <div className="dd-staff" data-testid="staff-scan">
      {!online ? (
        <div className="dd-offline" role="alert" data-testid="offline-banner">
          <Icon name="wifioff" size={22} />
          <div>
            <strong>{t('st.offlineTitle')}</strong>
            <div className="dd-caption">{t('st.offlineBody')}</div>
          </div>
        </div>
      ) : null}

      {phase.kind === 'scan' ? (
        <>
          <div>
            <h1 className="dd-title-xl">{t('st.scanTitle')}</h1>
            {counts ? (
              <p className="dd-caption" style={{ margin: 0 }} data-testid="today-counts">
                {t('st.today')}: {t('st.redeemedCount', { n: counts.redeemed })} ·{' '}
                {t('st.rejectedCount', { n: counts.rejected })}
              </p>
            ) : null}
          </div>
          {mode === 'camera' ? (
            <>
              <CameraScanner
                locale={locale}
                paused={false}
                onCode={(text) => void check(text, 'QR')}
                onStatus={(s) => {
                  if (s === 'denied' || s === 'unavailable') {
                    setCameraIssue(s);
                    setMode('manual');
                  }
                }}
              />
              <ScannerHint locale={locale} onManual={() => setMode('manual')} />
            </>
          ) : (
            <ManualEntry
              locale={locale}
              value={typed}
              onChange={setTyped}
              disabled={!online}
              onSubmit={() => void check(typed, 'MANUAL')}
              onCamera={() => {
                setCameraIssue(null);
                setMode('camera');
              }}
              issue={cameraIssue}
            />
          )}
          <p className="dd-caption">{t('st.privacy')}</p>
        </>
      ) : null}

      {phase.kind === 'working' ? (
        <div
          className="dd-result dd-result--warn"
          role="status"
          aria-busy="true"
          data-testid="staff-working"
        >
          <h1 className="dd-result__title">
            {phase.label === 'checking' ? t('st.checking') : t('st.confirming')}
          </h1>
        </div>
      ) : null}

      {phase.kind === 'valid' ? (
        <>
          <ResultView res={phase.res} locale={locale}>
            <Button
              className="dd-bigbtn"
              onClick={() => setSheetOpen(true)}
              disabled={!online}
              data-testid="redeem-open"
            >
              {t('st.redeem')}
            </Button>
            <Button className="dd-bigbtn" variant="outline" onClick={reset}>
              {t('st.cancelScan')}
            </Button>
          </ResultView>
          <BottomSheet
            open={sheetOpen}
            onClose={() => setSheetOpen(false)}
            title={
              phase.res.reservation?.kind === 'VOUCHER'
                ? t('st.confirmSheet.titleVoucher')
                : t('st.confirmSheet.title')
            }
            closeLabel={t('st.close')}
            testId="redeem-sheet"
            footer={
              <>
                <Button
                  className="dd-bigbtn"
                  onClick={() => {
                    if (busy.current) return; // a second tap while the request starts does nothing
                    setSheetOpen(false);
                    void confirm(phase.code, phase.source);
                  }}
                  disabled={!online}
                  data-testid="confirm-redeem"
                >
                  {t('st.confirm')}
                </Button>
                <Button className="dd-bigbtn" variant="outline" onClick={() => setSheetOpen(false)}>
                  {t('common.cancel')}
                </Button>
              </>
            }
          >
            {phase.res.reservation ? (
              <dl
                className="dd-result__facts dd-result__facts--sheet"
                data-testid="redeem-sheet-facts"
              >
                <div>
                  <dt>{t('st.offer')}</dt>
                  <dd>{pickText(phase.res.reservation.dealTitle, locale)}</dd>
                </div>
                <div>
                  <dt>{t('st.confirmSheet.benefit')}</dt>
                  <dd>{pickText(phase.res.reservation.offerLabel, locale)}</dd>
                </div>
                {phase.res.reservation.customerFirstName ? (
                  <div>
                    <dt>{t('st.customer')}</dt>
                    <dd>{phase.res.reservation.customerFirstName}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>{t('st.branch')}</dt>
                  <dd>{pickText(phase.res.reservation.branchName, locale)}</dd>
                </div>
                <div>
                  <dt>{t('res.reference')}</dt>
                  <dd className="dd-ltr">{phase.res.reservation.ref}</dd>
                </div>
              </dl>
            ) : null}
            <Alert tone="warning">
              {phase.res.reservation?.kind === 'VOUCHER'
                ? t('st.confirmSheet.warnVoucher')
                : t('st.confirmSheet.warn')}
            </Alert>
          </BottomSheet>
        </>
      ) : null}

      {phase.kind === 'rejected' ? (
        <ResultView res={phase.res} locale={locale}>
          <Button className="dd-bigbtn" onClick={reset} data-testid="scan-next">
            {t('st.scanNext')}
          </Button>
        </ResultView>
      ) : null}

      {phase.kind === 'done' ? (
        <ResultView res={phase.res} locale={locale} reference={phase.res.reference}>
          <Button className="dd-bigbtn" onClick={reset} data-testid="scan-next">
            {t('st.scanNext')}
          </Button>
        </ResultView>
      ) : null}

      {phase.kind === 'offline' ? (
        <div className="dd-result dd-result--warn" role="alert" data-testid="staff-offline">
          <span className="dd-result__icon">
            <Icon name="wifioff" size={32} />
          </span>
          <h1 className="dd-result__title">{t('st.offlineTitle')}</h1>
          <p className="dd-result__body">{t('st.offlineBody')}</p>
          <p className="dd-caption">{t('st.unsure')}</p>
          <Button
            className="dd-bigbtn"
            onClick={() => {
              busy.current = false;
              phase.retry();
            }}
            data-testid="retry"
          >
            {t('st.retry')}
          </Button>
          <Button className="dd-bigbtn" variant="outline" onClick={reset}>
            {t('st.cancelScan')}
          </Button>
        </div>
      ) : null}

      {phase.kind === 'error' ? (
        <div className="dd-result dd-result--stop" role="alert" data-testid="staff-error">
          <span className="dd-result__icon">
            <Icon name="alert" size={32} />
          </span>
          <p className="dd-result__body">{phase.message}</p>
          <Button className="dd-bigbtn" onClick={reset}>
            {t('st.scanNext')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ManualEntry({
  locale,
  value,
  onChange,
  onSubmit,
  onCamera,
  disabled,
  issue,
}: {
  locale: Locale;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCamera: () => void;
  disabled?: boolean;
  issue?: 'denied' | 'unavailable' | null;
}) {
  const t = createTranslator(locale);
  const ok = normaliseCode(value).length >= 8;
  return (
    <form
      className="dd-stack"
      style={{ gap: 14 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSubmit();
      }}
      data-testid="manual-entry"
    >
      <h1 className="dd-title-xl">{t('st.enterCode')}</h1>
      {issue ? (
        <Alert tone="warning">
          {issue === 'denied' ? t('st.cameraDenied') : t('st.cameraUnavailable')}
        </Alert>
      ) : null}
      <Field label={t('st.codeLabel')} htmlFor="manual-code" help={t('st.codeHint')}>
        <Input
          id="manual-code"
          className="dd-code-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          maxLength={14}
          autoFocus
        />
      </Field>
      <Button
        type="submit"
        className="dd-bigbtn"
        disabled={!ok || disabled}
        data-testid="check-code"
      >
        {t('st.check')}
      </Button>
      <Button type="button" variant="outline" className="dd-bigbtn" onClick={onCamera}>
        <Icon name="scan" size={18} /> {t('st.useCamera')}
      </Button>
    </form>
  );
}

/** The one adaptive result view: the same layout for every outcome, only tone, wording and facts change. */
export function ResultView({
  res,
  locale,
  children,
  reference,
}: {
  res: Outcome;
  locale: Locale;
  children?: React.ReactNode;
  reference?: string | null;
}) {
  const t = createTranslator(locale);
  const tone = toneOf(res.result);
  const r = res.reservation;
  const voucher = r?.kind === 'VOUCHER';
  const title =
    res.result === 'VALID'
      ? t('st.valid')
      : res.result === 'REDEEMED'
        ? t('st.done')
        : t(`st.result.${res.result}` as DictionaryKey);
  const body =
    res.result === 'VALID'
      ? t(voucher ? 'st.validBodyVoucher' : 'st.validBody')
      : res.result === 'REDEEMED'
        ? t(voucher ? 'st.doneVoucher' : 'st.doneBody')
        : res.result === 'WRONG_BRANCH'
          ? t('st.result.WRONG_BRANCH.body', {
              branch: r?.validBranchName ? pickText(r.validBranchName, locale) : '',
            })
          : res.result === 'INELIGIBLE'
            ? t('st.result.INELIGIBLE.body', {
                requirement: r?.requirement ? pickText(r.requirement, locale) : '',
              })
            : t(`st.result.${res.result}.body` as DictionaryKey);
  return (
    <div
      className={`dd-result dd-result--${tone}`}
      role="alert"
      data-testid="staff-result"
      data-result={res.result}
    >
      <span className="dd-result__icon">
        <Icon name={tone === 'ok' ? 'check' : tone === 'warn' ? 'clock' : 'x'} size={36} />
      </span>
      <h1 className="dd-result__title">{title}</h1>
      <p className="dd-result__body">{body}</p>
      {r ? (
        <dl className={`dd-result__facts ${voucher ? 'dd-staff-voucher' : ''}`}>
          <div>
            <dt>{voucher ? t('st.voucher') : t('st.offer')}</dt>
            <dd>{pickText(r.dealTitle, locale)}</dd>
          </div>
          {voucher && r.faceValueHalalas !== null ? (
            <div>
              <dt>{t('st.voucherValue')}</dt>
              <dd className="dd-ltr" data-testid="staff-voucher-value">
                {formatMoney(locale, r.faceValueHalalas)}
              </dd>
            </div>
          ) : (
            <div>
              <dt>{t('st.quantity')}</dt>
              <dd className="dd-ltr">{r.quantity}</dd>
            </div>
          )}
          {r.customerFirstName ? (
            <div>
              <dt>{t('st.customer')}</dt>
              <dd>{r.customerFirstName}</dd>
            </div>
          ) : null}
          <div>
            <dt>{t('st.branch')}</dt>
            <dd>{pickText(r.branchName, locale)}</dd>
          </div>
          {res.result === 'VALID' && r.expiresAt ? (
            <div>
              <dt>{t('st.expires')}</dt>
              <dd>
                <Countdown target={r.expiresAt} serverNow={res.serverNow} locale={locale} />
              </dd>
            </div>
          ) : null}
          {res.result === 'NOT_VALID_YET' && r.startsAt ? (
            <div>
              <dt>{t('st.startsAt')}</dt>
              <dd>{formatDateTime(locale, r.startsAt)}</dd>
            </div>
          ) : null}
          {res.result === 'ALREADY_REDEEMED' && r.redeemedAt ? (
            <div>
              <dt>{t('st.usedAt')}</dt>
              <dd>
                {formatDateTime(locale, r.redeemedAt)}
                {r.redeemedBranchName ? ` · ${pickText(r.redeemedBranchName, locale)}` : ''}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>{t('res.reference')}</dt>
            <dd className="dd-ltr">{reference ?? r.ref}</dd>
          </div>
        </dl>
      ) : null}
      {r?.money ? <StaffMoney money={r.money} locale={locale} /> : null}
      {children}
    </div>
  );
}

const MONEY_TONE: Record<string, string> = {
  PAID: 'success',
  AUTHORISED: 'success',
  CAPTURED: 'info',
  PENDING: 'warning',
  FAILED: 'danger',
  REFUNDED: 'neutral',
  PARTIALLY_REFUNDED: 'info',
  FORFEITED: 'neutral',
  VOIDED: 'neutral',
};

/**
 * RC-60: what the customer already paid or holds for a paid reservation: "Paid in full", "Deposit X, credit it to the bill",
 * "Card hold X", with the payment / hold status and any refund or kept amount. Read-only: staff never change financial rules.
 */
function StaffMoney({
  money,
  locale,
}: {
  money: NonNullable<NonNullable<Outcome['reservation']>['money']>;
  locale: Locale;
}) {
  const t = createTranslator(locale);
  const amount = formatMoney(locale, money.amountMinor, money.currency);
  const notPaid = money.paymentStatus === 'PENDING' || money.paymentStatus === 'FAILED';
  return (
    <div
      className="dd-staff-money"
      data-testid="staff-money"
      data-method={money.method}
      data-status={money.paymentStatus}
    >
      <div className="dd-row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <strong>
          {money.method === 'FULL_PREPAYMENT'
            ? t('srsv.FULL_PREPAYMENT')
            : t(`srsv.${money.method}` as DictionaryKey, { amount })}
        </strong>
        <span
          className={`dd-chip dd-chip--${MONEY_TONE[money.paymentStatus] ?? 'neutral'}`}
          data-testid="staff-money-status"
        >
          {money.holdStatus
            ? t(`rsv.hold.${money.holdStatus}` as DictionaryKey)
            : t(`rsv.status.${money.paymentStatus}` as DictionaryKey)}
        </span>
      </div>
      {money.method === 'FULL_PREPAYMENT' ? (
        <div className="dd-caption dd-ltr">{t('srsv.paidAmount', { amount })}</div>
      ) : null}
      {money.method === 'CARD_PREAUTH' && money.holdStatus === 'AUTHORISED' ? (
        <div className="dd-caption">{t('srsv.holdRelease')}</div>
      ) : null}
      {money.refundedMinor > 0 ? (
        <div className="dd-caption">
          {t('srsv.refunded', {
            amount: formatMoney(locale, money.refundedMinor, money.currency),
          })}
        </div>
      ) : null}
      {money.keptMinor ? (
        <div className="dd-caption">
          {t('srsv.kept', { amount: formatMoney(locale, money.keptMinor, money.currency) })}
        </div>
      ) : null}
      {notPaid ? (
        <Alert tone="danger">
          <span>{t('srsv.notPaid')}</span>
        </Alert>
      ) : null}
      <div className="dd-caption">{t('srsv.fixed')}</div>
    </div>
  );
}
