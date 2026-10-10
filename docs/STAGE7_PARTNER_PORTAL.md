# Stage 7 — Enterprise Partner Portal

Status: **FOUNDER APPROVED AND FROZEN (2026-10-10)**, with founder decisions FD-S7-1 to FD-S7-4 CLOSED and implemented (see
"Founder decisions"). Stage 8 (operational gap closure) has since been built on top without changing this stage (docs/STAGE8_OPERATIONAL_GAP_CLOSURE.md); the one Stage 7 change is a defect fix: UUIDs are no longer mistaken for card numbers by the PAN check (`looksLikeCardNumber`), plus the founder-approved B8 compatibility fix: "Add a merchant" cannot be submitted until the partner's market list has loaded. Frozen Phases 1–5, the subscription / licensing / entitlement engine and the Market /
Country configuration were consumed, not redesigned. Changes to this stage now need founder approval.

The Partner Portal (`apps/partner`, port 3004) is another governed front end on the one DealDash platform. It has no backend, database,
campaign engine, eligibility engine, finance engine, entitlement engine, market configuration or importer of its own. The API module
`apps/api/src/partners` only adds partner-specific access, workflows and views on top of the shared services.

## 1. Partner Business Account model
Partner = Business Account (`Organization` type PARTNER) → Legal Entities (shared `LegalEntity`, one per market / subsidiary) →
Markets (shared Market / Country configuration) → Contract / Enterprise Licence (shared `Contract` + entitlements: `BANK_ENTERPRISE`,
`SCHEME_NETWORK_LICENCE`, `CORPORATE_PARTNER`, `CUSTOM_ENTERPRISE`) → Entitlements → Roles + Scope (shared `RoleAssignment` /
`ScopeService`). A parent partner group is recorded on the profile and, where it must drive access, modelled as a GROUP unit.
No new identity model: partner users are `PARTNER_USER` accounts with ordinary memberships.

## 2. Partner types
`BANK`, `SCHEME` (card scheme: Visa, Mastercard, Amex, other approved schemes — `SCHEME` is the stored code), `EMPLOYER`,
`FINANCIAL_INSTITUTION`, `CORPORATE`, `STRATEGIC_PARTNER`, `OTHER_APPROVED_PARTNER`. What a type is OFFERED is configuration
(`partners.typeProfiles`: modules, eligibility attributes, ingestion methods, expected contract kinds, aggregate reporting); what is
ENTITLED is the contract; WHERE is the market. Nothing is coded for a named partner.

## 3. Onboarding / readiness
Lifecycle DRAFT → UNDER_REVIEW (partner submits) → APPROVED / CHANGES_REQUESTED / REJECTED (DealDash) → CONTRACT_ACTIVE →
FINANCE_READY → PRODUCT_ENABLED → ACTIVE (second DealDash administrator; requester can never approve), SUSPENDED. Each step checks
its readiness items live: profile and requested markets, legal entity, markets (legal entity there; market open), contacts,
authorised signatory, contract in force (kind matches the type profile), billing account, funding (prepaid, or credit with an active
facility), entitlements, API readiness (only when API is in the contract), market validation items (shown as VALIDATION_REQUIRED,
never hidden, no local requirement invented). Partners already active before Stage 7 were recorded ACTIVE (grandfathered). New
exposure (campaigns, benefits, sponsorship) needs ACTIVE.

## 4. Users / RBAC / scope
New roles: `PARTNER_FINANCE_MANAGER`, `PARTNER_APPROVER`, `PARTNER_INTEGRATION_MANAGER`, `PARTNER_NETWORK_MANAGER` (with the existing
admin, campaign manager, benefits manager, analyst, finance viewer, read-only). Delegated / country administrators are partner admins
with COUNTRY / LEGAL_ENTITY / PRODUCT / CAMPAIGN scoped assignments (shared). Inviting, changing roles and deactivating go through
`ScopeService.assertCanDelegate`: nobody grants more than they hold (`DELEGATION_EXCEEDED`). Organization-level work needs an
organization-wide grant (the shared safety net); scope-aware reads are filtered to the member's authorized markets.

## 5. Dashboard and performance
Home: lifecycle and readiness, open markets, campaigns (active / created / sponsored), network (referenced / registered), 30-day
verified outcomes (Exclusive redemptions, voucher sales, qualified views, loyalty points, partner benefit redemptions), funding
(committed / received / used / remaining), invoices (open / overdue / outstanding), purchase orders and credit, alerts, tasks,
integration health, modules. Performance drill-down by market, legal entity, merchant, city, branch, campaign from the Phase 4
aggregates, filtered to the partner's campaigns; expected-to-date and forecast labelled ESTIMATE; ROI is never shown (DealDash holds no
partner revenue data).

