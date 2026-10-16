import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import {
  createTranslator,
  formatDateTime,
  formatMoney,
  isolateLtr,
  type DictionaryKey,
  // customer views take the INTERFACE language (en / ar / ur); content is picked through pickText
  type UiLocale as Locale,
} from '@dealdash/localization';
import type { UnlockAction } from '@dealdash/types';
import { Alert, Button, Modal } from '@dealdash/ui';
import type { HotDealCard, HotDealDetail, ReservationView } from '@dealdash/validation';
import { Icon } from '../deals/icons';
import {
  dateLabel,
  directionsUrl,
  formatDistance,
  openStatus,
  pickText,
  visibleTermLines,
} from '../deals/format';
import { Countdown, useServerNow } from './countdown';
import { QrCode } from './qr';
import { shareLink, whatsappHref } from './share';
import {
  CommitmentTermsPanel,
  ReservationMoneyPanel,
  commitmentHeadline,
  isPaidTerms,
} from './reservation-money';

const tr = (locale: Locale) =>
  createTranslator(locale) as (
    key: DictionaryKey,
    vars?: Record<string, string | number>,
  ) => string;

// ================================================================ card
/**
 * Exclusive Deal card: the approved card language plus the three things that make it urgent: a live countdown, remaining
 * units, and a clear sold-out state. Used by the customer app and by the merchant/admin previews.
 */
export function HotCardView({
  deal,
  locale,
  variant = 'carousel',
  href,
  imageRef,
}: {
  deal: HotDealCard;
  locale: Locale;
  variant?: 'carousel' | 'list';
  href?: string;
  imageRef?: (el: HTMLElement | null) => void;
}) {
  const t = tr(locale);
  const locked = deal.eligibility.result === 'LOCKED_UNLOCKABLE';
  const distance = formatDistance(locale, deal.distanceMeters);
  const soldOut = deal.soldOut || deal.availability === 'SOLD_OUT';
  const unavailable = !soldOut && deal.availability !== 'AVAILABLE';
  const body = (
    <>
      <div className="dd-dc__media">
        {deal.imageUrl ? (
          <img src={deal.imageUrl} alt={pickText(deal.imageAlt, locale)} loading="lazy" />
        ) : (
          <div className="dd-dc__ph" aria-hidden="true" />
        )}
        <span className="dd-hot-badge">
          <Icon name="flame" size={13} /> {t('hot.badge')}
        </span>
        {soldOut ? <span className="dd-dc__state">{t('hot.soldOut')}</span> : null}
        {unavailable ? (
          <span className="dd-dc__state">
            {t(`deal.availability.${deal.availability}` as DictionaryKey)}
          </span>
        ) : null}
        <span className="dd-dc__offer">{pickText(deal.offerLabel, locale)}</span>
        {locked ? (
          <span className="dd-dc__lock">
            <Icon name="lock" size={14} /> {t('elig.locked')}
          </span>
        ) : null}
      </div>
      <div className="dd-dc__body">
        <h3 className="dd-dc__title">{pickText(deal.title, locale)}</h3>
        <div className="dd-dc__merchant">{pickText(deal.merchantName, locale)}</div>
        <div className="dd-dc__meta">
          {!soldOut && deal.endsAt ? (
            <span className="dd-dc__chip dd-hot-chip dd-hot-chip--time">
              <Icon name="clock" size={13} />
              <Countdown target={deal.endsAt} serverNow={deal.serverNow} locale={locale} />
            </span>
          ) : null}
          {!soldOut && !deal.endsAt ? (
            <span className="dd-dc__chip">
              <Icon name="clock" size={13} /> {t('hot.noEnd')}
            </span>
          ) : null}
          {!soldOut && deal.remaining !== null ? (
            <span
              className="dd-dc__chip dd-hot-chip dd-hot-chip--stock"
              data-testid="hot-remaining"
            >
              {deal.remaining <= 5
                ? t('hot.onlyLeft', { n: deal.remaining })
                : t('hot.left', { n: deal.remaining })}
            </span>
          ) : null}
          {!deal.reservationsEnabled ? (
            <span className="dd-dc__chip">{t('hot.walkIn')}</span>
          ) : null}
          {distance ? (
            <span className="dd-dc__chip">
              <Icon name="pin" size={13} /> <span className="dd-ltr">{distance}</span>
            </span>
          ) : null}
        </div>
        {locked && deal.eligibility.message ? (
          <div className="dd-dc__unlock">{pickText(deal.eligibility.message, locale)}</div>
        ) : null}
      </div>
    </>
  );
  return (
    <article
      className={`dd-dc dd-dc--${variant} dd-dc--hot ${soldOut ? 'dd-dc--soldout' : ''}`}
      data-deal-id={deal.id}
      data-testid="hot-card"
      ref={imageRef}
    >
      {href ? (
        <Link href={href} className="dd-dc__link" aria-label={pickText(deal.title, locale)}>
          {body}
        </Link>
      ) : (
        <div className="dd-dc__link">{body}</div>
      )}
    </article>
  );
}

