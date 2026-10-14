'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ACCOUNT_SIGNAL_EVENT,
  Icon,
  LoginPanel,
  errorMessage,
  pickText,
  useApi,
  useAuth,
} from '@dealdash/app-shell';
import {
  formatDate,
  stripLocale,
  withLocale,
  type DictionaryKey,
  type UiLocale,
} from '@dealdash/localization';
import {
  Alert,
  BottomSheet,
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  LoadingState,
  OtpInput,
  StatusChip,
} from '@dealdash/ui';
import {
  GENDERS,
  ONBOARDING_STEPS,
  type ConsentKind,
  type CustomerNotificationSettings,
  type CustomerProfile,
  type CustomerProfileUpdate,
  type OnboardingStep,
} from '@dealdash/validation';
import { useCustomer } from './customer-context';
import { useHref, useT } from './parts';

/**
 * Customer account (Blueprint §5; Customer MVP CS-02 profile set-up, CS-05 account settings, CS-06 notifications). The server decides
 * readiness (profile complete + current Terms / Privacy); the app only guides: a "continue setting up" prompt, the set-up wizard
 * that resumes at the first missing step, one account-level sheet when an action needs the profile (or new Terms, or a new
 * sign-in), the under-age block, and the offline banner.
 */
interface AccountContextValue {
  profile: CustomerProfile | null;
  reload: () => Promise<void>;
  set: (p: CustomerProfile) => void;
}
const AccountCtx = createContext<AccountContextValue>({
  profile: null,
  reload: async () => undefined,
  set: () => undefined,
});
export const useAccount = () => useContext(AccountCtx);

export const LANGUAGES: Array<{ id: UiLocale; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'ar', label: 'العربية' },
  { id: 'ur', label: 'اردو' },
];

