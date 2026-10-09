# Shared platform foundation before Stage 7: impact assessment

Status: assessment complete, no code changed. Written against the real code and schema on 2026-10-09 (after the Commercial Governance and Finance platform). Section numbers 1 to 35 follow section 81 of the change request.

Verdict up front: **there is no architectural blocker, but the request is a multi-phase programme, not one change.** It touches authorisation on every endpoint, adds roughly 30 tables and changes every portal. Delivering it as one change would make it impossible to regression-test safely. Section 34 proposes five phases ordered by dependency. Phase 1 is safe to start immediately.

## 1. Existing capabilities reusable (do not rebuild)

| Need | Already built |
|---|---|
| Tenant isolation, roles, permissions | `Organization`, `OrganizationMembership` (role + optional branch), `Role`/`Permission`, `TenantService`, `@RequirePermissions`, DB-seeded role matrix |
| Audit | append-only `AuditLog` (previous/new state, actor, org, reason, ip, user agent, request id) with DB triggers; per-product history tables |
| Legal entity, business account, billing account basics | `LegalEntity`, `BusinessAccount` (currency, funding mode) |
| Finance | double-entry ledger, `FinanceDocument` (invoice, receipt, credit and debit note, PO), payments, credit facilities, holds, adjustments, reconciliation, sequences, pricing agreements (versioned, effective-dated by version) |
| Commercial governance | quotations, acceptance, approvals, funding commitments, amendments, adapters per product |
| Eligibility | `EligibilityRuleSet` and `EligibilityCondition` with `EligibilityService`, used by Live, Hot, Voucher and Watch |
| Loyalty-like ledger | Rewards: `RewardAccount`, `RewardEntry`, `RewardLot`, catalogue, redemption, adjustment (EARN, HOLD, RELEASE, REVERSE, REDEEM, EXPIRE, ADMIN_ADJUSTMENT already exist) |
| Events and monitoring seeds | `DealEvent`, `AnalyticsModule` (batching client), `Job` + `JobsService` sweeps, `WatchViewEvent`, `Notification`, `SupportCase`, `RiskFlag` |
| Configuration | `SystemConfiguration` (versioned, cached) |
| Localization and RTL | complete |
| Idempotency, concurrency patterns | `IdempotencyKey`, conditional updates, CHECK constraints, append-only triggers |

## 2. Organization hierarchy gaps

Today: `Organization` (type MERCHANT, PARTNER, DEALDASH) with a flat list of `MerchantBranch`. `LegalEntity` exists only as a billing object. Missing: group or business account above organizations, brand, operator or franchisee, country, region, city as nodes, and the relationships between legal entity, brand, operator and settlement entity.
Plan: an `OrganizationUnit` tree (kind GROUP, LEGAL_ENTITY, BRAND, OPERATOR, COUNTRY, REGION, CITY, BRANCH) with a closure or materialised path column for fast scope checks, and explicit role links per campaign or contract (brand owner, fulfilment operator, commercial counterparty, settlement entity). `MerchantBranch` stays the physical outlet and gains a unit reference; nothing is removed.

## 3. Scoped RBAC gaps

Today a membership is role + organization + optional branch. There is no country, region, city, brand, legal-entity, campaign or product scope, and no delegated administration rules. Every service calls `TenantService.requireOwnOrganization` and permission checks are by role only.
Plan: `RoleAssignment` (user, role, scope kind, scope unit or id, granted by, valid from and until) replacing the single branch column logically while keeping `OrganizationMembership` as the anchor. A single `ScopeService.can(actor, permission, resource)` is the only place that resolves "role AND scope". Delegation rule: a grant is allowed only if the grantor holds the permission in a scope that contains the target scope. All grants audited. This is the highest-risk change because every controller and service path must adopt it; it must be introduced behind the existing helpers so current behaviour is the default scope.

## 4. Merchant master data

Today there are `Organization` + `Merchant` per merchant and no canonical or duplicate model. Plan: `MasterMerchant`, `MasterBrand`, `MasterBranch` canonical identities; `ExternalEntityReference` (source system, source record id) and `EntityAlias`; `MatchCandidate` with confidence; manual review before any merge. Network (referenced) merchants are master records with **no** `Organization` or entitlements; registering one creates the organization and links it. Controlled products already require a registered, active merchant (commercial gate); the entitlement layer (section 7) makes that explicit per product.

