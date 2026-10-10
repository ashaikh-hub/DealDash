# Market / Country Configuration

Status: built and verified 2026-10-09 (pre-Stage-7 hardening); FOUNDER APPROVED AND FROZEN 2026-10-09. Stage 7 has not started.
Frozen Phases 1–5 were extended, not redesigned: the existing `CountryConfiguration` model, `CountryService`, admin permissions,
`ScopeService` (COUNTRY scope), audit log, legal entities, contracts, plan / price-item market versions, pricing agreements, billing and
provider abstractions are reused. No parallel framework was created.

## 1. Hierarchy

GLOBAL → REGION → COUNTRY / MARKET → LEGAL ENTITY → BRAND / OPERATING ENTITY → REGION / CITY → BRANCH / OUTLET

- **Region** (`MarketRegion`: GCC, SOUTH_ASIA, …) groups markets for reporting and administration only. It is never a tax or regulatory
  authority.
- **Market** (`CountryConfiguration`, keyed by ISO alpha-2) drives tax, currency, invoicing, payments, settlement, regulatory configuration,
  product availability, customer / legal wording, local providers and launch state.
- Legal entities carry their country; organization units and branches carry country / city (existing Phase 1 structure).

## 2. Market master (extended `CountryConfiguration`)

Code (ISO alpha-2), ISO alpha-3, names (EN / AR), region, default currency, supported currencies, billing / settlement / tax currency,
currency decimals, rounding rule, default and supported languages, time zone, calling code, formatting (Western numerals), status,
launch date, effective from / to, version, approval status (pending lifecycle change), created by, approved by, DealDash legal entity,
support contact. History: every change is audited under scope `COUNTRY:<code>` (previous value, new value, user, role, reason, approval).
The legacy `enabled` flag is kept and always equals “status is PILOT or ACTIVE”; the legacy `/admin/platform/countries` endpoint can no
longer open or close a market around the gate.

### Lifecycle
PLANNED → CONFIGURING → TESTING → PILOT → ACTIVE, with SUSPENDED and CLOSED (terminal). Allowed moves are fixed (`MARKET_TRANSITIONS`).
Moving to **PILOT** or **ACTIVE** runs the activation gate and waits for a **second administrator** (`admin.markets.approve`); the gate runs
again at approval. Suspending and closing take effect at once and never touch issued customer rights or records. A market can exist and be
fully configured without being visible or commercially active. Migration: the existing enabled market (SA) became PILOT; AE, QA and PK are
PLANNED.

## 3. Product availability by market

`MarketProduct` per market and product (Live Deals, member benefits, Exclusive Deals, Vouchers, Watch & Earn, Loyalty, sponsored / push /
placement products, Merchant subscription, Enterprise licence, AI assistants): DISABLED, CONFIGURING, TESTING, PILOT, ACTIVE, SUSPENDED.
A product can never be more open than its market (PILOT needs a TESTING / PILOT / ACTIVE market; ACTIVE needs an ACTIVE market).
**Enforcement** (new exposure only; issued customer rights never pass through it): `EntitlementService.requireProduct` (every campaign
submission and activation through the commercial gate), Live Deal submission, and the AI assistants (`AI_ASSISTANT`). The market of a
campaign is the country of its branches (a campaign can never span markets), else the business's market (legal entity → in-force contract
market → first legal entity → configured default market). Open statuses are configuration (`markets.availableStatuses`, default PILOT,
ACTIVE).

## 4. Tax (effective-dated, versioned)

`TaxRule`: market, optional legal entity, code, version, tax type, rate (bps), inclusive / exclusive, applicability (taxable items or `*`),
exemption (rate 0 with reason), registration reference, rounding rule, tax currency, effective from / to, status, validation code,
approval. Taxable items cover subscriptions, licences, setup / API / integration fees, Live Deal paid features, Exclusive Deal fees, voucher
commissions, Watch & Earn charges, loyalty charges, promotional placement, AI and other add-ons, overage, other (`TAXABLE_ITEM_OF_EVENT`,
`TAXABLE_ITEM_OF_PRODUCT`). Rules are drafted, approved by a second administrator, then frozen in the database (trigger): a change is a new
version whose start closes the previous one. Resolution uses only the market's own rules (legal-entity-specific first, item-specific over
catch-all, latest version): **there is no fallback to another country** — “not configured” is stated on the document with the market's
validation code (e.g. `VALIDATE-QATAR-TAX`). Invoice lines keep `taxRuleId`, `taxRuleVersion` and taxable item; issued documents and their
lines are immutable, so a later rate change never rewrites history. Campaign quotations take the market's rule (version kept in the
quotation snapshot). No tax rate is seeded: Saudi and other markets' tax treatment remain validation items.

## 5. Invoice / e-invoice configuration

