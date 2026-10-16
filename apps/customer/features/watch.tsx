'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Icon,
  Points,
  RewardEntryRow,
  RewardItemCard,
  RewardSummaryCard,
  WatchCardView,
  WatchDetailView,
  errorMessage,
  pickText,
  useApi,
  useAuth,
} from '@dealdash/app-shell';
import { formatNumber, type DictionaryKey } from '@dealdash/localization';
import { Alert, Button, EmptyState, Modal, Skeleton } from '@dealdash/ui';
import type {
  RewardEntryView,
  RewardItemView,
  RewardSummary,
  WatchCard,
  WatchDetail,
  WatchEventsResult,
  WatchHub,
  WatchOutcomeView,
  WatchViewStarted,
} from '@dealdash/validation';
import { useCustomer, useImpression } from './customer-context';
import { CardSkeletons, CityBar, LoadError, RailEmpty, SectionHead, useHref, useT } from './parts';
import { RAIL_SIZE, curate, presentWatch } from './presentation';
import { useDealList } from './use-deals';

// ------------------------------------------------------------------ device id (random, app-generated: no fingerprinting)
const DEVICE_KEY = 'dd_device';
function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      id = 'dev-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'dev-session-' + Math.random().toString(16).slice(2, 18).padEnd(16, '0');
  }
}

// ------------------------------------------------------------------ card with impression tracking
export function TrackedWatchCard({
  campaign,
  variant,
  category,
}: {
  campaign: WatchCard;
  variant: 'carousel' | 'list';
  /** The merchant's category when known (picture for a video without its own thumbnail). */
  category?: string | null;
}) {
  const { uiLocale: locale } = useAuth();
  const href = useHref();
  const ref = useImpression(campaign.id, undefined, 'WATCH');
  return (
    <WatchCardView
      campaign={presentWatch(campaign, category)}
      locale={locale}
      variant={variant}
      href={href(`/watch/${campaign.id}`)}
      imageRef={ref}
    />
  );
}

function useHub() {
  const { call } = useApi();
  const { status } = useAuth();
  const { city } = useCustomer();
  const [hub, setHub] = useState<WatchHub | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const load = useCallback(async () => {
    setState('loading');
    const r = await call<WatchHub>('GET', '/v1/app/watch', { query: { city, limit: 30 } });
    if (r.ok && r.data) {
      setHub(r.data);
      setState('ready');
    } else setState('error');
  }, [call, city]);
  useEffect(() => {
    void load();
  }, [load, status]);
  return { hub, state, reload: load };
}

