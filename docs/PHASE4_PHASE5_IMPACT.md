# Phase 4 (Visibility / Operations) and Phase 5 (Billing / Finance / AI): impact assessment and design

Written 2026-10-09 against the real code after the founder froze Phase 3, the Subscription / Licensing / Entitlement architecture and the
Exclusive Deal terminology. Plan of record: `SHARED_PLATFORM_PRE_STAGE7_IMPACT.md` §14–25 and §34 (phases 4 and 5). Stage 7 is not started.

**Verdict: no material contradiction.** Both phases are additive on the modular monolith (NestJS + PostgreSQL). No Kafka, no
microservices, no streaming infrastructure. Frozen designs (subscription engine, commercial governance, product lifecycles, ledger) are
reused, not redesigned.

## 1. What already exists and is reused

| Need | Reused |
| --- | --- |
| Raw engagement events | `DealEvent` (impression, detail, merchant page, save, directions, CTA, checkout, payment...), `AnalyticsModule` batching client |
| Verified outcomes | `Reservation`, `Redemption`, `RedemptionAttempt`, `VoucherOrder`, `Payment`, `VoucherInstance`, `VoucherRedemption`, `Refund`, `WatchView`, `WatchFunding`, `RewardEntry`, `RewardRedemption` |
| Funding / finance | `CommercialCase`, `Quotation`, `CommercialAcceptance`, `FundingCommitment`, `UtilizationEvent`, `FinancePayment`, `FinanceDocument`, `CreditFacility`, `FinancialHold`, `CaseReconciliation`, ledger (SAR), `MerchantPayableEvent` |
| Subscription hooks | `CommercialBillingEvent` (Phase 5 consumes), `CommercialSignal` (Phase 4 consumes), `FINANCIAL_STATUS_PROVIDER` (Phase 5 replaces) |
| Scope | `ScopeService` (target: organization, legal entity, unit, branch, country, product, campaign), `AccessScopeService`, `HierarchyService` |
| Tasks / cases | `ApprovalTask` inbox, `DisputeCase`, `SupportCase`, `Notification` |
| Integrations | `IntegrationConnection` (staleAfterMinutes, lastSuccessfulSyncAt, errorCount), `SyncJob`, `FailedRecord`, `WebhookDelivery`, `Job` |

## 2. Phase 4 design decisions

* **D4-1 Event framework by projection, not by rewriting frozen products.** One `AnalyticsEvent` table (governed taxonomy, append-only,
  idempotent key `source:id:event`). A background projector reads the sources of truth incrementally (watermark per source) and writes
  events stamped with organization, legal entity, branch, unit path, country, city, product, campaign and amount / currency. Client
  engagement (`DealEvent`) is projected as **unverified**; outcomes (redemption, purchase, qualified view, points) only ever come from
  server records and are **verified**. Taxonomy classes keep the honesty rules: ENGAGEMENT, INTENT, CREDENTIAL, VERIFIED_OUTCOME,
  FINANCIAL — a click is never a sale, directions never a visit, a credential never a redemption.
* **D4-2 Aggregation in PostgreSQL.** `MetricAggregate` hourly and daily buckets per (organization, product, campaign, branch, metric),
  recomputed idempotently for touched buckets by a job (every minute) and on demand; near-real-time = closed buckets + live tail. Gauges
  (inventory remaining, budget remaining, points outstanding) are read live from the source tables, never accumulated.
* **D4-3 Hierarchical reporting** groups by country, legal entity, brand, region, city, branch, campaign, product using the unit tree.
  Backend enforcement: organization tenancy + `ScopeService` (branch / unit / legal entity / campaign) + product entitlement (only
  entitled products, history never hidden) + `ADVANCED_REPORTING` feature for drill-downs above branch / campaign. DealDash staff need
  `admin.analytics.read`.
