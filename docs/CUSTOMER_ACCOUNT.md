# Customer account, notifications, map and Urdu

Closes the Customer App gaps that need no external vendor: profile and consent onboarding, notification settings, the Live Deals
map, Urdu, the remaining benefits UX and the EM-20 grace period. Sources: Master Blueprint §5 (onboarding) and C-02 / C-05;
Customer MVP CS-02, CS-05, CS-06, §14 (global states), §15 (RTL), §16 (navigation); Business Rules AU-31, NT-40..44, EM-20.
No approved business rule was changed. No approved screen was redesigned: Home only gains a "continue setting up" card for a
signed-in customer whose profile is unfinished; Explore gains the "For my benefits" chip (Customer MVP §16) and a List / Map switch.

## Profile set-up (CS-02)

| Step | Required | Stored as |
|---|---|---|
| Details: first name, last name (optional), email | yes (email: FDC-03, not separately verified) | `Customer.firstName / lastName / email` |
| Date of birth + minimum-age check (AU-31) | yes | `Customer.dobEnc` (field-encrypted), `ageVerifiedAt` |
| Gender (Female / Male / Prefer not to say) | no; never used for targeting (WE-04, VK-06) | `Customer.gender` |
| City (enabled cities from configuration) | yes | `Customer.city` |
| Interests (active category codes) | no | `Customer.interests` |
| Consents: Terms + Privacy (required, versioned); notifications, location, marketing push / email (optional, never pre-ticked except service notifications) | Terms + Privacy | `CustomerConsent` (append-only) |

- States: `PHONE_VERIFIED` → `PROFILE_IN_PROGRESS` → `COMPLETE`; `AGE_BLOCKED`.
- **Ready** = `COMPLETE` and the *current* Terms / Privacy versions accepted.
- Resume: the wizard opens at the first missing required step (`?step=` jumps to one). Optional steps can be skipped and completed
  later in Account settings.
- Signing in on a page with an unfinished profile continues in the set-up and returns to that page afterwards.
- Completion sends the NT-02 welcome (`ACCOUNT_WELCOME`, in-app + push), once, and offers "Add my benefits".
- **Under the minimum age:** the account is set to `AGE_BLOCKED`. Nothing about the person is kept beyond that state: no date of
  birth, no name, email, gender, city or interests. The audit says "under the minimum age" without the date. The app shows a calm
  block with Sign out only, and every gated action returns `AGE_RESTRICTED`. Support can correct a mistaken date.
