# DealDash — Remote UAT guide (staging)

Status 2026-10-16: **prepared, not live.** Nothing is provisioned; no domain, cloud project or Cloudflare account exists yet. This guide
applies once the founder-approved staging cell (`docs/STAGING_DEPLOYMENT_PLAN.md`) is running in EDGE mode. Staging holds **synthetic
test data only**: no real customers, no real money, no real SMS. Production is not deployed and public launch is not authorized.

## 1. Addresses (replace `<domain>` with the chosen domain)

| App | Address | Who |
|---|---|---|
| Customer app | `https://app.staging.<domain>` | all testers (phone or laptop) |
| Merchant Staff app (PWA) | `https://staff.staging.<domain>` | all testers |
| Merchant portal | `https://merchant.staging.<domain>` | business testers |
| Partner portal | `https://partner.staging.<domain>` | business testers |
| Admin portal | `https://admin.staging.<domain>` | founder + at most 1–2 named people |

Every screen shows a small amber **STAGING · Test data only** label. Search engines are told not to index any of these pages
(`X-Robots-Tag: noindex` and a robots.txt that disallows everything).

## 2. Getting in (two locks)

1. **Cloudflare Access (the door):** open the address, type your e-mail, enter the 6-digit code Cloudflare e-mails you. No account and
   nothing to install. You stay in for 7 days on that browser. On iPhone Safari and Android Chrome this works on any network (no
   office Wi-Fi needed). If you add the app to your home screen, enter the e-mail code once more inside the installed app.
2. **The app's own sign-in (unchanged from production):** customers and staff use a phone number + a 6-digit SMS code; merchant and
   partner users use e-mail + password; admins use password + authenticator code.

## 3. Which account to use

**Customer testers** — each tester gets one number from these synthetic ranges (no real phone uses them):

| Range | Use |
|---|---|
| `+966500000600` – `+966500000699` | customer testers (Saudi-style numbers) |
| `+920000000600` – `+920000000699` | customer testers (Pakistan-style numbers) |
| `+966500000001`, `+966500000002` | the two seeded sample customers (already have reservations and vouchers) |

A new number creates a customer account on first sign-in, followed by the short profile set-up (name, date of birth 18+, city,
Terms). **SMS codes are not sent to phones in staging:** they appear in Admin → *Notification operations* → **Staging test inbox**.
The UAT coordinator (signed in as `operations@dealdash.test`) reads the code and sends it to the tester. A customer session lasts
14 days, so a code is needed about once per device. "Continue with Google / Apple" uses a test screen in staging (pick a test account)
and then asks for the phone number in the same way.

**Merchant Staff testers** — seeded staff numbers `+966500000100`, `+966500000102`, `+966500000103`, `+966500000104` (codes from
the same inbox).

**Business testers** — seeded accounts, all with the shared staging password (stored in Google Secret Manager as
`dd-staging-seed-user-password`; the founder shares it privately, never in chat groups):

| Portal | Accounts (role) |
|---|---|
| Merchant | `owner@harbourgrill.test` (Owner), `admin@…` (Admin), `finance@…` (Finance), `campaigns@…` (Campaign manager); `owner@dailydose.test`; `owner@najdkitchen.test` and the other `owner@<merchant>.test` accounts |
| Partner | `admin@bank.test`, `campaigns@bank.test`, `benefits@bank.test`, `analyst@bank.test`, `finance@bank.test`, `readonly@bank.test`, `finance-manager@bank.test`, `approver@bank.test`, `integration@bank.test`, `network@bank.test`; `admin@employer.test` |
| Admin | `super@dealdash.test`, `operations@`, `merchant-management@`, `partner-management@`, `support@`, `finance@`, `risk@`, `marketing@`, `analyst@dealdash.test` — password + authenticator code (shared staging authenticator key in Secret Manager `dd-staging-seed-admin-totp-secret`; admin testers only) |

Each account sees only its own organisation and only what its role allows (the same rules as production). Give business testers
the role they should test, not a higher one.

**Test payments:** paying, deposits, card holds, saved cards and voucher purchases open a **test payment page** with Approve /
Decline buttons (and test cards to choose from). No card number is ever entered and no money moves.

## 4. Founder: invite or remove a tester

- **Invite:** Cloudflare dashboard → Zero Trust → Access → Applications → pick the group (Customer + Staff, Merchant + Partner, or
  Admin) → Policies → add the person's e-mail → Save. Then send them the address and, for business testers, their account.
- **Remove:** delete their e-mail from the policy, then Zero Trust → Users → the person → **Revoke sessions** (takes effect at once).
  For a business account they used, disable it in Admin as well.
- Up to 50 people are free on Cloudflare's Free plan.

## 5. What is deliberately different from production

| Topic | Staging | Production |
|---|---|---|
| SMS / e-mail | kept in the admin Staging test inbox (synthetic recipients only) | real providers (not selected yet) |
| Payments, card holds, saved cards | test payment page, no money | real provider (not contracted yet) |
| Google / Apple sign-in | test account screen | real Google / Apple credentials (external) |
| Data | synthetic seed only | real customers |
| Search engines | never indexed | customer app may be indexed (production build only) |
| Who can open it | invited e-mails only (Cloudflare Access) | public customer app; portals still role-protected |

## 6. Reporting an issue

Note the app, the address, the account or test number you used, what you expected, what happened, and attach a screenshot (the
STAGING label shows it is test data). Never paste passwords or sign-in codes into the report.

## 7. Engineering notes (remote UAT fixes G-4 to G-8, 2026-10-16)

- **G-4 same-origin API:** the load balancer sends `/v1/*` on every app host to the API, and each web image is built with its own
  address as API URL (`STAGING_HOST_SUFFIX`), because Cloudflare Access gives every hostname its own login cookie. Cloud Armor
  refuses `/v1/admin/*` on every host except admin. The service workers never touch `/v1/` calls.
- **G-5 test provider pages in staging:** the mock payment / card hold, mock card, mock Google / Apple and voucher test-payment
  endpoints run when `APP_ENV=staging` and `ALLOW_MOCK_PROVIDERS=true` (`mockProviderPagesEnabled`, refused in production by the boot
  check). The SMS inbox and TOTP helpers under `/v1/dev` stay off in every production build, staging included.
- **G-6 noindex:** `X-Robots-Tag` on every web response (customer app indexable only in a `NEXT_PUBLIC_APP_ENV=production` build;
  portals never) and on every API response; `robots.txt` disallows everything. Optional second layer: a free Cloudflare Transform Rule
  adding `X-Robots-Tag: noindex` for `*.staging.<domain>`.
- **G-7 staging label:** `EnvironmentRibbon` in the shared app shell for `NEXT_PUBLIC_APP_ENV=staging` builds (EN / AR / UR).
- **G-8:** this guide and the synthetic number ranges above (all inside `STAGING_TEST_PHONE_PREFIXES`).