* **D4-4 Targets.** `CampaignTarget` (metric, value, period, direction, thresholds). Target / actual / expected-to-date (linear by
  elapsed time) / forecast (run-rate; labelled **FORECAST / ESTIMATE**, method and confidence returned; never a promise).
* **D4-5 Alerts.** `AlertRule` (organization or platform default; type, trigger, thresholds, frequency IMMEDIATE / DIGEST / CRITICAL_ONLY,
  recipients by role / user, scope, channels, escalation steps), `AlertEvent` (deduplicated by key, severity, status, escalation level,
  action), `AlertDelivery`. Detectors run in a job: target milestones and the early-warning list of the request, plus the subscription
  `CommercialSignal` outbox. Delivery: in-app (`Notification`), task inbox (`ApprovalTask` kind ALERT), email / push / SMS through
  provider interfaces (mock in development). `NotificationPreference` per user and alert category. Fatigue control: dedupe key per
  subject and window, cooldown, digest, critical-only.
* **D4-6 Actionable alerts** carry an action (label, route, required permission). The action only navigates to the existing screen; every
  financially material step still goes through RBAC, scope, maker-checker, commercial acceptance, finance approval and audit there.
* **D4-7 Operations Command Centre** is a read model over campaigns, transactions, finance, integrations and risk (existing tables).
  Integration health classifies each connection HEALTHY / DEGRADED / STALE / FAILING / NOT_CONFIGURED; platform health covers jobs,
  database latency, providers and webhooks.
* **D4-8 Customer Support Timeline** merges account, reservations, redemptions, orders, payments, refunds, vouchers, views, points,
  support cases, disputes, risk and notifications for one customer (admin only, minimised fields).
* **D4-9 Performance-to-Finance linkage**: every verified financial analytics event keeps its finance reference (utilisation event,
  billing event, payment, journal); a per-campaign linkage view compares performance counts with finance counts and raises
  RECONCILIATION_DIFFERENCE when they diverge.

## 3. Phase 5 design decisions

* **D5-1 One finance platform.** Invoices, payments, allocation, AR, PO, credit, statements and reconciliation are product-neutral;
  product economics stay in the adapters and the subscription engine.
* **D5-2 Legal-entity finance scope.** `BusinessAccount` becomes the billing account per (organization, legal entity, currency) with
  billing fields (country, address, tax id, contacts, payment terms, frequency, method, contract, PO required, status ACTIVE /
  CREDIT_HOLD / FINANCIAL_HOLD / SUSPENDED / CLOSED). The legacy unique (organization, currency) is replaced by (organization, legal
  entity, currency) with one `isDefault` account per organization and currency (existing rows become default; nothing moves).
  Finance endpoints check role + scope (legal-entity scope via `ScopeService`).
* **D5-3 No double billing.** Every billing event gets a *collection*: `INVOICE_DUE` (subscription, licence, setup / integration / API
  fees, add-ons, overage, premium services), `PREPAID_DRAWDOWN` (Watch & Earn views drawn from the funded budget, prepaid Exclusive
  Deal redemptions), `NETTED_FROM_PAYABLE` (voucher commission deducted at settlement) or `CAMPAIGN_CASE` (credit-mode campaign usage,
  invoiced by the existing commercial-case closure). Periodic invoicing bills only `INVOICE_DUE`; the others are consumed into
  reconciliation with their settlement reference.
* **D5-4 Documents.** `FinanceDocument` types gain PROFORMA_INVOICE, TAX_INVOICE (when tax is configured for the country), ADJUSTMENT_NOTE,
  STATEMENT (INVOICE stays the commercial invoice); statuses gain PENDING_APPROVAL, SENT, PARTIALLY_PAID, OVERDUE, DISPUTED, CANCELLED,
  CREDITED, WRITTEN_OFF. `InvoiceLine` rows (billing event, quantity, unit price, tax, pricing version, campaign, contract).
  Issued documents are immutable in the database (financial fields frozen, deletion blocked); corrections are credit / debit /
  adjustment notes. Issuing above a configured amount needs a second finance person. Write-off only where the country configuration
  allows it (VALIDATE-KSA).