interface Category {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

// ------------------------------------------------------------------ provider + global states
export function AccountProvider({ children }: { children: ReactNode }) {
  const { status, refresh } = useAuth();
  const { call } = useApi();
  const { locale } = useT();
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [signal, setSignal] = useState<string | null>(null);
  const prevStatus = useRef(status);
  const justSignedIn = useRef(false);

  const reload = useCallback(async () => {
    if (status !== 'authenticated') {
      setProfile(null);
      return;
    }
    const r = await call<CustomerProfile>('GET', '/v1/app/me/profile');
    // only a real profile answer counts (an unavailable account service never blocks browsing)
    if (r.ok && r.data?.onboarding) setProfile(r.data);
  }, [call, status]);
  useEffect(() => {
    void reload();
  }, [reload]);

  // signing in on this page with an unfinished profile continues in the set-up ("Resume onboarding")
  useEffect(() => {
    if (prevStatus.current === 'anonymous' && status === 'authenticated')
      justSignedIn.current = true;
    prevStatus.current = status;
  }, [status]);
  useEffect(() => {
    if (!justSignedIn.current || !profile) return;
    justSignedIn.current = false;
    const path = stripLocale(pathname);
    if (
      !profile.onboarding.ready &&
      profile.onboarding.state !== 'AGE_BLOCKED' &&
      !path.startsWith('/welcome')
    )
      router.push(`${withLocale('/welcome', locale)}?next=${encodeURIComponent(path)}`);
  }, [profile, pathname, router, locale]);

  // one account-level prompt for answers any screen can receive
  useEffect(() => {
    const on = (e: Event) => {
      const code = (e as CustomEvent<string>).detail;
      if (status !== 'authenticated') return;
      setSignal(code);
      if (code !== 'AUTH_REQUIRED') void reload();
    };
    window.addEventListener(ACCOUNT_SIGNAL_EVENT, on);
    return () => window.removeEventListener(ACCOUNT_SIGNAL_EVENT, on);
  }, [status, reload]);

  const value = useMemo(() => ({ profile, reload, set: setProfile }), [profile, reload]);
  const blocked = status === 'authenticated' && profile?.onboarding.state === 'AGE_BLOCKED';
  return (
    <AccountCtx.Provider value={value}>
      <OfflineBanner />
      {blocked ? <AgeBlocked /> : children}
      <AccountSignalSheet
        code={blocked ? null : signal}
        onClose={() => {
          if (signal === 'AUTH_REQUIRED') void refresh();
          setSignal(null);
        }}
      />
    </AccountCtx.Provider>
  );
}

/** Persistent top banner while the device is offline (codes already on screen stay visible). */
export function OfflineBanner() {
  const { t } = useT();
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(typeof navigator !== 'undefined' && navigator.onLine === false);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  if (!offline) return null;
  return (
    <div className="dd-offline" role="status" data-testid="offline-banner">
      <Icon name="wifioff" size={16} /> {t('acct.offline')}
    </div>
  );
}

function AccountSignalSheet({ code, onClose }: { code: string | null; onClose: () => void }) {
  const { t } = useT();
  const href = useHref();
  const pathname = usePathname() ?? '/';
  const { status } = useAuth();
  const next = encodeURIComponent(stripLocale(pathname));
  if (!code || code === 'AGE_RESTRICTED') return null;
  if (code === 'AUTH_REQUIRED')
    return (
      <BottomSheet
        open
        onClose={onClose}
        title={t('acct.session.title')}
        closeLabel={t('common.close')}
        testId="session-sheet"
      >
        <p>{t('acct.session.body')}</p>
        {status === 'authenticated' ? <LoginPanel /> : null}
      </BottomSheet>
    );
  const consent = code === 'CONSENT_REQUIRED';
  return (
    <BottomSheet
      open
      onClose={onClose}
      title={consent ? t('acct.reaccept.title') : t('acct.gate.title')}
      closeLabel={t('common.close')}
      testId="account-gate"
    >
      <p>{consent ? t('acct.reaccept.body') : t('acct.gate.body')}</p>
      <Link
        className="dd-btn dd-btn--primary dd-btn--block"
        href={`${href('/welcome')}?${consent ? 'step=CONSENTS&' : ''}next=${next}`}
        onClick={onClose}
      >
        {consent ? t('acct.reaccept.cta') : t('acct.gate.cta')}
      </Link>
    </BottomSheet>
  );
}

function AgeBlocked() {
  const { t } = useT();
  const { signOut } = useAuth();
  const { profile } = useAccount();
  return (
    <div className="dd-state dd-state--full" role="alert" data-testid="age-blocked">
      <div className="dd-state__title">
        {t('acct.blocked.title', { age: profile?.onboarding.minimumAge ?? 18 })}
      </div>
      <div>{t('acct.blocked.body')}</div>
      <Button variant="outline" onClick={() => void signOut()}>
        {t('auth.signOut')}
      </Button>
    </div>
  );
}

/** "Continue setting up" (or "accept the new Terms") for a signed-in customer whose account is not ready. */
export function SetupBanner() {
  const { t } = useT();
  const href = useHref();
  const { status } = useAuth();
  const { profile } = useAccount();
  if (status !== 'authenticated' || !profile || profile.onboarding.ready) return null;
  if (profile.onboarding.state === 'AGE_BLOCKED') return null;
  const consent = profile.onboarding.consentsOutdated;
  return (
    <div className="dd-setupcard" data-testid="setup-banner">
      <span className="dd-setupcard__icon" aria-hidden="true">
        <Icon name="user" size={20} />
      </span>
      <div className="dd-grow">
        <strong>{consent ? t('acct.reaccept.title') : t('profile.setup')}</strong>
        <div className="dd-caption">
          {consent ? t('acct.reaccept.body') : t('profile.setupBody')}
        </div>
      </div>
      <Link
        className="dd-btn dd-btn--primary dd-btn--sm"
        href={`${href('/welcome')}${consent ? '?step=CONSENTS' : ''}`}
      >
        {consent ? t('acct.reaccept.cta') : t('acct.gate.cta')}
      </Link>
    </div>
  );
}

// ------------------------------------------------------------------ shared pieces
function useCategories() {
  const { call } = useApi();
  const [cats, setCats] = useState<Category[]>([]);
  useEffect(() => {
    void call<Category[]>('GET', '/v1/app/categories').then((r) => r.ok && setCats(r.data ?? []));
  }, [call]);
  return cats;
}

function Documents({ profile }: { profile: CustomerProfile }) {
  const { t } = useT();
  const d = profile.documents;
  const link = (url: string | null, label: string, version: string) =>
    url ? (
      <a className="dd-link" href={url} target="_blank" rel="noreferrer">
        {label}
      </a>
    ) : (
      <span className="dd-caption">
        {label} · {t('acct.consents.version', { v: version })}
      </span>
    );
  return (
    <div className="dd-stack" style={{ gap: 4 }}>
      {link(d.termsUrl, t('acct.consents.readTerms'), d.termsVersion)}
      {link(d.privacyUrl, t('acct.consents.readPrivacy'), d.privacyVersion)}
      {!d.termsUrl || !d.privacyUrl ? (
        <span className="dd-help">{t('acct.consents.pending')}</span>
      ) : null}
    </div>
  );
}

function CityPills({ value, onChange }: { value: string; onChange: (city: string) => void }) {
  const { t, locale } = useT();
  const { cities } = useCustomer();
  return (
    <div className="dd-optrow" role="radiogroup" aria-label={t('acct.city.title')}>
      {cities.map((c) => (
        <button
          key={c.name}
          type="button"
          role="radio"
          aria-checked={c.name === value}
          className={`dd-pill ${c.name === value ? 'dd-pill--active' : ''}`}
          onClick={() => onChange(c.name)}
        >
          {pickText({ en: c.name, ar: c.nameAr }, locale)}
        </button>
      ))}
    </div>
  );
}

function InterestPills({
  value,
  onChange,
}: {
  value: string[];
  onChange: (codes: string[]) => void;
}) {
  const { t, locale } = useT();
  const cats = useCategories();
  return (
    <div className="dd-optrow" role="group" aria-label={t('acct.interests.title')}>
      {cats.map((c) => {
        const on = value.includes(c.code);
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={on}
            className={`dd-pill ${on ? 'dd-pill--active' : ''}`}
            onClick={() => onChange(on ? value.filter((x) => x !== c.code) : [...value, c.code])}
          >
            {pickText({ en: c.nameEn, ar: c.nameAr }, locale)}
          </button>
        );
      })}
    </div>
  );
}

