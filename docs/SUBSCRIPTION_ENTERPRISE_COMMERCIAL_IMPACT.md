# Subscription, Licensing, Entitlement and Commercial Plan Engine: impact assessment

Status: written BEFORE coding (as required). Result: **no material contradiction** with the existing Contract / Entitlement architecture was found, so implementation proceeds. Phase 4, Phase 5 and Stage 7 are not started.

The engine EXTENDS the existing tenant (Organization = Business Account), Legal Entity, Contract and ContractEntitlement. There is no second commercial model.

## 1. Existing Contract model: reused
`Contract` stays the one commercial agreement instance (organization, optional legal entity, name, reference, plan code, status, effective dates, entitlements). It is **extended with columns**, not replaced or shadowed:
`kind` (commercial type), `market`, `currency`, `billingCadence`, `billingLegalEntityId`, `planVersionId`, `renewalState`, `version`, `termsVersion`, `graceDays`, `enforcement` (policy override), `pastDueSince / graceUntil / suspendedAt / cancelledAt`, `nextBillingAt`, `nextRenewalAt`, `supportLevel`, `accountManager`, `pricingVersionKey`. The existing "ACTIVE / ENDED" status becomes the commercial lifecycle (item 6). Existing contracts keep working: `kind` defaults to `CUSTOM_ENTERPRISE`, `ENDED` is mapped to `CANCELLED` or `EXPIRED` by the migration.
`ContractLegalEntity` (new, small) lets one contract cover several legal entities (the single `legalEntityId` remains the contracting entity).

## 2. Existing Entitlement model: reused
`ContractEntitlement` (kind PRODUCT | FEATURE | LIMIT, key, enabled, limit value, effective dates) stays the ONLY authorization source. `EntitlementService.effective()` is upgraded, with the same signature and result fields, to understand provenance. Rows gain `source` (CONTRACT legacy | PLAN | OVERRIDE | ADDON), `sourceRef`, and for limits: `mode` (HARD | SOFT), `period`, `warnPercents`, `softAction`, `overageRateMinor`. Resolution per key: an OVERRIDE replaces the PLAN default for that contract; ADDON rows add to limits and enable features or products; contracts of the same organization combine as before (union, highest limit). The no-contract fallback to the configured default plan is unchanged, so no existing organization changes behaviour.

## 3. Contract extensions
Commercial kinds: `MERCHANT_SUBSCRIPTION`, `MERCHANT_ENTERPRISE`, `BANK_ENTERPRISE`, `SCHEME_NETWORK_LICENCE`, `CORPORATE_PARTNER`, `CUSTOM_ENTERPRISE`. An Enterprise Licence is a Contract of an enterprise kind. Visa Pakistan, Mastercard MENA, a bank agreement and a corporate agreement are Contracts with their own entitlements, limits, pricing and markets. Nothing technical differs between them.
New child tables, all hanging off Contract: `ContractAmendment`, `ContractAcceptance`, `ContractAddOn`, `ContractTrial`, `ContractPromotion`, `ContractRate`, `ContractLegalEntity`.

## 4. Plan model
`CommercialPlan` is a reusable template identity (code, names, entity type it is for, contract kind, free / negotiated flags). It is NOT a customer contract. Starter, Growth, Business, Merchant Enterprise, Bank Enterprise, the Scheme licences and Corporate / Partner are rows in this catalog, edited by DealDash Admin without a deployment. Nothing about plans is hard-coded in application logic.

## 5. Plan Version model
`CommercialPlanVersion` is the versioned, per-market snapshot: market, currency, version, status (DRAFT | PUBLISHED | RETIRED), effective dates, price points per billing cadence, setup / integration fees, add-on prices, products, features, limits (with mode, period, thresholds), billing cadence, support level, trial days, grace days, enforcement policy and commercial rules. Published versions are immutable; a change is a new version. When a Business Account enters a plan, the version feeds the Contract as PLAN entitlement rows (a snapshot); later plan edits do not change existing contracts. A contract-specific need is an OVERRIDE row, never an edit of the global plan.

