# Stage 3: Live Deals and customer discovery

Status: **implemented and verified** (see "Verification" for the exact results). Scope delivered, and nothing beyond it:
the Live Deal domain, the Merchant Live Deal builder and hub, DealDash Live Deal review, live-edit rules (minor versus
material), customer discovery (home, explore, search, nearby, deal detail, merchant page, saved), configurable categories,
the eligibility visibility foundation, discovery analytics for merchants and DealDash, development image storage rules,
Arabic/RTL throughout, permissions, tenant isolation and audit.

Not started (later stages): Exclusive Deals, reservations, vouchers, payments, Watch & Earn, rewards, Partner Portal functionality,
Play & Win, gifting, promo codes. The customer tab bar shows **Watch & Earn** and **Rewards** as the approved placeholders.

## How to run and view it

```powershell
pnpm install
pnpm build:packages
pnpm db:migrate                  # applies 20261010000000_stage3_live_deals and 20261010000100_search_normalisation
$env:SEED_USER_PASSWORD = "choose-a-dev-password"   # typed locally; never commit it
pnpm db:seed                     # also seeds the new permission, categories, 4 more Riyadh merchants and 16 sample deals

pnpm dev:api                     # http://localhost:4000  (OpenAPI: /docs)
pnpm dev:customer                # http://localhost:3001  (Arabic: /ar)   phone-width column, centred on desktop
pnpm dev:merchant                # http://localhost:3002  (Arabic: /ar)   Campaigns at /en/deals
pnpm dev:admin                   # http://localhost:3005  (Arabic: /ar)   Live Deals at /en/live-deals
```

| What | Where | Sign in |
|---|---|---|
| Customer app (guest browsing needs no sign-in) | http://localhost:3001 | Optional: mobile `+966500000001` (employer verified: sees the employer offer unlocked) or `+966500000002` (no benefits: sees it locked). The OTP code is shown at `GET /v1/dev/last-sms?to=%2B966500000001`. |
| Merchant app | http://localhost:3002 | `owner@harbourgrill.test` (7 deals in every review state, one pending new version), `campaigns@harbourgrill.test` (Campaign Manager), `finance@harbourgrill.test` (no campaign access), `owner@dailydose.test`, `owner@najdkitchen.test`, `owner@bloombeauty.test`, `owner@pulsefitness.test`, `owner@pageandco.test`. Password = your `SEED_USER_PASSWORD`. |
| Admin app | http://localhost:3005 | `operations@dealdash.test` (review + pause/suspend), `merchant-management@dealdash.test`, `marketing@dealdash.test` (review, cannot suspend), `analyst@dealdash.test` (analytics only), `support@dealdash.test` (no access to Live Deals). TOTP code: `GET /v1/dev/totp?email=...`. |

After pulling Stage 3 run `pnpm db:migrate` **and** `pnpm db:seed` (the seed adds the new `customer.saved.manage` and
`admin.campaigns.control` permissions to the role matrix and the categories; they are not created by the migration).

```powershell
pnpm test                                   # unit + integration + API end-to-end (needs the test database: pnpm db:test:reset)
node tooling/e2e/stage3-browser.mjs         # real Edge: whole journey, Arabic/RTL, states, permissions, responsive
                                            # (needs API + customer + merchant + admin running and SEED_USER_PASSWORD set)
```

Screenshots from the browser run are in `docs/screenshots/stage3/`.

## What was built

### Live Deal domain (API)

- One module `apps/api/src/live-deals/` with its own lifecycle; it shares nothing with Exclusive Deals/Vouchers/Watch & Earn.
- **Statuses** (explicit, enum-backed, transition table in `@dealdash/types`): `DRAFT`, `PENDING_REVIEW`, `NEEDS_CHANGES`,
  `SCHEDULED`, `LIVE`, `PAUSED`, `EXPIRED`, `REJECTED`, `SUSPENDED`. Only listed transitions are legal; every change goes through
  one method (`DealCoreService.transition`) that checks the table, uses a conditional update (concurrent decisions: exactly one
  wins) and writes history plus audit. `EXPIRED` and `REJECTED` are terminal. A merchant can never resume a deal that DealDash
  paused or suspended.
- **Content** (one validated bilingual structure shared by API and apps): category, mechanic (percentage, amount, BOGO, bundle,
  meal deal, service offer, everyday promotion, other), value, headline offer label, title, short and full description (EN + AR),
  1 to 5 images with EN/AR alt text, participating branches, start/end (Riyadh time, stored UTC, end optional), eligibility,
  structured terms plus free text (EN + AR), redemption mode. Publication requires both languages (FDR-01, see founder decisions).