## 6–10. Merchant network, ingestion, referenced vs registered, dedupe / provenance, integrations
A merchant is in a partner's network when the partner is the source of one of its master records (`ExternalEntityReference`). All
three methods use the ONE ingestion pipeline (`IngestService`): manual (portal form), bulk (shared importer with a new field mapping,
CSV template, preview, error report, DealDash approval, idempotent execution) and API / feed (shared integration framework; key shown
once, hashed at rest). Entitlement per method: at least one partner feature (MANUAL: `MERCHANT_INGESTION_MANUAL` or
`BANK_MERCHANT_NETWORK`; BULK: `MERCHANT_INGESTION_BULK` or `BANK_MERCHANT_NETWORK`; API: `MERCHANT_INGESTION_API`,
`NETWORK_INTEGRATION` or `BANK_MERCHANT_NETWORK`) AND the shared capability (BULK_IMPORT / API_ACCESS) — enforced on the portal
routes. The Phase 2 generic routes keep their frozen rule (founder decision FD-S7-2: CLOSED, NO). Provenance (source system, record id,
method, sync and override status, last sync / source update) and open conflicts are shown per merchant. Possible duplicates are
listed with the partner's view (NOT_DUPLICATE / SUGGEST_MERGE); only DealDash merges, and high-risk records are flagged.
A referenced merchant shows every controlled capability (Exclusive, voucher, Watch & Earn reward, staff redemption, settlement,
finance) as unavailable; a registered, active merchant's capabilities follow its own contract. Partners may add an already
registered DealDash merchant to the network (provenance link only).

## 11–13. Scheme Network Licence, Bank Enterprise, Corporate / Employer
Consumed from the subscription engine (plans, versioned prices, contracts, amendments, renewal, usage, entitlements; no hard-coded
price). Schemes are not priced merchant by merchant. Corporate / employer programmes keep work-email domains only (one domain belongs
to one employer); reporting is aggregate (verified member counts, never who).

## 14–15. Eligibility and card / scheme privacy
The portal builds AND / OR / NOT trees; the shared `EligibilityService` validates, stores (`EligibilityRuleSet`, now with an optional
name) and evaluates them, including "test with a sample customer". Attributes are limited to the type profile; card product / tier
values must be the partner's own active card programmes; issuer / employer / scheme values are partner organizations of the right type
(widened to financial institutions and corporates). Card programmes keep 6–8 digit BIN / IIN prefixes only (database CHECK); text
that looks like a card number is refused (`CARD_DATA_FORBIDDEN`); a link is "verified" only through the programme's verification
method. Card issuer / product / tier / scheme verification follows FD-S7-3 (below).

## 16–19. Campaigns: Live Deal benefit, Exclusive Deals, Vouchers
Exclusive Deals and Vouchers a partner creates run on the shared engines at a registered, active merchant of its network (the
fulfilment merchant's branches, staff, inventory, redemption, payable). Roles stay separate: the partner is Campaign Creator and
commercial OWNER (`commercial.creatorOrganizationId`, set only by the portal; a merchant edit can never change it), its customer
funding is its SPONSOR line (a partner can only commit its own funding), and the merchant is FULFILMENT_MERCHANT and accepts its own
obligations (DealDash can never stand in). Entitlement, market availability and campaign limits are checked on the partner's contract
in the campaign's market. Submission, DealDash review, commercial acceptance, funding and the activation gate are the shared ones.
Images come from the merchant's approved deal images.
Live Deal partner benefit (`LiveDealPartnerBenefit`): an extra for the partner's customers on an existing public Live Deal; the Live
Deal stays public; PROPOSED (partner) → MERCHANT_APPROVED (deal owner) → ACTIVE (DealDash, a different person, availability re-checked);
withdraw / suspend / reinstate / end; shown to customers by the shared eligibility engine (ELIGIBLE / LOCKED_UNLOCKABLE; HIDDEN not
shown); it is never an Exclusive Deal by itself and never counted as a redemption.

## 20–21. Watch & Earn, Loyalty
Partners fund extra points on network merchants' Watch & Earn campaigns through the shared loyalty rules (QUALIFIED_VIEW, campaign
scoped, DealDash approves, commercial governance applies) and see budget, paid views, spend and points funded. Partner-funded loyalty
uses the shared loyalty workspace. No fixed points-to-currency value. Partners may also OWN a Watch & Earn budget (FD-S7-1, below).

## 22–23. Commercial / funding, finance
Shared commercial case (charges, sponsor funding, merchant contribution, customer benefit, maximum commitment, currency, tax, pricing
version, funding method, acceptance, amendments). Partners now accept, approve (maker-checker) and pay their own obligations
(`partner.commercial.*`); declining uses the shared billing route. Finance is the shared Phase 5 billing workspace (accounts,
invoices, receipts, credit / debit notes, receivables and aging, purchase orders, statements, reconciliation), scoped by legal entity
and currency.

