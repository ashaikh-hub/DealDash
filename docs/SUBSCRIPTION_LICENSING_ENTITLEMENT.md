# DealDash Subscription, Licensing, Entitlement & Commercial Plan Engine

Status: **SUBSCRIPTION / LICENSING / ENTITLEMENT ARCHITECTURE: FOUNDER APPROVED AND FROZEN** (Oct 2026; approved baseline, prerequisite to
Phase 5). FD-24 is **CLOSED** (architecture and the current Pakistan configuration). **Stage 4 Exclusive Deal commercial regression fix:
FOUNDER APPROVED.** Phase 4, Phase 5 and Stage 7 are **not started**. See §17 for the approval record.

Impact assessment (written before implementation, no material contradiction): `SUBSCRIPTION_ENTERPRISE_COMMERCIAL_IMPACT.md`.
Figma handoff: `SUBSCRIPTION_FIGMA_HANDOFF.md`.

---

## 1. Principle: one commercial model, extended

No parallel commercial model was created. The engine **extends** the existing Phase 1 foundations:

| Existing foundation | Role in the engine |
| --- | --- |
| `Organization` (Business Account, the tenant) | The **subscriber**. Every agreement belongs to a Business Account. |
| `LegalEntity` | Contracting party, covered party and **billing party** (`ContractLegalEntity` roles `CONTRACTING`, `COVERED`, `BILLING`). |
| `Contract` | **The agreement.** An Enterprise Licence is a `Contract` of an enterprise `kind`, not a separate architecture. |
| `ContractEntitlement` (PRODUCT / FEATURE / LIMIT, effective-dated) | **The one authorization source.** Plan defaults, overrides and add-ons are all rows here, distinguished by `source`. |
| Commercial governance (quotation, acceptance, funding, credit) | Unchanged; campaigns now keep the contract and billing trigger that governed them (`CommercialCase.contractId / billingModel / billingTrigger`). |

Hierarchy: **Business Account → Legal Entity → Contract → Plan / Licence Version → Product entitlements → Feature entitlements → Usage limits →
Add-ons / Overrides → Pricing version.**

Brands, regions, branches and organization units **own no subscription** (the `Contract` table has no brand / branch column; covered by a test).

## 2. Enterprise subscription model

* `Contract.kind`: `MERCHANT_SUBSCRIPTION`, `MERCHANT_ENTERPRISE`, `BANK_ENTERPRISE`, `SCHEME_NETWORK_LICENCE`, `CORPORATE_PARTNER`, `CUSTOM_ENTERPRISE`
  (database CHECK).
* A bank, scheme or corporate partner is an ordinary Business Account with its own legal entities and contracts. **There is no special
  "sponsor subscription" concept.** Sponsor / bank / corporate *funding* of campaigns stays in the commercial-governance funding model and is
  never DealDash revenue.
* A contract may be scoped to one legal entity (`legalEntityId`), cover several (`coveredLegalEntityIds`) and name a billing legal entity
  (`billingLegalEntityId`). **Billing party** = the contract's billing legal entity, else its contracting legal entity, else the Business Account;
  never a brand or branch. Billing events carry `billingLegalEntityId`.
* A scheme can hold a country licence and later a multi-market or regional agreement: each is its own contract with its own market(s).
* Enterprise plans are **negotiated**: the plan version carries indicative reference figures; the real price is a **negotiated contract rate**
  (`ContractRate`), versioned and approved.
* Admin enterprise view: Admin → Subscriptions → Agreements → agreement detail (kind, Business Account, billing party, covered legal entities,
  account manager, support level, terms, rates, promotions, entitlements, amendments, acceptances, lifecycle, explain). **Partner-portal
  screens are Stage 7.**

## 3. Merchant subscription (Pakistan configuration, data not code)

Seeded by `apps/api/src/seed/subscription-catalog.ts` as **published plan versions for market PK, currency PKR** (amounts in paisa, i.e. PKR × 100):