- **General versus Controlled**: `redemptionMode` is `GENERAL` by default and means discover, view, visit: no claim, reservation,
  QR/barcode or forced redemption event (asserted by tests). `CONTROLLED` exists only as an enum and is refused with
  `CONTROLLED_NOT_ENABLED` unless configuration `live_deals.controlled_enabled` is turned on; no controlled flow is built.
- **Review and decisions**: submit, request changes (EN + AR reason, field list), approve, reject, pause, resume, suspend,
  reinstate. Every decision records actor, role, timestamp, decision, reason (mandatory) and an audit entry.
- **Live editing (LD-41)**: minor edits (typos, formatting, translation touch-ups, photos and alt text) publish immediately with a
  before/after snapshot in history and audit. Material edits (type, value, headline, category, branches, start/end dates,
  eligibility, structured terms, a number changed inside title/description, or a large rewrite of title/description/terms) never
  change the live deal: they become a **revision** that goes through the same review (`kind: REVISION` in the queue). The live
  version keeps serving until approval. The material-field list is configuration (`live_deals.material_fields`). The start date
  cannot change after the deal has started.
- **Guardrails**: pilot posture is manual review for everything. Auto-publish exists behind `live_deals.auto_publish`
  (off) for trusted merchants with clean content (mock ranges, VALIDATE-KSA); the builder shows "will be reviewed" or "pre-approved".
- **Dates**: visibility is computed from the dates directly (never depends on a background job); a minute-by-minute sweep job
  brings stored status and history in line (`SCHEDULED` to `LIVE` at start, to `EXPIRED` at end).
- A deal is hidden immediately when its merchant is not active or none of its branches is active.

### Customer discovery (API + app)

- Home (categories with eligibility-aware counts, Live Offers, Live Deals Near You, Ending soon), Explore (category, distance
  radius, sort, eligibility filter, paging), Search, Deal detail, Merchant page, Saved, Profile (sign in, language).
- **Nearby**: PostgreSQL + PostGIS (`ST_DWithin` radius on the GiST index, `ST_Distance` geography metres), nearest participating
  branch per deal, branches without coordinates never "near", city filter (Riyadh is the only enabled city; configuration).
- **Search**: PostgreSQL only. Matches merchant name, deal title, headline, short description and category, in either language,
  all words must match, ranked title > merchant > category. Arabic normalisation (alef forms, teh marbuta, alef maksura,
  diacritics, tatweel, Arabic-Indic digits) is the SQL function `dd_norm_ar` and is mirrored in the app; the Arabic article is
  stripped from query words. `%`, `_` and quotes are escaped and parameterised.
- **Eligibility visibility** (shared engine, `EligibilityRuleSet` / `EligibilityCondition` / `EligibilityAttribute`): public,
  geography, employer, bank card, scheme. Eligible: usable. Can reasonably unlock: shown **locked** with the explanation and an
  action ("Verify your employer to unlock", "Add your bank benefits to unlock", guests: "Sign in"). No realistic path (outside the
  geography, or verified at a different employer): **hidden** from discovery, detail returns 404. Card benefits are partner
  organisation ids only; the schema has no column for a card number, CVV, expiry, last digits or BIN (tested).
- **Images**: development storage adapter, JPG/PNG only, max 5 MB, min 400 x 250 px (header-parsed, magic-byte checked),
  preview, replace, remove, cover, alt text EN/AR (falls back to the title). Final storage vendor is not selected.
- Customers see only approved customer-facing content. The merchant page exposes name, logo, cover, description, branches,
  hours, phone and live deals; never e-mail, legal name, registration, tax or settlement data (tested).

### Merchant Portal

Campaigns hub (Live Deals tab, search, status filter, needs-attention filter, directions-click signal), five-step builder
(Basics, Branches & schedule, Eligibility & terms, Photos, Preview & submit) with English and Arabic fields side by side,
translation status chip, 30-second draft autosave, blocked Next with per-language errors, live customer preview (card and
detail, EN/AR toggle), guardrail panel, material-edit notice, result screens; deal detail with Overview, Analytics, Activity,
pause/resume/end, "Fix & resubmit", pending-version banners and discard/withdraw.

### Admin Portal

Live Deals page: review queue (oldest first, new deals and proposed new versions), all deals, performance tab. Review workbench:
merchant, English and Arabic side by side, dates, branches, eligibility, terms, photos, customer preview in both languages,
guardrail result, decision history; Approve, Request changes, Reject (reason required, Arabic reason recommended) and, with
`admin.campaigns.control`, Pause, Resume, Suspend, Reinstate. Controls shown are exactly the ones the backend allows.

