import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { createTranslator, formatMoney, isolateLtr, type Locale } from '@dealdash/localization';
import type { UnlockAction } from '@dealdash/types';
import type { DealCard, DealDetail, PublicBranch } from '@dealdash/validation';
import { Icon } from './icons';
import {
  dateLabel,
  directionsUrl,
  formatDistance,
  openStatus,
  pickText,
  timeLeftLabel,
  visibleTermLines,
} from './format';

const CAT_ICON: Record<string, string> = {
  dining: 'dining',
  cafes: 'cafes',
  shopping: 'shopping',
  beauty_wellness: 'beauty',
  entertainment: 'entertainment',
  services: 'services',
  fitness: 'fitness',
  other: 'other',
};
export const categoryIcon = (code: string) => CAT_ICON[code] ?? 'other';

export function SaveButton({
  saved,
  onToggle,
  locale,
  className,
}: {
  saved: boolean;
  onToggle: () => void;
  locale: Locale;
  className?: string;
}) {
  const t = createTranslator(locale);
  return (
    <button
      type="button"
      className={`dd-save ${saved ? 'dd-save--on' : ''} ${className ?? ''}`}
      aria-pressed={saved}
      aria-label={saved ? t('deal.saved') : t('deal.save')}
      onClick={onToggle}
    >
      <Icon name="heart" size={18} filled={saved} />
    </button>
  );
}

/**
 * Customer deal card (approved visual language: rounded card, image first, purple offer pill). Used by the customer
 * app and by the merchant/admin previews, so what reviewers see is exactly what customers see.
 */
