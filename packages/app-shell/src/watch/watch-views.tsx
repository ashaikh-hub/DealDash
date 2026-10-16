import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  createTranslator,
  formatDateTime,
  formatMoney,
  formatNumber,
  type DictionaryKey,
  // customer views take the INTERFACE language (en / ar / ur); content is picked through pickText
  type UiLocale as Locale,
} from '@dealdash/localization';
import type { WatchStatus } from '@dealdash/types';
import { Alert, Button, Card, StatusChip, type StatusTone } from '@dealdash/ui';
import type {
  RewardEntryView,
  RewardItemView,
  RewardSummary,
  WatchBudget,
  WatchCard,
  WatchDetail,
  WatchMonitor,
} from '@dealdash/validation';
import { Icon } from '../deals/icons';
import { dateLabel, formatDistance, pickText } from '../deals/format';

type T = (key: DictionaryKey, vars?: Record<string, string | number>) => string;
const tr = (locale: Locale) => createTranslator(locale) as T;

export const WATCH_TONE: Record<WatchStatus, StatusTone> = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'warning',
  NEEDS_CHANGES: 'warning',
  REJECTED: 'danger',
  SCHEDULED: 'info',
  LIVE: 'success',
  PAUSED: 'neutral',
  COMPLETED: 'info',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
  SUSPENDED: 'danger',
};

export function WatchStatusChip({ status, locale }: { status: WatchStatus; locale: Locale }) {
  return (
    <StatusChip tone={WATCH_TONE[status]}>
      {tr(locale)(`wstatus.${status}` as DictionaryKey)}
    </StatusChip>
  );
}

/** "+10 points": a number and a word, never a currency (points have no cash value anywhere). */
export function Points({ n, locale, signed }: { n: number; locale: Locale; signed?: boolean }) {
  const t = tr(locale);
  const sign = signed ? (n > 0 ? '+' : n < 0 ? '−' : '') : '';
  return (
    <span className="dd-points">
      <span className="dd-ltr">
        {sign}
        {formatNumber(locale, Math.abs(n))}
      </span>{' '}
      {t('rew.pointsWord')}
    </span>
  );
}

// ================================================================ customer: card
export function WatchCardView({
  campaign,
  locale,
  variant = 'carousel',
  href,
  imageRef,
}: {
  campaign: WatchCard;
  locale: Locale;
  variant?: 'carousel' | 'list';
  href?: string;
  imageRef?: (el: HTMLElement | null) => void;
}) {
  const t = tr(locale);
  const a = campaign.availability;
  const unavailable = a !== 'AVAILABLE' && a !== 'NOT_ELIGIBLE';
  const locked = campaign.eligibility.result === 'LOCKED_UNLOCKABLE';
  const stateKey: Partial<Record<WatchCard['availability'], DictionaryKey>> = {
    ALREADY_EARNED: 'wat.state.earned',
    DAILY_CAP: 'wat.state.cap',
    BUDGET_EXHAUSTED: 'wat.state.over',
    ENDED: 'wat.state.ended',
    UNAVAILABLE: 'wat.state.unavailable',
  };
  const body = (
    <>
      <div className="dd-dc__media">
        {campaign.thumbnailUrl ? (
          <img src={campaign.thumbnailUrl} alt="" loading="lazy" />
        ) : (
          <div className="dd-dc__ph" aria-hidden="true" />
        )}
        <span className="dd-watch-play" aria-hidden="true">
          <Icon name="play" size={22} />
        </span>
        <span className="dd-watch-badge">
          <Icon name="play" size={12} /> {t('wat.badge')}
        </span>
        <span className="dd-watch-len dd-ltr">
          {formatNumber(locale, campaign.durationSec)}
          {t('wat.secShort')}
        </span>
        {stateKey[a] ? <span className="dd-dc__state">{t(stateKey[a]!)}</span> : null}
        {locked ? (
          <span className="dd-dc__lock">
            <Icon name="lock" size={14} /> {t('elig.locked')}
          </span>
        ) : null}
      </div>
      <div className="dd-dc__body">
        <h3 className="dd-dc__title">{pickText(campaign.title, locale)}</h3>
        <div className="dd-dc__merchant">{pickText(campaign.merchantName, locale)}</div>
        {/* the reward proposition: watch N seconds, earn the points */}
        <div className="dd-watch-prop" data-testid="watch-prop">
          {t('wat.prop', { sec: formatNumber(locale, campaign.durationSec) })}
        </div>
        <div className="dd-dc__meta">
          <span className="dd-chip dd-chip--success" data-testid="watch-points">
            <Points n={campaign.rewardPoints} locale={locale} signed />
          </span>
          {campaign.distanceMeters !== null && campaign.distanceMeters !== undefined ? (
            <span className="dd-dc__chip dd-ltr">
              <Icon name="pin" size={12} /> {formatDistance(locale, campaign.distanceMeters)}
            </span>
          ) : null}
          {unavailable && campaign.availableAgainAt ? (
            <span className="dd-dc__chip">
              {t('wat.again', { when: dateLabel(locale, campaign.availableAgainAt) })}
            </span>
          ) : null}
        </div>
        {locked && campaign.eligibility.message ? (
          <div className="dd-dc__unlock">{pickText(campaign.eligibility.message, locale)}</div>
        ) : null}
      </div>
    </>
  );
  return (
    <article
      className={`dd-dc dd-dc--${variant} dd-dc--watch ${unavailable ? 'dd-dc--soldout' : ''}`}
      data-watch-id={campaign.id}
      data-availability={a}
      data-testid="watch-card"
      ref={imageRef}
    >
      {href ? (
        <Link href={href} className="dd-dc__link" aria-label={pickText(campaign.title, locale)}>
          {body}
        </Link>
      ) : (
        <div className="dd-dc__link">{body}</div>
      )}
    </article>
  );
}