## Database changes (migrations `20261010000000_stage3_live_deals`, `20261010000100_search_normalisation`)

| Table | Purpose |
|---|---|
| `Category` | Configurable bilingual categories (8 development defaults) |
| `LiveDeal` | Deal: `content` (authoritative JSON), derived query columns, status, version, dates, eligibility link |
| `LiveDealBranch` | Participating branches |
| `LiveDealRevision` | Proposed new version of an approved deal (one open revision per deal, unique partial index) |
| `LiveDealHistory` | Every lifecycle step and decision with actor and reason; append-only (trigger) |
| `EligibilityRuleSet`, `EligibilityCondition`, `EligibilityAttribute` | Shared eligibility architecture and customer attributes |
| `SavedItem` | Customer favourites (polymorphic; Follow is not modelled) |
| `DealEvent` | Append-only discovery signals (impression, detail view, merchant page view, save, unsave, directions click) |

Also: enums for the lifecycle, mechanics, eligibility and events; `dd_norm_ar()` SQL function; CHECK constraints (end after start,
version positive); append-only triggers on `LiveDealHistory` and `DealEvent`; partial index for discoverable deals. No Exclusive Deal,
Voucher or Watch & Earn schema. Migrations were verified from an empty database (`db:reset`) and on the test database.

## API added

Merchant (`/v1/merchants/:orgId/...`, own organisation only, 404 otherwise): `GET deal-options`, `GET/POST live-deals`
(POST needs `Idempotency-Key`), `GET live-deals/summary`, `GET/PUT live-deals/:id` (optimistic `expectedVersion`),
`POST live-deals/:id/submit|pause|resume|end|discard-revision`, `GET live-deals/:id/preview|history|performance`,
`POST deal-media/intent`, `POST deal-media/:fileId/complete`, `GET deal-media/:fileId/url`.

Admin (`/v1/admin/...`): `GET live-deals` (`queue=true`, status, merchant, search), `GET live-deals/analytics`,
`GET live-deals/:id`, `GET live-deals/:id/audit`, `POST live-deals/:id/approve|request-changes|reject|pause|resume|suspend|reinstate`,
`GET/POST/PATCH categories`.

Customer (`/v1/app/...`, public unless noted): `categories`, `home`, `deals`, `deals/nearby`, `search`, `live-deals/:id`,
`merchants/:id`, `events` (202), signed in: `GET saved`, `POST/DELETE saved/live-deals/:id`.

All routes follow the existing auth, RBAC, tenant isolation, Zod validation, error format `{ errors:[{code,message,field}] }`,
cursor pagination, audit and OpenAPI conventions; `packages/api-client/openapi.json` was regenerated (104 paths).

## Permissions

| Rule | Where enforced | Tested |
|---|---|---|
| Merchant A cannot read or change Merchant B's deals, media or analytics (404 on every route, including B using A's id) and cannot reference B's branches/images inside content | `requireMerchantScope`, scoped queries, `validateReferences` | yes |
| Branch-scoped memberships and the Staff app cannot manage campaigns | `requireMerchantScope`, audience | yes |
| Campaign Manager manages campaigns; Finance has no campaign access (list, create, edit, performance, media) | `merchant.deals.read/manage` | yes |
| Merchants not yet active or suspended have no campaign permissions | `ActorService` | yes |
| DealDash review: Operations, Merchant Management, Marketing Ops, Super Admin; Support and Analyst cannot approve, reject or request changes | `admin.campaigns.review` | yes (denials audited) |
| Pause, suspend, reinstate | new `admin.campaigns.control` (Operations, Merchant Management, Risk, Super Admin; not Marketing) | yes |
| Analytics for DealDash | `admin.reports.read` | yes |
| Save and Saved require a signed-in customer | new `customer.saved.manage` | yes |
| Categories: change needs `admin.config.manage` | | yes |

## Analytics events

Recorded server-side from validated references (the client cannot invent a merchant or deal; another merchant's branch id is
dropped), de-duplicated per visitor (impressions, detail views and page views per 30-minute window, directions clicks per
20 seconds), stored in `DealEvent` and also emitted on the shared analytics contract (`deal.impression`, `deal.detail_viewed`,
`merchant.page_viewed`, `deal.saved`, `deal.directions_clicked`) without personal data. Visitors are identified by a random
per-device id. Save/unsave are recorded by the save endpoint.

