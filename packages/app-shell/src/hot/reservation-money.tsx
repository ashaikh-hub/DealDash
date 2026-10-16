import {
  createTranslator,
  formatDateTime,
  formatMoney,
  type DictionaryKey,
  type UiLocale as Locale,
} from '@dealdash/localization';
import type { CommitmentTerms, ReservationView } from '@dealdash/validation';
import { pickText } from '../deals/format';
import { Icon } from '../deals/icons';

/**
 * Reservation commitment (phase 4, RC-81): what a customer pays or has held, and the cancellation, refund and "not used in time"
 * terms, shown BEFORE paying (deal page and reserve sheet) and on the reservation afterwards. Neutral wording: no "penalty".
 */
const tr = (locale: Locale) =>
  createTranslator(locale) as (
    key: DictionaryKey,
    vars?: Record<string, string | number>,
  ) => string;

type PaidTerms = CommitmentTerms & { method: 'FULL_PREPAYMENT' | 'DEPOSIT' | 'CARD_PREAUTH' };
export const isPaidTerms = (c: CommitmentTerms | null | undefined): c is PaidTerms =>
  !!c && c.method !== 'FREE' && c.amountMinor !== null;

export const money = (locale: Locale, minor: number, currency: string | null) =>
  formatMoney(locale, minor, currency);

/** Amount a late cancellation / not used in time charges from a card hold (same rule as the server, RC-92). */
export const holdLateCharge = (holdMinor: number, releasePercent: number | null) =>
  holdMinor - Math.round((holdMinor * Math.min(100, Math.max(0, releasePercent ?? 0))) / 100);

/** One-line headline for the sticky bar and the badges: "SAR 20 to reserve", "SAR 10 deposit", "SAR 50 card hold". */
export function commitmentHeadline(c: PaidTerms, locale: Locale, quantity = 1) {
  const t = tr(locale);
  return t(`rsv.bar.${c.method}` as DictionaryKey, {
    amount: money(locale, c.amountMinor! * quantity, c.currency),
  });
}

/** The terms lines (each a sentence), in the order a customer needs them. */
export function commitmentLines(
  c: PaidTerms,
  locale: Locale,
  opts: { merchant: string; holdMinutes: number; quantity?: number },
): string[] {
  const t = tr(locale);
  const q = opts.quantity ?? 1;
  const total = c.amountMinor! * q;
  const out: string[] = [t('rsv.collectedBy', { merchant: opts.merchant })];
  if (c.method === 'CARD_PREAUTH')
    out.push(
      c.preauthImmediateCapture
        ? t('rsv.immediate')
        : t(`rsv.use.${c.preauthOnRedemption ?? 'RELEASE'}` as DictionaryKey),
    );
  // deposit: credited toward the bill (the rest is paid at the branch) or a booking fee (the full bill is paid at the branch)
  else if (c.method === 'DEPOSIT' && c.depositCredited === false)
    out.push(t('rsv.use.DEPOSIT_FEE'));
  else out.push(t(`rsv.use.${c.method}` as DictionaryKey));
  const anyTime = c.method === 'DEPOSIT' && c.depositRefundable !== false && !!c.depositLateRefund;
  if (c.method === 'DEPOSIT' && c.depositRefundable === false) out.push(t('rsv.nonRefundable'));
  else if (anyTime) out.push(t('rsv.cancelAny.DEPOSIT'));
  else if (c.cancelCutoffMinutes !== null)
    out.push(t(`rsv.cancelFree.${c.method}` as DictionaryKey, { min: c.cancelCutoffMinutes }));
  if (c.method === 'FULL_PREPAYMENT')
    out.push(t('rsv.late.FULL_PREPAYMENT', { pct: c.noShowRefundPercent ?? 0 }));
  else if (c.method === 'DEPOSIT')
    out.push(anyTime ? t('rsv.late.DEPOSIT_NOSHOW') : t('rsv.late.DEPOSIT'));
  else if (!c.preauthImmediateCapture) {
    const charge = holdLateCharge(total, c.noShowRefundPercent);
    out.push(
      charge > 0
        ? t('rsv.late.CARD_PREAUTH', { amount: money(locale, charge, c.currency) })
        : t('rsv.lateNothing'),
    );
  }
  if (c.paymentWindowMinutes) out.push(t('rsv.window', { min: c.paymentWindowMinutes }));
  out.push(t('rsv.holdLength', { min: opts.holdMinutes }));
  out.push(t('rsv.strikes'));
  return out;
}