| Plan | Price | Branches | Users | Notes |
| --- | --- | --- | --- | --- |
| Starter | PKR 0 (genuine free plan, `isFree`) | 1 | 2 | Active at once, no acceptance, no billing event |
| Growth | PKR 4,999 / month | 5 | 10 | Paid: needs the authorised person's acceptance |
| Business | PKR 14,999 / month | 25 | 50 | Paid |
| Merchant Enterprise | Custom / negotiated (`negotiated`) | contract | contract | Indicative refs: from PKR 50,000 / month, setup from 100,000, API from 250,000 |

Bank Enterprise (PKR 250,000 / month or 2,500,000 / year; setup from 500k, API from 500k, premium analytics from 100k / month), Scheme
(country licence from 5M / year, regional from 10M / year, multi-market / international custom; setup from 1M, API from 1.5M, analytics from
250k / month), Corporate / Partner (PKR 100,000 / month or 1,000,000 / year; setup from 250k, API from 250k, analytics from 50k / month).
"From" figures are **indicative** (`indicative: true`) and are **never resolved as a charge**.

Price book (`PriceItem` / `PriceItemVersion`, PK): Featured Live Deal from PKR 5,000; Exclusive setup from 5,000; voucher commission 8–12 %
(range); Watch qualified view PKR 3–7+ per view (range); Play & Win from 50,000 (**INACTIVE**: Phase 2 product); push campaign from 10,000;
homepage placement from 25,000.

Changing any figure is a new **draft version** published by a **different person** (`admin.subscriptions.approve`): no deployment.

## 4. Commercial plan & pricing

* `CommercialPlan` = a reusable template (code, names, entity type, contract kind, `isFree`, `negotiated`).
* `CommercialPlanVersion` = market + currency + prices per cadence + one-off fees + add-on prices + entitlements (products, features, limits
  with mode / period / warn thresholds / soft action / overage rate) + add-on codes + support level + trial days + grace days + enforcement
  overrides + reference pricing. Lifecycle `DRAFT → PUBLISHED → RETIRED`. **A published version is immutable** (DB trigger
  `dd_published_version_frozen`; only retiring is allowed). Publishing a new version end-dates the previous one; it is never deleted.
* A contract **snapshots** the plan version it entered (`planVersionId`); an existing agreement keeps its own price when a new version is
  published (tested).
* Pricing resolution (`PricingResolver`), in order: **contract negotiated rate → active promotion → plan version / price book → discount →
  waiver**. Each result carries `pricingVersionKey` (`PLV:` plan version, `PIV:` price-book version, `CR:` contract rate, `PRM:` promotion)
  and a list of adjustments. **Every billing event and acceptance retains the pricing version**; history is never overwritten (rates and
  promotions are new rows / versions).
* Promotions (`ContractPromotion`): free onboarding, promotional price, setup waiver, campaign credit, temporary upgrade, enterprise trial;
  window + post-promotion treatment (`REVERT_TO_STANDARD`, `CONVERT_TO_PLAN`, `END`); approve permission.
* Money: integer minor units with an explicit currency; one field holds at most 2,000,000,000 (larger custom amounts split into events).

## 5. Contract & entitlement