`InvoiceConfig` per market, optional legal entity and document kind (tax invoice, invoice, commercial invoice, proforma, credit note, debit
note): prefix, sequence key, languages, required fields (legal name, registered address, tax number, invoice email, PO), QR required,
e-invoicing provider, validation status (CONFIGURED / VALIDATION_REQUIRED / VALIDATED) and code, effective dating, version, approval. At
issue, the configuration in force sets the number (`PREFIX-000001` on its own sequence) and refuses a document missing a required field
(`INVOICE_REQUIRED_FIELDS_MISSING`); the document keeps the market and configuration it was issued under (frozen). Without a configuration
the platform defaults apply (unchanged). No statutory format is assumed.

## 6. Currency

Default and supported transaction currencies, billing, settlement and tax currency, decimal precision and rounding per market. FX remains the
Phase 5 controlled rate (rate, source, date, maker-checker); a manual override now needs a reason (`isManualOverride`, `overrideReason`).
No full multi-currency general ledger (founder decision); the campaign funding ledger supports SAR only, so a campaign priced in another
currency is refused (`MARKET_CURRENCY_NOT_SUPPORTED`) instead of being converted silently (`markets.campaignLedgerCurrencies`).

## 7. Payments and local providers

`MarketProvider` per market and capability (payment, SMS / OTP, email, push, video, storage / CDN, maps, e-invoicing, KYB, identity,
analytics): provider code, payment method, currency, merchant account reference, refund support, credential and webhook **references only**
(`env:NAME` / `secret:NAME`, enforced by validation and a database CHECK), environment (MOCK / SANDBOX / PRODUCTION; a mock cannot be
production), routing priority, approved fallback, status, effective dates, version. `selectProviders` gives routing order (primary by
priority, then fallbacks). Product logic stays on the existing provider abstractions; mock adapters never count towards launch readiness.

## 8. Settlement

`SettlementRule` by market, legal entity, product, business agreement (organization / contract) and currency: frequency, cycle, minimum,
destination **reference** (account numbers refused), payable and sponsor treatment, fee, reconciliation method, hold days, dispute
treatment; effective-dated, versioned, second approver. `resolveSettlement` picks the most specific approved rule (contract > business >
legal entity > product > market). Payout execution is a later stage; it will consume this resolution (no settlement cycle is hard-coded).

## 9. Refund, expiry, KYB / KYC, privacy / consent / residency, legal terms

`MarketPolicy` (effective-dated, versioned, approved) by category: REFUND_EXPIRY (customer refund, cancellation window, payment reversal,
voucher refund / expiry, unused value, expired reward, loyalty expiry, settlement adjustment, dispute window), KYB (company registration,
tax documents, signatory, beneficial ownership, bank verification, agreement, settlement documents, product permissions), PRIVACY_CONSENT
(privacy notice, customer consent, merchant agreement, marketing consent, AI consent, data residency, retention, age / minor restrictions,
tracking, location), LEGAL_TERMS, SUPPORT, RESTRICTION. Values are references / versions; product-specific policies refine market-wide ones.
Legal conclusions are never encoded: they carry a validation code.

## 10. Legal entity, contract, campaign market

Business Account → Market → DealDash legal entity (the market's contracting, invoicing, collecting, settling, tax-registered entity,
which must be a DealDash legal entity registered in that market). A merchant / bank / scheme / corporate has one Business Account but may
have several legal entities, markets, contracts and billing accounts (Phase 5 billing accounts are per legal entity and currency). Contracts
carry their market and currency; commercial cases now record the campaign's market (and the quotation snapshot its tax rule); billing
events and finance documents record the market of the billed party. Nothing silently inherits another country's tax or commercial rules.

## 11. Market-specific pricing

Plans and price items were already versioned per market. Campaign pricing agreements are now market-aware: an agreement for the campaign's
market wins over a market-neutral one; market-neutral agreements and the platform default apply only where approved
(`markets.defaultPricingMarkets`, default SA). Elsewhere, campaigns cannot be priced until market pricing exists (`PRICING_NOT_AVAILABLE`).

## 12. Validation register

`MarketValidationItem`: market, code, topic, description, product, owner, status (OPEN, IN_REVIEW, RESOLVED, ACCEPTED_RISK,
NOT_APPLICABLE), blocks activation, evidence, decision, effective / review dates, approval, source reference; never deleted; every change
audited. Seeded: the 25 existing VALIDATE-KSA items (VK-01..VK-25, source `docs/DEALDASH_BUSINESS_RULES.md §25`) and the founder's
launch-readiness items (tax invoice format / numbering, write-off, FX-rate source, AI data residency, AI consent wording, native Arabic
review) as `VALIDATE-KSA-*`; open questions only for UAE, Qatar and Pakistan (`VALIDATE-UAE-*`, `VALIDATE-QATAR-*`, `VALIDATE-PAKISTAN-*`).
Closing an item needs a decision, evidence (for RESOLVED) and the approve permission.

## 13. Readiness and activation gate