Merchants see only impressions, detail views, merchant page visits attributed to the deal, saves, directions clicks (and
per-day and per-branch breakdowns), always captioned "Discovery signals. They do not prove visits or sales." No sales,
revenue or conversion figure exists anywhere. DealDash sees the same events as operational counts and top deals.

## Verification (actual results of the final run)

| Check | Result |
|---|---|
| `pnpm format:check`, `pnpm lint` | clean (0 errors; 37 warnings, all `any` in test files) |
| `pnpm typecheck` | 24/24 tasks |
| `pnpm test` (Stage 1 + 2 + 3) | all pass: API 247 (11 files), merchant 26, admin 22, customer 7, ui 14, localization 11, validation 6, app-shell 6, auth 5, analytics 4, config 3, staff 3, partner 3, api-client 2 |
| of which new in Stage 3 | API 146 (39 unit, 36 lifecycle/editing, 21 permissions/media/categories, 49 discovery/PostGIS/search/eligibility/analytics, 1 end-to-end journey), merchant 14, admin 10, customer 7, localization 2 |
| `pnpm build` | 15/15 tasks: API, five Next.js apps and packages build for production |
| Migrations | applied from empty on dev and test (5/5), seed is idempotent |
| Browser QA `tooling/e2e/stage3-browser.mjs` (real Edge) | **98/98 checks** |

API tests cover: state machine (full 9x9 transition matrix), create/edit/validation, review loop (request changes, resubmit,
approve), rejection, pause/suspend/reinstate, scheduling and expiry by date, minor versus material edits and revisions,
tenant isolation, role permissions, branch association, customer visibility, eligibility (public, geography, employer, bank,
scheme, locked, hidden, unlocked filter), PostGIS (geography trigger, GiST index, distances against an independent haversine
calculation, radius, closed branches, no-coordinate branches), search (English, Arabic, hamza/teh marbuta/diacritics,
Arabic-Indic digits, article, merchant and category names, ranking, wildcard safety), analytics events (dedupe, spoof
resistance, performance, append-only), images, categories, audit trail and the full journey.

Browser QA covers: merchant creates a deal (EN + AR, branches, photo upload with validation), preview, submit; admin review,
request changes with EN/AR reason; merchant fixes and resubmits; admin approves; customer finds it by English and Arabic words,
opens it, gets directions, views the merchant, signs in with an OTP, saves it; merchant analytics; admin history; locked
offers for guest / signed-in-without-benefits / verified employee; Arabic/RTL on 9 screens (direction, Arabic font, Western
digits, no overflow); loading skeleton, error with retry, empty states, not-found; long English and Arabic names; permissions
in the real UI (Finance, Campaign Manager, Support); responsive (320, 390, 820, 1280 px).

## Arabic and RTL

Plus Jakarta Sans for English and IBM Plex Sans Arabic for Arabic (existing design system). Every new component uses logical
CSS properties only (a unit test enforces it); directional icons mirror; the Arabic builder fields, previews and admin columns
carry `dir="rtl"`; numbers, distances and dates stay Western and left-to-right; mixed names render correctly. The Arabic text
is a **development translation** for native review before launch.

## Known limitations and technical notes

- **Search** matches words in the language you type: no transliteration (searching "Nobu" does not find "نوبو"), no stemming
  beyond removing the Arabic article from the front of a word (substring matching covers most prefixed forms), no typo
  tolerance. `pg_trgm` was deliberately not added. Paging of discovery lists uses an opaque offset cursor (fine at pilot scale).
- **Eligibility**: customers cannot yet add benefits in the app (My benefits, employer OTP and card selection belong to the
  Partner/Eligibility stage). Attributes exist for tests and the seed. The unlock button for a non-sign-in action explains it
  arrives later. Partner choices are partner organisations (issuer/product/tier granularity comes with that stage).
- **Images** are generated placeholders in the seed; uploaded files that are never attached are not garbage-collected yet.
- A closed branch hides the deal (and the merchant sees "none of its branches is active") instead of changing its status to Paused.
- No map view, share, follow/like, Exclusive Deals, Vouchers, Watch & Earn or Rewards screens (approved scope).
- No notifications to merchants about decisions yet (status and feedback are visible in the portal).
- Public discovery endpoints have de-duplication but no rate limiting yet.
- Geolocation permission prompts were not exercised in headless Edge; the no-location path (city centre) is what QA covers.
- The seed creates synthetic discovery events so analytics are not empty in development. They carry `seed-` device ids.
- Re-seeding resets the development account passwords to the password you give (or a generated one).

