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
import { AUDIENCE_DEFINITIONS, LOCALES, type Locale } from '@dealdash/types';
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

function LocaleSwitcher({ locale }: { locale: Locale }) {
  const pathname = usePathname() ?? '/';
  const t = createTranslator(locale);
  return (
    <nav className="dd-lang" aria-label={t('shell.language')}>
      {LOCALES.map((l) => (
        <Link
          key={l}
          href={withLocale(pathname, l)}
          hrefLang={l}
          lang={l}
          aria-current={l === locale ? 'true' : undefined}
        >
          {l === 'en' ? 'EN' : 'عربي'}
        </Link>
      ))}
    </nav>
  );
}

/** My Deals entry in the customer header, with a dot while there are updates the customer has not seen. */
function MyDealsLink({ locale }: { locale: Locale }) {
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
      if (alive && r.ok && r.data) setUnread(r.data.unread);
    });
    return () => {
      alive = false;
    };
  }, [call, status, pathname]);
  return (
    <Link
      href={withLocale('/reservations', locale)}
      className="dd-topicon"
      aria-label={t('res.title')}
      data-testid="my-deals-link"
    >
      <Icon name="ticket" size={20} />
      {unread > 0 ? <span className="dd-topicon__dot" aria-label={String(unread)} /> : null}
    </Link>
  );
}

/**
 * Shared layout. Customer and Staff are mobile-first (bottom tab bar, PWA); Merchant, Partner and Admin use a
 * responsive sidebar. Navigation shows only what the signed-in role may use (hidden, not greyed); the API
 * enforces every permission regardless of what is shown here.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { audience, locale, me, status, signOut } = useAuth();
  const t = createTranslator(locale);
  const pathname = usePathname() ?? '/';
  const current = stripLocale(pathname);
  const mobileFirst = audience === 'customer' || audience === 'staff';

  const items = filterNav(NAV_BY_AUDIENCE[audience], me?.permissions ?? []).filter(
    (i) => status === 'authenticated' || i.requiresAny === undefined,
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

  const navLinks = visible.map((item) => (
    <Link
      key={item.key}
      href={withLocale(item.href, locale)}
      className={mobileFirst ? undefined : 'dd-navitem'}
      aria-current={
        current === item.href || (item.href !== '/' && current.startsWith(item.href))
          ? 'page'
          : undefined
      }
    >
      {isCustomer ? <Icon name={TAB_ICON[item.key] ?? 'other'} size={22} /> : null}
      <span>{t(item.labelKey as DictionaryKey)}</span>
    </Link>
  ));

  const header = isCustomer ? (
    <div className="dd-topbar dd-topbar--customer">
      <div className="dd-row">
        <Wordmark />
      </div>
      <div className="dd-row">
        <MyDealsLink locale={locale} />
        <Link
          href={withLocale('/my-vouchers', locale)}
          className="dd-topicon"
          aria-label={t('wal.title')}
          data-testid="my-vouchers-link"
        >
          <Icon name="tag" size={20} />
        </Link>
        <LocaleSwitcher locale={locale} />
      </div>
    </div>
  ) : (
    <div className="dd-topbar">
      <div className="dd-row">
        <Wordmark />
        <span className="dd-caption">{t(APP_NAME_KEY[audience] ?? 'brand.name')}</span>
        <StatusChip tone="info">{AUDIENCE_DEFINITIONS[audience].label[locale]}</StatusChip>
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
        {noHeader ? null : (
          <header className="dd-main" style={{ paddingBlockEnd: 0 }}>
            {header}
          </header>
        )}
        <main className={isCustomer ? 'dd-main dd-main--customer' : 'dd-main'}>{children}</main>
        {visible.length && !fullScreen ? (
          <nav className="dd-tabbar" aria-label="Primary">
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