* **D5-5 AR subledger.** `PaymentAllocation` (partial payments, unallocated credit), aging buckets from configuration, overdue job,
  disputes through `DisputeCase`. AR is document-based per currency. The general ledger stays SAR-only (existing); non-SAR documents
  are never converted automatically.
* **D5-6 PO and credit.** PO = `FinanceDocument` PURCHASE_ORDER with number, value, expiry, document; invoices reference it; remaining
  balance computed. When a billing account requires a PO, issuing and committing need PO headroom. Credit uses the existing
  `CreditFacility`; exposure includes open AR. Exposure above PO / credit / funding is refused.
* **D5-7 Multi-currency.** Transaction, billing and settlement currency on documents; `FxRate` (pair, rate, source, date, approved by a
  second finance person); conversion only with an approved rate recorded on the document; tax currency where the country requires it.
* **D5-8 Reconciliation** report by business account, legal entity, product, campaign, funding party, merchant, sponsor and currency,
  with the product flows of the request (Watch & Earn funded → utilised → points → rewards; Exclusive Deal sponsor commitment →
  utilised → remaining; Voucher cash → issued → redeemed → payable → refund → settlement; Loyalty funded → issued → redeemed → expired →
  reversed → remaining) and exceptions.
* **D5-9 Receivables-aware financial status.** A new provider replaces the default behind `FINANCIAL_STATUS_PROVIDER`: same states, now
  also reporting overdue invoices (GRACE while within the configured days, PAST_DUE after). Enforcement is unchanged: holds and
  suspensions remain explicit, audited human decisions; the provider and alerts tell Finance when to act.
* **D5-10 Quotations** gain expiry, rejection and modification request; amendments keep original → amendment → revised → approval →
  re-acceptance (existing).

## 4. AI design decisions

* **D-AI-1 Governed tool layer, no generic chatbot.** Agent → authorised tool → existing service → existing RBAC / scope / entitlement →
  business rules → audit. Tools run as the requesting user's actor (never a service account, never direct SQL).
* **D-AI-2 Model provider interface** with a deterministic built-in provider (rules + templates, EN / AR). No vendor is chosen; a real
  model is configuration later. Every number in an answer must come from a tool result (grounding check).
* **D-AI-3 Five agent families** (Customer Best-Deal, Merchant Growth, Bank / Scheme / Partner Copilot, Operations & Support,
  Admin / Finance) with tool allow-lists. Answers label each statement OBSERVED_FACT, CALCULATED_TREND, FORECAST, HYPOTHESIS or
  RECOMMENDATION.
* **D-AI-4 Autonomy levels** 0 Explain, 1 Recommend, 2 Draft, 3 Execute after human approval (MVP maximum), 4 bounded autonomy
  (architecture and configuration ready, disabled), 5 refused. Drafts never publish or raise financial exposure; approval executes the
  draft through the normal service under the approver.
* **D-AI-5 AI entitlement.** Business agents need the `AI_COPILOT` feature (contract entitlement); the customer agent is a consumer
  feature behind configuration. Partner screens are Stage 7 (API only now).
* **D-AI-6 Audit and usage.** `AiInteraction`, `AiAction` (SUGGESTED / DRAFTED / HUMAN_APPROVED / SYSTEM_EXECUTED / REJECTED), `AiDraft`,
  `AiUsageRecord` (provider, model, units, estimated cost, business account, legal entity, product, campaign). Commercial treatment of AI
  (included, add-on, licence, usage, premium) is configuration; nothing is priced now.
* **D-AI-7 Evaluation** cases run in the test suite and from Admin: expired deal, ineligible deal, wrong branch, invented price,
  invented term, voucher validity, loyalty balance, unauthorised data, cross-tenant leakage, budget overrun, funding, Arabic quality,
  Urdu (not a supported locale: the agent must answer in a supported language and say so).