// ================================================================ detail
export interface ReserveOutcome {
  /** A translated error to show inside the sheet, or null when the reservation was made. */
  error: string | null;
}

/**
 * Exclusive Deal detail. `embedded` renders it inside the merchant/admin preview (no sticky bar, no actions).
 * Reservation commitment (phase 4, RC-81): a paid deal shows its amount and terms on the page and again in the reserve sheet, where
 * the customer accepts them before paying; the payment itself happens on the provider's page (`onReserve` sends them there).
 * A FREE deal (development / testing markets only) keeps the original free flow.
 */
export function HotDetailView({
  detail,
  locale,
  embedded,
  signedIn,
  onBack,
  onReserve,
  onSignIn,
  onViewReservation,
  onDirections,
  onUnlock,
  merchantHref,
  rating,
}: {
  detail: HotDealDetail;
  locale: Locale;
  /** The merchant's review summary, when known (customer app). */
  rating?: { average: number | null; count: number } | null;
  embedded?: boolean;
  signedIn?: boolean;
  onBack?: () => void;
  onReserve?: (branchId: string, opts: { acceptTerms: boolean }) => Promise<ReserveOutcome>;
  onSignIn?: () => void;
  onViewReservation?: (reservationId: string) => void;
  onDirections?: (branchId: string) => void;
  onUnlock?: (action: UnlockAction) => void;
  merchantHref?: string;
}) {
  const t = tr(locale);
  const [tab, setTab] = useState<'overview' | 'details'>('overview');
  const [sheet, setSheet] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const now = useServerNow(detail.serverNow);
  const paid =
    detail.reservationsEnabled && isPaidTerms(detail.commitment) ? detail.commitment : null;
  const merchant = pickText(detail.merchantName, locale);

  const locked = detail.eligibility.result === 'LOCKED_UNLOCKABLE';
  const soldOut = detail.soldOut;
  const reservable = detail.branches.filter((b) => b.canReserve);
  const mine = detail.myReservations[0] ?? null;
  const nearest =
    detail.branches.find((b) => b.id === detail.nearestBranch?.id) ?? detail.branches[0] ?? null;
  const distance = formatDistance(locale, detail.distanceMeters);
  const media = detail.media;
  const lines = visibleTermLines(locale, detail.terms.blocks, (h) => formatMoney(locale, h));
  const termsText = pickText(detail.terms.text, locale);
  const ended = detail.endsAt ? new Date(detail.endsAt).getTime() <= now : false;
  const restricted = !!detail.restriction;
  const limitReached = signedIn && detail.remainingForMe === 0 && !mine;

  useEffect(() => {
    if (sheet && !picked)
      setPicked(reservable.length === 1 ? reservable[0]!.id : (reservable[0]?.id ?? null));
    // terms are accepted afresh each time the sheet opens
    if (sheet) setAccepted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet]);

  const go = (b: { id: string; latitude: number | null; longitude: number | null }) => {
    if (b.latitude === null || b.longitude === null) return;
    onDirections?.(b.id);
    if (!embedded) window.open(directionsUrl(b.latitude, b.longitude), '_blank', 'noopener');
  };

  const confirm = async () => {
    if (!picked || !onReserve || (paid && !accepted)) return;
    setBusy(true);
    setError(null);
    const r = await onReserve(picked, { acceptTerms: !!paid && accepted });
    // a paid reservation continues on the payment page: the sheet stays busy until the browser leaves
    if (r.error) {
      setBusy(false);
      setError(r.error);
    } else if (!paid) {
      setBusy(false);
      setSheet(false);
    }
  };

  // never a generic or "free" reserve where money or a card hold is involved
  const reserveLabel = paid
    ? t(`rsv.cta.${paid.method}` as DictionaryKey, {
        amount: formatMoney(locale, paid.amountMinor!, paid.currency),
      })
    : t('hot.reserve');

  // what the sticky bar offers
  let bar: ReactNode = null;
  if (!embedded) {
    const status = (
      <div>
        <strong data-testid="hot-bar-status">
          {!detail.reservationsEnabled
            ? t('hot.walkIn')
            : paid
              ? commitmentHeadline(paid, locale)
              : t('hot.free')}
        </strong>
        <div className="dd-caption">
          {!detail.reservationsEnabled
            ? t('hot.walkInDetail')
            : paid
              ? t(`rsv.methodName.${paid.method}` as DictionaryKey)
              : t('hot.holdInfo', { min: detail.holdMinutes })}
        </div>
      </div>
    );
    let action: ReactNode;
    if (!detail.reservationsEnabled)
      action = (
        <Button
          onClick={() => nearest && go(nearest)}
          disabled={!nearest || nearest.latitude === null}
        >
          {t('res.directions')}
        </Button>
      );
    else if (mine)
      action = (
        <Button onClick={() => onViewReservation?.(mine.id)} data-testid="hot-view-mine">
          {t('hot.viewMine')}
        </Button>
      );
    else if (ended || detail.availability === 'ENDED')
      action = <Button disabled>{t('hot.ended')}</Button>;
    else if (soldOut || reservable.length === 0)
      action = <Button disabled>{t('hot.soldOut')}</Button>;
    else if (!signedIn)
      action = (
        <Button onClick={onSignIn} data-testid="hot-signin">
          {t('hot.signInToReserve')}
        </Button>
      );
    else if (locked)
      action = (
        <Button
          onClick={() =>
            detail.eligibility.unlockAction && onUnlock?.(detail.eligibility.unlockAction)
          }
        >
          {t('hot.lockedReserve')}
        </Button>
      );
    else if (restricted || limitReached)
      action = <Button disabled>{limitReached ? t('hot.limitReached') : reserveLabel}</Button>;
    else
      action = (
        <Button onClick={() => setSheet(true)} data-testid="hot-reserve">
          {reserveLabel}
        </Button>
      );
    bar = (
      <div className="dd-dd__bar">
        {status}
        {action}
      </div>
    );
  }

  return (
    <div className={`dd-dd dd-hot ${embedded ? 'dd-dd--embedded' : ''}`}>
      <div className="dd-dd__hero">
        <div
          className="dd-dd__gallery"
          tabIndex={0}
          aria-label={t('deal.photos', { n: media.length })}
        >
          {media.length ? (
            media.map((m, i) => <img key={i} src={m.url} alt={pickText(m.alt, locale)} />)
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
          <h2 className="dd-dd__offer">{pickText(detail.offerLabel, locale)}</h2>
          <span className="dd-hot-badge dd-hot-badge--inline">
            <Icon name="flame" size={13} /> {t('hot.badge')}
          </span>
        </div>
        <p className="dd-dd__title">{pickText(detail.title, locale)}</p>
        <p className="dd-muted">{pickText(detail.shortDescription, locale)}</p>

        {/* the urgency strip: time left and units left, from the server clock */}
        <div
          className={`dd-hot-timer ${soldOut ? 'dd-hot-timer--off' : ''}`}
          data-testid="hot-timer"
        >
          <div>
            <span className="dd-caption">{soldOut ? t('hot.soldOut') : t('res.timeLeft')}</span>
            <strong className="dd-hot-timer__value">
              {soldOut ? (
                '—'
              ) : (
                <Countdown target={detail.endsAt} serverNow={detail.serverNow} locale={locale} />
              )}
            </strong>
          </div>
          {detail.remainingTotal !== null && !soldOut ? (
            <div>
              <span className="dd-caption">{t('mm.available')}</span>
              <strong className="dd-hot-timer__value" data-testid="hot-remaining-total">
                {detail.remainingTotal}
              </strong>
            </div>
          ) : null}
          {detail.reservationsEnabled ? (
            <div>
              <span className="dd-caption">{t('res.holdWord')}</span>
              <strong className="dd-hot-timer__value">
                {t('res.minutes', { n: detail.holdMinutes })}
              </strong>
            </div>
          ) : null}
        </div>
        {/* scarcity: units left against what the deal started with (only when the stock is shown) */}
        {!soldOut && detail.unitsTotal && detail.remainingTotal !== null ? (
          <div className="dd-hot-scarcity" data-testid="hot-scarcity">
            <div className="dd-hot-scarcity__bar" aria-hidden="true">
              <span
                style={{
                  inlineSize: `${Math.max(4, Math.min(100, (detail.remainingTotal / detail.unitsTotal) * 100))}%`,
                }}
              />
            </div>
            <span className="dd-caption">
              {t('cx.hot.left', { n: detail.remainingTotal, total: detail.unitsTotal })}
            </span>
          </div>
        ) : null}
        <dl className="dd-hot-when" data-testid="hot-when">
          {detail.startsAt ? (
            <div>
              <dt>{t('cx.hot.starts')}</dt>
              <dd>{formatDateTime(locale, detail.startsAt)}</dd>
            </div>
          ) : null}
          <div>
            <dt>{t('cx.hot.ends')}</dt>
            <dd>{detail.endsAt ? formatDateTime(locale, detail.endsAt) : t('hot.noEnd')}</dd>
          </div>
          {rating ? (
            <div>
              <dt>
                <Icon name="star" size={13} />
              </dt>
              <dd data-testid="hot-rating">
                {rating.average !== null && rating.count > 0 ? (
                  <>
                    <span className="dd-ltr">{rating.average.toFixed(1)}</span>{' '}
                    <span className="dd-caption">{t('cx.m.reviews', { n: rating.count })}</span>
                  </>
                ) : (
                  <span className="dd-caption">{t('cx.m.noRating')}</span>
                )}
              </dd>
            </div>
          ) : null}
        </dl>
        {soldOut ? (
          <Alert tone="warning">
            <span> {t('hot.soldOutBody')}</span>
          </Alert>
        ) : null}

        {/* "Open to everyone" is the eligibility chip below; a restricted offer states its requirement here */}
        {detail.eligibility.kind !== 'PUBLIC' && detail.eligibility.message && !locked ? (
          <p className="dd-hot-elig" data-testid="hot-elig">
            <Icon name="tag" size={14} /> {pickText(detail.eligibility.message, locale)}
          </p>
        ) : null}

        <div className="dd-dd__badges">
          {paid ? (
            <span className="dd-chip dd-chip--info" data-testid="hot-commitment-chip">
              {commitmentHeadline(paid, locale)}
            </span>
          ) : (
            <span className="dd-chip dd-chip--success">{t('hot.free')}</span>
          )}
          <span className="dd-chip dd-chip--info">
            <Icon name="tag" size={13} /> {t(`elig.${detail.eligibility.kind}` as DictionaryKey)}
          </span>
          {detail.perCustomerLimit > 1 ? (
            <span className="dd-chip dd-chip--neutral">
              {t('hot.perPerson', { n: detail.perCustomerLimit })}
            </span>
          ) : null}
        </div>

        {restricted ? (
          <Alert tone="warning">
            <span>
              {' '}
              {t('hot.restricted', { date: dateLabel(locale, detail.restriction!.endsAt) })}{' '}
              {t('hot.restrictedWhy')}
            </span>
          </Alert>
        ) : null}
        {mine && !embedded ? <Alert tone="success" title={t('hot.alreadyHave')} /> : null}
        {signedIn && limitReached ? <Alert tone="info" title={t('hot.limitReached')} /> : null}

        {locked ? (
          <div className="dd-dd__locked" role="status">
            <Icon name="lock" size={20} />
            <div>
              <strong>{pickText(detail.eligibility.message, locale)}</strong>
              {detail.eligibility.unlockAction && !embedded ? (
                <div className="dd-dd__unlockrow">
                  <button
                    type="button"
                    className="dd-btn dd-btn--primary dd-btn--sm"
                    onClick={() => onUnlock?.(detail.eligibility.unlockAction!)}
                  >
                    {t(`elig.unlock.${detail.eligibility.unlockAction}` as DictionaryKey)}
                  </button>
                </div>
              ) : embedded ? (
                <div className="dd-caption">{t('elig.preview')}</div>
              ) : null}
              <div className="dd-caption">{t('elig.noCardData')}</div>
            </div>
          </div>
        ) : null}

        {paid ? (
          <CommitmentTermsPanel
            terms={paid}
            locale={locale}
            merchant={merchant}
            holdMinutes={detail.holdMinutes}
          />
        ) : null}

        {detail.reservationsEnabled ? (
          <ol className="dd-hot-how" aria-label={t('hot.howTitle')}>
            {([1, 2, 3] as const).map((n) => (
              <li key={n}>
                <span className="dd-hot-how__n" aria-hidden="true">
                  {n}
                </span>
                <div>
                  <strong>
                    {n === 2
                      ? t('hot.how2', { min: detail.holdMinutes })
                      : n === 1 && paid
                        ? t(`rsv.how1.${paid.method}` as DictionaryKey)
                        : t(`hot.how${n}` as DictionaryKey)}
                  </strong>
                  <div className="dd-caption">
                    {n === 1 && paid ? t('rsv.how1b') : t(`hot.how${n}b` as DictionaryKey)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="dd-dd__go">
            <strong>{t('hot.walkIn')}</strong>
            <span>{t('hot.walkInDetail')}</span>
          </div>
        )}
      </div>

      <div className="dd-dd__tabs" role="tablist" aria-label={t('hot.detailsTitle')}>
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
        </div>
      ) : (
        <div className="dd-dd__panel">
          <h3 className="dd-dd__h">{t('hot.termsTitle')}</h3>
          <ul className="dd-dd__terms">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
            {termsText ? <li>{termsText}</li> : null}
          </ul>
        </div>
      )}

      <div className="dd-dd__panel">
        <h3 className="dd-dd__h">{t('hot.branchesTitle')}</h3>
        <div className="dd-stack">
          {detail.branches.map((b) => {
            const st = openStatus(b.hours);
            const d = formatDistance(locale, b.distanceMeters);
            return (
              <div
                key={b.id}
                className="dd-dd__branch dd-dd__branch--card"
                data-testid="hot-branch"
              >
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
                  {detail.reservationsEnabled ? (
                    <div className="dd-caption">
                      {b.blockedReason === 'SOLD_OUT' ? (
                        <span className="dd-hot-soldout">{t('hot.branchSoldOut')}</span>
                      ) : b.stock ? (
                        <span className="dd-hot-low">
                          {t('hot.unitsAtBranch', { n: b.stock.available })}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {b.phone ? <div className="dd-caption dd-ltr">{isolateLtr(b.phone)}</div> : null}
                </div>
                <button
                  type="button"
                  className="dd-btn dd-btn--outline dd-btn--sm"
                  disabled={b.latitude === null}
                  onClick={() => go(b)}
                >
                  {t('merch.directions')}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {bar}

      {sheet ? (
        <div
          className="dd-sheet-overlay"
          onMouseDown={(e) => e.target === e.currentTarget && !busy && setSheet(false)}
        >
          <div
            className="dd-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={t('hot.confirmTitle')}
            data-testid="reserve-sheet"
          >
            <div className="dd-sheet__head">
              <h2 className="dd-title">{paid ? t('rsv.confirmTitle') : t('hot.confirmTitle')}</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSheet(false)}
                aria-label={t('common.close')}
                disabled={busy}
              >
                <Icon name="x" size={18} />
              </Button>
            </div>
            {paid ? null : (
              <p className="dd-muted">{t('hot.confirmBody', { min: detail.holdMinutes })}</p>
            )}
            {reservable.length > 1 ? (
              <fieldset className="dd-hot-branchpick">
                <legend className="dd-label">{t('hot.chooseBranch')}</legend>
                <p className="dd-caption">{t('hot.chooseBranchBody')}</p>
                {reservable.map((b) => (
                  <label
                    key={b.id}
                    className={`dd-hot-pick ${picked === b.id ? 'dd-hot-pick--on' : ''}`}
                  >
                    <input
                      type="radio"
                      name="branch"
                      value={b.id}
                      checked={picked === b.id}
                      onChange={() => setPicked(b.id)}
                    />
                    <span className="dd-grow">
                      <strong>{pickText(b.name, locale)}</strong>
                      <span className="dd-caption" style={{ display: 'block' }}>
                        {pickText(b.address, locale)}
                        {b.distanceMeters !== null ? (
                          <span className="dd-ltr">
                            {' '}
                            · {formatDistance(locale, b.distanceMeters)}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    {b.stock ? (
                      <span className="dd-chip dd-chip--warning">
                        {t('hot.unitsAtBranch', { n: b.stock.available })}
                      </span>
                    ) : null}
                  </label>
                ))}
              </fieldset>
            ) : reservable[0] ? (
              <div className="dd-dd__branch dd-dd__branch--card">
                <div className="dd-grow">
                  <strong>{pickText(reservable[0].name, locale)}</strong>
                  <div className="dd-caption">{pickText(reservable[0].address, locale)}</div>
                </div>
              </div>
            ) : null}
            {paid ? (
              <>
                <dl className="dd-pay-summary" data-testid="pay-summary">
                  <div>
                    <dt>{t('cx.pay.offer')}</dt>
                    <dd>
                      <strong>{pickText(detail.offerLabel, locale)}</strong>
                      <span className="dd-caption"> · {merchant}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>{t('cx.pay.method')}</dt>
                    <dd>{t('cx.pay.methodValue')}</dd>
                  </div>
                  <div>
                    <dt>
                      {paid.method === 'CARD_PREAUTH' && !paid.preauthImmediateCapture
                        ? t('cx.pay.held')
                        : t('cx.pay.charged')}
                    </dt>
                    <dd className="dd-ltr">
                      <strong>{formatMoney(locale, paid.amountMinor!, paid.currency)}</strong>
                    </dd>
                  </div>
                </dl>
                <CommitmentTermsPanel
                  terms={paid}
                  locale={locale}
                  merchant={merchant}
                  holdMinutes={detail.holdMinutes}
                  testId="sheet-terms"
                />
                <label className="dd-rsv-accept">
                  <input
                    type="checkbox"
                    checked={accepted}
                    disabled={busy}
                    onChange={(e) => setAccepted(e.target.checked)}
                    data-testid="reserve-accept"
                  />
                  <span>{t('rsv.accept')}</span>
                </label>
                <p className="dd-caption" style={{ margin: 0 }}>
                  <Icon name="lock" size={13} /> {t('rsv.secure')}
                </p>
              </>
            ) : null}
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <Button
              onClick={() => void confirm()}
              loading={busy}
              disabled={!picked || (!!paid && !accepted)}
              block
              data-testid="reserve-confirm"
            >
              {paid
                ? busy
                  ? t('rsv.redirecting')
                  : t(`rsv.cta.${paid.method}` as DictionaryKey, {
                      amount: formatMoney(locale, paid.amountMinor!, paid.currency),
                    })
                : busy
                  ? t('hot.reserving')
                  : t('hot.confirm')}
            </Button>
            <Button variant="secondary" onClick={() => setSheet(false)} disabled={busy} block>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ================================================================ reservation ticket
/**
 * The customer's reservation: QR + manual code while it can be used, and a calm, neutral explanation once it cannot.
 */
export function ReservationTicket({
  reservation,
  locale,
  justConfirmed,
  onCancel,
  onRetryPayment,
  offerHref,
  reserveAgainHref,
  onDirections,
}: {
  reservation: ReservationView;
  locale: Locale;
  justConfirmed?: boolean;
  onCancel?: () => Promise<string | null>;
  /** Paid reservations: start another payment attempt (returns a translated error, or null when the browser moves on). */
  onRetryPayment?: () => Promise<string | null>;
  offerHref?: string;
  reserveAgainHref?: string;
  onDirections?: () => void;
}) {
  const t = tr(locale);
  const r = reservation;
  const now = useServerNow(r.serverNow);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [payErr, setPayErr] = useState<string | null>(null);
  const ms = new Date(r.expiresAt).getTime() - now;
  const stateNow = r.displayState === 'HELD' && ms <= 0 ? 'NOT_COMPLETED' : r.displayState;
  const live = stateNow === 'HELD' && !!r.code;
  const pending = stateNow === 'PAYMENT_PENDING';
  const pay = r.payment;
  const attemptFailed = pending && pay?.status === 'FAILED';
  const cutoffPassed = !!pay?.cancelCutoffAt && new Date(pay.cancelCutoffAt).getTime() <= now;
  const tone =
    stateNow === 'HELD'
      ? 'success'
      : stateNow === 'REDEEMED'
        ? 'info'
        : stateNow === 'NOT_COMPLETED' || pending
          ? 'warning'
          : 'neutral';

  const retry = async () => {
    if (!onRetryPayment) return;
    setRetrying(true);
    setPayErr(null);
    const e = await onRetryPayment();
    // on success the browser goes to the payment page; stay busy until it does
    if (e) {
      setRetrying(false);
      setPayErr(e);
    }
  };
  const lat = r.branch.latitude;
  const lng = r.branch.longitude;

  const doCancel = async () => {
    if (!onCancel) return;
    setBusy(true);
    const e = await onCancel();
    setBusy(false);
    if (e) setErr(e);
    else setConfirmCancel(false);
  };

  return (
    <div className="dd-ticket" data-testid="reservation-ticket" data-state={stateNow}>
      {justConfirmed && live ? (
        <div className="dd-ticket__done" role="status">
          <span className="dd-ticket__tick" aria-hidden="true">
            <Icon name="check" size={22} />
          </span>
          <div>
            <strong>{t('res.confirmed')}</strong>
            <div className="dd-caption">{t('res.confirmedBody', { min: r.holdMinutes })}</div>
          </div>
        </div>
      ) : null}

      <div className="dd-ticket__card">
        <div className="dd-ticket__top">
          <span className={`dd-chip dd-chip--${tone}`}>
            {t(`res.state.${stateNow}` as DictionaryKey)}
          </span>
          <span className="dd-caption dd-ltr">{r.publicRef}</span>
        </div>
        <h1 className="dd-ticket__title">{pickText(r.deal.title, locale)}</h1>
        <p className="dd-muted" style={{ margin: 0 }}>
          {pickText(r.deal.merchantName, locale)} · {pickText(r.deal.offerLabel, locale)}
        </p>

        {live ? (
          <>
            <div className="dd-ticket__timer" data-testid="ticket-timer">
              <span className="dd-caption">{t('res.timeLeft')}</span>
              <strong className={ms <= 5 * 60_000 ? 'dd-cd--urgent' : ''}>
                <Countdown target={r.expiresAt} serverNow={r.serverNow} locale={locale} />
              </strong>
            </div>
            <div className="dd-ticket__qr">
              <QrCode text={r.code!.qr} label={t('res.qrAlt')} size={216} />
              <p className="dd-caption">{t('res.qrHint')}</p>
            </div>
            <div className="dd-ticket__manual">
              <span className="dd-caption">{t('res.manualHint')}</span>
              <strong className="dd-ltr dd-ticket__code" data-testid="manual-code">
                {r.code!.manual}
              </strong>
            </div>
          </>
        ) : pending ? (
          <div className="dd-ticket__pay" data-testid="ticket-pay">
            <p style={{ margin: 0 }}>
              {attemptFailed ? t('rsv.failedBody') : t('rsv.pendingBody')}
            </p>
            {pay?.dueAt ? (
              <div className="dd-ticket__timer">
                <span className="dd-caption">{t('rsv.payTimeLeft')}</span>
                <strong className="dd-cd--urgent">
                  <Countdown target={pay.dueAt} serverNow={r.serverNow} locale={locale} />
                </strong>
              </div>
            ) : null}
            {payErr ? <Alert tone="danger">{payErr}</Alert> : null}
            {!attemptFailed && pay?.redirectUrl ? (
              <a
                className="dd-btn dd-btn--primary dd-btn--block"
                href={pay.redirectUrl}
                data-testid="ticket-continue-pay"
              >
                {t('rsv.continuePay')}
              </a>
            ) : null}
            {pay?.canRetry && onRetryPayment ? (
              <Button
                block
                variant={attemptFailed || !pay.redirectUrl ? 'primary' : 'outline'}
                loading={retrying}
                onClick={() => void retry()}
                data-testid="ticket-retry-pay"
              >
                {t('rsv.retry')}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="dd-ticket__past">
            <Icon
              name={
                stateNow === 'REDEEMED' ? 'check' : stateNow === 'NOT_COMPLETED' ? 'clock' : 'x'
              }
              size={26}
            />
            <p style={{ margin: 0 }}>
              {stateNow === 'REDEEMED'
                ? t('res.usedOn', { date: dateLabel(locale, r.redeemedAt) })
                : stateNow === 'NOT_COMPLETED'
                  ? t('res.notCompletedBody')
                  : stateNow === 'PAYMENT_FAILED'
                    ? t('rsv.expiredBody')
                    : stateNow === 'CANCELLED_BY_MERCHANT'
                      ? t('res.cancelledByMerchantBody')
                      : t('res.cancelled')}
            </p>
            {stateNow === 'REDEEMED' ? <p className="dd-caption">{t('res.usedNote')}</p> : null}
          </div>
        )}

        <dl className="dd-ticket__facts">
          <div>
            <dt>{t('res.branch')}</dt>
            <dd>{pickText(r.branch.name, locale)}</dd>
          </div>
          <div>
            <dt>{t('res.quantity')}</dt>
            <dd className="dd-ltr">{r.quantity}</dd>
          </div>
          {live ? (
            <div style={{ gridColumn: '1 / -1' }}>
              <dt>{t('cx.t.valid')}</dt>
              <dd data-testid="ticket-validity">
                {formatDateTime(locale, r.createdAt)} – {formatDateTime(locale, r.expiresAt)}
              </dd>
            </div>
          ) : null}
        </dl>
        <p className="dd-caption" style={{ margin: 0 }}>
          {pickText(r.branch.address, locale)}
        </p>

        {live ? (
          <section className="dd-ticket__steps" data-testid="ticket-steps">
            <h2 className="dd-dd__h" style={{ margin: 0 }}>
              {t('cx.t.howTitle')}
            </h2>
            <ol>
              <li>{t('cx.t.step1', { merchant: pickText(r.deal.merchantName, locale) })}</li>
              <li>{t('cx.t.step2')}</li>
              <li>{t('cx.t.step3')}</li>
              <li>{t(`cx.t.step4.${r.payment?.method ?? 'FREE'}` as DictionaryKey)}</li>
            </ol>
          </section>
        ) : null}

        <ReservationMoneyPanel reservation={r} locale={locale} />

        <div className="dd-ticket__actions">
          {lat !== null && lng !== null ? (
            <a
              className="dd-btn dd-btn--secondary"
              href={directionsUrl(lat, lng)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onDirections}
            >
              <Icon name="pin" size={16} /> {t('res.directions')}
            </a>
          ) : null}
          {r.branch.phone ? (
            <a className="dd-btn dd-btn--outline" href={`tel:${r.branch.phone}`}>
              <Icon name="phone" size={16} /> {t('res.call')}
            </a>
          ) : null}
          {whatsappHref(r.branch.phone) ? (
            <a
              className="dd-btn dd-btn--outline"
              href={whatsappHref(r.branch.phone)!}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="ticket-whatsapp"
            >
              <Icon name="chat" size={16} /> {t('cx.m.whatsapp')}
            </a>
          ) : null}
          {offerHref ? (
            <button
              type="button"
              className="dd-btn dd-btn--outline"
              data-testid="ticket-share"
              onClick={() =>
                void shareLink({
                  title: pickText(r.deal.title, locale),
                  url: `${window.location.origin}${offerHref}`,
                })
              }
            >
              <Icon name="share" size={16} /> {t('cx.m.share')}
            </button>
          ) : null}
          {offerHref && live ? (
            <Link className="dd-btn dd-btn--ghost" href={offerHref} data-testid="ticket-terms">
              {t('cx.t.terms')}
            </Link>
          ) : null}
        </div>

        {live ? <p className="dd-caption">{t('res.releaseNote')}</p> : null}
        {(live || pending) && r.canCancel && onCancel ? (
          <Button
            variant="outline"
            block
            onClick={() => setConfirmCancel(true)}
            data-testid="ticket-cancel"
          >
            {t('res.cancel')}
          </Button>
        ) : null}
        {!live ? (
          <div className="dd-ticket__actions">
            {offerHref ? (
              <Link className="dd-btn dd-btn--secondary" href={offerHref}>
                {stateNow === 'NOT_COMPLETED' || stateNow.startsWith('CANCELLED')
                  ? t('res.reserveAgain')
                  : t('res.viewOffer')}
              </Link>
            ) : null}
            {reserveAgainHref ? null : null}
          </div>
        ) : null}
      </div>

      <Modal
        open={confirmCancel}
        onClose={() => !busy && setConfirmCancel(false)}
        title={t('res.cancelTitle')}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmCancel(false)} disabled={busy}>
              {t('res.cancelNo')}
            </Button>
            <Button
              variant="danger"
              onClick={() => void doCancel()}
              loading={busy}
              data-testid="ticket-cancel-yes"
            >
              {t('res.cancelYes')}
            </Button>
          </>
        }
      >
        <p>{t('res.cancelBody')}</p>
        {live && pay ? (
          <Alert tone={cutoffPassed ? 'warning' : 'info'}>
            <span data-testid="cancel-cutoff-note">
              {cutoffPassed ? t('rsv.cancelAfter') : t('rsv.cancelBefore')}
            </span>
          </Alert>
        ) : null}
        {err ? <Alert tone="danger">{err}</Alert> : null}
      </Modal>
    </div>
  );
}