- **Date of birth is read-only** once the age check passed (`PROFILE_DOB_LOCKED`); support corrects it.
- **New Terms / Privacy version:** raising `termsVersion` / `privacyVersion` asks every customer to accept again ("We updated our
  Terms"); until then gated actions return `CONSENT_REQUIRED`.

### Gate (configurable: `customer.onboarding.requireCompleteForActions`, default **true**)
Reserving an Exclusive Deal, starting voucher checkout, starting a Watch & Earn view and redeeming points need a ready account
(`ONBOARDING_REQUIRED` / `CONSENT_REQUIRED` / `AGE_RESTRICTED`, HTTP 403). Browsing, saving, search and My benefits never do.
A blocked account cannot change benefits either. The app answers any of these codes with one sheet ("Finish setting up your
profile" / "We updated our Terms") that leads into the set-up and back.

## Account settings (CS-05) and notifications (CS-06)

- Personal details (edit), date of birth (read-only), gender, city, interests.
- Mobile number change: a 6-digit code to the NEW number (sign-in OTP rules from configuration). A number held by another account
  is refused only after the code proves possession (`MOBILE_IN_USE`), so nothing is revealed to a stranger.
- Language: English, العربية, اردو (also sets the language of the customer's push titles, NT-43; Urdu titles fall back to English).
- Notifications:
  - Reservations, vouchers and payments; account, support and security: **always on** (NT-40).
  - Rewards and points; My benefits: push can be turned off (the inbox keeps everything).
  - "Allow push notifications" = the NOTIFICATIONS consent; withdrawing it stops all push (`CONSENT_WITHDRAWN`); the inbox keeps
    everything.
  - Offers and news: marketing push / email, separate opt-in consents (delivery itself is Phase 2, NT-30).
  - Push delivery honours all of the above (`NotificationsService.customerPushBlock`).
- Privacy and consents: Terms / Privacy with accepted date and version (not withdrawable here; deletion is in My data), location
  consent, legal documents (links when configured; otherwise "final text being prepared"), My data.

## Global states (Customer MVP §14)
- Offline: a persistent top banner while the device is offline.
- Session ended: a sheet with sign-in when a call returns `AUTH_REQUIRED` for a signed-in customer.
- The account signal: `useApi` raises a `dd:account-signal` window event for `AUTH_REQUIRED`, `ONBOARDING_REQUIRED`,
  `CONSENT_REQUIRED` and `AGE_RESTRICTED`; the screen still shows its own error.

## Live Deals map (C-05)
- Explore → Map: up to 50 Live Deals placed at their nearest branch (Web-Mercator), the customer's position (or the city centre),
  pins grouped when close (tap zooms in and lists them), zoom / recentre controls, drag to pan, keyboard + / −.
- Deals without coordinates are counted and left to the list.
- The map never mirrors in RTL; the selected-deal cards below it do (Customer MVP §15).
- Base layer: `customer.map.tileUrlTemplate` (+ `attribution`) for a licensed tile provider. **None is configured**: the map draws a
  plain canvas with 1 / 3 / 5 km rings. Choosing and contracting a tile provider is an external dependency.

## Urdu (customer app only)
- Routes `/ur/...`; right-to-left; `Accept-Language: ur` is honoured by the customer app (business portals stay EN / AR).
- The auth context carries two languages: `uiLocale` (interface: en / ar / ur) and `locale` (content: en / ar). Urdu reads the
  English content columns until content has an Urdu column.
- `dictionaries.ur.ts` translates the customer journeys (home, discovery, Exclusive Deals, reservations, vouchers, checkout,
  wallet, Watch & Earn, rewards, My benefits, account, map, errors); a test keeps coverage above 85% of those keys and every
  placeholder intact. Untranslated keys (mostly business-only, plus customer care / reviews) fall back to English.
- Western digits; dates use `ur-PK` with Latin digits; PKR amounts as "PKR 4,999.00".
- **Native Urdu review is required before launch** (same rule as the Arabic, B5), including the typeface (the app uses the Arabic
  Naskh face, IBM Plex Sans Arabic; a Nastaliq face is a design decision).

## API (customer audience, the signed-in customer only)
| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/app/me/profile` | Profile, onboarding status (ready, missing, next step), consents, document versions |
| PUT | `/v1/app/me/profile` | Partial update (details, date of birth once, gender, city, interests, language) |
| PUT | `/v1/app/me/consents` | Grant / withdraw (Terms / Privacy cannot be withdrawn) |
| GET / PUT | `/v1/app/me/notification-settings` | Categories (required / optional push), push allowed, marketing |
| POST | `/v1/app/me/mobile/code` · `/v1/app/me/mobile/verify` | Change the mobile number by code |

## Data (migration `20270109000000_customer_account`, additive)
- `Customer`: `dobEnc`, `ageVerifiedAt`, `gender`, `interests`, `onboardedAt`.
- `CustomerConsent` (new, append-only history).
- `EligibilityAttribute.renewDueAt` (EM-20 renewal date; existing employer rows get their end date).
- `NotificationType` `ACCOUNT_WELCOME`.
- `NotificationPreference` category check widened by `CUSTOMER_REWARDS`, `CUSTOMER_BENEFITS` (all existing values kept).

## Configuration
| Key | Default | Note |
|---|---|---|
| `customer.onboarding.minimumAge` | 18 | AU-31 / FD-03; per-market review VK-06 / VK-11 |
| `customer.onboarding.requireCompleteForActions` | true | the gate above |
| `customer.onboarding.termsVersion` / `privacyVersion` | 2026-10 | raise to ask for re-acceptance |
| `customer.onboarding.termsUrl` / `privacyUrl` | null | **Legal to publish** |
| `customer.map.tileUrlTemplate` / `attribution` | null | **map provider to contract** |
| `customer.benefits.employerGraceDays` | 14 | **placeholder** (EM-20) |

## External dependencies and decisions (not built here)
1. Terms of Use and Privacy Policy text and URLs (Legal; VK-11 / VK-23).
2. Map tile provider (licence, attribution, cost) for the base map.
3. Real SMS (mobile change, sign-in) and email providers; push provider and device tokens; marketing delivery (NT-30, Phase 2).
4. Quiet hours and frequency caps for customers (FDR-68 / VK-23): only the existing per-channel hourly cap applies.
5. Native Urdu (and Arabic) review; Urdu content columns for merchant / partner text; Urdu push and SMS templates.
6. Founder values: `employerReverifyDays` (FDR-28), `employerGraceDays`, minimum age per market.
7. Existing development / UAT customers have no completed profile: they are asked to finish the set-up before reserving, buying
   or earning (dev data is not changed by the migration).
