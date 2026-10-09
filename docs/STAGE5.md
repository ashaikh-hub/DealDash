# Stage 5: Vouchers, purchase, payments, QR redemption and refunds

Stage 5 adds the first paid product. A customer buys a Voucher in the app, owns it only after a **confirmed** payment, shows a secure QR/code at the merchant, and Merchant Staff redeem it through the same Stage 4 redemption framework. The merchant's money becomes **settlement-eligible only after redemption**. Refunds, expiry, support cases and a minimum Admin finance workbench are included.

Not in Stage 5 (by instruction): Watch & Earn, Rewards, Partner Portal functionality, Play & Win, gifting, promo codes, partial redemption, transfer, cash withdrawal, split tender, resale, loyalty-point payment, full settlement runs (Stage 8), Phase 2.

Payments run on a **mock provider** behind a provider adapter. **Nothing here is a legal or accounting conclusion**: every rule that carries legal or financial weight is a configurable placeholder listed under [VALIDATE-KSA](#validate-ksa-not-decided-in-code).

## How to run and view it

Prerequisites are unchanged (Node 22, pnpm, PostgreSQL with PostGIS). From the repo root, in PowerShell:

```powershell
pnpm install
$env:SEED_USER_PASSWORD = '<your own dev password, 12+ characters>'   # YOU choose it; set it BEFORE seeding; never commit or share it
pnpm db:reset            # drops + recreates the dev DB and applies every migration, including Stage 5
pnpm db:seed             # dev seed incl. 11 demo vouchers in every status and demo sales/refunds/ledger
pnpm build:packages
pnpm dev:api             # 4000
pnpm dev:customer        # 3001
pnpm dev:merchant        # 3002
pnpm dev:staff           # 3003
pnpm dev:admin           # 3005
```

| Surface | URL | Sign in |
| --- | --- | --- |
| Customer (mobile) | http://localhost:3001/en/vouchers , `/en/my-vouchers` | any mobile, OTP code from `GET /v1/dev/last-sms?to=<mobile>` |
| Merchant | http://localhost:3002/en/vouchers , `/en/finance` | `owner@najdkitchen.test` (all seeded users share the `SEED_USER_PASSWORD` you chose; the seed refuses to run without it and never prints it) |
| Admin | http://localhost:3005/en/vouchers , `/en/finance` | `operations@dealdash.test` (review), `finance@dealdash.test`, `support@dealdash.test` (admin accounts need the dev TOTP: `GET /v1/dev/totp?email=...`) |
| Staff (mobile) | http://localhost:3003/en | `+966500000102` (Najd Kitchen, Al Nakheel) |

The mock payment page is `/en/pay/<orderId>?mock_payment=<ref>`: it has **Approve** and **Decline** buttons and charges nothing. It settles through the same signed-webhook code path a real provider would use.

Tests and checks:

```powershell
pnpm typecheck ; pnpm eslint . ; pnpm test                   # 662 automated tests
node tooling/e2e/stage5-browser.mjs                          # 101 real-browser checks (Edge), needs the 5 servers + seed
node tooling/e2e/stage4-browser.mjs                          # regression: 120 checks
node tooling/e2e/stage3-browser.mjs ; node tooling/e2e/stage2-browser.mjs
pnpm api:contract ; pnpm build:packages                      # after any API change
```

Screenshots from the browser run are in `docs/screenshots/stage5/` (customer mobile, merchant desktop, admin desktop, staff mobile; English and Arabic).

## What was built

**Voucher domain** (own lifecycle, not Live/Hot): merchant, branches, bilingual title/descriptions/rules/terms, photos, category, face value, selling price, savings display, issuance limit (unlimited is not allowed), per-customer limit, validity (days from purchase or fixed date, counted in whole Riyadh days, ends 23:59:59.999), sale window, eligibility, audit. Voucher statuses: `DRAFT, PENDING_REVIEW, NEEDS_CHANGES, REJECTED, SCHEDULED, ON_SALE, PAUSED, SOLD_OUT, ENDED, SUSPENDED`.

**Merchant Portal**: Vouchers hub (third Campaigns tab), six-step bilingual builder (Offer, Content, Validity and sale period, Branches, Eligibility and terms, Review) with live "reported savings", live customer preview (card/detail, EN/AR), autosave, Needs Changes / resubmit; voucher detail with Monitor, Sales (first name only; reverse a redemption with a reason) and Activity; pause/resume/end/add or remove capacity; Finance page (held vs settlement-eligible).

**Admin Portal**: Vouchers queue and all-vouchers list; review workbench (merchant legal entity and registration, commercial checks, reported-savings claim with a discount flag, capacity, validity, eligibility, branches, both languages, preview, placeholder refund/payable/expired-value rules, decision history); approve / request changes / reject / pause / resume / suspend / reinstate, all with recorded reasons. **Finance workbench**: overview with ledger health and merchant payable split; lookup by order/voucher/payment/refund/redemption reference; refund queue with approve / reject / retry and maker-checker; order detail (payments, terms accepted, provider callbacks, instance and redemption, refunds, ledger journals, payable events, support cases); redemption reversal; exceptional refund; support cases.

**Customer app**: Home Vouchers rail, `/vouchers` (search, sort, "available to me" filter), voucher detail, checkout, test payment page, order status (processing / success / failure with attempts left / cancelled / expired), **My Vouchers** (Active, Used, Expired, Refunded) with QR + manual code, refund request, refund status and a support request. Notifications for purchase, failed payment, issued, expiring, refund updates and redemption (mock channel).

**Merchant Staff**: the Stage 4 scan screen now also accepts voucher QR (`DV1.`) and the shared manual code space. The result shows the **value to honour**, a voucher-specific confirmation sheet, and the new results `VOUCHER SUSPENDED` and `REFUNDED` using the Stage 4 colour model.

**Backend**: payment provider abstraction with a mock provider; payment state machine and webhook handling; ownership issuance; append-only double-entry ledger; merchant payable events; refund workflow; expiry job and reminders; reconciliation sweep; shared eligibility engine reuse; analytics events; support cases.

### Lifecycles

```text
Voucher   DRAFT -> PENDING_REVIEW -> (NEEDS_CHANGES -> PENDING_REVIEW) | REJECTED | SCHEDULED | ON_SALE
          ON_SALE <-> PAUSED ; ON_SALE -> SOLD_OUT -> ON_SALE (capacity or refund) ; any live -> ENDED ; live -> SUSPENDED -> reinstated
Order     PENDING_PAYMENT -> PAID | FAILED | CANCELLED | EXPIRED
Payment   CREATED -> PENDING -> SUCCEEDED | FAILED | CANCELLED ; SUCCEEDED -> REFUND_PENDING -> REFUNDED ; REVERSED
          (PARTIALLY_REFUNDED exists in the enum but is hidden: no partial refunds in the MVP)
Instance  ACTIVE -> REDEEMED | EXPIRED | VOIDED (refund approved) -> REFUNDED ; REDEEMED -> ACTIVE only by an audited reversal
Refund    REQUESTED -> UNDER_REVIEW -> APPROVED -> PROCESSING -> REFUNDED ; REJECTED ; FAILED -> PROCESSING (retry)
```

### Purchase and payment flow

`Voucher detail -> Buy -> Checkout -> Pay -> payment page -> processing -> success -> My Vouchers`

1. **Buy** creates a `VoucherOrder` and **holds** one unit for `vouchers.checkout_hold_minutes` (10). Stock is changed by one conditional SQL `UPDATE ... WHERE totalQty - heldQty - soldQty >= q` (never a read-then-write), guarded by CHECK constraints and an advisory lock per (customer, voucher). Concurrency is tested: 8 buyers for 3 vouchers produce exactly 3 holds.
2. **Pay** requires `acceptTerms` + the terms version (snapshotted on the order) and starts a payment attempt through the provider adapter (idempotent; one open attempt per order, enforced by a partial unique index; retries limited by `vouchers.payment_retry_limit`, 3). The return URL must be one of our own origins.
3. The provider reports the outcome through the **webhook** `POST /v1/webhooks/payments` (header `x-dealdash-signature`). Checks run in this order: signature, freshness (`payments.webhook_tolerance_seconds`, 300), duplicate `providerEventId`, state machine. Every callback is logged in `PaymentEvent` with its outcome (`APPLIED, DUPLICATE, IGNORED, REJECTED, LATE_SUCCESS`). Duplicate and out-of-order callbacks are idempotent.
4. **A voucher is issued only inside the transaction that records a confirmed success.** Nothing is created from an unconfirmed payment. A success that arrives after the order was cancelled or expired posts the sale and then an automatic system refund; no voucher is issued.
5. A reconciliation sweep (job `vouchers.sweep`, every 30 s) asks the provider about stuck pending payments, releases expired holds, expires vouchers and sends reminders.

### Ownership, QR and redemption

- The QR text is an opaque token with the prefix `DV1.` (reservations use `DD1.`); it contains no database id. The manual code is 8 characters (`K7QM-9T2X`); the manual code space is shared with reservations and checked in both tables.
- Staff validate, then redeem. Redemption is **single-use** (partial unique index `VoucherRedemption_one_active_per_instance`), **replay-proof**, **idempotent** (the same `Idempotency-Key` returns the same result), checks branch, status, validity and merchant, and is audited. Five parallel redeems of one voucher produce exactly one success.
- Results: `VALID, INVALID, NOT_VALID_YET, EXPIRED, ALREADY_REDEEMED, WRONG_BRANCH, VOUCHER_SUSPENDED, REFUNDED, CAMPAIGN_UNAVAILABLE`. Colours follow the Stage 4 decision: green success; amber for expired / not yet valid / wrong branch; red for every hard failure.
- Pausing, ending or selling out a voucher **never** blocks vouchers already sold. Only DealDash **suspension** blocks redemption (`VOUCHER_SUSPENDED`). Eligibility is re-evaluated before purchase and is not re-checked at redemption for paid vouchers.

### Ledger and merchant payable

Money is stored as **integer halalas**. The ledger is **append-only** (a database trigger refuses UPDATE/DELETE) and every journal must sum to zero (a deferred constraint trigger). Journals carry an idempotency key.

| Journal | Entries |
| --- | --- |
| SALE (payment success) | PSP_CLEARING +price / MERCHANT_HELD -price |
| REDEMPTION | MERCHANT_HELD +price / PLATFORM_REVENUE -fee / MERCHANT_SETTLEMENT_ELIGIBLE -(price - fee) |
| REFUND | MERCHANT_HELD +price / PSP_CLEARING -price |
| EXPIRY | MERCHANT_HELD +price / EXPIRED_VALUE -price (recorded separately; treatment undecided) |
| REVERSAL | the exact opposite of the redemption journal |
| ADJUSTMENT | ADJUSTMENTS (Admin only, audited; maker-checker arrives with Stage 8) |

The fee rule is configuration `vouchers.fee_rule` (`percentBps` 1000, `fixedHalalas` 0, version 1). `MerchantPayableEvent` rows (`SOLD, ISSUED, REDEEMED, ELIGIBLE, REFUNDED, REDEMPTION_REVERSED, EXPIRED, ADJUSTMENT`) feed the merchant Finance page. Settlement runs and payouts are Stage 8.

### Refunds

- Customer request inside `vouchers.refund_policy.windowHours` (24) for an ACTIVE voucher: approved automatically and sent to the provider. Outside the window the policy `outsideWindow` is `REVIEW` (goes to Admin) or `BLOCK`. All values are configuration; no Saudi rule is hard-coded.
- A **redeemed** voucher blocks the normal refund (`REDEMPTION_REVERSAL_REQUIRED`); an audited redemption reversal comes first. When a refund is approved the instance goes `VOIDED` (redemption is blocked at once) and `REFUNDED` on completion.
- Admin-initiated (exceptional) refunds need a **different** administrator to approve (maker-checker, `CHECKER_REQUIRED`), with a configurable amount threshold. Provider refund failures move to `FAILED` and can be retried; the customer only sees "we are finishing your refund".
- A refunded voucher does not return stock to the issuance pool (see deviations).

## Database changes (migration `20261101000000_stage5_vouchers_payments`)

New enums for voucher/order/payment/refund/instance/ledger/payable/support statuses and types. New values: `RedemptionResult` += `VOUCHER_SUSPENDED, REFUNDED`; `NotificationType` += `PURCHASE_SUCCEEDED, PAYMENT_FAILED, VOUCHER_ISSUED, VOUCHER_EXPIRING, REFUND_UPDATED, VOUCHER_REDEEMED`; `DealEventType` += checkout/payment/issued/wallet/redeemed/refund events; `RedemptionAttempt.voucherInstanceId`.

New tables: `Voucher`, `VoucherBranch`, `VoucherHistory`, `VoucherOrder`, `Payment`, `PaymentEvent`, `Refund`, `VoucherInstance`, `VoucherRedemption`, `LedgerAccount`, `LedgerJournal`, `LedgerEntry`, `MerchantPayableEvent`, `SupportCase`.

Hand-written guarantees in the migration: CHECK constraints (`soldQty + heldQty <= totalQty`, non-negative stock, `sellingPrice <= faceValue`, positive amounts), partial unique indexes (`Payment_one_open_per_order`, `VoucherRedemption_one_active_per_instance`, `Refund_one_live_per_instance`), unique idempotency keys, the append-only trigger `dd_block_mutation` on ledger and payment-event tables, and the deferred balance trigger `dd_ledger_journal_balanced`.

## API added (all under `/v1`; 206 documented paths in total, OpenAPI regenerated)

Merchant (`/merchants/:orgId`): `GET voucher-options`; `GET|POST vouchers`; `GET vouchers/summary`; `GET vouchers/sales`; `GET|PUT vouchers/:id`; `POST vouchers/:id/{submit,pause,resume,end,stock}`; `GET vouchers/:id/{preview,monitor,history}`; `POST voucher-redemptions/:redemptionId/reverse`; `GET finance/voucher-payable`; `GET finance/voucher-payable/events`.

Admin: `GET admin/vouchers`; `GET admin/vouchers/:id[/monitor|/audit]`; `POST admin/vouchers/:id/{approve,request-changes,reject,pause,resume,suspend,reinstate}`; `GET admin/finance/{overview,search,orders/:id,refunds,cases}`; `POST admin/finance/refunds`; `POST admin/finance/refunds/:id/{approve,reject,retry}`; `POST admin/finance/redemptions/:id/reverse`; `GET admin/finance/merchants/:orgId/payable[/events]`; `POST admin/finance/adjustments`; `POST admin/finance/cases/:id`.

Customer (`/app`): `GET vouchers`, `GET vouchers/:id`; `POST checkout`; `GET orders`, `GET orders/:id`; `POST orders/:id/pay`, `POST orders/:id/cancel`; `GET wallet`, `GET wallet/:id`; `POST wallet/:id/refund`; `POST support-cases`.

Staff: unchanged routes (`/staff/redemptions/validate`, `/staff/redemptions`, `/staff/history`); the voucher code is recognised by a `StaffCodeExtension` registered in the Stage 4 `RedemptionService`.

Provider: `POST /webhooks/payments` (signature required). Development only (not registered in production): `POST /dev/payments/:providerReference/complete`.

## Permissions (enforced in the API, tested)

New: `customer.vouchers.manage` (Customer) and `admin.vouchers.lookup` (Support, Finance, Operations, Super Admin). Reused: `merchant.vouchers.manage`, `merchant.deals.read`, `merchant.finance.read`, `merchant.redemptions.reverse`, `admin.campaigns.review` / `admin.campaigns.control`, `admin.payments.read`, `admin.refunds.manage`, `admin.settlements.manage`, `admin.support.manage`.

- Tenant isolation: a merchant sees only its own vouchers, sales and payable; cross-merchant ids return 404.
- Merchants see **first names only** for buyers: never phone, e-mail or payment data.
- **Support** sees provider references and callbacks redacted ("hidden for your role"). Support has no Overview tab (it needs `admin.payments.read`) and starts at Lookup.
- Admin finance actions are shown only when the API says the caller may perform them (`actions[]`, `canReverseRedemption`, `canCreateRefund`); the API enforces them regardless.
- Customers can read and refund only their own vouchers and orders; Staff cannot refund.

## Configuration added (Admin > Configuration; mock values)

`vouchers.limits` (min/max validity days, max face value, max quantity, max per customer, discount review threshold), `vouchers.guardrails`, `vouchers.auto_publish`, `vouchers.checkout_hold_minutes` (10), `vouchers.payment_retry_limit` (3), `vouchers.refund_policy` (`windowHours` 24, `outsideWindow` REVIEW, `checkerThresholdHalalas` 0), `vouchers.expiry_reminder_days` (3), `vouchers.fee_rule`, `vouchers.payable_accrual_point` (REDEMPTION), `vouchers.expired_value_policy` (`UNDECIDED_VALIDATE_KSA`), `payments.webhook_tolerance_seconds` (300).

## Analytics

Customer and system events (anonymous-safe, no card data): `voucher.impression`, `voucher.detail_viewed`, `voucher.directions_clicked`, `voucher.checkout_started`, `voucher.payment_initiated`, `voucher.payment_succeeded`, `voucher.payment_failed`, `voucher.issued`, `voucher.wallet_viewed`, `voucher.refund_requested`, `voucher.refund_completed`, plus redemption events. The merchant Monitor shows only measurable steps (seen, opened, checkouts started, payments succeeded/failed) and **verified money** from payments and redemptions; it makes no revenue claim from impressions.

## Arabic and RTL

Every Stage 5 string exists in English and Arabic (`dictionaries.stage5.ts`; a test requires identical keys, non-empty text, real Arabic, no overlap with earlier stages and no "guarantee" wording). Layout uses CSS logical properties only. Digits stay Western in Arabic; QR, manual codes, references and money are forced left-to-right. The savings wording is "Reported savings" / "التوفير المُعلن" with the note that what a customer saves overall depends on what they buy. **The Arabic is a working translation; native review is still required** (carried over from Stage 4).

## Verification (actual results of the final run)

| Check | Result |
| --- | --- |
| `pnpm typecheck` (24 tasks) | pass |
| `pnpm eslint .` | 0 errors (44 warnings, all `no-explicit-any` in test helpers, none new in app code) |
| `pnpm test` (24 tasks) | **662 tests pass**: API 438 (25 files), customer 42, admin 38, merchant 48, staff 34, localization 14, ui 14, app-shell 11, validation 6, auth 5, analytics 4, config 3, partner 3, api-client 2 |
| `stage5-browser.mjs` | **101/101** checks, no unexpected console errors |
| `stage4-browser.mjs` | 120/120 (regression) |
| `stage3-browser.mjs` | 98/98 (regression; one stale assertion fixed, see below) |
| `stage2-browser.mjs` | 30/30 (regression) |

Stage 5 API tests (`apps/api/test/voucher*.e2e.test.ts` and `src/vouchers/vouchers.unit.test.ts`) cover: voucher CRUD, review and lifecycle, stock safety under concurrency, payments (success, failure, retry limit, cancel, expiry, late success refund), webhook signature / stale / duplicate / out-of-order handling, ownership only after confirmed payment, redemption (all results, idempotency, parallel redeem, wrong branch, suspended, refunded), refunds (window, review, maker-checker, provider failure and retry, redeemed blocks), ledger append-only and balance guarantees, payable and reversal, expiry job, tenant isolation, redaction for Support, and one full journey (merchant creates -> admin approves -> customer buys -> staff redeems -> payable eligible -> audit + notifications).

Stage 5 UI tests cover the customer discovery / detail / checkout / pay / order status / My Vouchers / refund flows (including Arabic), the merchant hub / builder / detail / sales / finance, the admin review and finance workbench (including Support redaction and maker-checker), and the staff voucher results with colour tones.

Browser QA (`stage5-browser.mjs`) runs real Edge and covers: merchant builds and submits a voucher (EN + AR, photo, validation of price above value); admin reviews and approves; customer finds it (rail, list, search), reads "Reported savings", is refused without accepting terms, **declines** at the test payment page (failure state, no voucher), retries and pays, sees QR + manual code; staff **scan the QR with a fake camera**, confirm and redeem, replay the QR (ALREADY REDEEMED); customer sees Used; a second voucher is refunded and staff then see REFUNDED; merchant Monitor / Sales / Finance (settlement-eligible SAR 81.00 = 90.00 minus 10%); admin Finance (ledger balanced, lookup, order detail, refund queue approval with reason, cases, Support redaction); Arabic/RTL on customer, merchant, admin and staff; no horizontal overflow at 360, 390 and 820 px.

## Real-device test still required (cannot be proven here)

- A real phone camera reading the voucher QR in store light (the run uses Chrome's fake camera; same as Stage 4).
- A real payment provider: redirect, 3-D Secure, webhooks over the internet, refunds and chargebacks. Only the mock provider was exercised.
- Native Arabic proofreading of every Stage 5 string.
- Screen-reader and keyboard pass on checkout and My Vouchers on real devices.

## Deviations and notes

1. **Money is Prisma `Int` halalas**, not `bigint` as in the data model. Maximum single amount is far below 2^31 halalas; revisit before settlement volumes (Stage 8).
2. **Quantity per order is fixed at 1** (`MVP_MAX_QUANTITY`); the column and API accept the field so a founder decision on quantity needs no migration.
3. **Stricter material-edit lock than VC-08**: once a voucher is live, only wording and photos can be corrected; price, value, validity, branches, terms and eligibility require ending the sale and creating a new voucher. Capacity can be added or removed (unsold only).
4. A refunded voucher **does not return stock** to the issuance pool.
5. Wake-lock/torch items in the staff spec are not applicable to the Stage 4 scanner and were not added.
6. Adjustments are Admin-only and audited, **without maker-checker** (that arrives with Stage 8).
7. A refund `reason` entered by Admin on a rejection is **shown to the customer**; the UI tells the admin so.
8. Late success after cancel/expiry is **automatically refunded** (system refund) rather than issued.
9. The Stage 4 staff labels were widened: "Reservation code" -> "Reservation or voucher code" and "Scan a reservation" -> "Scan a reservation or voucher" (EN and AR), because the same screen now serves both. The Stage 4 unit test was updated accordingly.
10. The Stage 3 browser script asserted five customer tab-bar links, which was already stale after Stage 4 (three tabs, My Deals moved to the header). The assertion now expects three. Customer navigation was not changed by Stage 5; a **My Vouchers** icon was added next to the My Deals icon in the customer header.
11. The review banner on the voucher builder and the admin workbench reuses the shared guardrail text ("This deal will be reviewed by DealDash before it goes live") from Stage 3. It reads correctly but says "deal"; a Stage 6 copy pass can make it voucher-specific.
12. Provider data returned to Admin (provider reference, callback log) is read-only; no card data of any kind is received, stored or logged.

## VALIDATE-KSA (not decided in code)

Everything below is a placeholder or an open question for legal and finance review. None of it is a legal conclusion.

- **Merchant of record**: who sells the voucher and who issues the invoice.
- **Payment licensing**: whether DealDash or only the PSP needs authorisation for the flow of funds; PSP selection.
- **Treatment of customer funds** while held for the merchant (the ledger "held" family is a record, not a legal characterisation).
- **VAT** on the voucher sale, on the platform fee and at redemption; invoice timing.
- **Refund rights**: whether and when a customer must be allowed to cancel; the 24-hour window and `REVIEW` outside it are placeholders.
- **Expiry**: whether an expired unused voucher may expire at all, minimum validity, and who keeps the value (`vouchers.expired_value_policy` is `UNDECIDED_VALIDATE_KSA`; expired value is only recorded in its own ledger family).
- **Chargebacks and disputes**: process, liability, evidence retention.
- **Settlement timing and payout rules** (Stage 8); the 10% fee is a mock value.
- **Card data**: none is touched (hosted payment page only); confirm the PCI scope statement with the PSP.
- **Data retention** for orders, payments, callbacks, ledger and support cases.
- **Complaint handling timelines** and any consumer-protection disclosure wording.
- **"Reported savings" wording** and any rule on reference-price claims.

## Visual handoff (Figma)

> Current MVP visual source of truth for Voucher journeys. Original customer screens 09, 22, 28, 29, 30, 32, 33 and 53 are OUTDATED / SUPERSEDED FOR MVP (see [DESIGN_SOURCE_MAP.md](DESIGN_SOURCE_MAP.md)).

The Stage 5 Figma-ready package is in [docs/STAGE5_FIGMA_HANDOFF.md](STAGE5_FIGMA_HANDOFF.md) and `figma-handoff/stage5/` (SVG frames, component sheets, flows and reference screenshots, English and Arabic). The implementation-versus-design audit that accompanied it corrected a few copy and layout details: voucher-specific review wording, removal of two Phase 2 mentions from customer copy (the loyalty-points note on checkout and "no gifting for now" on the detail page), a translated review reason in the history, "Who can buy it?", a smaller detail headline on phones, and the finance Overview tab being hidden for roles without payment rights.

## Founder decisions needed

1. Merchant of record and invoicing model (blocks real payments).
2. PSP shortlist and whether to integrate more than one.
3. Refund window length and what happens outside it (`REVIEW` or `BLOCK`); who may approve exceptions and the maker-checker threshold.
4. Expired-voucher value treatment and minimum validity.
5. Platform fee rule (percentage, fixed part, who sees it) and when payable becomes eligible (redemption is the MVP rule).
6. Whether to allow quantity above 1 per order and per-customer limits above the pilot defaults.
7. Whether a refunded voucher should return its unit to sale.
8. Whether merchants may edit price or validity of a live voucher with a version history instead of ending and recreating it.

## Recommended Stage 6 scope

Stage 6 should stay narrow: (a) **harden before real money**: provider-integration contract tests against a PSP sandbox, webhook replay tooling, reconciliation report and ledger-vs-provider diff, alerting on unbalanced journals and stuck pending payments; (b) **settlement preparation without payouts**: statement view per merchant, settlement-eligible export, adjustment maker-checker, and the Admin finance exceptions queue; (c) **notification channels**: real push/SMS/e-mail behind the existing mock adapter (purchase, expiry reminder, refund), with preferences; (d) **voucher polish**: voucher-specific review copy, multiple units per order if approved, favourites/saved vouchers, expiry-soon section in My Vouchers; (e) the open real-device and Arabic proofreading items. Watch & Earn, Rewards and the Partner Portal stay out until you approve them.


## Addendum: commercial governance (Vouchers)

Vouchers now go through the shared commercial platform: the platform commission is shown as a charge netted from the merchant payout (no prepayment), the saving is the merchant's non-cash commitment, optional sponsors fund part of the saving separately, and a quantity increase on a live voucher is an amendment that must be accepted first. The Stage 5 fee rule, ledger and settlement figures are unchanged. See [COMMERCIAL_FINANCE.md](COMMERCIAL_FINANCE.md).
