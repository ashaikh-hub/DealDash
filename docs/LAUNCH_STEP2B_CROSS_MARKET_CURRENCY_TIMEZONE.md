# Launch Step 2B: Pakistan pilot cross-market corrections (currency and time zone)

**Status:** **FOUNDER APPROVED 2026-10-13** (currency and time-zone corrections). Committed locally; not pushed. Production is not deployed and the public launch is not authorized.
**Scope:** the founder decision "PAKISTAN PILOT CROSS-MARKET CORRECTIONS". This is not Stage 10. The frozen Stage 5 and 6 architecture is reused, not redesigned.

## 1. Principle

Currency and time zone are no longer platform-wide assumptions. They resolve from **Market / Country Configuration** (`MarketService.profile`) or from the **originating record**:

| Market | Currency | Time zone |
| --- | --- | --- |
| PK | PKR | Asia/Karachi |
| SA | SAR | Asia/Riyadh |
| QA | QAR | Asia/Qatar |
| AE | AED | Asia/Dubai |

- Timestamps are stored in UTC. Market-local days, validity and windows are computed with the DST-safe helpers in `@dealdash/localization`. The server's own time zone is never used.
- Every financial record stores an explicit ISO currency. Ledger journals are single-currency, and a database trigger rejects mixed-currency entries. Ledger accounts are separate per currency.
- There is no FX conversion anywhere. Totals in different currencies are reported side by side (`byCurrency`), never added together.
- No history was rewritten. Existing rows were backfilled to `SAR` (they are all KSA records) using the append-only-safe `ADD COLUMN … DEFAULT` / `DROP DEFAULT` pattern. New rows inherit the currency of their market or contract.

## 2. Audit classification

**A. Hard-coded SAR business assumptions found, and now corrected.**
- Schema defaults of `'SAR'`/`'SA'`: VoucherOrder, Payment, LedgerAccount, LegalEntity, BusinessAccount, FinancePayment, FinanceDocument, CreditFacility, AiUsageRecord, AdjustmentRequest, ReconciliationItem. All removed.
- Originating records had no currency at all: Voucher, WatchCampaign, CommercialCase, Refund, MerchantPayableEvent, WatchFunding, LedgerJournal. A `currency` column was added to each.
- Literal `'SAR'` in the API at the payment/provider initiation, refunds, redemption, voucher lifecycle, ledger journals and balances, voucher finance overview, commercial adapters (voucher, hot, loyalty, watch), Watch & Earn rate card, funding and economics, commercial case/payments/receipts/credit, finance-admin (facility, documents, adjustments, closure, overview), billing accounts, invoicing, receivables, reconciliation, settlement, adjustments, disputes, operations centre, metrics, targets, analytics projector, partner dashboard, AI money context, and the subscription fallbacks.
- Frontend: `formatMoney` always appended SAR. It now uses the record's currency, or else the session's display market.

**B. Remaining legitimate SAR references (left unchanged on purpose).**
- KSA seeds and fixtures (`SEED_CURRENCY = 'SAR'` in the Stage 5/6/7 seeds and test fixtures). They describe a KSA dataset.
- The SA market row in the catalog.
- The SAR denomination of existing configuration values: rate-card default, `FeeRule.fixedCurrency`. The fixed fee part applies only to transactions in that same currency; other currencies use the percentage part only.
- AI cost accounting currency `costCurrency: 'SAR'` (an internal vendor-cost unit; configurable).
- `campaignLedgerCurrencies` fallback list `['SAR','PKR','AED','QAR']`.
- The `ر.س` symbol for SAR in the formatter.
- Regulatory and legal KSA documents and the `VALIDATE-KSA` disclaimers.

**C. Hard-coded Riyadh-time assumptions found, and now corrected.**
- API: voucher instance expiry (end of day), Watch & Earn daily caps, market-day boundaries, time windows, discovery, the risk streak, hot-deal staff day range, and live-deal daily statistics.
- Frontend: the merchant date-time inputs used a fixed `+03:00` offset (`toRiyadhInput`/`fromRiyadhInput`). They are now `toMarketInput`/`fromMarketInput`, DST-safe in the market zone. Also corrected: the deal, hot, voucher and watch builder previews; the hot-detail clock; the customer hot-deal countdown; and the branch open/closed clock (`deals/format.ts`).

## 3. New API surface

- `GET /v1/market-context?city=` (public, optional actor) returns `{market, currency, currencyDecimals, timeZone, source}`. It gives a business's market for business users, and the city or default market for customers and admins. The app shell calls `setDisplayMarket`. The customer app passes its selected city.
- New fields: `currency` on watch budget, watch rows, admin watch monitor rows, commercial case view and case rows; `rateCard.currency/available` on watch options; `currency/currencies/byCurrency` on the finance overviews; and `?currency=` on admin finance overviews.
- New error code: `MARKET_CURRENCY_MISMATCH` (economics currency differs from the pricing-agreement currency; also raised when a transfer crosses currencies).

## 4. Regression evidence

- `apps/api/test/market-currency-timezone.e2e.test.ts` covers the PK merchant (Lahore, PKR) and the KSA merchant (SAR) side by side. The six tests cover:
  - same voucher rules in both markets;
  - redemption and refund in PKR;
  - ledger and merchant payable per currency;
  - validity end of day Karachi vs Riyadh;
  - Watch & Earn refused without a PKR rate card;
  - Watch & Earn priced and funded in PKR vs SAR;
  - mixed-currency journal rejected by the DB.