## 5. Database impact (additive)

New: `AnalyticsEvent`, `AnalyticsWatermark`, `MetricAggregate`, `CampaignTarget`, `AlertRule`, `AlertEvent`, `AlertDelivery`,
`NotificationPreference`, `InvoiceLine`, `PaymentAllocation`, `FxRate`, `AiInteraction`, `AiAction`, `AiDraft`, `AiUsageRecord`.
Extended: `BusinessAccount` (billing fields, isDefault, unique key), `FinanceDocument` (types, statuses, billing account period,
currencies, FX, PO link, approval, sent / overdue / disputed timestamps), `Quotation` (validUntil, rejection, modification request),
`CommercialBillingEvent` (collection, settlement reference, invoice line), enums `NotificationType` (ALERT). Append-only triggers on
analytics events and AI audit; immutability trigger on issued finance documents.

## 6. Risks

* Projection lag: bounded by the job interval; dashboards show "as of" time. LOW.
* BusinessAccount key change: one service call site (`accountOf`). LOW–MEDIUM; covered by the commercial suites.
* Closure invoicing moves onto the invoicing service (same statuses for existing flows). MEDIUM; covered by commercial e2e.
* Financial-status provider swap: reporting only, enforcement unchanged. LOW.

## 7. Founder decisions / VALIDATE-KSA carried

VAT / e-invoicing format, tax invoice numbering, write-off permissibility, revenue recognition of prepaid consumption, FX accounting
source, AI data processing and privacy consent, Urdu support — configuration placeholders, flagged VALIDATE-KSA / market items.


## 8. Implementation outcome (2026-10-09)

All decisions above were implemented as written, with these clarifications made during the build:
- D5 overdue switch: config key `finance.billing.overdueDrivesPastDue` (default false); `quotationValidityDays` (default 14) added.
- A legal entity is invoiced in its own currency; events in another currency wait (`FX_RATE_REQUIRED`) until an approved rate exists.
- Statements of account store the amount due as the document total and keep the signed closing balance in the statement data.
- The AI built-in provider classifies only; numbers come from tools (grounding check). Business AI requires AI_COPILOT, which no plan
  includes; the dev seed grants it to development-fixture agreements only.
- The partner UI for Phase 4/5 is Stage 7; the APIs are in place.
Verification, fixes and deferrals: `docs/DEALDASH_BUILD_PLAN.md` (Phases 4 and 5 addendum).


## Founder approval (2026-10-09) — PHASES 1–5: FOUNDER APPROVED AND FROZEN

Phase 4 (Visibility / Operations) and Phase 5 (Billing / Finance / Governed AI) are approved and frozen as the founder-approved baseline,
together with Phases 1–3 and the subscription / licensing / entitlement engine. The QA fixes and regression tests identified during final
validation are part of the frozen baseline and must be preserved. Stage 7 has NOT started.

Founder clarifications recorded with the approval:
1. **Currency.** The Saudi MVP does not require a full multi-currency general ledger, and none is to be built now. The architecture must
   keep supporting configurable transaction, billing and settlement currency and an approved FX rate / source / date where applicable, for
   future Pakistan, Qatar, UAE, KSA and other market deployments (already in place: per-document currencies, `FxRate` with maker-checker).
2. **VALIDATE-KSA launch-readiness items** (do not reopen Phase 4 or 5): Saudi tax invoice format / numbering; write-off treatment;
   FX-rate source; AI data residency; AI consent wording; native Arabic review.
3. **Legacy names.** Internal `HotDeal*` and `*Halalas` identifiers may remain only where already documented as legacy internal
   implementation names; they must not be used in new user-facing or business-facing development.
4. **TR-01** (Watch & Earn player timing test) stays a monitored reliability item; it is not a regression unless it reproduces consistently.
5. Stage 7 is not to be started until separately instructed.