## 5. Bulk and API impact

Nothing exists. Plan: `ImportJob` and `ImportRow` (upload, validate, normalise, duplicate detection, preview, error report, approval, execute, audit; idempotent by file hash and row key), a generic importer interface with per-entity handlers (merchants, brands, branches, offers, users first). Integration framework: `IntegrationConnection` (credentials hashed, scopes, version, rate limit), `SyncJob`, `FailedRecord` (dead letter), `WebhookEndpoint` and delivery log, health fields (last sync, last success, error count, stale flag). No scheme-specific connectors.

## 6. Source-of-truth impact

Plan: provenance columns on master records and imported offers (source system, organization, record id, import method, last sync, last successful sync, owner, editable-by, sync status, override status) and `DataConflict` with configurable resolution (source wins, DealDash wins, merchant wins, manual). Approved local data is never overwritten silently.

## 7. Entitlement impact

Today pricing agreements exist but there is no per-organization plan. Plan: `Contract` (organization or business account, effective from and until), `ProductEntitlement` (product), `FeatureEntitlement` (API access, advanced reporting, bulk import) and `EntitlementLimit` (campaign counts, branches). One `EntitlementService.require(org, product|feature)` called from the commercial gate and campaign creation. Backend enforced.

## 8. Eligibility impact

The engine is shared already but its model is a flat condition list. Required: AND, OR, nested, plus card scheme, card product, tier, segment, membership, product ownership. Plan: version the rule set as a JSON expression tree (`EligibilityRuleSet.expression`) evaluated by the same `EligibilityService`, keeping the existing conditions as the compiled legacy form so Stages 3 to 6 are untouched. Age and gender criteria stay behind a configuration flag (VALIDATE-KSA, legally permitted only).

## 9. Loyalty impact

The Rewards ledger is already append-oriented with lots, expiry, holds, reversal and catalogue redemption. Missing: funding source on every issuance, configurable earn rules (events, multiplier, caps), event sources other than Watch & Earn, and finance visibility. Plan: generalise rather than duplicate. Add `LoyaltyRule` (effective-dated) and `fundingSource` plus `fundingOrganizationId` and `campaignRef` to reward entries; a `LoyaltyIssuanceService` that every product calls for verified events; finance rows for funded, reserved, issued, redeemed, expired, reversed per funding source. No fixed SAR value (already true).

## 10. Finance impact

Reused. Add: loyalty funding commitments through the existing `FundingCommitment` (kind LOYALTY_FUNDING), and billing events (section 11).

## 11. Billing and invoicing impact

`FinanceDocument` and `FinancePayment` exist; missing: billing events from verified product events, cycles, invoice statuses beyond the current four, payment allocation, aging, statements, multi-currency, proforma versus tax invoice and billing accounts with tax id, address, payment terms and PO rule. Plan: extend `BusinessAccount` with the billing fields, add `BillingEvent` (source type and id, rate, quantity, currency, invoiced flag), `InvoiceLine`, `PaymentAllocation`, aging buckets from configuration. Statutory format stays VALIDATE-KSA.

## 12. Audit and versioning impact

Audit is strong but lacks scope, correlation id and approval reference. Plan: add nullable `scope`, `correlationId`, `approvalRef`, `source` columns to `AuditLog`. Campaign versioning: today Quotation versions and an edit lock after approval exist; there is no `CampaignVersion` snapshot per live version. Plan: a generic `CampaignVersion` (product, subject, version, content snapshot, status, effective period) written on approval and amendment, referenced by entitlements, redemptions and financial events.

## 13. Country configuration

Only `SystemConfiguration` keys and SAR assumptions exist. Plan: `CountryConfiguration` (country, currency, languages, tax settings, payment provider, settlement, legal text version, categories, notification providers, residency flag) resolved by the organization's country. KSA remains the only enabled market.

## 14 to 16. Performance monitoring, target alerts, early-warning alerts

Existing events are per product (`DealEvent`, `WatchViewEvent`, redemptions). Plan: one `AnalyticsEvent` taxonomy table (names in section 50, with the integrity rules of section 51), a background aggregator into `MetricAggregate` (by scope, product, campaign, day and hour), campaign targets, and a forecast function labelled ESTIMATE. No Kafka. Target milestone alerts and early warnings are `AlertRule` evaluations over aggregates.

