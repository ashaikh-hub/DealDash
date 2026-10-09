# Stage 4: Exclusive Deals, free reservations and merchant staff redemption

Status: complete and verified; waiting for founder approval. Stage 5 has NOT been started.
Not built (by instruction): Vouchers, payments, Watch & Earn, Rewards, Partner functionality.

## How to run and view it

```powershell
pnpm install
pnpm db:migrate            # applies 20261020000000_stage4_hot_deals_reservations
$env:SEED_USER_PASSWORD = "<your own dev password>"   # BEFORE seeding; re-seeding resets dev passwords
pnpm db:reset              # reset + seed (includes Stage 4 demo data)
pnpm dev:api               # 4000
pnpm dev:customer          # 3001   Exclusive Deals, My Deals, ticket
pnpm dev:merchant          # 3002   Campaigns > Exclusive Deals, live monitor, Redemptions
pnpm dev:admin             # 3005   Exclusive Deals review/monitor, Reservations tools
pnpm dev:staff             # 3003   Staff PWA (scan, history, account)
```

Dev logins (all use your seed password, except OTP accounts which use the code at `/v1/dev/last-sms?to=`):

| Surface | Account |
|---|---|
| Merchant owner (Najd Kitchen) | owner@najdkitchen.test |
| Merchant owner (Harbour Grill), Campaign Manager, Finance | owner@ / campaigns@ / finance@harbourgrill.test |
| Admin Operations (MFA: `/v1/dev/totp?email=`) | operations@dealdash.test |
| Admin Support | support@dealdash.test |
| Staff (mobile OTP) | +966500000102 Najd Al Nakheel, +966500000103 Pulse Al Malqa, +966500000104 Daily Dose, +966500000100 Harbour Grill Olaya |
| Customers (mobile OTP) | +966500000001 (employer verified), +966500000002, +966500000400..403 (demo) |

A live HELD reservation is deliberately not seeded (holds last 30 minutes). Reserve in the customer app, then scan or type the code in the Staff app.

Tests and checks:

```powershell
pnpm typecheck; pnpm lint; pnpm test          # all suites (API needs: pnpm db:test:reset)
node tooling/e2e/stage4-browser.mjs           # real Edge, all four apps running, SEED_USER_PASSWORD set
```

## What was built

### Exclusive Deal domain
- Own table and lifecycle, shared kernel only (eligibility engine, guardrails, categories, media, audit, localisation).
- States: DRAFT, PENDING_REVIEW, NEEDS_CHANGES, SCHEDULED, LIVE, PAUSED, SOLD_OUT, EXPIRED, CANCELLED, REJECTED, SUSPENDED. Every change goes through one `transition()` (conditional update + history + audit); illegal moves are refused. SOLD_OUT follows stock automatically (and reopens when units come back).
- Limit types TIME, QUANTITY, TIME_AND_QUANTITY. Reservations on = needs a quantity limit; off = walk-in, time-limited only (no code, no stock).
- Bilingual (both languages needed to submit), image, category, eligibility, start/end, per-customer limit, hold time, terms, version and decision history.
- Live editing: wording and photos only (audited `MINOR_EDIT`). Anything that changes what customers receive is refused with `MATERIAL_EDIT_LOCKED` (cancel and relaunch, or ask DealDash). Stock changes only through the stock endpoint.

### Free reservations and inventory
- Free: creating a reservation confirms it. No deposit, no payment screen, no price anywhere (the earlier SAR 15 deposit idea is removed; tests assert it).
- Hold time default 30 minutes (`reservation.hold_minutes`), per-deal override within `reservation.hold_limits`.
- Per-branch inventory: total, available, reserved, redeemed, released. Invariant `total = available + reserved + redeemed`, all non-negative, enforced by CHECK constraints.
- Concurrency design: stock moves only by single conditional `UPDATE ... WHERE available >= q` (row lock); reservation state changes are conditional on `status = 'HELD'`; per-customer limits are serialised with a transaction advisory lock; lock order is always inventory then deal (no deadlocks). Transactions use one connection (all reads happen before the transaction opens) so load cannot starve the pool. Overdue holds are freed on demand when a branch looks full.
- Reservation states: HELD, REDEEMED, EXPIRED, CANCELLED. Customers see neutral wording: "Reservation not completed" (never no-show, penalty or ban).
- Limits (configurable): per-customer per deal, max active reservations (3), expiring notice (10 min).
- Eligibility is checked again at reserve time and again at redemption.