Checks: DealDash legal entity, default currency, language and time zone, product activation, commercial pricing, tax treatment, invoice
configuration, payment provider (non-mock), settlement, legal / customer terms, privacy and consent, support contact, KYB / KYC
configuration, required providers (OTP and email, plus any policy marked required), local validations signed off. States per check: OK,
MISSING, VALIDATION_REQUIRED; overall READY, NOT_READY, VALIDATION_REQUIRED or BLOCKED (suspended / closed). PILOT needs nothing MISSING;
ACTIVE needs READY. Saudi Arabia today: PILOT (grandfathered), readiness NOT_READY — tax, invoice configuration, real providers, terms,
privacy, KYB and support contact are still to be configured or confirmed, and 31 validation items are open.

## 14. Access, scope, audit

Permissions `admin.markets.read` (Super admin, Operations, Merchant / Partner management, Finance, Risk), `admin.markets.manage` and
`admin.markets.approve` (Super admin, Finance). A **market-scoped administrator** is a scoped DealDash membership with COUNTRY role
assignments (existing Phase 1 mechanism): they see and change only those markets. Every configuration change is audited under
`COUNTRY:<code>`; approved configuration that affected transactions is versioned, never overwritten (database triggers).

## 15. API

`/v1/admin/markets`: list; `regions` (GET, POST); `validations` (GET, PUT `/:id`); `config/:kind/:id/(approve|retire)` with kind
`tax-rules | invoice-configs | settlement-rules | policies`; `/:code` (GET, POST create / update); `/:code/readiness`; `/:code/status`
(request) and `/:code/status/(approve|reject)`; `/:code/products` and `/:code/products/:product`; `/:code/config/:kind`;
`/:code/tax-rules` (+ `/resolve`); `/:code/invoice-configs`; `/:code/settlement-rules`; `/:code/policies`; `/:code/providers` (+ `/:id`);
`/:code/validations`; `/:code/history`. Business: `/v1/orgs/:orgId/markets` (the business's markets, legal entities and open products —
the view Stage 7 consumes). New error codes: MARKET_PRODUCT_UNAVAILABLE, MARKET_NOT_READY, MARKET_TRANSITION_INVALID,
MARKET_CONFIG_INVALID, MARKET_CURRENCY_NOT_SUPPORTED, INVOICE_REQUIRED_FIELDS_MISSING.

## 16. Stage 7 dependency

Partner / Bank / Scheme / Corporate users may operate across markets. Stage 7 must consume this architecture — authorized countries
(COUNTRY scope), legal entities, supported currencies, product availability, market pricing, tax configuration, eligibility and campaign
restrictions, finance scope — through `MarketService.requireAvailable / resolveMarket / forOrganization`, `MarketConfigService` resolvers and
the existing scope service. No separate partner market logic.

## 17. Verification

API `apps/api/test/markets.e2e.test.ts` (22 tests); full API suite 777 / 777 at the time of writing; admin component tests
`apps/admin/features/markets.test.tsx`; localization coverage test; browser `node tooling/e2e/markets-browser.mjs` (19 checks, screenshots
`docs/screenshots/markets`). Figma handoff: `docs/MARKET_CONFIGURATION_FIGMA_HANDOFF.md`.

## Founder approval (2026-10-09) — MARKET / COUNTRY CONFIGURATION: FOUNDER APPROVED AND FROZEN

The Market / Country Configuration architecture is approved and frozen as the founder-approved baseline: Global → Region → Country /
Market hierarchy, market lifecycle, product availability by market, effective-dated tax, invoice, currency, payment and settlement
configuration, legal entity / contract market scope, market-specific pricing, KYB/KYC readiness, privacy / consent / residency, provider
configuration, the Market Admin workspace, the activation gate, the market validation register (VALIDATE-KSA / UAE / QATAR / PAKISTAN),
RBAC / scope, audit / versioning and the Arabic / RTL handoff.

Founder rules recorded with the approval:
1. Stage 7 does not redesign this architecture.
2. Stage 7 consumes the shared Market / Country framework (MarketService, MarketConfigService, MarketReadinessService, COUNTRY scope).
3. No country-specific tax, currency, provider, pricing, invoice or settlement rule is hard-coded in the Partner Portal.
4. Effective dating and historical financial / configuration records are preserved.
5. A market cannot become ACTIVE unless its mandatory readiness configuration is complete.
6. Stage 7 is not started until separately instructed.
<!-- stage7-addendum -->
## Stage 7 consumption (Oct 2026)

The Partner Portal uses this framework unchanged: authorized markets come from the partner's legal entities and contract market,
narrowed by COUNTRY scope; partner campaigns use the market of the fulfilment merchant's branches (never spanning markets) and its
product availability, pricing, tax and invoice rules; partner benefits re-check MEMBER_BENEFIT availability at activation; readiness
shows open market validation items. No country rule is coded in the portal.

## Stage 8 consumption (Oct 2026)
Stage 8 reads the market settlement rule (APPROVED only; otherwise SETTLEMENT_RULE_MISSING), the refund policy and its open
validation items (shown on refund eligibility), the market of cases / audit / restrictions, and scoped admins' visible markets. No
market rule was added or changed; VALIDATE-KSA / UAE / QATAR / PAKISTAN items stand.