## 6. Subscription lifecycle
`Contract.status` is the commercial lifecycle: `DRAFT, PENDING_ACTIVATION, TRIAL, ACTIVE, PAST_DUE, SUSPENDED, CANCELLED, EXPIRED` plus `SUPERSEDED` (a history marker when a replacement contract starts). Renewal is a **separate** field, `renewalState`: `AUTO_RENEW, MANUAL_RENEWAL, NON_RENEWING, RENEWAL_PENDING`. Upgrade, downgrade, add-on, renewal, pricing, entitlement, market and extension changes are NOT statuses: they are `ContractAmendment` records (previous version snapshot, change, new effective version).

## 7. Licence lifecycle
Identical to item 6 (a licence is a contract). Network licences use the same lifecycle with annual or multi-year cadence and manual renewal.

## 8. Usage Allowance model
An allowance is a LIMIT entitlement row (metric key, value, mode HARD | SOFT, period NONE | DAY | MONTH | YEAR | CONTRACT_TERM, warning thresholds, soft action WARN | OVERAGE_CHARGE | REQUIRE_APPROVAL, overage rate, source). Entitlement says WHAT IS ALLOWED. Metric keys: `branches.max`, `users.max`, `campaigns.max_active`, `campaigns.per_period`, `api.requests`, `bulk_import.rows`, `markets.max`, `legal_entities.max`, `brands.max`, `exports.per_period`.

## 9. Usage Meter model
Three distinct concepts, never mixed: (A) current RESOURCE COUNTS computed live from the source of truth (branches, active users, active campaigns, legal entities, brands, markets); (B) PERIOD USAGE meters (`UsageMeter`, one row per organization, legal entity, metric and period, advanced by conditional update); (C) BILLABLE BUSINESS EVENTS (qualified view, verified redemption, voucher transaction) recorded once in `UsageEvent` with an idempotency key. A meter never decides what is allowed.

## 10. Pricing model
`PriceItem` / `PriceItemVersion` is the price book (market, currency, model FIXED | PER_UNIT | PERCENT_BPS | TIERED, indicative "from" and range values). Subscription prices live in the plan version; negotiated prices in `ContractRate`; promotions in `ContractPromotion`. A single `PricingResolver` applies the precedence: contract negotiated rate, then promotion / discount / waiver, then plan version, then market price book. Existing campaign pricing (`PricingAgreement`, quotations) is untouched and keeps pricing campaign charges; the resolver does not replace it. Money is integer minor units with an explicit currency.

## 11. Pricing versions
Prices are never overwritten: a new version supersedes the previous by effective date. Every billing / usage event stores the pricing version key that governed it (`PLV:<id>`, `PIV:<id>`, `CR:<id>`, `PRM:<id>`).

## 12. Billing Event interface
One new table, `CommercialBillingEvent`, is the standard financial-event hook (no existing abstraction fits: `UtilizationEvent` is a funding drawdown, ledger journals are postings). It carries event id, idempotency key, business account, legal entity, billing legal entity, contract, plan, product, feature, campaign, source event, pricing version, quantity, unit, unit rate and amount where resolved, currency, occurred at, billing category (revenue classification), event type and metadata. Event types: monthly / annual renewal, setup, integration, API, add-on, featured placement, campaign setup, qualified view, verified redemption, voucher commission, plan change adjustment, overage. Phase 5 consumes these (invoices, AR); nothing here posts to the ledger. Customer points funding, merchant reward commitments, sponsor funding, loyalty funding and customer subsidy are NOT revenue and never create a revenue billing event.

## 13. Financial-status interface
`FinancialStatusProvider` (injection token) answers GOOD_STANDING, GRACE, PAST_DUE, FINANCIAL_HOLD or SUSPENDED for an organization (and legal entity). The default implementation derives it from the contract lifecycle, grace window and organization-level financial holds. Phase 5 replaces or enriches the provider with AR data; consumers do not change.

