import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { NAV_BY_AUDIENCE, filterNav } from '@dealdash/auth';
import {
  createTranslator,
  stripLocale,
  withLocale,
  type DictionaryKey,
} from '@dealdash/localization';
import { AUDIENCE_DEFINITIONS, LOCALES, webAppEnv, type UiLocale } from '@dealdash/types';
import { Button, StatusChip, Wordmark } from '@dealdash/ui';
import { Icon } from './deals/icons';
import { useApi } from './api';
import { useAuth } from './auth-context';

const APP_NAME_KEY: Record<string, DictionaryKey> = {
  customer: 'app.customer',
  merchant: 'app.merchant',
  staff: 'app.staff',
  partner: 'app.partner',
  admin: 'app.admin',
};

const TAB_ICON: Record<string, string> = {
  home: 'home',
  explore: 'compass',
  watch: 'play',
  rewards: 'gift',
  profile: 'user',
};

const LANGUAGE_LABEL: Record<UiLocale, string> = { en: 'EN', ar: 'عربي', ur: 'اردو' };

/**
 * The header keeps the approved EN / عربي toggle; a customer reading in Urdu also sees Urdu marked here (all three languages are
 * offered in Profile > Language).
 */
function LocaleSwitcher({ locale }: { locale: UiLocale }) {
  const pathname = usePathname() ?? '/';
  const t = createTranslator(locale);
  const shown: UiLocale[] = locale === 'ur' ? [...LOCALES, 'ur'] : [...LOCALES];
  return (
    <nav className="dd-lang" aria-label={t('shell.language')}>
      {shown.map((l) => (
        <Link
          key={l}
          href={withLocale(pathname, l)}
          hrefLang={l}
          lang={l}
          aria-current={l === locale ? 'true' : undefined}
        >
          {LANGUAGE_LABEL[l]}
        </Link>
      ))}
    </nav>
  );
}

/** My Deals entry in the customer header, with a dot while there are updates the customer has not seen. */
function MyDealsLink({ locale }: { locale: UiLocale }) {
  const t = createTranslator(locale);
  return (
    <Link
      href={withLocale('/reservations', locale)}
      className="dd-topicon"
      aria-label={t('res.title')}
      data-testid="my-deals-link"
    >
      <Icon name="ticket" size={20} />
    </Link>
  );
}