// ------------------------------------------------------------------ home rail
export function WatchRail({ categories }: { categories?: Map<string, string> } = {}) {
  const { t } = useT();
  const href = useHref();
  const { hub, state } = useHub();
  if (state === 'loading') return <CardSkeletons variant="carousel" n={2} />;
  const cards =
    state === 'error' ? [] : (hub?.campaigns ?? []).filter((c) => c.availability !== 'ENDED');
  // Home presents Watch & Earn even when no video is available right now (a note and the way to the hub)
  if (!cards.length)
    return (
      <section className="dd-section" aria-label={t('wat.rail')} data-testid="watch-rail">
        <SectionHead
          icon="play"
          title={t('wat.rail')}
          sub={t('wat.railSub')}
          action={
            <Link className="dd-link" href={href('/watch')}>
              {t('cust.seeAll')}
            </Link>
          }
        />
        <RailEmpty
          icon="play"
          text={t('home.empty.watch')}
          href={href('/watch')}
          cta={t('cust.seeAll')}
          testId="watch-rail-empty"
        />
      </section>
    );
  return (
    <section className="dd-section" aria-label={t('wat.rail')} data-testid="watch-rail">
      <SectionHead
        icon="play"
        title={t('wat.rail')}
        sub={t('wat.railSub')}
        action={
          <Link className="dd-link" href={href('/watch')}>
            {t('cust.seeAll')}
          </Link>
        }
      />
      {/* compact carousel (founder direction 2026-10-16): up to five videos, the next one peeking, the rest behind See all */}
      <div className="dd-hscroll dd-rail" data-testid="watch-rail-items">
        {curate([cards], RAIL_SIZE).map((c) => (
          <TrackedWatchCard
            key={c.id}
            campaign={c}
            variant="carousel"
            category={categories?.get(c.merchantId)}
          />
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ hub (tab)
export function WatchHubPage() {
  const { t, locale } = useT();
  const href = useHref();
  const { status } = useAuth();
  const { hub, state, reload } = useHub();
  const signedIn = status === 'authenticated';
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="watch-hub">
      <CityBar />
      <div>
        <h1 className="dd-title-xl">{t('wat.title')}</h1>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('wat.sub')}
        </p>
      </div>
      {signedIn && hub ? (
        <Link href={href('/rewards')} className="dd-watch-balance" data-testid="watch-balance">
          <span className="dd-watch-balance__icon" aria-hidden="true">
            <Icon name="gift" size={20} />
          </span>
          <span>
            <span className="dd-caption">{t('rew.available')}</span>
            <strong className="dd-ltr" data-testid="watch-balance-points">
              {formatNumber(locale, hub.balance.availableBalance)}
            </strong>{' '}
            <small>{t('rew.pointsWord')}</small>
          </span>
          <span className="dd-caption" data-testid="watch-daily">
            {t('wat.daily', {
              n: formatNumber(locale, hub.daily.earnedViews),
              cap: formatNumber(locale, hub.daily.cap),
            })}
          </span>
        </Link>
      ) : !signedIn ? (
        <Alert tone="info">
          <span>{t('wat.signInBanner')}</span>
        </Alert>
      ) : null}
      <p className="dd-caption">{t('rew.notCash')}</p>
      {state === 'loading' ? (
        <CardSkeletons />
      ) : state === 'error' || !hub ? (
        <LoadError onRetry={reload} />
      ) : hub.campaigns.length === 0 ? (
        <EmptyState title={t('wat.empty')} description={t('wat.emptyBody')} />
      ) : (
        <div className="dd-cardgrid">
          {hub.campaigns.map((c) => (
            <TrackedWatchCard key={c.id} campaign={c} variant="list" />
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ detail
export function WatchPage({ id }: { id: string }) {
  const { t, locale } = useT();
  const { call } = useApi();
  const { status } = useAuth();
  const router = useRouter();
  const href = useHref();
  const { city, track } = useCustomer();
  const [detail, setDetail] = useState<WatchDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setState('loading');
      const r = await call<WatchDetail>('GET', `/v1/app/watch/campaigns/${id}`, {
        query: { city },
      });
      if (r.ok && r.data) {
        setDetail(r.data);
        setState('ready');
      } else if (!quiet) setState(r.status === 404 ? 'missing' : 'error');
    },
    [call, id, city],
  );
  useEffect(() => {
    void load();
  }, [load, status]);

  const viewed = detail?.id;
  useEffect(() => {
    if (viewed) track({ type: 'DETAIL_VIEW', dealId: viewed, product: 'WATCH' });
    // one detail view per opened campaign
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewed]);

  const back = () => (window.history.length > 1 ? router.back() : router.push(href('/watch')));
  if (state === 'loading')
    return (
      <div className="dd-stack" style={{ margin: -16 }} aria-busy="true">
        <Skeleton height={280} />
        <div style={{ padding: 16, display: 'grid', gap: 10 }}>
          <Skeleton height={32} width="50%" />
          <Skeleton height={16} />
        </div>
      </div>
    );
  if (state === 'error') return <LoadError onRetry={() => void load()} />;
  if (state === 'missing' || !detail)
    return (
      <div className="dd-stack">
        <Button variant="ghost" onClick={back}>
          ← {t('cust.back')}
        </Button>
        <EmptyState title={t('wat.gone')} description={t('wat.goneBody')} />
      </div>
    );
  return (
    <WatchDetailView
      detail={presentWatch(detail)}
      locale={locale}
      signedIn={status === 'authenticated'}
      onBack={back}
      onStart={() => router.push(href(`/watch/${id}/play`))}
      onSignIn={() => router.push(href('/profile') + '?reason=earn')}
      merchantHref={href(`/merchants/${detail.merchantId}`)}
    />
  );
}

// ------------------------------------------------------------------ player
type Phase = 'starting' | 'ready' | 'playing' | 'finishing' | 'done' | 'error';

/**
 * The player only REPORTS what happened (heartbeats, visibility, the still-watching answer); the server decides everything.
 * There are no seek controls, no thresholds in the client and no reward maths here.
 */
export function WatchPlayerPage({ id }: { id: string }) {
  const { t, locale } = useT();
  const { call } = useApi();
  const { status } = useAuth();
  const router = useRouter();
  const href = useHref();
  const { city, track } = useCustomer();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sessionRef = useRef<WatchViewStarted | null>(null);
  const startedRef = useRef(false);
  const finishingRef = useRef(false);
  const [phase, setPhase] = useState<Phase>('starting');
  const [session, setSession] = useState<WatchViewStarted | null>(null);
  const [detail, setDetail] = useState<WatchDetail | null>(null);
  const [pos, setPos] = useState(0);
  const [prompt, setPrompt] = useState<{ id: string; deadlineSec: number } | null>(null);
  const [promptLeft, setPromptLeft] = useState(0);
  const [needsTap, setNeedsTap] = useState(false);
  const [outcome, setOutcome] = useState<WatchOutcomeView | null>(null);
  const [error, setError] = useState('');

  const send = useCallback(
    async (events: Array<Record<string, unknown>>) => {
      const s = sessionRef.current;
      if (!s) return null;
      const r = await call<WatchEventsResult>('POST', `/v1/app/watch/views/${s.viewId}/events`, {
        body: { events },
        headers: { 'x-view-token': s.viewToken },
      });
      return r.ok ? r.data : null;
    },
    [call],
  );

  const finish = useCallback(
    async (completed: boolean) => {
      const s = sessionRef.current;
      if (!s || finishingRef.current) return;
      finishingRef.current = true;
      setPhase('finishing');
      videoRef.current?.pause();
      const position = Math.min(videoRef.current?.currentTime ?? 0, s.durationSec);
      const r = completed
        ? await call<WatchOutcomeView>('POST', `/v1/app/watch/views/${s.viewId}/complete`, {
            body: { positionSec: position },
            headers: { 'x-view-token': s.viewToken },
          })
        : await call<WatchOutcomeView>('GET', `/v1/app/watch/views/${s.viewId}`);
      if (r.ok && r.data) {
        setOutcome(r.data);
        setPhase('done');
      } else {
        setError(errorMessage(locale, r.errors));
        setPhase('error');
      }
    },
    [call, locale],
  );

  // 1. start the server-side viewing session (once)
  useEffect(() => {
    if (status === 'loading' || startedRef.current) return;
    if (status !== 'authenticated') {
      setPhase('error');
      setError(t('wat.signInPrompt'));
      return;
    }
    startedRef.current = true;
    void (async () => {
      const [d, s] = await Promise.all([
        call<WatchDetail>('GET', `/v1/app/watch/campaigns/${id}`, { query: { city } }),
        call<WatchViewStarted>('POST', '/v1/app/watch/views', {
          body: { campaignId: id, deviceId: deviceId(), city },
        }),
      ]);
      if (d.ok && d.data) setDetail(d.data);
      if (!s.ok || !s.data) {
        const code = s.errors[0]?.field;
        setError(
          s.status === 0
            ? t('hot.connError')
            : code
              ? t(`wat.block.${code}` as DictionaryKey)
              : errorMessage(locale, s.errors),
        );
        setPhase('error');
        return;
      }
      sessionRef.current = s.data;
      setSession(s.data);
      setPhase('ready');
    })();
  }, [status, call, id, city, locale, t]);

  // 2. play as soon as the video can (autoplay may be blocked: then the customer taps once)
  const play = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      await v.play();
      setNeedsTap(false);
      setPhase('playing');
    } catch {
      setNeedsTap(true);
    }
  }, []);

  // 3. heartbeats while playing
  useEffect(() => {
    if (phase !== 'playing' || !session) return;
    const timer = setInterval(async () => {
      const v = videoRef.current;
      if (!v || v.paused || prompt) return;
      const r = await send([
        { type: 'HEARTBEAT', positionSec: v.currentTime, clientAt: Date.now() },
      ]);
      if (!r) return;
      if (r.state !== 'STARTED') {
        void finish(false);
        return;
      }
      if (r.prompt) {
        v.pause();
        setPrompt(r.prompt);
        setPromptLeft(r.prompt.deadlineSec);
        void send([{ type: 'PROMPT_SHOWN', positionSec: v.currentTime }]);
      }
    }, session.heartbeatSec * 1000);
    return () => clearInterval(timer);
  }, [phase, session, send, finish, prompt]);

  // 4. the still-watching countdown (the server owns the deadline; this is only the visible timer)
  useEffect(() => {
    if (!prompt) return;
    const timer = setInterval(() => setPromptLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(timer);
  }, [prompt]);

  // 5. visibility: leaving the app pauses the video and is reported
  useEffect(() => {
    if (!session) return;
    const onVis = () => {
      const v = videoRef.current;
      if (document.hidden) {
        v?.pause();
        void send([{ type: 'BACKGROUND', positionSec: v?.currentTime ?? 0 }]);
      } else if (phase === 'playing') {
        void send([{ type: 'FOREGROUND', positionSec: v?.currentTime ?? 0 }]).then((r) => {
          if (r && r.state !== 'STARTED') void finish(false);
          else void v?.play().catch(() => setNeedsTap(true));
        });
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [session, phase, send, finish]);

  const answer = async () => {
    if (!prompt) return;
    const v = videoRef.current;
    const r = await send([
      {
        type: 'PROMPT_ANSWERED',
        positionSec: v?.currentTime ?? 0,
        promptId: prompt.id,
        clientAt: Date.now(),
      },
    ]);
    setPrompt(null);
    if (r && r.state !== 'STARTED') return void finish(false);
    void v?.play().catch(() => setNeedsTap(true));
  };

  const cta = () => {
    if (!outcome?.link || !detail) return null;
    const { type, id: target } = outcome.link;
    const to =
      type === 'LIVE_DEAL' && target
        ? `/deals/${target}`
        : type === 'HOT_DEAL' && target
          ? `/hot/${target}`
          : type === 'VOUCHER' && target
            ? `/vouchers/${target}`
            : type === 'MERCHANT'
              ? `/merchants/${detail.merchantId}`
              : null;
    if (!to) return null;
    return (
      <Button
        variant="secondary"
        block
        data-testid="outcome-cta"
        onClick={() => {
          track({ type: 'CTA_CLICK', dealId: id, product: 'WATCH' });
          router.push(href(to));
        }}
      >
        {pickText(detail.ctaLabel, locale)}
      </Button>
    );
  };

  const duration = session?.durationSec ?? detail?.durationSec ?? 0;
  const pct = duration > 0 ? Math.min(100, (pos / duration) * 100) : 0;

  return (
    <div className="dd-player" data-testid="watch-player" data-phase={phase}>
      <div className="dd-player__bar">
        <button
          type="button"
          className="dd-dd__back dd-player__back"
          aria-label={t('cust.back')}
          onClick={() => {
            if (phase === 'playing' || phase === 'ready')
              void finish(false).finally(() => router.push(href(`/watch/${id}`)));
            else router.push(href('/watch'));
          }}
        >
          <Icon name="back" size={20} />
        </button>
        <div className="dd-player__title">
          <strong>{detail ? pickText(detail.title, locale) : ''}</strong>
          <span className="dd-caption">
            {detail
              ? t('wat.sponsoredBy', { merchant: pickText(detail.merchantName, locale) })
              : ''}
          </span>
        </div>
        {detail ? (
          <span className="dd-chip dd-chip--success">
            <Points n={detail.rewardPoints} locale={locale} signed />
          </span>
        ) : null}
      </div>

      {phase === 'starting' ? (
        <div className="dd-player__stage" aria-busy="true">
          <Skeleton height={220} />
        </div>
      ) : phase === 'error' ? (
        <div className="dd-stack" data-testid="player-error" style={{ padding: 16 }}>
          <Alert tone="warning">
            <span>{error || t('error.generic')}</span>
          </Alert>
          <Button
            block
            onClick={() =>
              router.push(
                href(status === 'authenticated' ? '/watch' : '/profile') +
                  (status === 'authenticated' ? '' : '?reason=earn'),
              )
            }
          >
            {status === 'authenticated' ? t('wat.backToHub') : t('auth.signIn')}
          </Button>
        </div>
      ) : session && phase !== 'done' ? (
        <div className="dd-player__stage">
          <video
            ref={videoRef}
            className="dd-player__video"
            src={session.playbackUrl}
            poster={session.posterUrl ?? undefined}
            playsInline
            preload="auto"
            controls={false}
            disablePictureInPicture
            data-testid="player-video"
            onCanPlay={() => {
              if (phase === 'ready') void play();
            }}
            onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
            onEnded={() => void finish(true)}
            onError={() => {
              setError(t('wat.videoError'));
              setPhase('error');
            }}
          />
          {needsTap || phase === 'ready' ? (
            <button
              type="button"
              className="dd-player__tap"
              onClick={() => void play()}
              data-testid="player-tap"
              aria-label={t('wat.tapToPlay')}
            >
              <Icon name="play" size={42} />
              <span>{t('wat.tapToPlay')}</span>
            </button>
          ) : null}
          <div className="dd-player__progress" aria-hidden="true">
            <span style={{ inlineSize: `${pct}%` }} data-testid="player-progress" />
          </div>
          <p className="dd-player__hint" data-testid="player-hint">
            {phase === 'finishing' ? t('wat.checking') : t('wat.stayHint')}
          </p>
        </div>
      ) : null}

      <Modal
        open={!!prompt}
        onClose={() => undefined}
        title={t('wat.promptTitle')}
        closeLabel={t('common.close')}
        footer={
          <Button onClick={() => void answer()} data-testid="player-prompt-confirm" block>
            {t('wat.promptYes')}
          </Button>
        }
      >
        <div data-testid="player-prompt">
          <p>{t('wat.promptBody')}</p>
          <p className="dd-caption dd-ltr">{promptLeft}</p>
        </div>
      </Modal>

      {phase === 'done' && outcome ? (
        <div
          className="dd-player__result"
          data-testid="player-outcome"
          data-outcome={outcome.outcome}
        >
          {outcome.outcome === 'QUALIFIED' || outcome.outcome === 'HELD' ? (
            <>
              <span className="dd-player__check" aria-hidden="true">
                <Icon name={outcome.outcome === 'QUALIFIED' ? 'check' : 'clock'} size={34} />
              </span>
              <h1 className="dd-title-xl" data-testid="outcome-title">
                {outcome.outcome === 'QUALIFIED' ? t('wat.earned') : t('wat.heldTitle')}
              </h1>
              {outcome.reward ? (
                <p className="dd-player__points" data-testid="outcome-points">
                  <Points n={outcome.reward.points} locale={locale} signed />
                </p>
              ) : null}
              <p className="dd-muted">
                {outcome.outcome === 'QUALIFIED' ? t('wat.addedBody') : t('wat.heldBody')}
              </p>
              {outcome.balance ? (
                <p className="dd-caption" data-testid="outcome-balance">
                  {t('wat.balanceNow', {
                    n: formatNumber(locale, outcome.balance.availableBalance),
                  })}
                </p>
              ) : null}
              <p className="dd-caption">{t('rew.notCash')}</p>
            </>
          ) : (
            <>
              <span className="dd-player__check dd-player__check--no" aria-hidden="true">
                <Icon name="info" size={34} />
              </span>
              <h1 className="dd-title-xl" data-testid="outcome-title">
                {t('wat.notCounted')}
              </h1>
              <p className="dd-muted" data-testid="outcome-reason">
                {t(`wat.reason.${outcome.reasonClass ?? 'OTHER'}` as DictionaryKey)}
              </p>
            </>
          )}
          <div className="dd-stack" style={{ gap: 8, inlineSize: '100%' }}>
            {outcome.outcome === 'QUALIFIED' || outcome.outcome === 'HELD' ? cta() : null}
            <Button block onClick={() => router.push(href('/watch'))} data-testid="outcome-more">
              {t('wat.moreVideos')}
            </Button>
            <Button block variant="outline" onClick={() => router.push(href('/rewards'))}>
              {t('rew.open')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ rewards (tab): balance, activity, catalogue
export function RewardsPage() {
  const { t, locale } = useT();
  const { call } = useApi();
  const { status } = useAuth();
  const router = useRouter();
  const href = useHref();
  const signedIn = status === 'authenticated';
  const [summary, setSummary] = useState<RewardSummary | null>(null);
  const [items, setItems] = useState<RewardItemView[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<RewardItemView | null>(null);
  const [done, setDone] = useState<{ name: string; code: string } | null>(null);
  const [error, setError] = useState('');
  const activity = useDealList<RewardEntryView>(
    '/v1/app/rewards/activity',
    { limit: 20 },
    signedIn,
  );

  const load = useCallback(async () => {
    if (!signedIn) return;
    setState('loading');
    const [s, c] = await Promise.all([
      call<RewardSummary>('GET', '/v1/app/rewards'),
      call<RewardItemView[]>('GET', '/v1/app/rewards/catalogue'),
    ]);
    if (s.ok && s.data) {
      setSummary(s.data);
      setItems(c.data ?? []);
      setState('ready');
    } else setState('error');
  }, [call, signedIn]);
  useEffect(() => {
    if (status === 'loading') return;
    if (signedIn) void load();
  }, [load, signedIn, status]);

  if (status !== 'loading' && !signedIn)
    return (
      <div className="dd-stack" data-testid="rewards-signin">
        <h1 className="dd-title-xl">{t('rew.title')}</h1>
        {/* the Home rewards card language: navy card, amber accent, one clear action */}
        <section className="dd-rewardcard dd-rewardcard--stack">
          <div className="dd-rewardcard__body">
            <span className="dd-rewardcard__kicker">
              <Icon name="gift" size={16} /> {t('rew.title')}
            </span>
            <h2 className="dd-rewardcard__title">{t('rew.signInTitle')}</h2>
            <p className="dd-rewardcard__text">{t('rew.signInBody')}</p>
          </div>
          <button
            type="button"
            className="dd-rewardcard__cta"
            onClick={() => router.push(href('/profile') + '?reason=earn')}
          >
            {t('auth.signIn')}
          </button>
        </section>
      </div>
    );

  const redeem = async () => {
    if (!confirm) return;
    setBusy(confirm.id);
    setError('');
    const r = await call<{ code: string; itemName: { en: string; ar: string } }>(
      'POST',
      '/v1/app/rewards/redeem',
      { body: { itemId: confirm.id }, idempotent: true },
    );
    setBusy(null);
    if (!r.ok || !r.data) {
      setError(errorMessage(locale, r.errors));
      return;
    }
    setDone({ name: pickText(r.data.itemName, locale), code: r.data.code });
    setConfirm(null);
    void load();
    void activity.reload();
  };

  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="rewards-page">
      <h1 className="dd-title-xl">{t('rew.title')}</h1>
      {state === 'loading' ? (
        <Skeleton height={150} />
      ) : state === 'error' || !summary ? (
        <LoadError onRetry={load} />
      ) : (
        <RewardSummaryCard summary={summary} locale={locale} />
      )}
      {done ? (
        <Alert tone="success" title={t('rew.redeemedTitle', { name: done.name })}>
          <span data-testid="redeemed-code">
            {t('rew.redeemedCode')} <strong className="dd-ltr">{done.code}</strong>
          </span>
        </Alert>
      ) : null}
      <section className="dd-section" aria-label={t('rew.catalogue')}>
        <SectionHead icon="gift" title={t('rew.catalogue')} sub={t('rew.catalogueSub')} />
        {items.length === 0 ? (
          <EmptyState title={t('rew.noItems')} />
        ) : (
          <div className="dd-cardgrid" data-testid="reward-catalogue">
            {items.map((i) => (
              <RewardItemCard
                key={i.id}
                item={i}
                locale={locale}
                busy={busy === i.id}
                onRedeem={(it) => {
                  setError('');
                  setConfirm(it);
                }}
              />
            ))}
          </div>
        )}
        <p className="dd-caption">{t('rew.catalogueNote')}</p>
      </section>
      <section className="dd-section" aria-label={t('rew.activity')}>
        <SectionHead icon="history" title={t('rew.activity')} />
        {activity.loading ? (
          <Skeleton height={64} />
        ) : activity.items.length === 0 ? (
          <EmptyState title={t('rew.noActivity')} description={t('rew.noActivityBody')} />
        ) : (
          <ul className="dd-rewardlist" data-testid="reward-activity">
            {activity.items.map((e) => (
              <RewardEntryRow key={e.id} entry={e} locale={locale} />
            ))}
          </ul>
        )}
        {activity.hasMore ? (
          <Button
            variant="outline"
            block
            onClick={() => void activity.more()}
            loading={activity.loadingMore}
          >
            {t('cust.moreDeals')}
          </Button>
        ) : null}
      </section>

      <Modal
        open={!!confirm}
        onClose={() => busy === null && setConfirm(null)}
        title={t('rew.confirmTitle')}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={busy !== null}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => void redeem()}
              loading={busy !== null}
              data-testid="reward-confirm"
            >
              {t('rew.redeem')}
            </Button>
          </>
        }
      >
        {confirm ? (
          <div className="dd-stack">
            <strong>{pickText(confirm.name, locale)}</strong>
            <p>
              {t('rew.confirmBody')} <Points n={confirm.pointsCost} locale={locale} />
            </p>
            {error ? <Alert tone="danger">{error}</Alert> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