## 17. Notification preferences

`Notification` exists for in-app. Plan: preference model (channel, frequency, recipient role and scope, digest) and delivery adapters; email, push and SMS stay behind provider interfaces (mock in development).

## 18. Escalation

Plan: `AlertEvent` with escalation steps in the rule; time periods are rule data. Financial actions from an alert use the existing commercial and finance controls.

## 19. Operations monitoring

Plan: Admin Command Centre read model over campaigns, transactions, finance, integration health and risk, using existing data first and aggregates later. Technical health from health checks and the `Job` table.

## 20 to 25. AI Agent architecture, Customer, Merchant, Bank and Scheme, Admin AI, permissions and audit

Not present. Plan: an AI tool layer that is nothing but authorised calls to existing services under the end user's actor (no service account, no bypass), a tool registry with read, draft and controlled tiers, `AIAgentAuditEvent` (suggested, human approved, system executed), and confirmation tokens for controlled actions. No model vendor is chosen or integrated in this change; a provider interface and a deterministic stub keep it testable. Autonomous operation is out of scope.

## 26. Merchant and Admin portal impact

Merchant: hierarchy and branch management, role and scope assignment, bulk import, integration health, performance and targets, alerts, billing, loyalty funding, activity, task inbox, AI. Admin: master data and duplicate review, hierarchy, integrations, bulk imports, loyalty configuration, billing, AR, Command Centre, alerts, audit, support timeline, AI. Existing finance and commercial screens are reused.

## 27 and 28. Customer and Staff impact

Customer: loyalty balance and history, AI deal assistant, eligibility explanation. Rewards screens already exist. Staff: none, except that redemption scope will follow branch or unit assignment through the shared scope check.

## 29. Database impact

Additive tables (about 30) as listed in section 82 of the request, deliberately consolidated: `OrganizationUnit`, `RoleAssignment`, `Contract` + entitlements + limits, master merchant, brand, branch, aliases and match candidates, `ImportJob` + `ImportRow`, `IntegrationConnection`, `SyncJob`, `FailedRecord`, `DataConflict`, `CampaignVersion`, `LoyaltyRule`, `AnalyticsEvent`, `MetricAggregate`, `CampaignTarget`, `AlertRule`, `AlertEvent`, `NotificationPreference`, `ApprovalTask`, `DisputeCase`, `BillingEvent`, `InvoiceLine`, `PaymentAllocation`, `CountryConfiguration`, `AIAgentAuditEvent`. Existing `SupportCase`, `Notification`, `LegalEntity`, `BusinessAccount`, `FinanceDocument`, `EligibilityRuleSet` and the rewards tables are extended, not replaced.

## 30. API impact

New scoped endpoints per capability; existing endpoints keep their URLs. The one cross-cutting change is the scope check.

## 31. Figma impact

All listed screens in section 84 are new. No design exists for any of them; the Commercial screens are still functional drafts. A design pass is needed before visual freeze. The Customer app gains only loyalty and the assistant.

## 32. Migration risk

* Scoped RBAC: HIGH. Mitigation: default scope equals today's behaviour; introduce `ScopeService` behind `TenantService`; run the full 544 API tests after each controller family moves.
* Hierarchy: MEDIUM. Existing organizations and branches map one-to-one into units by a backfill migration.
* Loyalty generalisation: MEDIUM (Stage 6 tests cover the ledger heavily).
* Campaign versions and eligibility expressions: LOW to MEDIUM, additive.
* Billing extensions: LOW, additive.
* Analytics events: LOW; dual-write before switching dashboards.
* Everything else: additive.

## 33. Stage 7 dependency

Stage 7 (Partner Portal for banks, schemes, employers) needs, in order: hierarchy and scoped RBAC, entitlements, partner master data and delegated administration, eligibility expressions, bulk import. It does **not** need AI, advanced alerts, the Command Centre or full billing. Those can follow in parallel.

## 34. MVP versus deferred, and proposed phasing