/** The terms panel: amount (paid now or held), then the terms. Used on the deal page and inside the reserve sheet. */
export function CommitmentTermsPanel({
  terms,
  locale,
  merchant,
  holdMinutes,
  quantity = 1,
  testId = 'commitment-terms',
}: {
  terms: PaidTerms;
  locale: Locale;
  merchant: string;
  holdMinutes: number;
  quantity?: number;
  testId?: string;
}) {
  const t = tr(locale);
  const hold = terms.method === 'CARD_PREAUTH';
  return (
    <section className="dd-rsv-terms" data-testid={testId} data-method={terms.method}>
      <div className="dd-rsv-terms__head">
        <span className="dd-rsv-terms__icon" aria-hidden="true">
          <Icon name={hold ? 'lock' : 'tag'} size={18} />
        </span>
        <div className="dd-grow">
          <strong>{t(`rsv.method.${terms.method}` as DictionaryKey)}</strong>
          <div className="dd-caption">{hold ? t('rsv.holdNow') : t('rsv.payNow')}</div>
        </div>
        <strong className="dd-rsv-terms__amount dd-ltr" data-testid="commitment-amount">
          {money(locale, terms.amountMinor! * quantity, terms.currency)}
        </strong>
      </div>
      <ul className="dd-rsv-terms__list">
        {commitmentLines(terms, locale, { merchant, holdMinutes, quantity }).map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </section>
  );
}

const STATUS_TONE: Record<string, string> = {
  PENDING: 'warning',
  PAID: 'success',
  AUTHORISED: 'success',
  CAPTURED: 'info',
  VOIDED: 'neutral',
  FAILED: 'danger',
  PARTIALLY_REFUNDED: 'info',
  REFUNDED: 'info',
  FORFEITED: 'neutral',
  NOT_REQUIRED: 'neutral',
};

/**
 * The money part of a paid reservation: method, amount paid / held, payment or hold status, the free cancellation time, the terms
 * that apply, and every refund with its status. Read-only: retry and cancel live in the ticket's actions.
 */
export function ReservationMoneyPanel({
  reservation,
  locale,
}: {
  reservation: ReservationView;
  locale: Locale;
}) {
  const t = tr(locale);
  const p = reservation.payment;
  if (!p) return null;
  const hold = p.authorisation;
  const cutoff = p.cancelCutoffAt ? new Date(p.cancelCutoffAt) : null;
  const cutoffPassed = cutoff
    ? cutoff.getTime() <= new Date(reservation.serverNow).getTime()
    : false;
  const amountLabel =
    p.method === 'CARD_PREAUTH'
      ? t('rsv.amountHeld')
      : p.status === 'PENDING' || p.status === 'FAILED'
        ? t('rsv.amountDue')
        : t('rsv.amountPaid');
  const terms: PaidTerms = {
    method: p.method,
    amountMinor: Math.round(p.amountMinor / Math.max(1, reservation.quantity)),
    currency: p.currency,
    depositRefundable: p.depositRefundable,
    depositLateRefund: p.depositLateRefund,
    depositCredited: p.depositCredited,
    cancelCutoffMinutes: null,
    noShowRefundPercent: p.noShowRefundPercent,
    paymentWindowMinutes: null,
    preauthOnRedemption: null,
    preauthImmediateCapture: null,
  };
  const live = reservation.displayState === 'HELD';
  return (
    <section className="dd-rsv-money" data-testid="reservation-money" data-status={p.status}>
      <div className="dd-rsv-money__head">
        <h2 className="dd-dd__h" style={{ margin: 0 }}>
          {t('rsv.section')}
        </h2>
        <span
          className={`dd-chip dd-chip--${STATUS_TONE[p.status] ?? 'neutral'}`}
          data-testid="payment-status"
        >
          {t(`rsv.status.${p.status}` as DictionaryKey)}
        </span>
      </div>
      <dl className="dd-ticket__facts">
        <div>
          <dt>
            {t(`rsv.methodName.${p.method}` as DictionaryKey)} · {amountLabel}
          </dt>
          <dd className="dd-ltr" data-testid="payment-amount">
            {money(locale, p.amountMinor, p.currency)}
          </dd>
        </div>
        {hold ? (
          <div>
            <dt>{t('rsv.methodName.CARD_PREAUTH')}</dt>
            <dd data-testid="hold-status">{t(`rsv.hold.${hold.status}` as DictionaryKey)}</dd>
          </div>
        ) : null}
        {hold && hold.capturedMinor > 0 ? (
          <div>
            <dt>{t('rsv.charged')}</dt>
            <dd className="dd-ltr">{money(locale, hold.capturedMinor, p.currency)}</dd>
          </div>
        ) : null}
        {hold && hold.releasedMinor > 0 ? (
          <div>
            <dt>{t('rsv.released')}</dt>
            <dd className="dd-ltr">{money(locale, hold.releasedMinor, p.currency)}</dd>
          </div>
        ) : null}
        {p.keptMinor !== null && p.keptMinor > 0 && p.method !== 'CARD_PREAUTH' ? (
          <div>
            <dt>{t('rsv.kept')}</dt>
            <dd className="dd-ltr">{money(locale, p.keptMinor, p.currency)}</dd>
          </div>
        ) : null}
      </dl>
      {/* a deposit refundable on any cancellation has no cut-off that matters to the customer */}
      {live && cutoff && !(p.method === 'DEPOSIT' && p.depositLateRefund) ? (
        <p className="dd-caption" style={{ margin: 0 }} data-testid="cutoff">
          <Icon name="clock" size={13} />{' '}
          {cutoffPassed
            ? t('rsv.cutoffPassed', { time: formatDateTime(locale, p.cancelCutoffAt!) })
            : t('rsv.cutoffAt', { time: formatDateTime(locale, p.cancelCutoffAt!) })}
        </p>
      ) : null}
      {live || reservation.displayState === 'PAYMENT_PENDING' ? (
        <ul className="dd-rsv-terms__list">
          {commitmentLines(terms, locale, {
            merchant: pickText(reservation.deal.merchantName, locale),
            holdMinutes: reservation.holdMinutes,
            quantity: 1,
          })
            // the collection note, hold length and limits note stay on the deal page; a card hold's redemption rule is not on
            // the reservation, so it is not restated here (it was accepted with the terms); while still unpaid the "at the
            // branch" line (which says it is paid) is not shown either
            .slice(p.method === 'CARD_PREAUTH' || !live ? 2 : 1, -2)
            .map((l) => (
              <li key={l}>{l}</li>
            ))}
        </ul>
      ) : null}
      {p.refunds.length ? (
        <div className="dd-stack" style={{ gap: 6 }} data-testid="refunds">
          <strong>{t('rsv.refunds')}</strong>
          {p.refunds.map((f) => (
            <div key={f.reference} className="dd-row" style={{ justifyContent: 'space-between' }}>
              <span className="dd-ltr">{money(locale, f.amountMinor, p.currency)}</span>
              <span
                className={`dd-chip dd-chip--${f.status === 'REFUNDED' ? 'success' : f.status === 'FAILED' ? 'warning' : 'info'}`}
              >
                {t(`rsv.refund.${f.status}` as DictionaryKey)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