/** Customer header bell: the reservation and payment updates (My Deals → Updates) with the unread count. */
function NotificationBell({ locale }: { locale: UiLocale }) {
  const { status } = useAuth();
  const { call } = useApi();
  const pathname = usePathname() ?? '/';
  const [unread, setUnread] = useState(0);
  const t = createTranslator(locale);
  useEffect(() => {
    if (status !== 'authenticated') {
      setUnread(0);
      return;
    }
    let alive = true;
    void call<{ unread: number }>('GET', '/v1/app/notifications').then((r) => {
      if (alive && r.ok && typeof r.data?.unread === 'number') setUnread(r.data.unread);
    });
    return () => {
      alive = false;
    };
  }, [call, status, pathname]);
  return (
    <Link
      href={withLocale('/reservations?tab=updates', locale)}
      className="dd-topicon"
      aria-label={unread > 0 ? `${t('hdr.updates')} (${unread})` : t('hdr.updates')}
      data-testid="notifications-bell"
    >
      <Icon name="bell" size={20} />
      {unread > 0 ? (
        <span className="dd-topicon__badge dd-ltr" data-testid="notifications-unread">
          {unread > 9 ? '9+' : unread}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * Shared layout. Customer and Staff are mobile-first (bottom tab bar, PWA); Merchant, Partner and Admin use a
 * responsive sidebar. Navigation shows only what the signed-in role may use (hidden, not greyed); the API
 * enforces every permission regardless of what is shown here.
 */
/**
 * Remote UAT (G-7): every screen of a STAGING / UAT build carries a small "Staging · test data only" label, so nobody mistakes it for
 * the live service (or shares a screenshot as real). It never takes space or catches taps; production and local builds show nothing.
 * `env` is the public build setting NEXT_PUBLIC_APP_ENV (a prop only so tests can set it).
 */
export function EnvironmentRibbon({ env = process.env.NEXT_PUBLIC_APP_ENV }: { env?: string }) {
  const { uiLocale } = useAuth();
  if (webAppEnv(env) !== 'staging') return null;
  const t = createTranslator(uiLocale);
  return (
    <div className="dd-envribbon" role="note" data-testid="env-ribbon">
      {t('shell.envStaging')}
    </div>
  );
}

export function AppShell({
  children,
  hiddenKeys,
  headerAccessory,
}: {
  children: ReactNode;
  /** Stage 7: navigation items hidden because the contract does not include them. */ hiddenKeys?: readonly string[];
  /** Customer header: an app-provided control beside the brand (the location selector on discovery screens). */
  headerAccessory?: ReactNode;
}) {
  const { audience, locale: contentLocale, uiLocale: locale, me, status, signOut } = useAuth();
  const t = createTranslator(locale);
  const pathname = usePathname() ?? '/';
  const current = stripLocale(pathname);
  const mobileFirst = audience === 'customer' || audience === 'staff';

  const items = filterNav(NAV_BY_AUDIENCE[audience], me?.permissions ?? []).filter(
    (i) =>
      (status === 'authenticated' || i.requiresAny === undefined) && !hiddenKeys?.includes(i.key),
  );
  const isCustomer = audience === 'customer';
  // Customers browse as guests, so their tabs show before sign-in.
  const visible = status === 'authenticated' || isCustomer ? items : [];
  // Full-screen customer pages (deal detail) bring their own back button and bottom action bar.
  const fullScreen =
    isCustomer &&
    (current.startsWith('/deals/') ||
      current.startsWith('/hot/') ||
      current.startsWith('/vouchers/') ||
      current.startsWith('/watch/'));
  const noHeader = fullScreen || (isCustomer && current.startsWith('/merchants/'));

  const navLinks = visible.map((item) => {
    const active = current === item.href || (item.href !== '/' && current.startsWith(item.href));
    // the customer tab bar features Watch & Earn as the raised centre action (approved customer UI)
    const feature = isCustomer && item.key === 'watch';
    return (
      <Link
        key={item.key}
        href={withLocale(item.href, locale)}
        className={mobileFirst ? (feature ? 'dd-tab--feature' : undefined) : 'dd-navitem'}
        data-tab={item.key}
        aria-current={active ? 'page' : undefined}
      >
        {isCustomer ? (
          feature ? (
            <span className="dd-tab__fab" aria-hidden="true">
              <Icon name="play" size={22} filled />
            </span>
          ) : (
            <Icon
              name={TAB_ICON[item.key] ?? 'other'}
              size={22}
              filled={active && item.key !== 'explore'}
            />
          )
        ) : null}
        <span>{t(item.labelKey as DictionaryKey)}</span>
      </Link>
    );
  });

  const header = isCustomer ? (
    <div className="dd-topbar dd-topbar--customer">
      <div className="dd-brandblock">
        {/* approved header (founder direction 2026-10-16): wordmark with the tagline; location and greeting beneath */}
        <Wordmark />
        <span className="dd-brandblock__tag">{t('brand.tagline')}</span>
      </div>
      {headerAccessory ? <div className="dd-topbar__accessory">{headerAccessory}</div> : null}
      <div className="dd-row dd-topbar__actions">
        <NotificationBell locale={locale} />
        <MyDealsLink locale={locale} />
        <LocaleSwitcher locale={locale} />
      </div>
    </div>
  ) : (
    <div className="dd-topbar">
      <div className="dd-row">
        <Wordmark />
        <span className="dd-caption">{t(APP_NAME_KEY[audience] ?? 'brand.name')}</span>
        <StatusChip tone="info">{AUDIENCE_DEFINITIONS[audience].label[contentLocale]}</StatusChip>
      </div>
      <div className="dd-row">
        <LocaleSwitcher locale={locale} />
        {status === 'authenticated' ? (
          <Button variant="outline" size="sm" onClick={() => void signOut()}>
            {t('auth.signOut')}
          </Button>
        ) : null}
      </div>
    </div>
  );

  if (mobileFirst) {
    return (
      <div className="dd-shell dd-shell--mobile">
        <EnvironmentRibbon />
        {noHeader ? null : (
          <header className="dd-main" style={{ paddingBlockEnd: 0 }}>
            {header}
          </header>
        )}
        <main className={isCustomer ? 'dd-main dd-main--customer' : 'dd-main'}>{children}</main>
        {visible.length && !fullScreen ? (
          <nav
            className={isCustomer ? 'dd-tabbar dd-tabbar--customer' : 'dd-tabbar'}
            aria-label="Primary"
          >
            {navLinks}
          </nav>
        ) : (
          <div />
        )}
      </div>
    );
  }

  return (
    <div className="dd-shell">
      <EnvironmentRibbon />
      <aside className="dd-sidebar" aria-label="Primary">
        <div style={{ padding: '4px 12px 16px' }}>
          <Wordmark />
          <div className="dd-caption">{t(APP_NAME_KEY[audience] ?? 'brand.name')}</div>
        </div>
        {navLinks}
      </aside>
      <div>
        <header className="dd-main" style={{ paddingBlockEnd: 0 }}>
          {header}
        </header>
        <main className="dd-main">{children}</main>
      </div>
    </div>
  );
}