### Redemption (Merchant Staff)
- Staff PWA, mobile OTP, scoped to merchant (and one branch if assigned). Camera QR scanning (BarcodeDetector where available, jsQR fallback), manual code fallback, one adaptive result: VALID, REDEEMED, INVALID_CODE, EXPIRED, ALREADY_REDEEMED, WRONG_BRANCH, INELIGIBLE, NOT_ACTIVE, CAMPAIGN_UNAVAILABLE. Today/yesterday history, account page, offline/connection errors with retry.
- Online only. A lost connection while confirming offers retry with the SAME Idempotency-Key, so it can never redeem twice. No offline redemption.
- Redemption is one conditional update (`HELD` and not expired), a partial unique index (one active redemption per reservation), idempotent, audited; duplicate scans, QR replay, double taps and concurrent devices produce exactly one success.
- A code of another merchant reads as "not recognised". Failed attempts are logged (append-only, only the code tail) and rate limited per staff member (5 wrong codes/minute).
- Staff cannot reverse. Reversal (within `redemption.reversal_window_hours`, default 24) is Merchant Owner/Admin or DealDash (`admin.reservations.manage`), needs a reason, gives the customer a fresh hold, is audited.
- Codes: QR text `DD1.<22 random chars>` (128 bits) and an 8-character manual code (unambiguous alphabet), both random and unrelated to any id; single use; expire with the hold.

### No-show foundation
- Only a hold that elapses unredeemed counts; cancelling does not. N confirmed (default 3) within a window (30 days) put a TEMPORARY restriction on new reservations (default 7 days), never a permanent ban. Counting restarts after a restriction. Operations/Support can review and lift restrictions with a reason (audited). All values configurable (`reservation.noshow`).

### Notifications foundation
`NotificationsService` writes the in-app inbox inside the transaction and delivers to channels (push provider abstraction, mock in development) after commit; failures never fail the action. Events: confirmed, expiring soon, not completed, cancelled, redeemed. Customer "Updates" tab.

### Analytics
Impressions and detail views (deduplicated, validated server-side, `product: HOT`), reservation created/cancelled/expired/redeemed events, funnel view -> reservation -> used, not completed and cancelled counts. No revenue, no sales, no conversion-to-purchase (text says so). Live Deal analytics are filtered to Live Deals only.

### Screens
- Customer (mobile, EN/AR): Exclusive Deals rail on Home, Exclusive Deals list (sort), detail (countdown from the server clock, units left, per-branch stock, how it works, reserve sheet with branch choice), ticket (QR, manual code, timer, directions, call, cancel), My Deals (Active, Past, Updates), locked/sold-out/restricted/walk-in states.
- Merchant (desktop): Campaigns now has a Live Deals / Exclusive Deals switch; Exclusive Deals hub; six-step builder (Offer, Content, Time & limits, Branches & stock, Eligibility & terms, Review) with customer preview; live monitor (Live monitor, Reservations, Results, Activity; pause, resume, cancel, add stock, cancel a reservation); Redemptions page with reversal.
- Admin (desktop): Exclusive Deals review queue / all / live monitor; review page (both languages, per-branch inventory, reservation rules, dates, eligibility, preview, history; approve, request changes, reject, pause, resume, suspend, reinstate, cancel); Reservations tools (restrictions list and lift, reservation lookup, cancel, reverse a redemption).
- Staff (mobile PWA): Scan, History, Account.

## Database changes (migration `20261020000000_stage4_hot_deals_reservations`)
Tables: `HotDeal`, `HotDealInventory`, `HotDealHistory` (append-only), `Reservation`, `ReservationEvent` (append-only), `Redemption`, `RedemptionAttempt` (append-only), `CustomerRestriction`, `Notification`. `DealEvent` gains `productType` and four reservation event types. Hand-written: CHECK constraints (stock non-negative and balanced, date order, limits), partial unique indexes (one active redemption per reservation, one active restriction per customer, idempotency key per staff member), append-only triggers. No other migrations.