// ================================================================ customer: detail
export function WatchDetailView({
  detail,
  locale,
  embedded,
  signedIn,
  onBack,
  onStart,
  onSignIn,
  merchantHref,
}: {
  detail: WatchDetail;
  locale: Locale;
  embedded?: boolean;
  signedIn?: boolean;
  onBack?: () => void;
  onStart?: () => void;
  onSignIn?: () => void;
  merchantHref?: string;
}) {
  const t = tr(locale);
  const a = detail.availability;
  let action: ReactNode = null;
  if (!embedded) {
    if (a === 'ENDED') action = <Button disabled>{t('wat.state.ended')}</Button>;
    else if (a === 'BUDGET_EXHAUSTED') action = <Button disabled>{t('wat.state.over')}</Button>;
    else if (a === 'UNAVAILABLE') action = <Button disabled>{t('wat.state.unavailable')}</Button>;
    else if (!signedIn)
      action = (
        <Button onClick={onSignIn} data-testid="watch-signin">
          {t('wat.signInToEarn')}
        </Button>
      );
    else if (a === 'ALREADY_EARNED')
      action = (
        <Button disabled>
          {detail.availableAgainAt
            ? t('wat.again', { when: dateLabel(locale, detail.availableAgainAt) })
            : t('wat.state.earned')}
        </Button>
      );
    else if (a === 'DAILY_CAP') action = <Button disabled>{t('wat.state.cap')}</Button>;
    else if (a === 'NOT_ELIGIBLE' || !detail.canStart)
      action = <Button disabled>{t('vch.locked')}</Button>;
    else
      action = (
        <Button onClick={onStart} data-testid="watch-start">
          {t('wat.start', { n: detail.rewardPoints })}
        </Button>
      );
  }
  return (
    <div className={`dd-dd dd-watch ${embedded ? 'dd-dd--embedded' : ''}`}>
      <div className="dd-dd__hero">
        <div className="dd-dd__gallery">
          {detail.thumbnailUrl ? (
            <img src={detail.thumbnailUrl} alt="" />
          ) : (
            <div className="dd-dc__ph dd-dd__ph" aria-hidden="true" />
          )}
        </div>
        <div className="dd-dd__shade" aria-hidden="true" />
        <span className="dd-watch-play dd-watch-play--lg" aria-hidden="true">
          <Icon name="play" size={34} />
        </span>
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
          <p>{t('wat.sponsoredBy', { merchant: pickText(detail.merchantName, locale) })}</p>
        </div>
      </div>
      <div className="dd-dd__sheet">
        <div className="dd-dd__headline">
          <h2 className="dd-dd__offer" data-testid="watch-reward">
            <Points n={detail.rewardPoints} locale={locale} signed />
          </h2>
          <span className="dd-watch-badge dd-watch-badge--inline">
            <Icon name="play" size={12} /> {t('wat.badge')}
          </span>
        </div>
        <p className="dd-dd__title">{pickText(detail.title, locale)}</p>
        <p className="dd-muted">{pickText(detail.description, locale)}</p>
        <div className="dd-dd__badges">
          <span className="dd-chip dd-chip--info">
            <Icon name="clock" size={13} /> {t('wat.length', { n: detail.durationSec })}
          </span>
          {detail.endsAt ? (
            <span className="dd-chip dd-chip--neutral">
              {t('wat.ends', { date: dateLabel(locale, detail.endsAt) })}
            </span>
          ) : null}
        </div>
        {a === 'NOT_ELIGIBLE' && detail.eligibility.message ? (
          <div className="dd-dd__locked" role="status">
            <Icon name="lock" size={20} />
            <div>
              <strong>{pickText(detail.eligibility.message, locale)}</strong>
              <div className="dd-caption">{t('elig.noCardData')}</div>
            </div>
          </div>
        ) : null}
        {a === 'ALREADY_EARNED' || a === 'DAILY_CAP' ? (
          <Alert tone="info">
            <span>
              {a === 'ALREADY_EARNED' ? t('wat.earnedBody') : t('wat.capBody')}
              {detail.availableAgainAt
                ? ` ${t('wat.again', { when: dateLabel(locale, detail.availableAgainAt) })}`
                : ''}
            </span>
          </Alert>
        ) : null}
        <h3 className="dd-dd__h">{t('wat.howTitle')}</h3>
        <ol className="dd-hot-how" aria-label={t('wat.howTitle')}>
          {(['1', '2', '3'] as const).map((n) => (
            <li key={n}>{t(`wat.how${n}` as DictionaryKey)}</li>
          ))}
        </ol>
        <p className="dd-caption" data-testid="watch-points-note">
          {t('rew.notCash')}
        </p>
        {merchantHref ? (
          <p>
            <Link className="dd-link" href={merchantHref}>
              {t('wat.viewMerchant', { merchant: pickText(detail.merchantName, locale) })}
            </Link>
          </p>
        ) : null}
      </div>
      {!embedded ? (
        <div className="dd-dd__bar">
          <div>
            <strong data-testid="watch-bar-points">
              <Points n={detail.rewardPoints} locale={locale} signed />
            </strong>
            <div className="dd-caption">{t('wat.length', { n: detail.durationSec })}</div>
          </div>
          {action}
        </div>
      ) : null}
    </div>
  );
}

