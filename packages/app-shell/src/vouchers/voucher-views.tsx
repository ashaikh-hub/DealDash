import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import {
  createTranslator,
  formatMoney,
  isolateLtr,
  type DictionaryKey,
  type Locale,
} from '@dealdash/localization';
import { Alert, Button, Field, Select, Textarea } from '@dealdash/ui';
import type {
  OrderView,
  VoucherCard,
  VoucherDetail,
  WalletDetail,
  WalletItem,
} from '@dealdash/validation';
import { Icon } from '../deals/icons';
import {
  dateLabel,
  directionsUrl,
  formatDistance,
  openStatus,
  pickText,
  visibleTermLines,
} from '../deals/format';
import { Countdown } from '../hot/countdown';
import { QrCode } from '../hot/qr';

type T = (key: DictionaryKey, vars?: Record<string, string | number>) => string;
const tr = (locale: Locale) => createTranslator(locale) as T;

/** Wallet state to chip tone: calm colours, nothing alarming for ordinary outcomes. */
export const WALLET_TONE: Record<string, 'success' | 'info' | 'warning' | 'neutral'> = {
  ACTIVE: 'success',
  USED: 'info',
  EXPIRED: 'neutral',
  REFUNDED: 'neutral',
  REFUND_PENDING: 'warning',
  VOIDED: 'warning',
};

/** "Reported savings": the merchant's stated value minus the price. Never a promise about total personal savings. */
export function SavingsLine({
  locale,
  halalas,
  percent,
}: {
  locale: Locale;
  halalas: number;
  percent: number;
}) {
  const t = tr(locale);
  if (halalas <= 0) return null;
  return (
    <span className="dd-voucher-save" data-testid="voucher-savings">
      <span className="dd-caption">{t('vch.reportedSavings')}</span>{' '}
      <strong className="dd-ltr">
        {t('vch.savingsAmount', { amount: formatMoney(locale, halalas), pct: percent })}
      </strong>
    </span>
  );
}

// ================================================================ card
export function VoucherCardView({
  voucher,
  locale,
  variant = 'carousel',
  href,
  imageRef,
}: {
  voucher: VoucherCard;
  locale: Locale;
  variant?: 'carousel' | 'list';
  href?: string;
  imageRef?: (el: HTMLElement | null) => void;
}) {
  const t = tr(locale);
  const locked = voucher.eligibility.result === 'LOCKED_UNLOCKABLE';
  const distance = formatDistance(locale, voucher.distanceMeters);
  const soldOut = voucher.soldOut || voucher.availability === 'SOLD_OUT';
  const body = (
    <>
      <div className="dd-dc__media">
        {voucher.imageUrl ? (
          <img src={voucher.imageUrl} alt={pickText(voucher.imageAlt, locale)} loading="lazy" />
        ) : (
          <div className="dd-dc__ph" aria-hidden="true" />
        )}
        <span className="dd-voucher-badge">
          <Icon name="ticket" size={13} /> {t('vch.badge')}
        </span>
        {soldOut ? <span className="dd-dc__state">{t('vch.soldOut')}</span> : null}
        <span className="dd-dc__offer dd-ltr">
          {formatMoney(locale, voucher.faceValueHalalas, voucher.currency)}
        </span>
        {locked ? (
          <span className="dd-dc__lock">
            <Icon name="lock" size={14} /> {t('elig.locked')}
          </span>
        ) : null}
      </div>
      <div className="dd-dc__body">
        <h3 className="dd-dc__title">{pickText(voucher.title, locale)}</h3>
        <div className="dd-dc__merchant">{pickText(voucher.merchantName, locale)}</div>
        <div className="dd-voucher-price">
          <strong className="dd-ltr">
            {formatMoney(locale, voucher.sellingPriceHalalas, voucher.currency)}
          </strong>
          {voucher.reportedSavingsPercent > 0 ? (
            <span className="dd-chip dd-chip--success dd-ltr">
              {voucher.reportedSavingsPercent}%
            </span>
          ) : null}
        </div>
        <div className="dd-dc__meta">
          {!soldOut && voucher.remaining !== null && voucher.remaining <= 10 ? (
            <span className="dd-dc__chip dd-hot-chip dd-hot-chip--stock">
              {t('vch.onlyLeft', { n: voucher.remaining })}
            </span>
          ) : null}
          {distance ? (
            <span className="dd-dc__chip">
              <Icon name="pin" size={13} /> <span className="dd-ltr">{distance}</span>
            </span>
          ) : null}
        </div>
        {locked && voucher.eligibility.message ? (
          <div className="dd-dc__unlock">{pickText(voucher.eligibility.message, locale)}</div>
        ) : null}
      </div>
    </>
  );
  return (
    <article
      className={`dd-dc dd-dc--${variant} dd-dc--voucher ${soldOut ? 'dd-dc--soldout' : ''}`}
      data-voucher-id={voucher.id}
      data-testid="voucher-card"
      ref={imageRef}
    >
      {href ? (
        <Link href={href} className="dd-dc__link" aria-label={pickText(voucher.title, locale)}>
          {body}
        </Link>
      ) : (
        <div className="dd-dc__link">{body}</div>
      )}
    </article>
  );
}