export function DealCardView({
  deal,
  locale,
  variant = 'carousel',
  href,
  onToggleSave,
  now,
  imageRef,
}: {
  deal: DealCard;
  locale: Locale;
  variant?: 'carousel' | 'list';
  href?: string;
  onToggleSave?: () => void;
  now?: Date;
  imageRef?: (el: HTMLElement | null) => void;
}) {
  const t = createTranslator(locale);
  const locked = deal.eligibility.result === 'LOCKED_UNLOCKABLE';
  const distance = formatDistance(locale, deal.distanceMeters);
  const unavailable = deal.availability !== 'AVAILABLE';
  const body = (
    <>
      <div className="dd-dc__media">
        {deal.imageUrl ? (
          <img src={deal.imageUrl} alt={pickText(deal.imageAlt, locale)} loading="lazy" />
        ) : (
          <div className="dd-dc__ph" aria-hidden="true" />
        )}
        {variant === 'carousel' && !unavailable ? (
          <span className="dd-dc__live">
            <span className="dd-dc__dot" aria-hidden="true" />
            {t('cust.liveBadge')}
          </span>
        ) : null}
        {unavailable ? (
          <span className="dd-dc__state">
            {t(`deal.availability.${deal.availability}` as never)}
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
          {distance ? (
            <span className="dd-dc__chip">
              <Icon name="pin" size={13} /> <span className="dd-ltr">{distance}</span>
            </span>
          ) : null}
          <span className="dd-dc__chip">
            <Icon name="clock" size={13} /> {timeLeftLabel(locale, deal.endsAt, now)}
          </span>
        </div>
        {locked && deal.eligibility.message ? (
          <div className="dd-dc__unlock">{pickText(deal.eligibility.message, locale)}</div>
        ) : null}
      </div>
    </>
  );
  return (
    <article className={`dd-dc dd-dc--${variant}`} data-deal-id={deal.id} ref={imageRef}>
      {href ? (
        <Link href={href} className="dd-dc__link" aria-label={pickText(deal.title, locale)}>
          {body}
        </Link>
      ) : (
        <div className="dd-dc__link">{body}</div>
      )}
      {onToggleSave ? (
        <SaveButton
          saved={deal.saved}
          onToggle={onToggleSave}
          locale={locale}
          className="dd-dc__save"
        />
      ) : null}
    </article>
  );
}

/**
 * Customer deal detail. `embedded` renders it inside the merchant/admin preview (no sticky bar, no navigation).
 * General Live Deals: nothing to claim, book or scan; the action is "Get directions".
 */
export function DealDetailView({
  detail,
  locale,
  now,
  embedded,
  signedIn,
  onToggleSave,
  onDirections,
  onUnlock,
  onBack,
  merchantHref,
  heroFooter,
}: {
  detail: DealDetail;
  locale: Locale;
  now?: Date;
  embedded?: boolean;
  signedIn?: boolean;
  onToggleSave?: () => void;
  onDirections?: (branch: PublicBranch) => void;
  onUnlock?: (action: UnlockAction) => void;
  onBack?: () => void;
  merchantHref?: string;
  heroFooter?: ReactNode;
}) {
  const t = createTranslator(locale);
  const [tab, setTab] = useState<'overview' | 'details'>('overview');
  const locked = detail.eligibility.result === 'LOCKED_UNLOCKABLE';
  const nearest =
    detail.branches.find((b) => b.id === detail.nearestBranch?.id) ?? detail.branches[0] ?? null;
  const distance = formatDistance(locale, detail.distanceMeters);
  const lines = visibleTermLines(locale, detail.terms.blocks, (h) => formatMoney(locale, h));
  const termsText = pickText(detail.terms.text, locale);
  const media = detail.media.length ? detail.media : [];
  const go = (b: PublicBranch) => {
    if (b.latitude === null || b.longitude === null) return;
    onDirections?.(b);
    if (!embedded) window.open(directionsUrl(b.latitude, b.longitude), '_blank', 'noopener');
  };
  const canGo = !!nearest && nearest.latitude !== null && nearest.longitude !== null;

  return (
    <div className={`dd-dd ${embedded ? 'dd-dd--embedded' : ''}`}>
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
        {onToggleSave ? (
          <SaveButton
            saved={detail.saved}
            onToggle={onToggleSave}
            locale={locale}
            className="dd-dd__save"
          />
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
          <span className="dd-chip dd-chip--success">{t('deal.live')}</span>
        </div>
        <p className="dd-dd__title">{pickText(detail.title, locale)}</p>
        <p className="dd-muted">{pickText(detail.shortDescription, locale)}</p>
        <div className="dd-dd__dates">
          <span>
            {detail.startsAt
              ? t('deal.startsOn', { date: dateLabel(locale, detail.startsAt) })
              : ''}
          </span>
          <span>
            {detail.endsAt
              ? t('deal.endsOn', { date: dateLabel(locale, detail.endsAt) })
              : t('deal.ongoing')}
          </span>
        </div>
        <div className="dd-dd__badges">
          <span className="dd-chip dd-chip--info">
            <Icon name="tag" size={13} /> {t(`elig.${detail.eligibility.kind}` as never)}
          </span>
          {nearest ? (
            <span className="dd-chip dd-chip--neutral">
              {detail.branches.length === 1
                ? t('deal.oneBranch')
                : t('deal.branchesCount', { n: detail.branches.length })}
            </span>
          ) : null}
        </div>

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
                    {t(`elig.unlock.${detail.eligibility.unlockAction}` as never)}
                  </button>
                  {detail.eligibility.unlockAction !== 'SIGN_IN' ? (
                    <span className="dd-caption">{t('elig.comingLater')}</span>
                  ) : null}
                </div>
              ) : embedded ? (
                <div className="dd-caption">{t('elig.preview')}</div>
              ) : null}
              <div className="dd-caption">{t('elig.noCardData')}</div>
            </div>
          </div>
        ) : null}

        <div className="dd-dd__go">
          <strong>{t('deal.justSeeAndGo')}</strong>
          <span>{t('deal.justSeeAndGoBody')}</span>
        </div>
      </div>

      <div className="dd-dd__tabs" role="tablist" aria-label={t('deal.overview')}>
        {(['overview', 'details'] as const).map((id) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            className="dd-dd__tab"
            onClick={() => setTab(id)}
          >
            {t(`deal.${id}` as never)}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <div className="dd-dd__panel">
          {nearest ? (
            <div className="dd-dd__branch">
              <span className="dd-dd__branchicon">
                <Icon name="pin" size={20} />
              </span>
              <div className="dd-grow">
                <strong>{pickText(nearest.name, locale)}</strong>
                <div className="dd-caption">
                  {distance ? <span className="dd-ltr">{distance} </span> : null}
                  {pickText(nearest.address, locale)}
                </div>
              </div>
              <button
                type="button"
                className="dd-btn dd-btn--secondary dd-btn--sm"
                disabled={!canGo}
                onClick={() => nearest && go(nearest)}
              >
                {t('merch.directions')}
              </button>
            </div>
          ) : null}
          {merchantHref ? (
            <Link href={merchantHref} className="dd-dd__merchantlink">
              <span>{t('deal.fromMerchant', { name: pickText(detail.merchantName, locale) })}</span>
              <span>{t('deal.viewMerchant')}</span>
              <Icon name="forward" size={16} />
            </Link>
          ) : null}
          <h3 className="dd-dd__h">{t('deal.description')}</h3>
          <p className="dd-pre">{pickText(detail.description, locale)}</p>
          {media.length > 1 ? (
            <>
              <h3 className="dd-dd__h">{t('deal.photos', { n: media.length })}</h3>
              <div className="dd-dd__photos">
                {media.map((m, i) => (
                  <img key={i} src={m.url} alt={pickText(m.alt, locale)} loading="lazy" />
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <div className="dd-dd__panel">
          <h3 className="dd-dd__h">{t('deal.terms')}</h3>
          <ul className="dd-dd__terms">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
            {termsText ? <li>{termsText}</li> : null}
          </ul>
          <h3 className="dd-dd__h">{t('deal.branches')}</h3>
          <div className="dd-stack">
            {detail.branches.map((b) => {
              const st = openStatus(b.hours, now);
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
                          {st.next
                            ? ` · ${st.open ? t('merch.closesAt', { time: st.next }) : t('merch.opensAt', { time: st.next })}`
                            : ''}
                        </span>
                      ) : (
                        t('deal.hoursUnknown')
                      )}
                      {d ? <span className="dd-ltr"> · {d}</span> : null}
                    </div>
                    {b.phone ? (
                      <div className="dd-caption dd-ltr">{isolateLtr(b.phone)}</div>
                    ) : null}
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
      )}
      {heroFooter}

      {!embedded ? (
        <div className="dd-dd__bar">
          <div>
            <strong>{t('deal.justSeeAndGo')}</strong>
            <div className="dd-caption">{t('deal.noCodeShort')}</div>
          </div>
          <button
            type="button"
            className="dd-btn dd-btn--primary"
            disabled={!canGo}
            onClick={() => nearest && go(nearest)}
            title={canGo ? undefined : t('deal.noDirections')}
          >
            {t('deal.directions')}
          </button>
        </div>
      ) : null}
      {signedIn === undefined ? null : null}
    </div>
  );
}