## 14. Admin management
DealDash Admin (no deployment needed): plan catalog and versions, country prices, price book, add-on definitions, assign plan, enterprise / bank / scheme / corporate agreements, overrides, add-ons, rates, discounts, waivers, promotions, trials, lifecycle (past due, suspend, reinstate, cancel, renew), amendments, usage and billing-event views, signals, launch readiness (organizations with no contract). New permissions: `admin.subscriptions.read / manage / approve` (maker-checker for overrides, forced downgrade and published price changes).

## 15. Merchant UX
A "Plan and usage" screen: current plan, status, price, renewal, branch and user usage, products, features, add-ons, promotions, commercial status, upgrade (difference, price, effective date, acceptance), downgrade (impact and blockers), plan history, and a plain-language "why is this unavailable". No invoice screens (Phase 5).

## 16. Enterprise UX
Admin-side agreement view (agreement, licence type, period, legal entities, countries, products, features, API and integration rights, limits vs actual usage, pricing, renewal, account manager, support, acceptance). Partner-portal screens are Stage 7; the organization-scoped APIs already serve partners.

## 17. Phase 4 hooks
`CommercialSignal` (an outbox of domain events, de-duplicated per threshold and period): BRANCH_LIMIT_80_PERCENT, BRANCH_LIMIT_REACHED, USER_LIMIT_APPROACHING, API_LIMIT_APPROACHING, TRIAL_EXPIRING, PROMOTION_EXPIRING, RENEWAL_APPROACHING, CONTRACT_EXPIRING, PAYMENT_GRACE_STARTED, FINANCIAL_HOLD. No alert engine is built; Phase 4 consumes the outbox.

## 18. Phase 5 hooks
Billing events (item 12), the financial-status provider (item 13), billing legal entity resolution (contract's billing entity, else the contracting entity, else the organization's first entity; never a brand or branch), commercial acceptance records, pricing versions. Phase 5 owns invoices, invoice workflow, AR, payment allocation, PO and credit controls, statements, credit / debit notes, reconciliation and full multi-currency finance.

## 19. Stage 7 dependency
Stage 7 (and the partner portal) consumes the org-scoped subscription and entitlement APIs and the explain endpoint. Nothing in Stage 7 may bypass the engine.

## 20. Migration
Additive migration. Existing contracts are kept; `ENDED` becomes `CANCELLED` (ended early) or `EXPIRED` (past its end date). No contract rows are deleted; no entitlement is changed. Organizations with no contract keep the configured default plan. Development fixtures: seeded merchants are mapped to fixture plan versions (flagged development, zero price). **Real pilot merchants must receive an explicit plan / contract assignment before commercial launch**: a launch-readiness endpoint lists organizations without one. The dev database is migrated, not reset (it holds real ledger rows).

## 21. Testing
Standard merchant plans (limits, upgrade, downgrade with excess, add-on, trial, renewal, cancellation, suspension); plan feeds contract, overrides, add-ons, effective dates, expired entitlement, financial hold; enterprise kinds, multi-market, legal-entity scope; resource counts, period meters, hard and soft limits, idempotent usage; pricing versions, discount, waiver, acceptance, amendment, re-acceptance; billing events and idempotency; tenant isolation, scope and role; suspension preserving customer rights (issued vouchers, credentials, rewards, refunds, finance and history). Then the full Stage 1-6 regression.

## 22. Material blocker
None. Two design notes, both inside the existing architecture: (a) amounts above 2,000,000,000 minor units (about PKR 20 million) would overflow the 32-bit integer; larger custom licences are split into billing events (documented limit); (b) FD-24 is CLOSED for the architecture and the current Pakistan configuration; tax and accounting treatment stay market-specific configuration (VALIDATE items listed in the final report).


---

## Implementation closure (Oct 2026)

Implemented as assessed, with no material contradiction found during the build. Specification of what was built:
`SUBSCRIPTION_LICENSING_ENTITLEMENT.md`; Figma: `SUBSCRIPTION_FIGMA_HANDOFF.md`. FD-24 CLOSED. Recorded decisions: unpriced add-ons are
arranged by DealDash (not self-service); an ended agreement no longer falls back to the default plan; development merchants run on
unpriced SA fixture agreements; real pilot businesses need explicit assignment (Readiness list). Phase 4, Phase 5 and Stage 7 not started.