## 24–28. Performance, alerts, tasks, disputes, AI copilot
Shared Phase 4 alerts and notification preferences; the shared task inbox gained COMMERCIAL_ACCEPTANCE, PARTNER_BENEFIT_DECISION,
IMPORT_REJECTED / IMPORT_READY, INTEGRATION_ISSUE (business) and PARTNER_REVIEW, PARTNER_ACTIVATION, PARTNER_BENEFIT_REVIEW
(DealDash). Disputes / exceptions: the shared cases. AI: the governed Partner Campaign agent (explain, recommend, draft; nothing that
raises exposure without a human), same RBAC and tenant isolation, contract feature AI_COPILOT.

## 29–30. Multi-market and isolation
Authorized markets = the partner's markets (legal entities, contract market) narrowed by the member's COUNTRY scope; every campaign,
network merchant, programme and benefit is filtered by them. Another tenant's id is always 404 (bank vs bank, bank vs scheme, scheme vs
scheme, corporate vs corporate), including finance, inbox and AI.

## API
`/v1/partners/:orgId/…`: home, modules, profile, readiness, onboarding/submit, history, markets, users (+ invitations, role,
deactivate / reactivate), network (+ merchants, registered, duplicates, imports, templates), offers, card-programs,
employer-programs, eligibility (options, rules, test), campaigns (+ preview, merchants/:id/assets, :product/:id, submit),
commercial (case, preview, cases, accept, approvals, pay), benefits (+ live-deals, withdraw), watch (+ campaigns, sponsor),
performance, integrations. `/v1/admin/partners` (list, create + invite, :orgId, readiness, history, lifecycle, lifecycle/approve |
reject, benefits, benefits/:id/approve | reject | suspend | reinstate). `/v1/merchants/:orgId/partner-benefits` (+ decision).
`/v1/app/live-deals/:id/partner-benefits` (public).

## Data
Migration `20270102000000_stage7_partner_portal` (additive): PartnerType values; Partner onboarding columns; PartnerCardProgram,
PartnerEmployerProgram, LiveDealPartnerBenefit; EligibilityRuleSet.name; MatchCandidate partner suggestion; CHECK constraints
(lifecycle, statuses, kinds, BIN prefixes 6–8 digits). Content field `commercial.creatorOrganizationId` (default null) on the shared
commercial inputs.

## Founder decisions — ALL CLOSED (2026-10-10)

### FD-S7-1 — Partner ownership of the Watch & Earn budget: CLOSED, YES
An authorized Bank, Financial Institution, Card Scheme, Corporate, Employer or approved Partner may be the Sponsor / Funder and own a
Watch & Earn campaign budget, on the SHARED Watch engine (no second engine):
- `WatchCampaign.creatorOrganizationId` (Campaign Creator) and `sponsorOrganizationId` (Sponsor / Funder, budget owner) are recorded
  separately from `organizationId` (the registered network merchant that holds the campaign and its video: fulfilment / reward
  provider). They are set only from the in-process partner context at creation; a merchant edit can never change them.
- Gates: operating (ACTIVE) partner, Watch & Earn module, the WATCH product in the partner's contract in the campaign's market,
  authorized market, registered active network merchant; then the shared commercial case (partner = OWNER accepts the media spend,
  merchant = FULFILMENT_MERCHANT accepts its part; pricing version, funding model, credit / PO / prepaid controls as configured),
  funding, and the activation gate.
- Funding: only the budget owner funds it (`partner.commercial.accept`; never the merchant; DealDash admin credit stays possible).
  The funding record and the CAMPAIGN_BUDGET / CAMPAIGN_UNUSED ledger lines are posted to the owner; consumption, credit-back and
  close-out follow the owner.
- A partner-owned budget is always reviewed by DealDash (merchant trust never auto-publishes it).
- DealDash keeps customer points economics, qualification rules, fraud controls and reward rules: Watch content has no points field
  and the partner cannot set customer points.
- API: `GET|POST /v1/partners/:orgId/watch/owned`, `GET /watch/owned/:id`, `POST /watch/owned/:id/fund`, `POST /watch/owned/:id/submit`;
  merchant videos are offered via `campaigns/merchants/:id/assets` (`videos`). Portal: Watch & Earn → "Budgets you own".

### FD-S7-2 — Stricter partner ingestion rule on shared Phase 2 routes: CLOSED, NO
The founder-approved frozen Phase 2 shared import / integration behaviour is preserved. Shared ingestion engine → existing shared
permissions / capabilities; Partner Portal ingestion routes → shared ingestion engine + partner-specific entitlement / role / scope /
contract enforcement (`PARTNER_INGESTION_FEATURES`). No change was made to the Phase 2 routes.