- Unit tests cover Karachi, Riyadh and Europe/London DST day boundaries.
- Full workspace typecheck and test results are in the completion report.

## 5. Pakistan activation is governed configuration, not code

Before Pakistan UAT, a founder or admin enables these through the existing governed admin flows:
1. Market `PK`:
   - On a fresh seed it already exists as a disabled catalog entry.
   - On an existing database (dev, staging) it is created with `POST /v1/admin/markets/PK`.
   - Then move it to status `PILOT` with pilot products.
2. A PKR pricing agreement.
3. A PKR Watch & Earn rate card. Without one, PK Watch & Earn is refused with `PRICING_NOT_AVAILABLE`, by design.
4. `campaignLedgerCurrencies` including `PKR` on existing databases. The default only applies when the setting is created.
5. Enabled Pakistani cities.
6. Fee rules: confirm the percentage and the PKR fixed component, if any.

The amounts (rates, fees) are commercial founder decisions.

### 5.1 Development state (2026-10-13, founder-approved "Pakistan development / UAT market")

`apps/api/scripts/ops/pk-uat-market.ts` ran on `dealdash_dev`.
- It runs only the governed services, each change validated and audited under the DealDash Super Admin with the founder-approval reason.
- It refuses non-local databases, non-`_dev`/`_test` databases and production, and never requests PILOT or ACTIVE.
- It is idempotent: a second run reported no changes.
- A backup was taken first: `dealdash_dev-pre-pk-uat-market-20261013T094043Z.dump`.

| Item | Result |
| --- | --- |
| Market PK | `PLANNED → CONFIGURING → TESTING`; PKR (supported: PKR); Asia/Karachi; no legal entity (founder decision) |
| Products | All 14 products `TESTING`, each noted **CONFIGURATION REQUIRED / FOUNDER DECISION REQUIRED** (no PKR commercial value) |
| Cities | Karachi, Lahore and Islamabad added to enabled cities and city centres (Riyadh kept) |
| Ledger | `campaignLedgerCurrencies` changed from `['SAR']` (the stored dev value) to `['SAR','PKR']` |
| Register | VALIDATE-PAKISTAN items open (blocking activation) |
| PKR commercial values | **none configured**: no pricing agreement, Watch & Earn rate card or fee was created |

**Remaining gate (by design, not a defect).** New business (creating campaigns) is open only in markets and products whose status is in `markets.availableStatuses` (default `PILOT`, `ACTIVE`). Moving PK to PILOT runs the activation gate, which needs these items. Each is a founder, legal or provider dependency:
- a DealDash legal entity;
- approved tax and invoice configuration;
- a non-mock payment provider;
- a non-mock SMS/OTP provider and a non-mock email provider;
- a settlement rule;
- terms, privacy and KYB policies;
- pricing.

**Founder decision 2026-10-13: option (a) approved (development / UAT only).**
- A TESTING market takes new business only when both hold:
  - the database opts in with the markets setting `developmentUatTestingOpen: true`; and
  - the API process environment is `local`, `development` or `test`.
- Staging and production ignore the setting, whatever the database says, and keep the normal lifecycle and readiness gates.
- A service built without a process environment (seeds, scripts) stays closed. PILOT and ACTIVE are unchanged.
- Proven by `apps/api/src/platform/markets/market-uat-gate.unit.test.ts`.
- On `dealdash_dev` the opt-in was set by `pk-uat-market.ts`. A backup was taken first: `dealdash_dev-pre-pk-uat-testing-gate-20261013T095426Z.dump`. PK stays TESTING, with no legal entity.
- RBAC, entitlements, the commercial gate, audit and the ledger controls are untouched.
- Paid products still need founder-approved PKR values. Until then they refuse with the pricing error, by design (CONFIGURATION REQUIRED).
- UAT businesses on dev must be clearly marked TEST / DUMMY.

Before this decision, Pakistan merchant campaign UAT needed either:
- (a) a founder decision to open TESTING for new business on the development database only (`availableStatuses` including `TESTING` there); or
- (b) the PILOT prerequisites.

Priced products also need the PKR commercial values.

## 6. Latency (recorded, no decision taken)

| Region | Measured RTT from Pakistan (founder-recorded) |
| --- | --- |
| Doha `me-central1` | 77 ms |
| Dammam `me-central2` | 94 ms |
| Mumbai `asia-south1` | 522 ms |

- Doha remains the staging candidate.
- The Pakistan production region is **not** finalized.
- Mobile-carrier testing (Jazz, Zong, Telenor, Ufone) remains a pre-production item.
- Globalping will not be retried.
- Details: `docs/performance/latency-doha-mumbai-2026-10-11.md`.

## 7. Development database

Migration `20270107000000_market_currency` was applied to dev on 2026-10-13 using the backup-first procedure, with no reset and no reseed:
1. Backup: `.tools/stage7/backup/dealdash_dev-pre-market-currency-migration-20261013T093320Z.dump` (verified, with manifest).
2. Restored into `dealdash_test`: RESTORE VERIFIED, 0 mismatches, 0 unbalanced journals.
3. Rehearsed the migration on the restored copy: applied cleanly over the real dev rows (79 journals, 28 payments, 5 refunds).
4. Applied to `dealdash_dev`. `db:status` shows dev and test both at 22/22 migrations.
5. Ran `db:catalog:sync`: permissions and roles unchanged. The catalog sync does not create markets, so PK on dev is created through the governed admin step in section 5.
6. Reset the test database afterwards.