// ================================================================ rewards: balance, activity, catalogue
export function RewardSummaryCard({ summary, locale }: { summary: RewardSummary; locale: Locale }) {
  const t = tr(locale);
  return (
    <section
      className="dd-rewardcard dd-rewardcard--stack"
      data-testid="reward-summary"
      aria-label={t('rew.title')}
    >
      <div className="dd-caption dd-rewardcard__label">{t('rew.available')}</div>
      <div className="dd-rewardcard__big" data-testid="reward-available">
        <span className="dd-ltr">{formatNumber(locale, summary.availableBalance)}</span>
        <small>{t('rew.pointsWord')}</small>
      </div>
      <div className="dd-rewardcard__row">
        <div>
          <span className="dd-caption">{t('rew.held')}</span>
          <strong className="dd-ltr" data-testid="reward-held">
            {formatNumber(locale, summary.heldBalance)}
          </strong>
        </div>
        <div>
          <span className="dd-caption">{t('rew.earnedTotal')}</span>
          <strong className="dd-ltr">{formatNumber(locale, summary.lifetimeEarned)}</strong>
        </div>
        <div>
          <span className="dd-caption">{t('rew.redeemedTotal')}</span>
          <strong className="dd-ltr">{formatNumber(locale, summary.lifetimeRedeemed)}</strong>
        </div>
      </div>
      {summary.heldBalance > 0 ? <p className="dd-caption">{t('rew.heldNote')}</p> : null}
      {summary.expiringSoon ? (
        <Alert tone="warning">
          <span>
            {t('rew.expiring', {
              n: summary.expiringSoon.points,
              date: dateLabel(locale, summary.expiringSoon.at),
            })}
          </span>
        </Alert>
      ) : null}
      <p className="dd-caption" data-testid="reward-note">
        {t('rew.notCash')}
      </p>
    </section>
  );
}

const ENTRY_ICON: Record<string, string> = {
  EARN: 'play',
  HOLD: 'clock',
  RELEASE: 'check',
  REVERSE: 'x',
  REDEEM: 'gift',
  EXPIRE: 'history',
  ADMIN_ADJUSTMENT: 'sliders',
};