## API added (all under `/v1`)
- Customer: `GET /app/config`, `GET /app/hot-deals`, `GET /app/hot-deals/:id`, `POST /app/hot-deals/:id/reservations` (Idempotency-Key), `GET /app/reservations`, `GET /app/reservations/:id`, `POST /app/reservations/:id/cancel`, `GET /app/notifications`, `POST /app/notifications/read`; events endpoint accepts `product: HOT`.
- Merchant (`/merchants/:orgId/...`): `hot-deal-options`, `hot-deal-choices`, `hot-deals` (list, summary, create, get, update, submit, pause, resume, cancel, stock, preview, history, monitor, activity, reservations), `reservations/:id/cancel`, `redemptions`, `redemptions/:id/reverse`.
- Admin: `admin/hot-deals` (list/queue, overview, detail, monitor, activity, audit, approve, request-changes, reject, pause, resume, suspend, reinstate, cancel); `admin/reservations` (restrictions, lift, search, cancel, redemptions, reverse).
- Staff: `staff/me`, `staff/redemptions/validate`, `staff/redemptions` (Idempotency-Key), `staff/history`.
OpenAPI regenerated (`pnpm api:contract`).

## Permissions (enforced in the API, tested)
Merchant A cannot touch Merchant B (404). Campaign Manager manages Exclusive Deals and cancels reservations; Finance has no campaign permission (it keeps the existing read of redemptions for reconciliation, but cannot reverse); only Owner/Admin reverse; branch-scoped managers are refused on organisation-wide routes; Staff can only validate/redeem/see history for their scope and cannot reach any portal, admin or customer route. New permissions: `customer.reservations.manage`, `merchant.redemptions.reverse`, `admin.reservations.manage` (Operations, Merchant Management, Support, Super Admin). Support cannot approve, pause or suspend.

## Configuration added (Admin > Configuration; mock values)
`hot_deals.limits`, `hot_deals.guardrails`, `hot_deals.auto_publish` (pilot: manual review), `reservation.hold_limits`, `reservation.max_active`, `reservation.expiring_notice_minutes`, `reservation.noshow`, `redemption.recheck_eligibility`, `redemption.manual_attempts_per_minute`, `redemption.reversal_window_hours`, `staff.history_days`, `discovery.city_centers`. Existing: `reservation.hold_minutes`, `discovery.enabled_cities`.

## Verification (actual results of the final run)
- `pnpm typecheck`: 24/24 tasks. `pnpm lint`: no errors. `pnpm build`: 15/15 (all Next apps compile).
- Unit/UI: localization 13, ui 14, app-shell 11, validation 6, auth 5, customer 26, merchant 41, admin 29, staff 19, partner 3.
- API: 19 files, 354 tests (was 247): domain, reservations, real parallel concurrency (inventory = 1 with two customers gives exactly one success; 20 customers for 5 units give exactly 5; same-customer double tap; cancel vs expiry; redeem vs cancel; remove-stock vs reserve), redemption matrix and replay, permissions and tenant isolation, discovery/eligibility/analytics, the end-to-end journey, app config.
- Browser (real Edge, `tooling/e2e/stage4-browser.mjs`): 120/120 checks after the final UX decisions (was 110/110), no unexpected console errors. Covers the full journey (merchant builds, admin requests changes then approves, customer reserves free, staff scans a QR through a fake camera, replay, wrong branch, typed code, lost connection with retry, customer sees Used, sold-out, add stock, reverse, restrictions, lookup), Arabic/RTL on every surface, 360 px and tablet layouts, error/missing/guest states and permissions. 61 screenshots in `docs/screenshots/stage4/`.

## Real-device test still required (cannot be proven here)
The browser run uses Chrome's fake camera fed with a video of the QR. It proves the scanner logic, not a phone. Please test on at least one Android phone (Chrome) and one iPhone (Safari), over HTTPS (cameras need a secure context; use a tunnel or deployed staging):
1. Install the Staff PWA, sign in with a staff mobile OTP, allow the camera.
2. Reserve in the customer app on another device; scan the QR from the screen at arm's length, in bright and in dim light, at normal and 50% brightness. Confirm it reads within about 2 seconds.
3. Deny camera permission: the manual form and the explanation must appear.
4. Switch to airplane mode before Confirm: the offline panel must appear; reconnect and Retry: exactly one redemption.
5. Repeat in Arabic. Rotate the phone. Check that the QR on the customer ticket is large enough to scan on a small phone and that a screenshot of the QR (replay) is reported as already used.