// ================================================================ detail
export function VoucherDetailView({
  detail,
  locale,
  embedded,
  signedIn,
  onBack,
  onBuy,
  onSignIn,
  onDirections,
  merchantHref,
}: {
  detail: VoucherDetail;
  locale: Locale;
  embedded?: boolean;
  signedIn?: boolean;
  onBack?: () => void;
  /** Starts checkout. Returns a translated error to show, or null when the customer is being taken to checkout. */
  onBuy?: () => Promise<{ error: string | null }>;
  onSignIn?: () => void;
  onDirections?: (branchId: string) => void;
  merchantHref?: string;
}) {
  const t = tr(locale);
  const [tab, setTab] = useState<'overview' | 'details'>('overview');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nearest =
    detail.branches.find((b) => b.id === detail.nearestBranch?.id) ?? detail.branches[0] ?? null;
  const distance = formatDistance(locale, detail.distanceMeters);
  const lines = visibleTermLines(locale, detail.terms.blocks, (h) =>
    formatMoney(locale, h, detail.currency),
  );
  const termsText = pickText(detail.terms.text, locale);
  const soldOut = detail.soldOut;
  const v = detail.validity;

  const buy = async () => {
    if (!onBuy) return;
    setBusy(true);
    setError(null);
    const r = await onBuy();
    setBusy(false);
    if (r.error) setError(r.error);
  };

  let action: ReactNode = null;
  if (!embedded) {
    if (soldOut || detail.blockedReason === 'SOLD_OUT')
      action = <Button disabled>{t('vch.soldOut')}</Button>;
    else if (detail.blockedReason === 'ENDED') action = <Button disabled>{t('vch.ended')}</Button>;
    else if (detail.blockedReason === 'NOT_ON_SALE')
      action = <Button disabled>{t('vch.notOnSale')}</Button>;
    else if (!signedIn)
      action = (
        <Button onClick={onSignIn} data-testid="voucher-signin">
          {t('vch.signInToBuy')}
        </Button>
      );
    else if (detail.blockedReason === 'LIMIT_REACHED')
      action = <Button disabled>{t('vch.limitReached')}</Button>;
    else if (detail.blockedReason === 'LOCKED')
      action = <Button disabled>{t('vch.locked')}</Button>;
    else
      action = (
        <Button onClick={() => void buy()} loading={busy} data-testid="voucher-buy">
          {busy ? t('vch.buying') : t('vch.buy')}
        </Button>
      );
  }

  return (
    <div className={`dd-dd dd-voucher ${embedded ? 'dd-dd--embedded' : ''}`}>
      <div className="dd-dd__hero">
        <div
          className="dd-dd__gallery"
          tabIndex={0}
          aria-label={t('deal.photos', { n: detail.media.length })}
        >
          {detail.media.length ? (
            detail.media.map((m, i) => <img key={i} src={m.url} alt={pickText(m.alt, locale)} />)
          ) : (
            <div className="dd-dc__ph dd-dd__ph" aria-hidden="true" />
          )}
        </div>
        <div className="dd-dd__shade" aria-hidden="true" />
        {onBack ? (
          <button
            type="button"
            className="dd-dd__back"
            onClick={onBack}
            aria-label={t('cust.back')}
          >
            <Icon name="back" size={20} />
          </button>
        ) : null}
        <div className="dd-dd__name">
          <h1>{pickText(detail.merchantName, locale)}</h1>
          <p>
            {detail.category ? pickText(detail.category.name, locale) : ''}
            {nearest ? ` · ${pickText(nearest.address, locale)}` : ''}
            {distance ? ' · ' : ''}
            {distance ? <span className="dd-ltr">{distance}</span> : null}
          </p>
        </div>
      </div>

      <div className="dd-dd__sheet">
        <div className="dd-dd__headline">
          <h2 className="dd-dd__offer dd-ltr">
            {t('vch.worth', {
              value: formatMoney(locale, detail.faceValueHalalas, detail.currency),
            })}
          </h2>
          <span className="dd-voucher-badge dd-voucher-badge--inline">
            <Icon name="ticket" size={13} /> {t('vch.badge')}
          </span>
        </div>
        <p className="dd-dd__title">{pickText(detail.title, locale)}</p>
        <p className="dd-muted">{pickText(detail.shortDescription, locale)}</p>

        <div className="dd-voucher-pricebox" data-testid="voucher-pricebox">
          <div>
            <span className="dd-caption">{t('vch.youPay')}</span>
            <strong className="dd-voucher-pricebox__price dd-ltr">
              {formatMoney(locale, detail.sellingPriceHalalas, detail.currency)}
            </strong>
          </div>
          <div>
            <span className="dd-caption">{t('vch.voucherValue')}</span>
            <strong className="dd-ltr">
              {formatMoney(locale, detail.faceValueHalalas, detail.currency)}
            </strong>
          </div>
          <SavingsLine
            locale={locale}
            halalas={detail.reportedSavingsHalalas}
            percent={detail.reportedSavingsPercent}
          />
        </div>
        <p className="dd-caption">{t('vch.savingsNote')}</p>

        <div className="dd-dd__badges">
          <span className="dd-chip dd-chip--info">
            <Icon name="clock" size={13} />{' '}
            {v.type === 'DAYS_FROM_PURCHASE'
              ? t('vch.validDays', { n: v.days ?? 0 })
              : t('vch.validUntil', { date: dateLabel(locale, v.validUntil) })}
          </span>
          {detail.saleEndsAt ? (
            <span className="dd-chip dd-chip--neutral">
              {t('vch.saleEnds', { date: dateLabel(locale, detail.saleEndsAt) })}
            </span>
          ) : null}
          {detail.remaining !== null && !soldOut && detail.remaining <= 10 ? (
            <span className="dd-chip dd-chip--warning">
              {t('vch.onlyLeft', { n: detail.remaining })}
            </span>
          ) : null}
          {detail.perCustomerLimit > 1 ? (
            <span className="dd-chip dd-chip--neutral">
              {t('vch.perPerson', { n: detail.perCustomerLimit })}
            </span>
          ) : null}
        </div>

        {soldOut ? (
          <Alert tone="warning">
            <span> {t('vch.soldOutBody')}</span>
          </Alert>
        ) : null}
        {detail.blockedReason === 'LOCKED' && detail.eligibility.message ? (
          <div className="dd-dd__locked" role="status">
            <Icon name="lock" size={20} />
            <div>
              <strong>{pickText(detail.eligibility.message, locale)}</strong>
              <div className="dd-caption">{t('elig.noCardData')}</div>
            </div>
          </div>
        ) : null}
        {error ? (
          <div data-testid="voucher-buy-error">
            <Alert tone="danger">{error}</Alert>
          </div>
        ) : null}

        <h3 className="dd-dd__h">{t('vch.howTitle')}</h3>
        <ol className="dd-hot-how" aria-label={t('vch.howTitle')}>
          {([1, 2, 3] as const).map((n) => (
            <li key={n}>
              <span className="dd-hot-how__n" aria-hidden="true">
                {n}
              </span>
              <div>
                <strong>{t(`vch.how${n}` as DictionaryKey)}</strong>
                <div className="dd-caption">{t(`vch.how${n}b` as DictionaryKey)}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="dd-dd__tabs" role="tablist" aria-label={t('vch.rulesTitle')}>
        {(['overview', 'details'] as const).map((id) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            className="dd-dd__tab"
            onClick={() => setTab(id)}
          >
            {t(`deal.${id}` as DictionaryKey)}
          </button>
        ))}
      </div>
      {tab === 'overview' ? (
        <div className="dd-dd__panel">
          {merchantHref ? (
            <Link href={merchantHref} className="dd-dd__merchantlink">
              <span>{t('deal.fromMerchant', { name: pickText(detail.merchantName, locale) })}</span>
              <span>{t('deal.viewMerchant')}</span>
              <Icon name="forward" size={16} />
            </Link>
          ) : null}
          <h3 className="dd-dd__h">{t('deal.description')}</h3>
          <p className="dd-pre">{pickText(detail.description, locale)}</p>
          <h3 className="dd-dd__h">{t('vch.rulesTitle')}</h3>
          <p className="dd-pre">{pickText(detail.redemptionRules, locale)}</p>
        </div>
      ) : (
        <div className="dd-dd__panel">
          <h3 className="dd-dd__h">{t('vch.termsTitle')}</h3>
          <ul className="dd-dd__terms">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
            {termsText ? <li>{termsText}</li> : null}
          </ul>
          <p className="dd-caption">{t('vch.refundInfo')}</p>
        </div>
      )}

      <div className="dd-dd__panel">
        <h3 className="dd-dd__h">{t('vch.branchesTitle')}</h3>
        <div className="dd-stack">
          {detail.branches.map((b) => {
            const st = openStatus(b.hours);
            const d = formatDistance(locale, b.distanceMeters);
            return (
              <div key={b.id} className="dd-dd__branch dd-dd__branch--card">
                <div className="dd-grow">
                  <strong>{pickText(b.name, locale)}</strong>
                  <div className="dd-caption">{pickText(b.address, locale)}</div>
                  <div className="dd-caption">
                    {st ? (
                      <span className={st.open ? 'dd-open' : 'dd-closed'}>
                        {st.open ? t('merch.openNow') : t('merch.closedNow')}
                      </span>
                    ) : (
                      t('deal.hoursUnknown')
                    )}
                    {d ? <span className="dd-ltr"> · {d}</span> : null}
                  </div>
                  {b.phone ? <div className="dd-caption dd-ltr">{isolateLtr(b.phone)}</div> : null}
                </div>
                <button
                  type="button"
                  className="dd-btn dd-btn--outline dd-btn--sm"
                  disabled={b.latitude === null}
                  onClick={() => {
                    if (b.latitude === null || b.longitude === null) return;
                    onDirections?.(b.id);
                    if (!embedded)
                      window.open(directionsUrl(b.latitude, b.longitude), '_blank', 'noopener');
                  }}
                >
                  {t('merch.directions')}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {!embedded ? (
        <div className="dd-dd__bar">
          <div>
            <strong className="dd-ltr">
              {formatMoney(locale, detail.sellingPriceHalalas, detail.currency)}
            </strong>
            <div className="dd-caption dd-ltr">
              {t('vch.worth', {
                value: formatMoney(locale, detail.faceValueHalalas, detail.currency),
              })}
            </div>
          </div>
          {action}
        </div>
      ) : null}
    </div>
  );
}

// ================================================================ checkout
/** The order summary shown before and after payment: voucher, merchant, value, price, quantity, amount payable. */
export function OrderSummary({ order, locale }: { order: OrderView; locale: Locale }) {
  const t = tr(locale);
  const saved = order.faceValueHalalas * order.quantity - order.totalHalalas;
  return (
    <div className="dd-card dd-order" data-testid="order-summary">
      <div className="dd-row" style={{ gap: 12, alignItems: 'center' }}>
        {order.voucher.imageUrl ? (
          <img className="dd-logo" src={order.voucher.imageUrl} alt="" />
        ) : (
          <span className="dd-notif__icon">
            <Icon name="ticket" />
          </span>
        )}
        <div className="dd-grow">
          <strong>{pickText(order.voucher.title, locale)}</strong>
          <div className="dd-caption">{pickText(order.voucher.merchantName, locale)}</div>
        </div>
      </div>
      <dl className="dd-kv" style={{ marginBlockStart: 12 }}>
        <div className="dd-kv__row">
          <dt>{t('ck.faceValue')}</dt>
          <dd className="dd-ltr">{formatMoney(locale, order.faceValueHalalas, order.currency)}</dd>
        </div>
        <div className="dd-kv__row">
          <dt>{t('ck.price')}</dt>
          <dd className="dd-ltr">{formatMoney(locale, order.unitPriceHalalas, order.currency)}</dd>
        </div>
        <div className="dd-kv__row">
          <dt>{t('ck.quantity')}</dt>
          <dd className="dd-ltr">{order.quantity}</dd>
        </div>
        {saved > 0 ? (
          <div className="dd-kv__row">
            <dt>{t('ck.savings')}</dt>
            <dd className="dd-ltr">{formatMoney(locale, saved, order.currency)}</dd>
          </div>
        ) : null}
        <div className="dd-kv__row dd-kv__row--total">
          <dt>
            <strong>{t('ck.total')}</strong>
          </dt>
          <dd className="dd-ltr" data-testid="order-total">
            <strong>{formatMoney(locale, order.totalHalalas, order.currency)}</strong>
          </dd>
        </div>
      </dl>
      {saved > 0 ? <p className="dd-caption">{t('vch.savingsNote')}</p> : null}
    </div>
  );
}

export function HoldCountdown({ order, locale }: { order: OrderView; locale: Locale }) {
  const t = tr(locale);
  return (
    <p className="dd-caption" data-testid="hold-note">
      {t('ck.holdNote') + ' '}
      <strong className="dd-ltr">
        <Countdown target={order.holdExpiresAt} serverNow={order.serverNow} locale={locale} />
      </strong>
    </p>
  );
}

// ================================================================ wallet
export function WalletRowView({
  item,
  locale,
  href,
}: {
  item: WalletItem;
  locale: Locale;
  href: string;
}) {
  const t = tr(locale);
  return (
    <Link
      href={href}
      className="dd-staffrow"
      style={{ textDecoration: 'none', color: 'inherit' }}
      data-testid="wallet-row"
    >
      {item.imageUrl ? (
        <img className="dd-logo" src={item.imageUrl} alt="" />
      ) : (
        <span className="dd-notif__icon">
          <Icon name="ticket" />
        </span>
      )}
      <div className="dd-grow">
        <strong>{pickText(item.title, locale)}</strong>
        <div className="dd-caption">{pickText(item.merchantName, locale)}</div>
        <div className="dd-caption dd-ltr">
          {formatMoney(locale, item.faceValueHalalas, item.currency)} · {item.reference}
        </div>
        <div style={{ marginBlockStart: 4 }}>
          <span className={`dd-chip dd-chip--${WALLET_TONE[item.state] ?? 'neutral'}`}>
            {t(`vwallet.${item.state}` as DictionaryKey)}
          </span>{' '}
          {item.state === 'ACTIVE' ? (
            <span className="dd-caption">
              {t('wal.expires', { date: dateLabel(locale, item.expiresAt) })}
            </span>
          ) : null}
        </div>
      </div>
      <Icon name="forward" size={18} />
    </Link>
  );
}

const REFUND_REASONS = ['CHANGED_MIND', 'DUPLICATE', 'MERCHANT_CANNOT_HONOUR', 'OTHER'] as const;

/** One owned voucher: QR + manual code while it can be used; a calm explanation otherwise; refund + support. */
export function WalletTicket({
  voucher,
  locale,
  justIssued,
  onRefund,
  onSupport,
  onDirections,
  offerHref,
}: {
  voucher: WalletDetail;
  locale: Locale;
  justIssued?: boolean;
  onRefund?: (reasonCode: string, note: string) => Promise<string | null>;
  onSupport?: (subject: string, body: string) => Promise<string | null>;
  onDirections?: (branchId: string) => void;
  offerHref?: string;
}) {
  const t = tr(locale);
  const v = voucher;
  const [sheet, setSheet] = useState<null | 'refund' | 'support'>(null);
  const [reason, setReason] = useState<string>('CHANGED_MIND');
  const [note, setNote] = useState('');
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<null | 'refund' | 'support'>(null);
  const live = v.state === 'ACTIVE' && !!v.code;
  const first = v.branches[0] ?? null;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const e =
      sheet === 'refund'
        ? await onRefund?.(reason, note.trim())
        : await onSupport?.(subject.trim(), note.trim());
    setBusy(false);
    if (e) setErr(e);
    else {
      setSent(sheet);
      setSheet(null);
      setNote('');
      setSubject('');
    }
  };

  return (
    <div className="dd-ticket" data-testid="wallet-ticket" data-state={v.state}>
      {justIssued && live ? (
        <div className="dd-ticket__done" role="status">
          <span className="dd-ticket__tick" aria-hidden="true">
            <Icon name="check" size={22} />
          </span>
          <div>
            <strong>{t('ord.success')}</strong>
            <div className="dd-caption">{t('ord.successBody')}</div>
          </div>
        </div>
      ) : null}
      <div className="dd-ticket__card">
        <div className="dd-ticket__top">
          <span className={`dd-chip dd-chip--${WALLET_TONE[v.state] ?? 'neutral'}`}>
            {t(`vwallet.${v.state}` as DictionaryKey)}
          </span>
          <span className="dd-caption dd-ltr">{v.reference}</span>
        </div>
        <h1 className="dd-ticket__title">{pickText(v.title, locale)}</h1>
        <p className="dd-muted" style={{ margin: 0 }}>
          {pickText(v.merchantName, locale)} ·{' '}
          <span className="dd-ltr">{formatMoney(locale, v.faceValueHalalas, v.currency)}</span>
        </p>

        {live ? (
          <>
            <div className="dd-ticket__qr">
              <QrCode text={v.code!.qr} label={t('wal.qrAlt')} size={216} />
              <p className="dd-caption">{t('wal.qrHint')}</p>
            </div>
            <div className="dd-ticket__manual">
              <span className="dd-caption">{t('wal.manualHint')}</span>
              <strong className="dd-ltr dd-ticket__code" data-testid="manual-code">
                {v.code!.manual}
              </strong>
            </div>
          </>
        ) : (
          <div className="dd-ticket__past">
            <Icon
              name={v.state === 'USED' ? 'check' : v.state === 'EXPIRED' ? 'clock' : 'info'}
              size={26}
            />
            <p style={{ margin: 0 }} data-testid="wallet-state-note">
              {v.state === 'USED'
                ? t('wal.usedBody')
                : v.state === 'EXPIRED'
                  ? t('wal.expiredBody')
                  : v.state === 'REFUNDED'
                    ? t('wal.refundedBody')
                    : t('wal.pendingBody')}
            </p>
            {v.state === 'USED' && v.redeemedAt ? (
              <p className="dd-caption">
                {t('wal.usedOn', { date: dateLabel(locale, v.redeemedAt) })}
              </p>
            ) : null}
          </div>
        )}

        <dl className="dd-ticket__facts">
          <div>
            <dt>{t('wal.validTo')}</dt>
            <dd>{dateLabel(locale, v.expiresAt)}</dd>
          </div>
          <div>
            <dt>{t('wal.order')}</dt>
            <dd className="dd-ltr">{v.orderReference}</dd>
          </div>
          <div>
            <dt>{t('ck.price')}</dt>
            <dd className="dd-ltr">{formatMoney(locale, v.purchasePriceHalalas, v.currency)}</dd>
          </div>
        </dl>

        {v.refund ? (
          <Alert
            tone={v.refund.status === 'REJECTED' ? 'warning' : 'info'}
            title={t('wal.refund.status', { ref: v.refund.reference })}
          >
            <span data-testid="refund-status">
              {t(`wal.refund.${v.refund.status}` as DictionaryKey)}
              {v.refund.status === 'REJECTED' && v.refund.decisionNote
                ? ` ${v.refund.decisionNote}`
                : ''}
            </span>
          </Alert>
        ) : null}
        {sent === 'refund' ? <Alert tone="success">{t('wal.refund.sent')}</Alert> : null}
        {sent === 'support' ? <Alert tone="success">{t('wal.support.sent')}</Alert> : null}

        <div className="dd-ticket__actions">
          {first && first.latitude !== null && first.longitude !== null ? (
            <a
              className="dd-btn dd-btn--secondary"
              href={directionsUrl(first.latitude, first.longitude)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onDirections?.(first.id)}
            >
              <Icon name="pin" size={16} /> {t('wal.directions')}
            </a>
          ) : null}
          {offerHref ? (
            <Link className="dd-btn dd-btn--outline" href={offerHref}>
              {t('deal.overview')}
            </Link>
          ) : null}
        </div>

        <details className="dd-voucher-more">
          <summary>{t('vch.termsTitle')}</summary>
          <p className="dd-pre">{pickText(v.redemptionRules, locale)}</p>
          <ul className="dd-dd__terms">
            {visibleTermLines(locale, v.terms.blocks, (h) =>
              formatMoney(locale, h, v.currency),
            ).map((l) => (
              <li key={l}>{l}</li>
            ))}
            {pickText(v.terms.text, locale) ? <li>{pickText(v.terms.text, locale)}</li> : null}
          </ul>
          {v.branches.map((b) => (
            <div key={b.id} className="dd-caption">
              {pickText(b.name, locale)} · {pickText(b.address, locale)}
            </div>
          ))}
        </details>

        {v.canRequestRefund && onRefund ? (
          <Button
            variant="outline"
            block
            onClick={() => {
              setErr(null);
              setSheet('refund');
            }}
            data-testid="wallet-refund"
          >
            {t('wal.refund.cta')}
          </Button>
        ) : v.state === 'ACTIVE' && v.refundNote === 'WINDOW_PASSED' ? (
          <p className="dd-caption">{t('wal.refund.windowPassed')}</p>
        ) : v.state === 'USED' ? (
          <p className="dd-caption">{t('wal.refund.used')}</p>
        ) : null}
        {v.canRequestRefund && v.refundWindowEndsAt ? (
          <p className="dd-caption">
            {t('wal.refund.windowEnds', { date: dateLabel(locale, v.refundWindowEndsAt) })}
          </p>
        ) : null}

        {v.supportCaseOpen ? (
          <p className="dd-caption">{t('wal.support.pending')}</p>
        ) : onSupport ? (
          <Button
            variant="ghost"
            block
            onClick={() => {
              setErr(null);
              setSheet('support');
            }}
            data-testid="wallet-support"
          >
            {t('wal.support.open')}
          </Button>
        ) : null}
      </div>

      {sheet ? (
        <div
          className="dd-sheet-overlay"
          onMouseDown={(e) => e.target === e.currentTarget && !busy && setSheet(null)}
        >
          <div
            className="dd-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={sheet === 'refund' ? t('wal.refund.title') : t('wal.support')}
            data-testid="wallet-sheet"
          >
            <div className="dd-sheet__head">
              <h2 className="dd-title">
                {sheet === 'refund' ? t('wal.refund.title') : t('wal.support')}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSheet(null)}
                aria-label={t('common.close')}
                disabled={busy}
              >
                <Icon name="x" size={18} />
              </Button>
            </div>
            {sheet === 'refund' ? (
              <>
                <p className="dd-muted">{t('wal.refund.body')}</p>
                {v.refundNote === 'REVIEW_REQUIRED' ? (
                  <Alert tone="info">{t('wal.refund.review')}</Alert>
                ) : null}
                <Field label={t('wal.refund.reason')} htmlFor="refund-reason">
                  <Select
                    id="refund-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  >
                    {REFUND_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {t(`vreason.${r}` as DictionaryKey)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </>
            ) : (
              <Field label={t('wal.support.subject')} htmlFor="support-subject">
                <input
                  id="support-subject"
                  className="dd-input"
                  value={subject}
                  maxLength={120}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </Field>
            )}
            <Field
              label={sheet === 'refund' ? t('wal.refund.note') : t('wal.support.body')}
              htmlFor="sheet-note"
            >
              <Textarea
                id="sheet-note"
                rows={3}
                maxLength={sheet === 'refund' ? 500 : 1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            {err ? <Alert tone="danger">{err}</Alert> : null}
            <Button
              onClick={() => void submit()}
              loading={busy}
              disabled={
                sheet === 'support' && (subject.trim().length < 3 || note.trim().length < 3)
              }
              block
              data-testid="wallet-sheet-submit"
            >
              {sheet === 'refund' ? t('wal.refund.submit') : t('wal.support.send')}
            </Button>
            <Button variant="secondary" onClick={() => setSheet(null)} disabled={busy} block>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