function GenderPills({
  value,
  onChange,
}: {
  value: CustomerProfile['gender'];
  onChange: (g: CustomerProfile['gender']) => void;
}) {
  const { t } = useT();
  return (
    <div className="dd-optrow" role="radiogroup" aria-label={t('acct.gender.title')}>
      {GENDERS.map((g) => (
        <button
          key={g}
          type="button"
          role="radio"
          aria-checked={value === g}
          className={`dd-pill ${value === g ? 'dd-pill--active' : ''}`}
          onClick={() => onChange(g)}
        >
          {t(`acct.gender.${g}` as DictionaryKey)}
        </button>
      ))}
    </div>
  );
}

const todayIso = () => new Date().toISOString().slice(0, 10);

// ------------------------------------------------------------------ set-up wizard (CS-02)
const WIZARD: OnboardingStep[] = [...ONBOARDING_STEPS];
const OPTIONAL: OnboardingStep[] = ['GENDER', 'INTERESTS'];

export function WelcomePage() {
  const { t, locale } = useT();
  const href = useHref();
  const router = useRouter();
  const params = useSearchParams();
  const { status } = useAuth();
  const { call } = useApi();
  const { profile, set, reload } = useAccount();
  const { city: browsingCity } = useCustomer();
  const [step, setStep] = useState<OnboardingStep | 'DONE' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    dateOfBirth: '',
    gender: null as CustomerProfile['gender'],
    city: '',
    interests: [] as string[],
  });
  const [consents, setConsents] = useState<Record<ConsentKind, boolean>>({
    TERMS: false,
    PRIVACY: false,
    MARKETING_PUSH: false,
    MARKETING_EMAIL: false,
    LOCATION: false,
    NOTIFICATIONS: true,
  });
  const [consentTried, setConsentTried] = useState(false);
  const nextPath = params.get('next');
  const safeNext =
    nextPath && nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/';

  useEffect(() => {
    if (status === 'authenticated') void reload();
  }, [status, reload]);

  // resume: the requested step, else the first missing one; seed the form from what is saved
  useEffect(() => {
    if (!profile || step !== null) return;
    const wanted = params.get('step') as OnboardingStep | null;
    setStep(
      wanted && WIZARD.includes(wanted)
        ? wanted
        : (profile.onboarding.nextStep ?? (profile.onboarding.ready ? 'DONE' : 'DETAILS')),
    );
    setForm({
      firstName: profile.firstName ?? '',
      lastName: profile.lastName ?? '',
      email: profile.email ?? '',
      dateOfBirth: profile.dateOfBirth ?? '',
      gender: profile.gender,
      city: profile.city ?? browsingCity,
      interests: profile.interests,
    });
    const granted = Object.fromEntries(profile.consents.map((c) => [c.kind, c.granted]));
    setConsents((c) => ({
      ...c,
      ...granted,
      // a Terms / Privacy version accepted earlier must be accepted again when it changed
      TERMS: !profile.onboarding.consentsOutdated && !!granted.TERMS,
      PRIVACY: !profile.onboarding.consentsOutdated && !!granted.PRIVACY,
    }));
  }, [profile, step, params, browsingCity]);

  if (status === 'loading' || (status === 'authenticated' && (!profile || !step)))
    return <LoadingState label={t('state.loading')} />;
  if (status !== 'authenticated')
    return (
      <div className="dd-stack" data-testid="welcome">
        <h1 className="dd-title-xl">{t('acct.setup.title')}</h1>
        <p>{t('acct.setup.signIn')}</p>
        <LoginPanel />
      </div>
    );
  if (!profile || !step) return null;

  const index = step === 'DONE' ? WIZARD.length : WIZARD.indexOf(step);
  const advance = (fresh: CustomerProfile) => {
    set(fresh);
    if (fresh.onboarding.state === 'AGE_BLOCKED') return;
    const after = WIZARD.slice(index + 1)[0];
    // after the last step (or when everything required is done and the customer was resuming) finish or go to what is missing
    if (!after) setStep(fresh.onboarding.ready ? 'DONE' : (fresh.onboarding.nextStep ?? 'DONE'));
    else setStep(after);
  };

  const saveProfile = async (body: CustomerProfileUpdate) => {
    setBusy(true);
    setError(null);
    const r = await call<CustomerProfile>('PUT', '/v1/app/me/profile', { body });
    setBusy(false);
    if (!r.ok || !r.data) {
      setError(errorMessage(locale, r.errors));
      return;
    }
    advance(r.data);
  };

  const saveConsents = async () => {
    setConsentTried(true);
    if (!consents.TERMS || !consents.PRIVACY) return;
    setBusy(true);
    setError(null);
    const r = await call<CustomerProfile>('PUT', '/v1/app/me/consents', {
      body: {
        source: 'ONBOARDING',
        items: (Object.keys(consents) as ConsentKind[]).map((kind) => ({
          kind,
          granted: consents[kind],
        })),
      },
    });
    setBusy(false);
    if (!r.ok || !r.data) {
      setError(errorMessage(locale, r.errors));
      return;
    }
    advance(r.data);
  };

  const skip = () => {
    const after = WIZARD.slice(index + 1)[0];
    setStep(after ?? 'DONE');
  };
  const back = () => {
    const prev = WIZARD[index - 1];
    if (prev) setStep(prev);
  };

  if (step === 'DONE')
    return (
      <div className="dd-stack" style={{ gap: 16 }} data-testid="welcome-done">
        <div className="dd-setupdone">
          <span className="dd-setupdone__icon" aria-hidden="true">
            <Icon name="check" size={28} />
          </span>
          <h1 className="dd-title-xl">{t('acct.done.title', { name: profile.firstName ?? '' })}</h1>
          <p>{t('acct.done.body')}</p>
        </div>
        <Link className="dd-btn dd-btn--primary dd-btn--block" href={href('/benefits')}>
          {t('acct.done.benefits')}
        </Link>
        <Button variant="outline" block onClick={() => router.push(withLocale(safeNext, locale))}>
          {t('acct.done.home')}
        </Button>
      </div>
    );

  const footer = (primary: ReactNode) => (
    <div className="dd-setup__actions">
      {index > 0 ? (
        <Button variant="ghost" onClick={back}>
          {t('acct.setup.back')}
        </Button>
      ) : (
        <span />
      )}
      <div className="dd-row">
        {OPTIONAL.includes(step) ? (
          <Button variant="outline" onClick={skip}>
            {t('acct.setup.skip')}
          </Button>
        ) : null}
        {primary}
      </div>
    </div>
  );

  return (
    <div className="dd-stack dd-setup" style={{ gap: 16 }} data-testid="welcome">
      <div className="dd-stack" style={{ gap: 6 }}>
        <span className="dd-caption">
          {t('acct.setup.step', { n: index + 1, total: WIZARD.length })}
        </span>
        <div
          className="dd-setup__progress"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={WIZARD.length}
          aria-valuenow={index + 1}
          aria-label={t('acct.setup.title')}
        >
          <span style={{ inlineSize: `${((index + 1) / WIZARD.length) * 100}%` }} />
        </div>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {step === 'DETAILS' ? (
        <form
          className="dd-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void saveProfile({
              firstName: form.firstName,
              lastName: form.lastName,
              email: form.email,
            });
          }}
        >
          <h1 className="dd-title-xl">{t('acct.details.title')}</h1>
          <Field label={t('acct.firstName')} htmlFor="first-name">
            <Input
              id="first-name"
              required
              autoComplete="given-name"
              maxLength={60}
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            />
          </Field>
          <Field label={t('acct.lastName')} htmlFor="last-name">
            <Input
              id="last-name"
              autoComplete="family-name"
              maxLength={60}
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            />
          </Field>
          <Field label={t('acct.email')} htmlFor="email" help={t('acct.emailHelp')}>
            <Input
              id="email"
              type="email"
              required
              dir="ltr"
              autoComplete="email"
              maxLength={254}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          {footer(
            <Button type="submit" loading={busy}>
              {t('acct.setup.continue')}
            </Button>,
          )}
        </form>
      ) : null}

      {step === 'BIRTH_DATE' ? (
        <form
          className="dd-stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (profile.ageVerified) setStep(WIZARD[index + 1]!);
            else void saveProfile({ dateOfBirth: form.dateOfBirth });
          }}
        >
          <h1 className="dd-title-xl">{t('acct.dob.title')}</h1>
          <Field
            label={t('acct.dob')}
            htmlFor="dob"
            help={
              profile.ageVerified
                ? t('acct.dobLocked')
                : t('acct.dobHelp', { age: profile.onboarding.minimumAge })
            }
          >
            <Input
              id="dob"
              type="date"
              required
              dir="ltr"
              max={todayIso()}
              disabled={profile.ageVerified}
              value={form.dateOfBirth}
              onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
            />
          </Field>
          {footer(
            <Button type="submit" loading={busy}>
              {t('acct.setup.continue')}
            </Button>,
          )}
        </form>
      ) : null}

      {step === 'GENDER' ? (
        <div className="dd-stack">
          <h1 className="dd-title-xl">{t('acct.gender.title')}</h1>
          <p className="dd-help">{t('acct.genderHelp')}</p>
          <GenderPills value={form.gender} onChange={(gender) => setForm({ ...form, gender })} />
          {footer(
            <Button
              loading={busy}
              disabled={!form.gender}
              onClick={() => void saveProfile({ gender: form.gender })}
            >
              {t('acct.setup.continue')}
            </Button>,
          )}
        </div>
      ) : null}

      {step === 'CITY' ? (
        <div className="dd-stack">
          <h1 className="dd-title-xl">{t('acct.city.title')}</h1>
          <p className="dd-help">{t('acct.cityHelp')}</p>
          <CityPills value={form.city} onChange={(city) => setForm({ ...form, city })} />
          {footer(
            <Button
              loading={busy}
              disabled={!form.city}
              onClick={() => void saveProfile({ city: form.city })}
            >
              {t('acct.setup.continue')}
            </Button>,
          )}
        </div>
      ) : null}

      {step === 'INTERESTS' ? (
        <div className="dd-stack">
          <h1 className="dd-title-xl">{t('acct.interests.title')}</h1>
          <p className="dd-help">{t('acct.interestsHelp')}</p>
          <InterestPills
            value={form.interests}
            onChange={(interests) => setForm({ ...form, interests })}
          />
          {footer(
            <Button
              loading={busy}
              disabled={!form.interests.length}
              onClick={() => void saveProfile({ interests: form.interests })}
            >
              {t('acct.setup.continue')}
            </Button>,
          )}
        </div>
      ) : null}

      {step === 'CONSENTS' ? (
        <div className="dd-stack">
          <h1 className="dd-title-xl">
            {profile.onboarding.consentsOutdated
              ? t('acct.reaccept.title')
              : t('acct.consents.title')}
          </h1>
          <fieldset className="dd-stack dd-consents">
            {(['TERMS', 'PRIVACY'] as const).map((k) => (
              <Checkbox
                key={k}
                label={t(`acct.consent.${k}` as DictionaryKey)}
                checked={consents[k]}
                onChange={(e) => setConsents({ ...consents, [k]: e.target.checked })}
              />
            ))}
            <Documents profile={profile} />
            <span className="dd-label">{t('acct.consents.optional')}</span>
            {(['NOTIFICATIONS', 'LOCATION', 'MARKETING_PUSH', 'MARKETING_EMAIL'] as const).map(
              (k) => (
                <Checkbox
                  key={k}
                  label={t(`acct.consent.${k}` as DictionaryKey)}
                  checked={consents[k]}
                  onChange={(e) => setConsents({ ...consents, [k]: e.target.checked })}
                />
              ),
            )}
          </fieldset>
          {consentTried && (!consents.TERMS || !consents.PRIVACY) ? (
            <span className="dd-error" role="alert">
              {t('acct.consents.required')}
            </span>
          ) : null}
          {footer(
            <Button loading={busy} onClick={() => void saveConsents()}>
              {t('acct.setup.continue')}
            </Button>,
          )}
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ account settings (CS-05 / CS-06)
export function AccountSettingsPage() {
  const { t, locale } = useT();
  const { status } = useAuth();
  const { profile, set, reload } = useAccount();
  useEffect(() => {
    if (status === 'authenticated') void reload();
  }, [status, reload]);
  if (status === 'loading' || (status === 'authenticated' && !profile))
    return <LoadingState label={t('state.loading')} />;
  if (status !== 'authenticated' || !profile)
    return (
      <div className="dd-stack" data-testid="account-settings">
        <h1 className="dd-title-xl">{t('acct.title')}</h1>
        <LoginPanel />
      </div>
    );
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="account-settings">
      <h1 className="dd-title-xl">{t('acct.title')}</h1>
      <SetupBanner />
      <PersonalDetails profile={profile} onSaved={set} />
      <MobileNumber profile={profile} onSaved={set} />
      <LanguageCard current={locale} />
      <NotificationSettings />
      <PrivacyCard profile={profile} onSaved={set} />
    </div>
  );
}

function PersonalDetails({
  profile,
  onSaved,
}: {
  profile: CustomerProfile;
  onSaved: (p: CustomerProfile) => void;
}) {
  const { t, locale } = useT();
  const href = useHref();
  const { call } = useApi();
  const [form, setForm] = useState({
    firstName: profile.firstName ?? '',
    lastName: profile.lastName ?? '',
    email: profile.email ?? '',
    gender: profile.gender,
    city: profile.city ?? '',
    interests: profile.interests,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    const body: CustomerProfileUpdate = {};
    if (form.firstName !== (profile.firstName ?? '')) body.firstName = form.firstName;
    if (form.lastName !== (profile.lastName ?? '')) body.lastName = form.lastName;
    if (form.email !== (profile.email ?? '')) body.email = form.email;
    if (form.gender !== profile.gender) body.gender = form.gender;
    if (form.city && form.city !== profile.city) body.city = form.city;
    if (form.interests.join() !== profile.interests.join()) body.interests = form.interests;
    const r = Object.keys(body).length
      ? await call<CustomerProfile>('PUT', '/v1/app/me/profile', { body })
      : { ok: true, data: profile, errors: [] };
    setBusy(false);
    if (!r.ok || !r.data) {
      setMsg({ tone: 'danger', text: errorMessage(locale, r.errors) });
      return;
    }
    onSaved(r.data);
    setMsg({ tone: 'success', text: t('acct.saved') });
  };
  return (
    <Card>
      <form
        className="dd-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 className="dd-title">{t('acct.personal')}</h2>
        <Field label={t('acct.firstName')} htmlFor="acct-first">
          <Input
            id="acct-first"
            required
            maxLength={60}
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          />
        </Field>
        <Field label={t('acct.lastName')} htmlFor="acct-last">
          <Input
            id="acct-last"
            maxLength={60}
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          />
        </Field>
        <Field label={t('acct.email')} htmlFor="acct-email" help={t('acct.emailHelp')}>
          <Input
            id="acct-email"
            type="email"
            dir="ltr"
            required
            maxLength={254}
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>
        <div className="dd-field">
          <span className="dd-label">{t('acct.dob')}</span>
          {profile.dateOfBirth ? (
            <>
              <span className="dd-ltr">
                {formatDate(locale, `${profile.dateOfBirth}T12:00:00Z`, 'UTC')}
              </span>
              <span className="dd-help">{t('acct.dobLocked')}</span>
            </>
          ) : (
            <Link className="dd-link" href={`${href('/welcome')}?step=BIRTH_DATE`}>
              {t('acct.gate.cta')}
            </Link>
          )}
        </div>
        <div className="dd-field">
          <span className="dd-label">{t('acct.gender.title')}</span>
          <GenderPills value={form.gender} onChange={(gender) => setForm({ ...form, gender })} />
          <span className="dd-help">{t('acct.genderHelp')}</span>
        </div>
        <div className="dd-field">
          <span className="dd-label">{t('acct.city.title')}</span>
          <CityPills value={form.city} onChange={(city) => setForm({ ...form, city })} />
        </div>
        <div className="dd-field">
          <span className="dd-label">{t('acct.interests.title')}</span>
          <InterestPills
            value={form.interests}
            onChange={(interests) => setForm({ ...form, interests })}
          />
        </div>
        {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
        <Button type="submit" loading={busy}>
          {t('acct.save')}
        </Button>
      </form>
    </Card>
  );
}

function MobileNumber({
  profile,
  onSaved,
}: {
  profile: CustomerProfile;
  onSaved: (p: CustomerProfile) => void;
}) {
  const { t, locale } = useT();
  const { call } = useApi();
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const send = async () => {
    setBusy(true);
    setMsg(null);
    const r = await call('POST', '/v1/app/me/mobile/code', { body: { mobile: mobile.trim() } });
    setBusy(false);
    if (!r.ok) setMsg({ tone: 'danger', text: errorMessage(locale, r.errors) });
    else setSent(true);
  };
  const verify = async (value = code) => {
    setBusy(true);
    setMsg(null);
    const r = await call<CustomerProfile>('POST', '/v1/app/me/mobile/verify', {
      body: { mobile: mobile.trim(), code: value },
    });
    setBusy(false);
    if (!r.ok || !r.data) {
      setMsg({ tone: 'danger', text: errorMessage(locale, r.errors) });
      return;
    }
    onSaved(r.data);
    setOpen(false);
    setSent(false);
    setCode('');
    setMsg({ tone: 'success', text: t('acct.mobile.changed') });
  };
  return (
    <Card>
      <div className="dd-stack">
        <h2 className="dd-title">{t('acct.mobile')}</h2>
        <span className="dd-ltr" data-testid="mobile-masked">
          {profile.mobileMasked}
        </span>
        {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
        {!open ? (
          <Button variant="outline" onClick={() => setOpen(true)}>
            {t('acct.mobile.change')}
          </Button>
        ) : !sent ? (
          <form
            className="dd-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <Field label={t('acct.mobile.new')} htmlFor="new-mobile" help={t('acct.mobile.help')}>
              <Input
                id="new-mobile"
                type="tel"
                dir="ltr"
                inputMode="tel"
                autoComplete="tel"
                required
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
              />
            </Field>
            <div className="dd-row">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" loading={busy}>
                {t('acct.mobile.sendCode')}
              </Button>
            </div>
          </form>
        ) : (
          <div className="dd-stack">
            <p>{t('acct.mobile.codeSent', { mobile: mobile.trim() })}</p>
            <OtpInput
              value={code}
              onChange={setCode}
              onComplete={(v) => void verify(v)}
              aria-label={t('acct.mobile.code')}
            />
            <Button loading={busy} disabled={code.length !== 6} onClick={() => void verify()}>
              {t('acct.mobile.verify')}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

/** Language: English, Arabic or Urdu. The choice also sets the language of the customer's notifications (NT-43). */
export function LanguageCard({ current }: { current: UiLocale }) {
  const { t } = useT();
  const { status } = useAuth();
  const { call } = useApi();
  const pathname = usePathname() ?? '/';
  return (
    <Card flat>
      <strong>{t('profile.language')}</strong>
      <div className="dd-row" style={{ marginBlockStart: 8 }} data-testid="language-choice">
        {LANGUAGES.map((l) => (
          <Link
            key={l.id}
            className={`dd-pill ${current === l.id ? 'dd-pill--active' : ''}`}
            href={withLocale(pathname, l.id)}
            hrefLang={l.id}
            lang={l.id}
            aria-current={current === l.id ? 'true' : undefined}
            onClick={() => {
              if (status === 'authenticated' && l.id !== current)
                void call('PUT', '/v1/app/me/profile', { body: { language: l.id } });
            }}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </Card>
  );
}

function NotificationSettings() {
  const { t, locale } = useT();
  const { call } = useApi();
  const [s, setS] = useState<CustomerNotificationSettings | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setFailed(false);
    const r = await call<CustomerNotificationSettings>('GET', '/v1/app/me/notification-settings');
    if (r.ok && r.data) setS(r.data);
    else setFailed(true);
  }, [call]);
  useEffect(() => {
    void load();
  }, [load]);
  const setCategory = async (category: 'REWARDS' | 'BENEFITS', push: boolean) => {
    setError(null);
    const r = await call<CustomerNotificationSettings>('PUT', '/v1/app/me/notification-settings', {
      body: { categories: [{ category, push }] },
    });
    if (r.ok && r.data) setS(r.data);
    else setError(errorMessage(locale, r.errors));
  };
  const setConsent = async (kind: ConsentKind, granted: boolean) => {
    setError(null);
    const r = await call<CustomerProfile>('PUT', '/v1/app/me/consents', {
      body: { items: [{ kind, granted }] },
    });
    if (r.ok) void load();
    else setError(errorMessage(locale, r.errors));
  };
  return (
    <Card id="notifications">
      <div className="dd-stack" data-testid="notification-settings">
        <h2 className="dd-title">{t('acct.notif.title')}</h2>
        <p className="dd-help">{t('acct.notif.intro')}</p>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {failed ? (
          <Alert tone="danger">
            {t('error.generic')}{' '}
            <button type="button" className="dd-link" onClick={() => void load()}>
              {t('cust.retry')}
            </button>
          </Alert>
        ) : !s ? (
          <LoadingState label={t('state.loading')} />
        ) : (
          <>
            <Checkbox
              label={t('acct.notif.pushAllowed')}
              checked={s.pushAllowed}
              onChange={(e) => void setConsent('NOTIFICATIONS', e.target.checked)}
            />
            {!s.pushAllowed ? <Alert tone="info">{t('acct.notif.pushOff')}</Alert> : null}
            <ul className="dd-notifset" aria-label={t('acct.notif.push')}>
              {s.categories.map((c) => (
                <li key={c.category}>
                  <span className="dd-grow">
                    {t(`acct.notif.cat.${c.category}` as DictionaryKey)}
                  </span>
                  {c.required ? (
                    <StatusChip tone="neutral">{t('acct.notif.required')}</StatusChip>
                  ) : (
                    <Checkbox
                      label={t('acct.notif.push')}
                      checked={c.push && s.pushAllowed}
                      disabled={!s.pushAllowed}
                      onChange={(e) =>
                        void setCategory(c.category as 'REWARDS' | 'BENEFITS', e.target.checked)
                      }
                    />
                  )}
                </li>
              ))}
            </ul>
            <span className="dd-help">{t('acct.notif.inbox')}</span>
            <strong>{t('acct.notif.marketing')}</strong>
            <span className="dd-help">{t('acct.notif.marketingHelp')}</span>
            <Checkbox
              label={t('acct.consent.MARKETING_PUSH')}
              checked={s.marketing.push}
              onChange={(e) => void setConsent('MARKETING_PUSH', e.target.checked)}
            />
            <Checkbox
              label={t('acct.consent.MARKETING_EMAIL')}
              checked={s.marketing.email}
              onChange={(e) => void setConsent('MARKETING_EMAIL', e.target.checked)}
            />
          </>
        )}
      </div>
    </Card>
  );
}

function PrivacyCard({
  profile,
  onSaved,
}: {
  profile: CustomerProfile;
  onSaved: (p: CustomerProfile) => void;
}) {
  const { t, locale } = useT();
  const href = useHref();
  const { call } = useApi();
  const [error, setError] = useState<string | null>(null);
  const consent = (k: ConsentKind) => profile.consents.find((c) => c.kind === k);
  const location = consent('LOCATION');
  return (
    <Card id="privacy">
      <div className="dd-stack" data-testid="privacy-consents">
        <h2 className="dd-title">{t('profile.privacy')}</h2>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {(['TERMS', 'PRIVACY'] as const).map((k) => {
          const c = consent(k);
          return (
            <div key={k} className="dd-stack" style={{ gap: 2 }}>
              <strong>{t(`acct.consent.${k}` as DictionaryKey)}</strong>
              <span className="dd-caption">
                {c?.granted
                  ? `${t('acct.consents.accepted', { date: formatDate(locale, c.at) })} · ${t('acct.consents.version', { v: c.version ?? '' })}`
                  : t('acct.consents.required')}
              </span>
            </div>
          );
        })}
        <span className="dd-help">{t('acct.consents.cannotWithdraw')}</span>
        <Checkbox
          label={t('acct.consent.LOCATION')}
          checked={!!location?.granted}
          onChange={async (e) => {
            setError(null);
            const r = await call<CustomerProfile>('PUT', '/v1/app/me/consents', {
              body: { items: [{ kind: 'LOCATION', granted: e.target.checked }] },
            });
            if (r.ok && r.data) onSaved(r.data);
            else setError(errorMessage(locale, r.errors));
          }}
        />
        {location && !location.granted ? (
          <span className="dd-caption">
            {t('acct.consents.withdrawn', { date: formatDate(locale, location.at) })}
          </span>
        ) : null}
        <strong>{t('acct.legal')}</strong>
        <Documents profile={profile} />
        <Link className="dd-link" href={href('/my-data')}>
          {t('acct.data')}
        </Link>
      </div>
    </Card>
  );
}