### FD-S7-3 — Card product / tier verification: CLOSED
Card issuer, product, tier or scheme is VERIFIED (`ISSUER_VERIFIED`) only with trusted verification evidence: issuer / bank API,
scheme API, approved partner feed, approved tokenized verification or another formally approved source.
- `EligibilityAttribute.verificationSource` (ISSUER_API | SCHEME_API | PARTNER_FEED | TOKENIZED_VERIFICATION | APPROVED_SOURCE) and
  `evidenceRef`, with `verifiedAt` / `status` (existing). Database CHECK: a CARD / CARD_PRODUCT / CARD_TIER / SCHEME attribute can be
  ISSUER_VERIFIED only with both (enforced on every new or changed row; existing rows are not rewritten).
- The shared eligibility engine treats a card attribute claiming ISSUER_VERIFIED without source and evidence as declared
  (`trustedLevel`), so BIN / IIN metadata, a customer's selection or a self-declaration is never represented as verified. Rules
  distinguish VERIFIED from DECLARED through the existing required level (SELF_DECLARED / OTP_VERIFIED / ISSUER_VERIFIED).
- Preserved: no full PAN, no CVV; BIN / IIN prefixes (6–8 digits) only where approved; card-number-like text refused.
- Actual issuer / scheme verification integrations are connectors to be contracted (no connector is invented here).

### FD-S7-4 — Partner creation of Live Deals: CLOSED, YES (subject to governance)
Authorized Banks, Card Schemes and approved Partners create / import Live Deals from their merchant networks where they have confirmed
rights to publish, using the existing Merchant Master / Network Merchant / provenance architecture (ReferencedOffer +
ExternalEntityReference through the ONE ingestion pipeline):
- Methods: bulk file (shared importer, DealDash approves the job with the publication reference), API / feed (DealDash authorises the
  connection's publication), and now one-by-one in the portal (`POST /v1/partners/:orgId/offers`, OFFERS module, MANUAL ingestion
  entitlement, `partner.network.manage`, authorized market, merchant of the partner's network). A manual Live Deal states its
  publication authority (`publicationRef`) and is NOT shown to customers until DealDash confirms the right
  (`GET /v1/admin/partners/offers`, `POST /v1/admin/partners/offers/:id/confirm|withdraw`, `admin.partners.approve`, audited).
- Retained per Live Deal: source, publication authority / right, external offer id, merchant source id, effective dates, eligibility,
  market, provenance (method, sync status), last synchronization, audit history (shown on the portal Offers page).
- A partner Live Deal never gives the merchant Exclusive Deal, voucher, controlled redemption, staff, settlement or finance capability;
  a referenced merchant stays referenced; a registered merchant keeps only what its own readiness and entitlements allow.
- Controlled redemption or financially controlled benefits use the approved products (Exclusive Deals, vouchers, Live Deal partner
  benefits). Existing Live Deal rules are unchanged: discovery is frictionless; click / directions / referral are not redemption. A
  bank / scheme / employer benefit may coexist with a public Live Deal and does not become an Exclusive Deal.

Migration `20270104000000_stage7_founder_decisions` (additive): WatchCampaign creator / sponsor columns + index; EligibilityAttribute
verificationSource / evidenceRef + CHECKs. Applied to the test and development databases (development backed up first, no reset or
reseed, no drift).

### Verification after the founder decisions (2026-10-10)
API 804/804 (27 Stage 7 tests, 3 new); partner app 15/15 (3 new); admin 96 incl. partners 4/4 (1 new); localization 22/22;
typecheck 24/24; ESLint 0 errors (64 pre-existing warnings); browser Stage 7 40/40 (5 new checks), Stage 6 Watch & Earn 88/88,
Stage 3 Live Deals / eligibility 98/98.

## Deferred (post-MVP)
Excel parsing in the importer (files are exported to CSV), scheduled feed pulls, partner-specific statements beyond Phase 5,
Inbox snooze (already post-MVP), partner group roll-ups across Business Accounts.

## Stage 8 founder approval (2026-10-10): APPROVED AND FROZEN
Stage 8 Operational Gap Closure is founder approved and frozen (docs/STAGE8_OPERATIONAL_GAP_CLOSURE.md). B8 closed (partner "Add a merchant" Stage 7
compatibility fix, now part of the frozen Stage 7 baseline); B9 monitored, not a regression. Pre-pilot items B1–B7 remain open for Stage 9 /
pilot readiness; VALIDATE-market items remain central. Stage 9 not started.