| Phase | Content | Needed for Stage 7 |
|---|---|---|
| 1 Foundation | organization units, role assignments with scope, delegation rules, `ScopeService`, entitlements and contracts, effective-dating helper, audit columns, country configuration | yes |
| 2 Master data and ingestion | master merchant, brand, branch, aliases, duplicate review, provenance, conflicts, import jobs, integration framework | yes |
| 3 Shared engines | eligibility expressions, campaign versions, loyalty rules and funding, approval task inbox, dispute cases, conflict detection | yes (eligibility, versions) |
| 4 Visibility | analytics events, aggregates, targets, forecast, alerts, escalation, notification preferences, Command Centre, support timeline | no |
| 5 Billing and AI | billing events, statements, aging, multi-currency, AI tool layer, audit and customer, business and admin read tools | no |

Deferred after MVP, as the request itself lists: global merchant matching AI, loyalty tiers and external transfers, Kafka, machine-learning forecasting, autonomous optimisation, POS integration.

## 35. Genuine architecture blockers

None. Three founder decisions would change the design and should be settled before Phase 1 ends (defaults shown, none blocks starting):

1. Is `Organization` the legal entity, or do we introduce `OrganizationUnit` above and below it? Default: units form a tree around the existing organization; the organization stays the tenant and billing anchor.
2. Which scope kinds are valid for each role, and may a scope be set on a campaign? Default: the list in section 6 of the request, validated per role in configuration.
3. Is a network (referenced) merchant allowed to appear in customer discovery before it is registered? Default: only as a Live Deal listing where data rights are confirmed (VALIDATE-KSA).

VALIDATE-KSA items: VAT and e-invoicing, revenue recognition, loyalty liability, customer data privacy and AI data processing, card and BIN data, advertising disclosures and targeting, data residency, FX accounting, refunds and expired value.


---

## Phase 3 - Shared business engines (backend complete; screens deferred to the UI pass)

**Status:** backend built and tested; awaiting Phases 4-5 before the Stage 7 gate. Stage 7 NOT started.

### Functionality added / reused
| Engine | Added | Reused |
|---|---|---|
| Eligibility | Nested AND/OR/NOT expression, new attribute types (country, card product/tier, segment, membership, product ownership, age band, gender), fail-closed, unlockable vs impossible | `EligibilityService`, existing rule sets and call sites |
| Campaign versioning | `CampaignVersion` (LIVE versions, content frozen by trigger, one LIVE per campaign); version stamped on reservations, redemptions, vouchers, views, utilization events; amendment versions on stock additions | Product cores' approve paths, commercial acceptance |
| Entitlements | (Phase 1) enforced at activation; LOYALTY is a product | `CommercialService.assertEntitled` |
| Loyalty | `LoyaltyRule` (effective-dated, capped per day / month / customer / allocation, funder + rate, expiry), `LoyaltyIssuanceService`, reversal, finance view, LOYALTY commercial adapter (`SPONSOR_FUNDING`) | **One** points ledger (`PointsLedgerService`, shared with Watch & Earn), `RewardEntry`/`RewardLot`, commercial quotation/acceptance/funding/utilization |
| Task inbox | Derived tasks (reviews, loyalty / import approvals, data + offer conflicts, duplicate suggestions, disputes with SLA) + stored `ApprovalTask`; each task carries the permission needed to see it | Existing statuses; nothing is copied |
| Disputes / exceptions | `DisputeCase`, append-only `CaseNote` (INTERNAL vs SHARED), SLA from config, assign, resolve with recorded outcome and optional finance link | Audit log |
| Offer conflicts | `OfferConflictFlag`: weaker Exclusive vs overlapping public Live Deal, duplicates; flags (never blocks), human decision with reason | Hot-deal approve hook, admin scan |
| Activity history | Plain-language, tenant- and audience-filtered view over the one audit log | `AuditLog` (+ scope / correlation fields from Phase 1) |

Loyalty events wired (verified events only): qualified Watch view (not held / flagged), Exclusive redemption, voucher purchase (settled payment), voucher redemption. Reversed on: Exclusive / voucher redemption reversal, voucher refund. Event types and rule numbers are configuration / rule data, not code.

### Schema impact
Migrations `20261222000000_platform_phase3_engines` and `20261223000000_platform_phase3_conflict_statuses` (adds `REQUIRES_CHANGE` to the conflict status check). All additive; existing rows unaffected. `RewardEntry` gains source/funding columns (defaults keep old rows valid). Test DB: applied from scratch, no drift.