## Deviations and notes
- Exclusive Deals have no revisions/versions table: a live Exclusive Deal accepts only audited wording and photo corrections; any material change means cancel and relaunch (documented, short-lived campaigns). Versions are the history snapshots plus the `version` counter.
- Staff history shows the staff member's own scans (not the whole branch).
- Codes are stored in clear (needed to show them again to the customer); the database is the trust boundary. Hashing at rest is a hardening item.
- Staff with no branch (all branches) have no branch picker: any branch of their merchant is accepted.
- Merchant "Finance" keeps the Stage 1 read permission on redemptions.
- The notification providers are the development mocks; SMS/push vendors are VALIDATE-KSA.
- Two small defects found by the browser run and fixed: an infinite refetch loop in the Staff history page, and a connection-pool starvation under 20 parallel reservations.

## VALIDATE-KSA (not decided in code)
Real SMS/push delivery and consent wording for reservation notifications; retention period for reservation, attempt and notification records; whether customer first name may be shown to staff; Arabic copy native review (all Stage 4 Arabic is a working translation); final hold-time and no-show thresholds from real usage; consumer-protection wording for restrictions.

## Founder decisions needed
1. Default hold time (30 min) and per-deal range (10 to 120).
2. No-show rule defaults (3 in 30 days, 7-day pause) and whether customers get a warning before a restriction.
3. Whether staff may see the customer's first name (currently yes).
4. Maximum simultaneous reservations per customer (3).
5. Who may reverse a redemption (Owner/Admin, 24 hour window) and whether managers should be able to do it at all in the pilot.
6. Whether Finance should keep seeing redemptions.
7. Whether to hash reservation codes at rest before launch.

## Recommended Stage 5 scope
Vouchers (purchase and redemption reusing the Staff app and the redemption service), payments abstraction with the real provider, then Watch & Earn / Rewards; re-enable their customer tabs from `CUSTOMER_NAV_WHEN_BUILT`.

## Final UX decisions (2026-10-08) and what changed

Approved after the Figma handoff review. Code, tests, browser QA and the design documents were all updated together.

| # | Decision | Where it lives |
|---|---|---|
| 1 | Staff result colours: green = Valid/Redeemed; amber = Expired, Not valid yet, Wrong branch; red = Invalid, Already redeemed, Eligibility failed, Campaign suspended/blocked, Reservation cancelled | `toneOf` in `apps/staff/features/redeem.tsx`; history chips in `history-account.tsx`; `DEALDASH_MERCHANT_STAFF_DESIGN.md` section 5 |
| 2 | Redeem confirmation is a mobile bottom sheet (offer, benefit, first name, branch, reference, irreversible warning); locked while submitting | `BottomSheet` in `packages/ui`; `redeem.tsx` (`redeem-open` then `confirm-redeem`) |
| 3 | `NOT_VALID_YET` is a distinct result (amber) with the start time; checked after Expired, before Campaign unavailable; also blocks redeem | enum `RedemptionResult` (migration `20261021000000_stage4_not_valid_yet`), `redemption.service.ts` `assess`, API e2e test |
| 4 | OTP: one accessible input drawn as six boxes; wrong/expired clear the boxes; no "tries left"; resend button | `OtpInput` (`packages/ui`), `login-panel.tsx` |
| 5 | Reservation quantity fixed at 1 (no stepper); per-customer limits stay configurable | unchanged: `quantity: 1` in the customer reserve call, merchant "Per customer" limit |
| 6 | Torch toggle and screen wake-lock as progressive enhancement | `apps/staff/features/scanner.tsx` |
| 7 | History search by code and scan detail sheet | `history-account.tsx` (uses the existing `q` filter) |
| 8 | Admin per-Hot-Deal reservation/activity feed | `ActivityFeed` in `apps/admin/features/hot-review.tsx` (existing `/v1/admin/hot-deals/:id/activity`) |

Limits to know about: wake-lock and torch depend on the browser and camera (Chrome/Edge on Android support both; iOS Safari has no torch API and wake lock only on recent versions), so both hide or fail silently and never block scanning. History search matches the code, not the customer name. Arabic wording for the new strings is a first draft and needs native review before launch.


## Addendum: commercial governance (Exclusive Deals)

Exclusive Deals now go through the shared commercial platform before they can be submitted or approved: the owner reviews the DealDash redemption fee, any sponsor funding and the non-cash benefit, accepts explicitly, and funds the prepaid charge (or uses approved credit). A stock increase on a live deal is an amendment that must be accepted first. A walk-in deal with no tracked stock needs a stated maximum redemption count. A verified redemption draws down the funding and a reversal gives it back. See [COMMERCIAL_FINANCE.md](COMMERCIAL_FINANCE.md).