export function RewardEntryRow({ entry, locale }: { entry: RewardEntryView; locale: Locale }) {
  const t = tr(locale);
  const label = entry.title
    ? pickText(entry.title, locale)
    : t(`rew.type.${entry.type}` as DictionaryKey);
  return (
    <li className="dd-rewardrow" data-testid="reward-row" data-type={entry.type}>
      <span className="dd-rewardrow__icon" aria-hidden="true">
        <Icon name={ENTRY_ICON[entry.type] ?? 'other'} size={18} />
      </span>
      <div className="dd-rewardrow__body">
        <strong>{label}</strong>
        <span className="dd-caption">
          {entry.merchantName ? `${pickText(entry.merchantName, locale)} · ` : ''}
          {t(`rew.type.${entry.type}` as DictionaryKey)} · {formatDateTime(locale, entry.createdAt)}
        </span>
      </div>
      <strong
        className={`dd-rewardrow__pts ${entry.points < 0 ? 'dd-rewardrow__pts--neg' : ''}`}
        data-testid="reward-row-points"
      >
        <Points n={entry.points} locale={locale} signed />
      </strong>
    </li>
  );
}

export function RewardItemCard({
  item,
  locale,
  onRedeem,
  busy,
}: {
  item: RewardItemView;
  locale: Locale;
  onRedeem?: (item: RewardItemView) => void;
  busy?: boolean;
}) {
  const t = tr(locale);
  const out = item.stockLeft !== null && item.stockLeft <= 0;
  return (
    <Card flat>
      <div className="dd-stack" style={{ gap: 8 }} data-testid="reward-item" data-item-id={item.id}>
        <div className="dd-row" style={{ justifyContent: 'space-between' }}>
          <strong>{pickText(item.name, locale)}</strong>
          {item.isSample ? <StatusChip tone="neutral">{t('rew.sample')}</StatusChip> : null}
        </div>
        {pickText(item.description, locale) ? (
          <p className="dd-muted" style={{ margin: 0 }}>
            {pickText(item.description, locale)}
          </p>
        ) : null}
        <div className="dd-row" style={{ justifyContent: 'space-between' }}>
          <strong>
            <Points n={item.pointsCost} locale={locale} />
          </strong>
          {out ? (
            <StatusChip tone="warning">{t('rew.outOfStock')}</StatusChip>
          ) : item.stockLeft !== null && item.stockLeft <= 5 ? (
            <span className="dd-caption">{t('rew.stockLeft', { n: item.stockLeft })}</span>
          ) : null}
        </div>
        <Button
          size="sm"
          variant={item.canRedeem ? 'primary' : 'outline'}
          disabled={!item.canRedeem || busy}
          loading={busy}
          onClick={() => onRedeem?.(item)}
          data-testid="reward-redeem"
        >
          {out ? t('rew.outOfStock') : item.canRedeem ? t('rew.redeem') : t('rew.notEnough')}
        </Button>
      </div>
    </Card>
  );
}

// ================================================================ merchant / admin: budget and monitor
export function BudgetMeter({ budget, locale }: { budget: WatchBudget; locale: Locale }) {
  const t = tr(locale);
  const pct =
    budget.fundedHalalas > 0
      ? Math.min(100, (budget.spentHalalas * 100) / budget.fundedHalalas)
      : 0;
  return (
    <div className="dd-stack" data-testid="budget-meter" style={{ gap: 8 }}>
      <div
        className="dd-meter"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={t('wmon.budgetSpent')}
      >
        <span style={{ inlineSize: `${pct}%` }} />
      </div>
      <dl className="dd-kv">
        <div className="dd-kv__row">
          <dt>{t('wmon.required')}</dt>
          <dd className="dd-ltr" data-testid="budget-required">
            {formatMoney(locale, budget.requiredHalalas)}
          </dd>
        </div>
        <div className="dd-kv__row">
          <dt>{t('wmon.funded')}</dt>
          <dd className="dd-ltr" data-testid="budget-funded">
            {formatMoney(locale, budget.fundedHalalas)}
          </dd>
        </div>
        <div className="dd-kv__row">
          <dt>{t('wmon.spent')}</dt>
          <dd className="dd-ltr" data-testid="budget-spent">
            {formatMoney(locale, budget.spentHalalas)}
          </dd>
        </div>
        <div className="dd-kv__row">
          <dt>{t('wmon.remaining')}</dt>
          <dd className="dd-ltr" data-testid="budget-remaining">
            {formatMoney(locale, budget.remainingHalalas)}
          </dd>
        </div>
        <div className="dd-kv__row">
          <dt>{t('wmon.unused')}</dt>
          <dd className="dd-ltr" data-testid="budget-unused">
            {formatMoney(locale, budget.unusedHalalas)}
          </dd>
        </div>
        <div className="dd-kv__row">
          <dt>{t('wmon.charge')}</dt>
          <dd className="dd-ltr">{formatMoney(locale, budget.chargePerViewHalalas)}</dd>
        </div>
      </dl>
      {budget.closedOut ? (
        <Alert tone="info">
          <span data-testid="budget-unused-note">{t('wmon.unusedNote')}</span>
        </Alert>
      ) : null}
    </div>
  );
}