### API impact (additive)
- `/v1/admin/loyalty/rules[...]` (create, submit, approve, reject, pause, resume, end, allocation), `/v1/admin/loyalty/finance`
- `/v1/orgs/:orgId/loyalty/rules[...]`, `/v1/orgs/:orgId/loyalty/finance`
- `/v1/admin/inbox`, `/v1/orgs/:orgId/inbox`
- `/v1/admin/disputes[...]`, `/v1/orgs/:orgId/disputes[...]`
- `/v1/admin/conflicts[...]` (list, scan, decide)
- `/v1/admin/activity`, `/v1/orgs/:orgId/activity`
No existing route changed shape. `RewardsLedgerService.apply` keeps its signature (delegates to the shared ledger).

### RBAC
New: `admin.loyalty.{read,manage,approve}`, `merchant|partner.loyalty.manage`, `admin.disputes.{read,manage}`, `merchant|partner.disputes.manage`, `merchant|partner.activity.read`, `admin.conflicts.manage`. Author of a loyalty rule or a higher DealDash allocation cannot approve it. Business-wide views refuse branch/scope-limited members until each is made scope-aware (deferred).

### Tests
`loyalty.e2e` (9), `operations.e2e` (11), plus earlier Phase 3 unit tests. Full API suite: 603 / 603; eslint (errors) clean; tsc clean; package suites green.

### Unresolved / founder decisions
- Streak-style loyalty events are not implemented (event types are configuration; a streak concept was removed from the MVP).
- Points redemption destinations for external partners are a catalogue column only; no external transfer (post-MVP by decision).
- Expiry defaults stay OFF (VALIDATE-KSA, VK-17).

### Deferred
Scope-aware (branch / unit) adoption in the legacy campaign endpoints and the new business-wide views; task inbox assignment / snooze; dispute attachments upload; Phase 3 screens and Arabic/English dictionary entries (done together with the Phases 4-5 UI).


---

## Phase 3 closure addendum (supersedes the "Unresolved / Deferred" lists above)

**Status:** Phase 3 is functionally and visually complete (backend, screens, localization, scope enforcement, validation). Awaiting approval. Phases 4-5 and Stage 7 are NOT started.

### Scope enforcement on the older endpoints (mandatory, now done)
One mechanism, two layers:
1. **Safety net (deny by default).** `PermissionsGuard` holds every scoped member to *each required permission organization-wide* on any route not marked `@ScopeAware()`. A route can therefore never leak partial-scope data by forgetting to check.
2. **Scope-aware routes** (`@ScopeAware()` + `AccessScopeService`, which wraps `ScopeService`): Live Deals, Exclusive Deals, Vouchers, Watch & Earn (list, summary, read, create, update, submit, pause, resume, end/cancel, stock, funding), reservations cancel, redemptions list / reverse, voucher sales and reversal, branches (list / read / create / update / status), the organization inbox.
   - Lists are filtered **on the server** (an id allow-list); reads need any one of the record's branches in scope, writes need **all** of them; a record the member cannot read is a 404 (existence not revealed); a narrower scope (product, campaign) can only narrow; creating needs every branch in scope.
   - Organization-level work (finance, commercial terms, voucher payable, team / users, loyalty, disputes, activity, imports, integrations) needs an organization-wide grant of that permission.
   - Branch-bound staff memberships still never manage campaigns.
Covered by `scope-legacy.e2e` (15) and `scope-products.e2e` (5): cross-scope denial, spanning-campaign read-vs-write, product / campaign narrowing, branch redemptions, finance and team, tenant isolation, audit of denials.
Policy note: finance data has no country / legal-entity dimension yet, so a country-scoped finance user is refused until per-legal-entity billing (Phase 5).

### Dispute evidence (done)
Reference-only attachments on the case (`evidence` list: file ref, type, label, uploaded by, time, visibility INTERNAL | SHARED), through the existing file flow (signed upload, type / size / content check, short-lived signed read links), tenant-checked, append-safe (one conditional update), max 20, closed cases refuse files, every add and every open is audited. No document management; storage provider stays the platform's adapter.

### Task inbox
Derived + stored tasks, each with the permission needed to see it, translated by `kind` (never free English text), scope-aware for businesses. **Snooze is POST-MVP by decision:** it would hide approvals that carry SLAs and four-person controls; the inbox note says so.