* Lifecycle (`Contract.status`, DB CHECK): `DRAFT`, `PENDING_ACTIVATION`, `TRIAL`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`, `CANCELLED`, `EXPIRED`
  (+ `SUPERSEDED` for a replaced legacy row). Renewal is separate (`renewalState`: `AUTO_RENEW`, `MANUAL_RENEWAL`, `NON_RENEWING`,
  `RENEWAL_PENDING`).
* **Upgrade, downgrade, add-on, renewal, pricing, entitlement, market addition and extension are amendments, not statuses**
  (`ContractAmendment`: previous version → change + impact → acceptance → new effective version, `Contract.version++`).
* Effective entitlements (`EntitlementService.effective`): plan default (`source PLAN`), **override replaces** the plan default
  (`OVERRIDE`), **add-ons add** (`ADDON`); several in-force contracts → union / highest limit; legal-entity scope respected. No in-force
  contract → the configured default plan, **unless the organization's agreement ended** (cancelled / expired): then nothing new is granted
  and history stays.
* Acceptance (`ContractAcceptance`, **append-only**): user, role, on-behalf authorization, plan version, pricing version, terms version,
  currency, accepted amount, maximum exposure, effective date, cadence, approval reference, terms snapshot. Re-acceptance is required when
  the commitment rises (upgrade, paid add-on).
* Trial (`ContractTrial`) is **separate from Starter**: converts to the configured post-trial plan (a paid one waits for acceptance), or
  expires; never silently becomes Starter.
* Upgrade: immediate, next billing cycle or a custom date; impact shown first (price delta, added / removed products and features, limit
  changes, fees); acceptance; amendment; billing hook.
* Downgrade: **blocked while current usage exceeds the new limits** (`DOWNGRADE_BLOCKED`, remedies: deactivate excess, schedule for later,
  buy add-on, cancel); a scheduled downgrade is accepted and re-checked at apply time; **nothing is deleted**. A **forced** downgrade by
  DealDash needs a reason, is audited and **restricts** the excess (no additions) instead of deleting it.
* DealDash-only amendments (`ENTITLEMENT`, `PRICING`, `MARKET_ADDITION`, `EXTENSION`) need a **second DealDash person** to apply.
* Admin overrides are audited (user, reason, previous / new state, period, approval).

## 6. Enforcement (backend)

| Gate | Where | Effect |
| --- | --- | --- |
| `requireNewExposure(org, action)` | campaign submit / activate, branch create, team invite, premium / API operations, exposure-raising upgrades | `SUSPENDED`, grace elapsed, financial hold or an ended agreement refuse **new exposure only** |
| `requireWithinLimit` / `UsageService.assertResourceWithin` | branches, users (pending invitations count), active campaigns | HARD → `ENTITLEMENT_LIMIT_REACHED`; SOFT → warn / overage / require approval |
| `UsageService.consume` | period metrics (API requests, bulk import rows, campaign activations, exports) | atomic conditional meter update; idempotent by key; HARD refuses at the limit; SOFT overage emits `OVERAGE_USAGE` |
| `assertLiveCampaignOpen` | reservation, checkout, view start | default `CONTINUE` (live prepaid campaigns keep running); `STOP_NEW_EXPOSURE` per contract / plan |

**Never blocked** (protected actions): redemption of issued vouchers / credentials, rewards, refunds, invoice / finance access, history,
fulfilment. `PAST_DUE` within grace keeps everything working. Grace days resolve contract → plan version → entity type → market → platform
default (`commercial.enforcement`), never hard-coded.

Usage is three different things, never mixed: **resource counts** (read live), **period usage** (`UsageMeter` + append-only `UsageEvent`),
**billable business events** (`CommercialBillingEvent`). Usage meters never create a second entitlement system: allowances live on the
contract's entitlement rows.

"Why is this unavailable?" (`CommercialAccessService`, `GET …/explain`): the twelve-step decision (business account, legal entity, contract
in force, plan usable, product, feature, role, scope, usage, add-on, commercial acceptance, financial status) with machine reasons and
remedies, **without side effects**. This is the governed data the AI layer will read.

## 7. Phase 5 dependency (hooks only; Phase 5 owns billing)

Built here (hooks): billing account reference (Business Account / billing legal entity), agreement reference, pricing resolution and version
keys, immutable acceptance, **`CommercialBillingEvent`** (idempotency key, event type → revenue category, amount, currency, quantity, unit
rate, pricing version, billing legal entity, source event; `PENDING → CONSUMED / VOID`; only `status` / `consumedAt` may change, DB trigger
`dd_billing_event_guard`), usage events, funding reference, and the **financial-status interface** (`FinancialStatusProvider`,
`GOOD_STANDING / GRACE / PAST_DUE / FINANCIAL_HOLD / SUSPENDED`; default provider derives it from lifecycle, grace and holds).

Event types: monthly subscription renewal, annual licence renewal, licence activation, plan change adjustment (proration left to Phase 5),
setup / integration / API fees, add-on fee, premium analytics, featured placement, campaign setup, qualified view usage, verified redemption
usage, overage usage, voucher transaction commission. Revenue categories: subscription / licence, setup & integration, product usage,
transaction commission, campaigns & advertising, premium services. **Customer points funding, merchant reward commitments, sponsor funding,
loyalty funding and customer subsidies are not DealDash revenue and never appear as billing events.**

**Phase 5 owns** invoices, receivables, payment allocation, PO / credit operations, statements, credit / debit notes, reconciliation and
multi-currency accounting. It consumes `PENDING` billing events (`markConsumed`) and replaces the `FINANCIAL_STATUS_PROVIDER` binding with a
receivables-aware provider (same interface; no consumer changes). A consumed event is corrected by a credit note, never voided here.

## 8. Phase 4 dependency (signals only; no alert engine)

`CommercialSignal` is an outbox, raised **once per threshold** (unique key): `BRANCH_LIMIT_80_PERCENT`, `BRANCH_LIMIT_REACHED`,
`USER_LIMIT_APPROACHING`, `USER_LIMIT_REACHED`, `API_LIMIT_APPROACHING`, `API_LIMIT_REACHED`, `LIMIT_APPROACHING`, `LIMIT_REACHED`,
`TRIAL_EXPIRING`, `PROMOTION_EXPIRING`, `RENEWAL_APPROACHING`, `CONTRACT_EXPIRING`, `PAYMENT_GRACE_STARTED`, `FINANCIAL_HOLD`,
`CONTRACT_SUSPENDED`. Thresholds are configuration (`commercial.signals`). Phase 4 reads unconsumed signals and marks them consumed.

## 9. Stage 7 prerequisites

* Partner Portal subscription screens (bank / scheme / corporate "my agreement", usage, acceptance) — the API already serves partners
  (`/v1/orgs/:orgId/subscription`, `partner.subscription.read / manage`); only the screens are Stage 7.
* Real pilot businesses need an **explicit plan assignment** before launch: Admin → Subscriptions → Readiness lists every active business
  without an agreement of its own (the dev bank, scheme and employer partners are listed today).
* Native Arabic review of the subscription copy (working translation).

## 10. Scheduled pass

Job `subscription.run_due` (hourly, idempotent per slot; also `POST /v1/admin/subscriptions/run-due`): trial conversion / expiry, grace start
and auto-suspension after grace, renewals (one billing event per period, idempotent), non-renewing expiry, fixed-term expiry, scheduled
amendments (`applyDue`, re-checking downgrade excess), signals.

## 11. Migration and data safety

Migration `20261224000000_subscription_engine` is additive (new tables, new nullable / defaulted columns, CHECK constraints, triggers).
Legacy `ENDED` contracts map to `SUPERSEDED` (replaced by a later contract) or `CANCELLED`; nothing is deleted. Applied to the dev database
without a reset after a `pg_dump` backup (dev held no contract rows; ledger and all other rows untouched; `prisma migrate diff` reports no
drift). Development merchants receive **unpriced SA development-fixture** Business agreements (`developmentFixture: true`, never billed);
real pilot merchants are never auto-assigned.

## 12. API surface

Admin (`/v1/admin/subscriptions`, `admin.subscriptions.read / manage / approve`): plans, plan versions (draft / update / publish / retire),
price items and versions (publish), add-ons, contracts (list, view, terms, price, acceptances, assign, accept-on-behalf, past-due, suspend,
reinstate, cancel, renewal state, renew, promotions, rates, amendments + preview), amendments (list, view, accept-on-behalf, apply, reject),
organizations (summary, explain, financial status, record usage), billing events, signals, readiness, run-due.

Business (`/v1/orgs/:orgId/subscription`, merchant / partner; organization-wide permission, scoped members refused): summary, usage, plans,
explain, preview, amendments (propose / list / accept / cancel), accept (pending agreement), pending, stop-renewal.

## 13. Screens

* Merchant **Plan and usage** (`/plan`, `merchant.subscription.read`): plan, status, price, renewal, commercial status (grace / suspension /
  hold explained), usage meters, products / features / limits, add-ons, promotions and adjustments, pending agreement acceptance, changes
  waiting (accept / cancel), change plan with impact preview (immediate / next cycle), why-unavailable, plan history, stop renewal. **No
  invoice screens** (pointer to Finance).
* Admin **Subscriptions** (`/subscriptions`, `admin.subscriptions.read`): agreements (filters, assign, enterprise detail, lifecycle, renewal,
  rates, promotions, amendments with preview / apply / reject, acceptances, explain), plan catalog (versions by market, new plan, new draft
  version, publish / retire), price book (versions, publish), add-ons, changes queue, billing events, signals, readiness + run-due.
* English and Arabic (`packages/localization/src/dictionaries.subscription.ts`), right-to-left, Western digits, currency code shown for
  non-SAR markets (`formatAmount`).

## 14. Tests

API e2e: `subscription-catalog` (18), `subscription-lifecycle` (33), `subscription-enterprise` (24) plus the updated
`platform-foundation`. Component: `apps/merchant/features/plan.test.tsx` (12), `apps/admin/features/subscriptions.test.tsx` (9).
Localization and navigation tests. Browser: `node tooling/e2e/subscription-browser.mjs` (31 checks incl. Arabic / RTL and phone width).

## 15. Regression findings during this work (outside the subscription scope)

* **Exclusive Deal "start as soon as approved" could not be submitted after accepting the commercial terms** (pre-existing since the Oct 9
  commercial-governance work; the Stage 4 browser journey had not completed since). The builder sends the current time with every
  save, the quotation hash included that time, so each save created a new quotation and voided the acceptance (422
  `COMMERCIAL_ACCEPTANCE_REQUIRED`). Fix (minimal, server side): `hot-commercial.adapter.ts` treats a start that is not in the future
  as "immediately" in the quotation; a scheduled start still re-quotes. Regression test added to `commercial.e2e.test.ts`.
* Stage 4 browser script brought in line with commercial governance (save before resubmitting; adding stock to a live deal asks for
  the commercial amendment). Stage 4: 121 / 121 and Stage 6: 88 / 88 on a freshly seeded database.
* Dev-data hygiene: nine DealDash-funded "QA Welcome" loyalty rules left ACTIVE by repeated Phase 3 browser runs inflated every
  qualified view in the dev database; they were **paused** through the audited admin API (nothing deleted; audit history kept). On the
  founder's instruction the Phase 3 browser script now pauses the rule it created at the end of each run (tooling only).

## 16. Design notes and decisions recorded

* Add-on prices were not supplied by the founder: an **unpriced add-on cannot be bought by the business** (`PRICING_NOT_AVAILABLE`);
  DealDash prices it with a contract rate or grants it by override.
* Market addition is recorded on the amendment; per-market pricing is a plan version per market.
* Stricter live-campaign treatment on suspension is the `STOP_NEW_EXPOSURE` policy gate (reservation / checkout / view start).
* Legal-entity branch counting follows the organization-unit tree.
* An agreement that ended no longer silently falls back to the default plan (behaviour change from Phase 1, intended by this
  architecture; the Phase 1 test was updated accordingly).

## 17. Founder approval and freeze record (Oct 2026)

**SUBSCRIPTION / LICENSING / ENTITLEMENT ARCHITECTURE: FOUNDER APPROVED AND FROZEN.** Frozen scope: Plan, Plan Version, Merchant Starter /
Growth / Business / Enterprise, Bank Enterprise, Scheme Network Licence, Corporate / Partner Enterprise, Contract, Contract Amendment,
effective-dated entitlements (product, feature), usage limits and metering, add-ons, pricing and pricing versions, commercial acceptance,
suspension, grace, upgrade, downgrade, renewal, cancellation, billing / finance / alert hooks and AI entitlement readiness. Later phases do
not redesign these unless a genuine regression or material architecture contradiction is found. No further subscription features now.

**Stage 4 Exclusive Deal commercial regression fix: FOUNDER APPROVED.** Rule: an Exclusive Deal set to start immediately / as soon as
approved stays commercially stable when re-saved or submitted (no new quotation, no acceptance invalidation, no re-acceptance); a
genuinely scheduled future start or change may still re-quote. The regression test in `commercial.e2e.test.ts` is kept. Operational
guidance kept: save before resubmitting where required; stock / inventory changes that materially raise the commercial commitment go
through the approved commercial amendment process.

Rules confirmed by the founder:

* **FD-24 CLOSED.** Pakistan merchant plans: Starter PKR 0 / month, Growth PKR 4,999 / month, Business PKR 14,999 / month, Enterprise
  custom. All pricing is configuration, never hard-coded.
* **Add-on pricing: CONFIGURABLE / TO BE COMMERCIALIZED** until explicitly approved. No add-on price is invented. DealDash Admin
  configures future add-ons (additional branches, users, API access / capacity, premium analytics, additional markets, support, campaign
  packages, AI capabilities, other approved add-ons) as data, without code changes. Not a blocker.
* **Hard pre-launch rule:** every REAL pilot / production Business Account must have an explicit Merchant Plan or Enterprise Contract /
  Licence before commercial launch. The default-plan fallback is for development / test fixtures only (Admin → Subscriptions → Readiness
  lists every business without an agreement).
* **Ended agreement rule:** an ended / expired / terminated agreement never falls back to a default plan and grants nothing new; history
  stays. New entitlement comes only from another active contract, an approved plan assignment, a renewal or an approved replacement.
* **Customer rights:** commercial suspension or termination never silently invalidates legitimate customer rights already issued
  (purchased vouchers, issued Exclusive Deal entitlements, earned rewards, refunds, historical transactions); they continue under their
  approved validity rules. New exposure is blocked before any existing customer obligation is broken.
* **Arabic:** technically complete, subject to **native Arabic review before pilot / production** (launch-readiness item; does not reopen
  this architecture).
* **Dev data:** the QA loyalty cleanup is accepted (audit history kept, no ledger record deleted); test runs no longer leave active QA
  earning rules. Stage 4 and Stage 6 browser journeys depend on seed data with relative dates / times and must run on a **fresh seed**
  (reset + seed `dealdash_test`, start the API with `DATABASE_URL` pointing at it).
* **ADMIN_DATABASE_URL:** the setup credential in the local `.env` does not authenticate. Recorded as a **development / setup
  configuration item**, not an architecture blocker. Before production readiness (Stage 9): verify the setup scripts, use least-privilege
  credentials, confirm no production secret is embedded in source, and confirm the setup / migration process runs cleanly.

**Terminology:** the approved product name is **EXCLUSIVE DEAL / EXCLUSIVE DEALS** (formerly "Hot Deal"). See
`DEALDASH_MASTER_BLUEPRINT.md` addendum "Terminology" for the legacy internal identifiers and the controlled rename item.

Next approved sequencing (not started): Phase 4 (visibility / operations) and Phase 5 (billing / finance / AI), possibly in parallel.
Stage 7 is not started.
<!-- stage7-addendum -->
## Stage 7 (Oct 2026)

The Partner Portal consumes the contracts and entitlements as they are: BANK_ENTERPRISE, SCHEME_NETWORK_LICENCE (schemes are never
priced merchant by merchant), CORPORATE_PARTNER and CUSTOM_ENTERPRISE contracts decide products and features; portal modules are
shown only where the type profile offers them and the contract entitles them; partner-created campaigns are entitled and limited on
the partner's own contract in the campaign's market.

<!-- stage7-founder-decisions -->
## Stage 7 founder approval and decisions (2026-10-10): APPROVED AND FROZEN

A partner-owned Watch & Earn budget (FD-S7-1) needs the WATCH product in the partner's contract in the campaign's market (checked at
creation and again by the shared commercial gate). Partner Live Deals (FD-S7-4) need the OFFERS module and the MANUAL ingestion
entitlement for one-by-one entry; bulk / API keep their Stage 7 rule.