function Kpi({ label, value, testId }: { label: string; value: string | number; testId?: string }) {
  return (
    <Card flat>
      <div className="dd-caption">{label}</div>
      <div className="dd-title-xl dd-ltr" style={{ fontSize: 24 }} data-testid={testId}>
        {value}
      </div>
    </Card>
  );
}

/** Verified numbers only: views, completion, verified spend, rewards summary. No invented revenue, no customer identities. */
export function WatchMonitorView({ mon, locale }: { mon: WatchMonitor; locale: Locale }) {
  const t = tr(locale);
  const n = (v: number) => formatNumber(locale, v);
  const cats = Object.entries(mon.funnel.invalidByCategory);
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="watch-monitor">
      <div className="dd-finance-grid">
        <Kpi
          label={t('wmon.kpi.qualified')}
          value={n(mon.delivery.qualifiedViews)}
          testId="kpi-qualified"
        />
        <Kpi
          label={t('wmon.kpi.remainingViews')}
          value={n(mon.delivery.remainingViews)}
          testId="kpi-remaining-views"
        />
        <Kpi label={t('wmon.kpi.delivery')} value={`${n(mon.delivery.pct)}%`} />
        <Kpi
          label={t('wmon.kpi.completion')}
          value={mon.completionRatePct === null ? '–' : `${n(mon.completionRatePct)}%`}
        />
        <Kpi
          label={t('wmon.kpi.cost')}
          value={
            mon.costPerQualifiedViewHalalas === null
              ? '–'
              : formatMoney(locale, mon.costPerQualifiedViewHalalas)
          }
        />
        <Kpi label={t('wmon.kpi.viewers')} value={n(mon.reach.uniqueViewers)} />
        <Kpi label={t('wmon.kpi.frequency')} value={n(mon.reach.averageFrequency)} />
        <Kpi label={t('wmon.kpi.cta')} value={n(mon.funnel.ctaClicks)} />
      </div>
      <Card flat>
        <h2 className="dd-title">{t('wmon.budget')}</h2>
        <BudgetMeter budget={mon.budget} locale={locale} />
      </Card>
      <Card flat>
        <h2 className="dd-title">{t('wmon.funnel')}</h2>
        <dl className="dd-kv" style={{ marginBlockStart: 8 }}>
          {(
            [
              ['impressions', mon.funnel.impressions],
              ['opened', mon.funnel.opened],
              ['started', mon.funnel.started],
              ['completed', mon.funnel.completed],
              ['qualified', mon.funnel.qualified],
              ['invalid', mon.funnel.invalid],
              ['capped', mon.funnel.capped],
            ] as const
          ).map(([k, v]) => (
            <div className="dd-kv__row" key={k}>
              <dt>{t(`wmon.funnel.${k}` as DictionaryKey)}</dt>
              <dd className="dd-ltr" data-testid={`funnel-${k}`}>
                {n(v)}
              </dd>
            </div>
          ))}
        </dl>
        {cats.length ? (
          <>
            <h3 className="dd-caption" style={{ marginBlockStart: 12 }}>
              {t('wmon.notCounted')}
            </h3>
            <dl className="dd-kv">
              {cats.map(([k, v]) => (
                <div className="dd-kv__row" key={k}>
                  <dt>{t(`wmon.reason.${k}` as DictionaryKey)}</dt>
                  <dd className="dd-ltr" data-testid={`reason-${k}`}>
                    {n(v)}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}
      </Card>
      <Card flat>
        <h2 className="dd-title">{t('wmon.rewards')}</h2>
        <dl className="dd-kv" style={{ marginBlockStart: 8 }}>
          <div className="dd-kv__row">
            <dt>{t('wmon.rewarded')}</dt>
            <dd className="dd-ltr">{n(mon.rewards.rewardedViews)}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('wmon.pointsIssued')}</dt>
            <dd className="dd-ltr">{n(mon.rewards.pointsIssued)}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('wmon.heldViews')}</dt>
            <dd className="dd-ltr">{n(mon.rewards.heldViews)}</dd>
          </div>
        </dl>
        <p className="dd-caption">{t('wmon.rewardsNote')}</p>
      </Card>
      <p className="dd-caption">{t('wmon.disclaimer')}</p>
    </div>
  );
}