### Explicitly out of MVP (DEFERRED / NOT IN MVP, not "incomplete")
- Streak / milestone loyalty events (concept removed from the MVP). `FIRST_ACTIVITY` / `CAMPAIGN_BONUS` event types removed from the default configuration (a campaign bonus is a BONUS rule scoped to one campaign).
- Inbox snooze (see above).
- Partner-portal screens for loyalty / cases (the partner app is still the placeholder shell; the org APIs already serve partners).
- External loyalty transfers, ML anything, POS integration (original MVP discipline).

### Migrations
`20261222000000_platform_phase3_engines` was changed after first authoring: its one-time provenance backfill of `RewardEntry` (new columns only) now lifts the append-only guard for that statement only. A first dry run against the dev database (62 existing ledger rows) failed on the guard; the dev database was recovered without data loss (the DDL had applied, the backfill was run with the guard lifted and re-enabled, the migration marked applied). `20261223000000_platform_phase3_conflict_statuses` adds `REQUIRES_CHANGE`. Test database re-applies all 14 from scratch; dev database: "up to date", ledger untouched.

### Screens (both languages, right-to-left verified)
Admin: **Operations** (Inbox, Cases with notes and evidence, Offer conflicts with scan and decision, Activity) and **Loyalty** (rules with maker-checker, finance view). Merchant: **Operations** (Inbox, Cases with evidence, Activity) and **Loyalty** (merchant-funded rules gated by the commercial terms). Browser check `tooling/e2e/phase3-browser.mjs`: 31/31, screenshots in `docs/screenshots/phase3`.


---

## Phase 3 final closure verification

**Approved deferrals (NOT Phase 3 defects; do not report them as unfinished Phase 3 work):**
| Item | Decision | Where it lands |
|---|---|---|
| Streak / milestone loyalty events | NOT IN MVP (concept removed) | not planned |
| Inbox snooze | POST-MVP | later release |
| Partner Portal screens (loyalty, cases, inbox) | Stage 7 | Stage 7 (the org APIs already serve partners) |
| Per-Legal-Entity finance scope | Phase 5 | Phase 5 billing (until then finance data needs an organization-wide grant) |

**Defect found and fixed during the final verification.** The new end-to-end test for loyalty through the real product flows (`loyalty-events.e2e`) found that an active `QUALIFIED_VIEW` rule made a Watch & Earn qualifying view fail: loyalty points were recorded with the view's own source, which a database rule (one credit per view) reserves for the Watch & Earn reward, and fraud handling finds view rewards by it. Loyalty points for a view are now recorded as a generic event (`view:<id>`); a fraud verdict on a view also takes back the loyalty points earned from it. Voucher purchase and refund, voucher redemption, Exclusive redemption and its reversal were verified correct by the same test.

## Phases 4 and 5 — completion status (2026-10-09, awaiting founder approval)

| Phase | Scope | Status |
|---|---|---|
| 1 | Organization / unit / legal entity, scoped roles, contracts and entitlements | Approved, frozen |
| 2 | Master data, ingestion, imports, integrations | Approved, frozen |
| 3 | Operations, cases, evidence, loyalty governance | Approved, frozen |
| Subscription | Licensing / entitlement engine (FD-24) | Approved, frozen |
| 4 | Visibility / operations: analytics, reporting, targets, alerts, Command Centre, support timeline | Approved, frozen |
| 5 | Billing / finance (legal-entity scope, invoicing, AR, PO, credit, FX, reconciliation) and governed AI agents | Approved, frozen |

Details: `docs/PHASE4_VISIBILITY_OPERATIONS.md`, `docs/PHASE5_BILLING_FINANCE.md`, `docs/AI_AGENTS.md`,
`docs/PHASE4_PHASE5_FIGMA_HANDOFF.md`, decisions in `docs/PHASE4_PHASE5_IMPACT.md`, verification and deferrals in
`docs/DEALDASH_BUILD_PLAN.md` (Phases 4 and 5 addendum).

What Stage 7 (partner portal) inherits: partner performance, targets, alerts, billing and the Partner Campaign copilot are available as
APIs with partner permissions and scope; only the partner screens remain.


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