## VALIDATE-KSA placeholders (deliberately not decided in code)

- **VK-01** discount and savings claims, price-sanity ranges: `live_deals.guardrails` values are mock.
- **VK-06 / VK-13** eligibility attributes: only partner references; card data is never collected (no PAN, CVV, expiry, last-4, BIN).
- Employer and bank partner lists are development samples; real partners arrive with the Partner stage.
- **VK-11 / VK-15** retention of `DealEvent` and customer favourites is not configured yet.
- Location consent wording and the use of device location for sorting (it stays on the device and goes only as query parameters).
- Advertising and sponsored-offer rules, image and logo rights.
- Arabic customer-facing copy and legal terms wording need native/legal review.

## Technical deviations from the approved documents

- Discovery lives under `/v1/app/...` and merchant routes under `/v1/merchants/:orgId/...` (the existing Stage 2 convention) instead of
  `/v1/merchant/...`.
- `LiveDeal.content` JSON is authoritative with derived query columns, instead of many separate content tables; revisions reuse it.
- The merchant "Controlled redemption" builder step is omitted (the mode is a gated enum only).
- Categories are a table (`Category`), separate from the Stage 2 merchant onboarding category list.
- Shared deal views live in `@dealdash/app-shell` (they need localization and routing) rather than `@dealdash/ui`.

## Founder decisions needed

1. **FDR-01**: publication requires both English and Arabic (implemented). Confirm, or allow one language with assisted translation.
2. **FDR-03**: locked-versus-hidden rule as implemented (hide only when there is no realistic unlock path). Confirm.
3. Guardrail ranges and whether any merchant tier may auto-publish (default: none; BP-03 manual review).
4. Material-edit definition (the default list and the "number changed" / "large rewrite" heuristics).
5. Category list and the pilot city list.
6. Whether the Watch & Earn and Rewards tabs stay visible as placeholders in the pilot.

## Recommended Stage 4 scope

Exclusive Deals (builder, per-branch inventory, time and quantity limits), free reservations (atomic reserve, hold timer, expiry job,
no-show handling), and the Staff PWA (scan/validate/redeem) with the redemption core, reusing this stage's review, revision,
eligibility, discovery and analytics foundations. Customer onboarding (profile, consents) and My benefits (employer OTP, card
selection) are the natural companions so locked offers become unlockable.


## Closed decisions (approved with Stage 3; Stage 3 is frozen)

1. **Bilingual content.** English and Arabic are both required before a deal can be submitted or published. A Draft may hold one language; submission lists the missing language. DealDash Operations may help with translation during the pilot. The Arabic copy in the app is a working translation and needs native review before launch.
2. **Locked vs hidden.** An offer the customer can realistically unlock is shown locked with the reason and a call to action ("Verify your employer to unlock", "Add your bank benefits to unlock"). An offer with no realistic path (for example another city, or a different verified employer) is hidden.
3. **Guardrails** are configuration (Admin > Configuration: `live_deals.guardrails`, `live_deals.auto_publish`), with mock values. They are not permanent policy.
4. **Material edits** of an approved Live Deal (discount or value, core proposition, eligibility, participating branches, important start/end dates, material terms, customer entitlement) go to review as a new version. Typo, format and translation fixes publish immediately and are audited. The field list is configuration (`live_deals.material_fields`).
5. **Categories and cities are configuration.** Riyadh is the initial pilot city only because it is the first entry of `discovery.enabled_cities`. City centres live in `discovery.city_centers`. The public `GET /v1/app/config` returns both, and the customer app reads it (no city is hard-coded in the app or the discovery SQL; `Riyadh` remains only as a last-resort fallback when configuration is empty). Adding a city is a configuration change (covered by `test/app-config.e2e.test.ts`).
6. **Watch & Earn and Rewards.** The customer navigation no longer shows these tabs (no dead placeholders). Routes and components are preserved; `CUSTOMER_NAV_WHEN_BUILT` in `packages/auth/src/index.ts` lists what to move back into `NAV_BY_AUDIENCE.customer` when those modules ship. My Deals is reached from the header ticket icon.

<!-- stage7-founder-decisions -->
## Stage 7 founder approval and decisions (2026-10-10): APPROVED AND FROZEN

Eligibility (FD-S7-3): a card attribute counts as ISSUER_VERIFIED only with a trusted verification source and evidence; otherwise it is
evaluated as declared. Live Deal discovery rules are unchanged (FD-S7-4).
