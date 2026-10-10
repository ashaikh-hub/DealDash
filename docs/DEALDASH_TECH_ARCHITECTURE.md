# DEALDASH TECHNICAL ARCHITECTURE

Version 0.2 (lean startup revision; founder stack decisions applied; draft for approval) · 2026-10-07
Scope: system architecture for the frozen MVP (Customer, Merchant, Staff, Partner and Admin surfaces) for a **controlled Riyadh pilot built by a lean startup team**. **Documentation only. No application code, no schema scripts.**
Companions: `DEALDASH_DATA_MODEL.md`, `DEALDASH_API_ARCHITECTURE.md`, `DEALDASH_BUILD_PLAN.md`.
Inputs: Master Blueprint, Business Rules, UX Architecture v0.4, Customer MVP Final v0.2, frozen Merchant / Staff / Admin / Partner designs.

> **History:** v0.1 proposed a modular monolith with a native-app-capable customer client, a ~56-week plan and a ~15-person team. **That is no longer the target.** The founder approved a leaner stack and delivery model (section 1). v0.1 is retained only as context; nothing in it overrides this document.

Conventions: **MVP / P2 / P3**; `TA-nn` technical decision; `VK-nn` VALIDATE-KSA. "Verify at build start" marks library or platform capabilities I have not confirmed against current versions and which the technical lead must confirm in the first sprint.

---

## 1. FOUNDER DECISIONS APPLIED (approved MVP stack)

| Area | Decision |
|---|---|
| Language | **TypeScript** everywhere (frontend, backend, shared packages) |
| Backend | **Node.js + NestJS**, one backend |
| Database | **PostgreSQL** (source of truth) with **PostGIS** |
| ORM | **Prisma** |
| Frontend | **Next.js + React + TypeScript** |
| Architecture | **Modular monolith**; **no microservices** for MVP |
| Repository | **Monorepo** |
| Client strategy | **Responsive web / PWA** for all five surfaces; **no native apps** for the pilot unless a genuine technical limitation is found. A future **React Native / Expo** customer app must be possible without redesigning backend APIs or business logic |
| Search | PostgreSQL + PostGIS + PostgreSQL text search; **no Elasticsearch/OpenSearch** |
| Cache / queue | **Redis** only where it adds clear value; never the system of record; **no Kafka** |
| Hosting | Not locked; **portable, managed, simple**; **no Kubernetes** |
| Video | Managed provider; no custom video infrastructure |
| Team | Lean (about 5 engineers + QA + part-time DevOps), not 15 |
| Target | **16 to 24 weeks** for a controlled Riyadh pilot with all four products (see Build Plan for the honest assessment) |

---

## 2. ARCHITECTURAL DRIVERS

| Driver | Consequence |
|---|---|
| **Four distinct products on one platform** | Separate domain modules and lifecycles for Live Deals, Exclusive Deals, Vouchers and Watch & Earn; shared kernel only for identity, tenancy, eligibility binding, approval, media, ledger, audit, localisation, configuration |
| **Money correctness** | Append-only double-entry ledger, idempotent payment/redeem/refund commands, signature-verified webhooks, reconciliation |
| **Hard inventory** | Per-branch stock with atomic PostgreSQL updates; no oversell (section 11) |
| **Lean team, fast delivery** | One backend, one database, shared UI and API client, generated types, managed services, no distributed infrastructure |
| **Five surfaces, AR/EN, RTL** | One design system package, logical CSS, bilingual content model |
| **Privacy by design** | No PAN/CVV/last-4; aggregate-only partner data; suppression service; tenant isolation tests |
| **Saudi validation still open** | Configurable policies, model-neutral ledger, portable hosting |
| **Future growth** | Clean module boundaries and an API that a native client can reuse |

---

## 3. SYSTEM CONTEXT

```
 Customer PWA     Merchant web     Staff PWA     Partner web     Admin web          (all Next.js + React + TypeScript, shared packages)
      │                │              │              │              │
      └────────────────┴──────┬───────┴──────────────┴──────────────┘
                              ▼
               CDN / edge (TLS, WAF, static assets, media)
                              │
                ┌─────────────┴───────────────────────────────┐
                │   apps/api : ONE NestJS modular monolith     │
                │   (same codebase also runs as worker process)│
                └──────┬──────────────┬──────────────┬─────────┘
                       │              │              │
                 PostgreSQL        Redis         Object storage
                 (+ PostGIS)   (queue, limits,   (media, documents,
                               cache, idempotency) evidence) + CDN
   External (behind adapters): PSP · SMS/OTP · Email · Web Push · Maps/geocoding · Video delivery · Monitoring/error tracking
```
No other servers: no search cluster, no event streaming, no service mesh. The **worker** is the same NestJS codebase started in job-processing mode (separate process, same image).

---

## 4. ARCHITECTURE STYLE

### 4.1 Modular monolith
- One NestJS application organised into **domain modules**. Each module owns its models, services, controllers, DTOs, jobs and events; other modules use its **exported service interface** or subscribe to its **domain events**.
- Boundaries are **enforced, not just documented**: lint rules (module-boundary and import restrictions), no cross-module Prisma model access in code review and CI, and per-module test suites.
- **Domain lifecycles are not unified.** Live Deals, Exclusive Deals, Vouchers and Watch & Earn each have their own state machine, rules and tables. They share only the kernel (section 4.3).

### 4.2 Module catalogue (NestJS modules)

| # | Module | Responsibility |
|---|---|---|
| 1 | **Identity** | Authentication (provider-neutral), sessions, devices, OTP, invitations, MFA |
| 2 | **Customer** | Profile, onboarding, consents, interests, restrictions, saved items, account lifecycle |
| 3 | **Merchant** | Merchant organisation, onboarding, KYB state, agreement, trust level |
| 4 | **Merchant Branch** | Branches, hours, coordinates, status |
| 5 | **Merchant Staff** | Staff members and branch assignment |
| 6 | **Partner** | Partner organisation, onboarding, proposals, change requests, data-sharing posture |
| 7 | **Bank** | Issuers, card products, tiers, BIN/IIN metadata (partner-owned, DealDash-verified) |
| 8 | **Card Scheme** | Networks, scheme-issuer participation |
| 9 | **Employer** | Employers, official domains, verification settings |
| 10 | **Eligibility** | Rule sets, customer attributes, evaluation engine (one engine for all products) |
| 11 | **Live Deals** | Live Deal lifecycle, controlled-redemption option, discovery signals |
| 12 | **Exclusive Deals** | Exclusive Deal lifecycle, per-branch inventory |
| 13 | **Reservations** | Free reservations, hold, expiry, cancellation, no-show strikes |
| 14 | **Vouchers** | Voucher definitions, instances, codes, validity, expiry |
| 15 | **Voucher Purchases** | Orders, checkout holds, ownership, receipts |
| 16 | **Watch & Earn** | Campaigns, budgets, views, qualification, caps |
| 17 | **Rewards** | Points ledger, catalogue, holds, redemption, adjustments |
| 18 | **Payments** | PSP abstraction, payment states, webhooks, reconciliation inputs |
| 19 | **Refunds** | Refund requests, execution, status |
| 20 | **Redemptions** | Code validation, redeem, reversal, attempts |
| 21 | **Settlements** | Statements, payout batches, adjustments, disputes (uses the Ledger) |
| 22 | **Campaign Approval** | Guardrails, review queue, decisions, pause/suspend |
| 23 | **Notifications** | Templates, channels, preferences, delivery log |
| 24 | **Reviews** | Reviews, Verified evidence, reports, moderation |
| 25 | **Support Cases** | Cases, messages, evidence, SLAs, appeals |
| 26 | **Fraud / Risk** | Rules, signals, flags, blocklists, decisions |
| 27 | **Reporting** | Aggregates, partner reports with suppression, exports |
| 28 | **Audit** | Append-only audit store |
| 29 | **System Configuration** | Typed parameters, feature flags, reference data |

**Supporting modules (small, shared):** **Ledger** (financial kernel used by Payments, Refunds, Redemptions, Settlements, Watch & Earn), **Discovery** (PostGIS search and feed), **Media/Files**, **Content & Localisation**, **Analytics Events**, **Jobs** (queue plumbing).

### 4.3 Shared kernel (allowed to be depended on by all modules)
Identity context (actor, org, branch scope), tenancy helpers, Audit writer, Configuration reader, Localisation helpers, Ledger commands, Eligibility evaluation interface, Analytics event emitter, error model, idempotency helper, money type. Nothing else is shared.

### 4.4 Module interaction rules
1. Synchronous calls through exported services only where the user waits and consistency is mandatory (for example Reservations → Eligibility, Voucher Purchases → Vouchers).
2. Everything else is **event-driven in process** with a **transactional outbox** table so that events survive a crash and can later be delivered to another process if a module is extracted.
3. **Only the Ledger module posts ledger entries**, via idempotent commands.
4. **Audit is written in the same transaction** as the business change.
5. A module never queries another module's tables directly.

### 4.5 When to extract a module (documented triggers, none expected in the pilot)
Watch & Earn view ingestion (sustained high event volume), Notifications (provider throughput), Reporting (heavy aggregation affecting OLTP), Discovery (search relevance/scale). Extraction is a refactor behind existing interfaces, not a redesign.

---

## 5. MONOREPO STRUCTURE

Tooling: **pnpm workspaces + Turborepo** (task caching, affected-only builds). One TypeScript config base and one lint config package. *(Tool choice: verify at build start; the structure holds with equivalent tools.)*

```
dealdash/
├─ apps/
│  ├─ api/            NestJS backend (HTTP API + worker entrypoint); owns Prisma schema and migrations
│  ├─ customer/       Next.js customer PWA (mobile-first, installable)
│  ├─ merchant/       Next.js merchant web app (responsive)
│  ├─ staff/          Next.js staff PWA (mobile-first, online-first scan/validate/redeem)
│  ├─ partner/        Next.js partner web app (bank, scheme, employer via role-based modules)
│  └─ admin/          Next.js admin web app (responsive)
├─ packages/
│  ├─ ui/             Design system: tokens, components, RTL-safe primitives, charts, patterns from frozen designs
│  ├─ types/          Shared domain types and enums (generated from API contract where possible)
│  ├─ validation/     Shared schemas (for example Zod) used by API DTOs and forms
│  ├─ api-client/     Typed client generated from the API's OpenAPI description
│  ├─ auth/           Client auth helpers (session handling, route guards, permission helpers)
│  ├─ localization/   AR/EN messages, formatting (Western digits, Gregorian), RTL helpers, fonts config
│  ├─ analytics/      Analytics event contracts and client emitter
│  ├─ config/         Shared configuration schema, environment validation, feature-flag keys
│  ├─ eslint-config/  Lint rules including module-boundary rules
│  └─ tsconfig/       Base TypeScript configs
├─ tooling/           Scripts: codegen, seed, dev utilities
├─ infra/             Infrastructure as code and deployment definitions (portable)
└─ docs/              The documentation set
```
Refinements from the founder's outline: `eslint-config` and `tsconfig` packages (consistency), `tooling` and `infra` folders. **Prisma lives inside `apps/api`** (not a shared package) so that frontends can never import database code. Optionally extract a `packages/testing` for fixtures later.

**Rules:**
- **No business logic in frontends.** Apps render, collect input and call the API. Eligibility, pricing, inventory, state transitions and money are decided on the server only.
- **No duplicated logic across apps:** shared behaviour lives in a package or in the API.
- Apps import only from `packages/*`; packages never import from `apps/*`; `apps/api` does not import frontend code.
- The API contract is the boundary: OpenAPI generated from the NestJS app, client generated into `packages/api-client`, schemas shared through `packages/validation`.

---

## 6. APPLICATIONS (PWA STRATEGY)

| App | Type | Notes |
|---|---|---|
| **Customer** | Mobile-first **PWA** (Next.js) | Must faithfully reproduce the approved mobile UI/UX (Figma baseline, Customer MVP Final): installable (manifest, icons, splash), app-like navigation, bottom tab bar, bottom sheets, safe-area handling, RTL, reduced motion. Service worker for static shell, cached images and **cached voucher/reservation codes for display** (not for validation). Web Push where supported |
| **Merchant** | Responsive Next.js web | Approved Merchant Portal structure (onboarding, dashboard, profile, branches, team, Live Deals, Exclusive Deals, Vouchers, Watch & Earn, redemptions, insights, finance, support, settings) |
| **Staff** | Mobile-first **PWA** | Scan → Validate → Redeem; **online-first; no unsafe offline redemption**; clear error and retry when offline; true offline redemption is Phase 2 |
| **Partner** | One responsive Next.js app | Bank / scheme / employer through role- and type-based conditional modules; proposal-based campaigns; reports with suppression |
| **Admin** | Responsive Next.js web | All frozen Admin modules; maker-checker; MFA mandatory |

**Rendering approach:** Next.js App Router. Authenticated apps are primarily client-driven with server components for shells and static content; customer discovery pages may use server rendering for first-load speed where it helps. No server-side access to the database from Next.js: Next.js calls the API only.

**Future native path:** because all logic and contracts live in the API and shared packages, a React Native / Expo customer app can reuse `types`, `validation`, `api-client`, `localization` and `analytics`, and the same API with bearer-token authentication. No backend redesign is needed (API supports cookie sessions for web and bearer tokens for native).

### 6.1 PWA constraints and mitigations (genuine limitation check)
| Concern | Reality (verify at build start) | Mitigation |
|---|---|---|
| **Web push on iOS** | Works only for installed (home-screen) PWAs on recent iOS versions; permission and install friction | In-app notification feed, SMS for critical events (OTP, reservation expiry optional), email for receipts; install prompt education; measure opt-in |
| **Camera scanning (Staff)** | Browser camera access works over HTTPS; QR decoding may rely on a JS library where native barcode APIs are missing | Use a proven decoding library; typed-code fallback; device matrix test on staff phones |
| **Video playback and view qualification (Watch & Earn)** | Page Visibility and media events are available; autoplay, background and fullscreen behaviour vary by browser | Server-driven qualification using visibility/heartbeat events; strict foreground rule; real-device QA; adaptive streaming via provider |
| **Screen wake for QR codes** | Wake Lock API support varies | Large high-contrast QR, brightness hint, simple fallback copy |
| **Geolocation** | Permission prompts per browser; accuracy varies | Manual area picker (already designed); never block browsing |
| **App-store presence and deep links** | No store listing; links open in browser or installed PWA | Marketing links, install guidance; native app can come later |
| **In-app browsers (social apps)** | Limited PWA features | Detect and prompt to open in the system browser |
| **Apple Pay / payment sheets on web** | Depends on PSP and domain verification | Card-form/hosted payment and redirect flows as baseline; wallet options per PSP |
| **Performance on low-end devices** | JS bundle size matters | Performance budgets, code splitting, image optimisation, route-level lazy loading |
No limitation found so far that blocks the pilot. If real-device QA shows one (for example web push opt-in too low to support reservation reminders), the first response is mitigation, then a native wrapper for the customer client; the API already supports it.

---

## 7. BACKEND (NestJS)

- **Layering per module:** controller (HTTP, DTO validation, auth guards) → service (business rules, transactions) → repository (Prisma access). Domain rules live in services and small pure domain classes, covered by unit tests.
- **Validation:** shared schemas from `packages/validation` applied at the controller boundary; unknown fields rejected on commands.
- **Cross-cutting (Nest guards, interceptors, filters):** authentication, tenant/permission guard, idempotency interceptor, rate limiting, audit interceptor helpers, request id, error mapping to stable error codes, locale resolution, response shaping (permission-aware fields).
- **Transactions:** Prisma interactive transactions for multi-step commands (reserve, checkout, redeem, post journal). Isolation level chosen per command; atomic conditional updates preferred over long locks.
- **Events:** in-process domain events (Nest event emitter) plus **outbox rows written in the same transaction**; a worker publishes them to subscribers.
- **Jobs:** worker process consumes queues (section 10).
- **OpenAPI:** generated from controllers/DTOs; drives `api-client` and contract tests.
- **Configuration:** environment validated at boot (`packages/config`); business parameters come from the System Configuration module, not environment variables.
- **Health:** liveness, readiness, dependency checks; graceful shutdown (finish in-flight jobs).

---

## 8. DATABASE APPROACH (PostgreSQL + Prisma)

| Topic | Approach |
|---|---|
| **Source of truth** | PostgreSQL. Redis and analytics aggregates are derived or temporary |
| **ORM** | Prisma for schema, migrations and typed data access. One Prisma schema file set in `apps/api`, organised by module with clear naming; module access boundaries enforced in code |
| **Where Prisma is not enough** | Spatial columns and queries (PostGIS), partial unique indexes, check constraints, triggers, role privileges, text-search indexes, partitioning. Use **hand-written SQL inside Prisma migrations** and **raw queries** for these, kept in a small number of well-tested repository methods. *(Confirm current Prisma support for these at build start.)* |
| **Relational modelling** | Normalised where relationships matter (organisation, branch, membership, roles, campaign state, ledger, eligibility); pragmatic denormalisation for read paths (counters, snapshots); JSON used only for bilingual content blocks, rule definitions and targeting definitions |
| **Tenancy** | One database; every tenant-owned row carries `org_id` (and `branch_id` where relevant); a Prisma client extension/repository base adds the scope filter automatically; services additionally assert permissions; **automated tenant-isolation tests** run in CI. Postgres row-level security may be added later as defence in depth (design does not depend on it) |
| **Ledger** | Append-only tables; the application database role has **insert/select only**; balanced journals verified by service and by a periodic check job |
| **Money** | Integer halalas |
| **IDs and time** | UUIDv7; UTC timestamps; Riyadh display |
| **Localisation** | Bilingual content columns or an `i18n` JSON structure on the owning row; **no duplicate rows per language** |
| **Reporting hooks** | Analytics events and aggregate tables separate from OLTP tables; partner reports read only aggregates |
| **Migrations** | Versioned, forward-only in production, expand-then-contract; run in CI against a clean database and a restored snapshot; automated before deploy with approval in production |
| **Backups** | Managed automated backups, point-in-time recovery, **tested restore** |
| **Performance** | Indexes defined with the model; slow-query logging; connection pooling sized for the API and worker |
Details: `DEALDASH_DATA_MODEL.md`.

---

## 9. SEARCH AND LOCATION (PostgreSQL + PostGIS)

- Branch coordinates stored as geography points with a spatial index; **nearby search** by distance, **radius filtering**, **city and area filtering**, map-bounds queries for map discovery.
- **Text search:** PostgreSQL full-text search over bilingual titles, merchant names and categories (Arabic and English configurations; trigram similarity for tolerant matching). *(Verify Arabic text-search configuration quality in the first discovery sprint; fallback is trigram plus normalised Arabic text.)*
- **Discovery queries** combine: text, merchant, category, location, product type (Live, Hot, Voucher, Watch & Earn), eligibility state, open/live status, filters and sorting. Ranking is **rules-based** (distance, freshness, ending soon, availability, eligibility match) with weights in configuration.
- Caching: short-lived caches for home feed pieces per area and category (Redis or in-process); invalidated on publish/pause events.
- **Upgrade path (documented, not built):** if search relevance or scale demands it, add a dedicated search service fed by the outbox events; Discovery stays behind one interface so the switch is internal. Triggers listed in section 25.

---

## 10. REDIS, QUEUES AND JOBS

**Redis is used only for:** background-job queue (for example BullMQ; alternative: a Postgres-backed queue such as pg-boss if the team prefers one fewer service, decision TA-05), rate limiting, OTP throttling counters, short-lived caches, idempotency key cache and coordination of non-authoritative short-lived state. **Redis never holds authoritative stock, balances, reservations, vouchers or points.** Loss of Redis must not corrupt data (it may delay jobs and reset counters; jobs are reconstructed from database state).

**Jobs (worker process):**
| Job | Trigger |
|---|---|
| Reservation expiry and inventory release | Scheduled per reservation and sweep every minute |
| Campaign activation and expiry (Live, Hot, Voucher, Watch & Earn) | Scheduled at start/end times |
| Voucher expiry and expiry reminders | Daily and scheduled |
| Eligibility expiry (employer, card reconfirmation if on) | Daily |
| Employer reverification reminders | Daily |
| Notifications (send, retry, digest) | Events and schedules |
| Settlement preparation and statement generation | Schedule and manual trigger |
| Watch & Earn budget checks and unused-balance handling | Frequent and at campaign end |
| Reward holds release and expiry | Frequent |
| Payment reconciliation | Daily |
| Reporting aggregation and suppression data refresh | Hourly/daily |
| Outbox publishing | Continuous |
| Data retention sweeps | Daily |
Retries with backoff, **dead-letter queue** with an Admin-visible failure list, idempotent handlers.

---

## 11. EXCLUSIVE DEAL INVENTORY AND CONCURRENCY

Per-branch inventory lives in an **allocation row per (Exclusive Deal, branch)**. Safe patterns (PostgreSQL only):

| Operation | Pattern |
|---|---|
| **Reserve** | One transaction: check eligibility, restrictions, per-customer limit and active-reservation cap; **atomic conditional decrement** of `available` (`WHERE available >= qty`) on the allocation row; insert reservation (hold from configuration snapshot) and code; write audit and outbox. If zero rows updated → `OUT_OF_STOCK`. Unique/guard constraints stop duplicate active reservations where configured |
| **Hold expiry** | Job selects expired `reserved` rows with row locks (skip-locked), moves each to `expired`, returns units to `available` in the same transaction, exactly once (state guard on the update) |
| **Cancellation** | Customer or merchant cancel: state guard `reserved → cancelled`, increment `available`, same transaction |
| **Redeem** | State guard `reserved → redeemed` (compare-and-set); unique constraint on successful redemption per reservation; counters updated in the same transaction |
| **Inventory edits by merchants** | Increase allowed (guardrails); cannot reduce below reserved + redeemed |
| **Pause / suspend** | New reservations rejected by deal-state check inside the same transaction |
Invariants (tested by concurrency tests): `reserved + redeemed + available = total`; no negative stock; no double expiry; no double redemption. **No distributed locks or extra infrastructure.** Hold duration is configuration (initial default 30 minutes), snapshotted onto each reservation.

---

## 12. DOMAIN DESIGN NOTES

### 12.1 Vouchers (dedicated commerce and financial domain)
Voucher definition (face value, selling price, inventory, validity, branches, terms, eligibility), **purchase** (stock hold, order, PSP payment), **ownership** (account-bound, not transferable in MVP), **QR/code**, **validity**, **redemption** (full value only), **refund** (full, before redemption, configurable window), **expiry**, **merchant payable** and **settlement eligibility**. MVP accounting treatment: sale recorded immediately in the ledger; merchant amount becomes **settlement-eligible on successful redemption** (accrual point configurable). Partial redemption, gifting and promo codes are Phase 2. Voucher-fund legal treatment: **VK-05 / VK-16 open**.

### 12.2 Watch & Earn (separate advertising/reward campaign domain)
Video asset, **pre-funded campaign budget**, paid-view quantity, targeting, geography, qualifying view, completion, still-watching check (where configured), frequency rules, daily/account/device caps, reward issue, **reward hold and reversal**, **budget exhaustion**, **unused campaign balance** (separately identifiable, treatment configurable, VK-08), fraud signals. **Merchant campaign charge and customer reward are separate configurable concepts**: the merchant never sets the reward; DealDash controls reward economics; **no CPV, margin or reward value is hard-coded**. The server alone decides qualification.

### 12.3 Rewards
Reward account and **append-only reward ledger**: earn, hold, release, reverse, redeem, expire, adjust. **Non-cash, non-withdrawable, non-transferable.** No point-to-SAR conversion is hard-coded; catalogue and valuation are configuration. Admin adjustments need reason, reference and maker-checker above threshold; fraud holds supported.

### 12.4 Eligibility engine (one reusable engine)
Rule sets of conditions over customer attributes combined with **AND / OR (and NOT)**; supported conditions: public, geography, issuing bank, card product, card tier, network (Visa, Mastercard, Amex, mada, configurable), employer, customer segment, campaign-specific. **A customer may qualify by more than one route.** Evaluated: in discovery (visible, locked-unlockable, hidden), before reservation, before voucher purchase, and at redemption where rules require current eligibility. Rule syntax is never exposed in any UI; the Partner builder generates rule sets. Partner configuration is effective-dated and DealDash-verified.

### 12.5 Card eligibility and privacy
**No PAN, CVV, last-4 or first-6; no unnecessary sensitive card data.** The customer selects issuer → product → tier. Approved limited **BIN/IIN metadata** exists only on the partner configuration side where approved. **A card is never labelled "verified"** without a real verification mechanism. The attribute model carries `level` and `source` so that **issuer API, PSP-token or scheme verification** can be added later with no redesign.

### 12.6 Reviews
Signed-in customers only. **Verified** indicator only when DealDash can evidence an eligible merchant interaction (voucher redemption, redeemed Exclusive Deal reservation, controlled-offer redemption, future tracked transactions); **Watch & Earn alone never qualifies**; community reviews allowed without the label when moderation permits; moderation and reporting under DealDash control.

### 12.7 Reporting privacy
Partner reporting is **aggregated by default** from aggregate tables only; configurable **small-cohort suppression (pilot setting 10)** with **merged-remainder** handling so hidden values cannot be inferred by subtraction; eligible reach shown as rounded ranges; no customer-level data by default. Value and legal basis: **VK-12**.

### 12.8 Fraud / risk
**Rule-based, no ML in MVP.** Signals for duplicate accounts, OTP abuse, employer-verification abuse, card-eligibility abuse, reservation abuse, voucher fraud, QR/redeem abuse, Watch & Earn abuse, reward abuse, refund abuse and merchant/staff abuse. Decision outputs: **ALLOW, BLOCK, FLAG**, with holds on rewards and restrictions on accounts; appeals through Support Cases.

---

## 13. AUTHENTICATION, AUTHORISATION, TENANCY

### 13.1 Authentication (provider-neutral layer)
The Identity module defines an **authentication-provider interface** (credential verification, challenge issuance, identity linking). MVP providers: **mobile OTP** (customer and staff), **email + password with MFA-ready TOTP** (merchant and partner users), **strong authentication with mandatory MFA** (admin). Future providers (**Google, Apple, enterprise SSO, identity federation**) plug in as providers and link to the same user and role model; business modules depend only on the resulting authenticated actor.
- **Employer work-email OTP is separate from login**: it creates a verification attribute, not a session.
- **Sessions:** web apps use **secure, httpOnly, same-site cookies** with CSRF protection and short-lived access plus rotating refresh; the same API accepts **bearer tokens** for a future native client. Sessions are revocable; device records support abuse controls.
- OTP: TTL, attempts, resend limits and cooldown are configuration; throttled per number, device and IP (Redis counters; persistent lockouts in the database).

### 13.2 Authorisation
**RBAC combined with organisation and branch scope**, enforced at the **API/backend** (never only in the UI). Roles from the frozen designs:
Customer; **Merchant:** Owner, Admin, Finance, Campaign Manager, Staff (branch manager variants as designed); **Partner:** Admin, Campaign Manager, Benefits Manager (Eligibility Manager), Analyst, Finance Viewer, Read-only; **DealDash:** Super Admin, Operations, Merchant Management, Partner Management, Support, Finance, Risk/Compliance, Marketing/Campaign Operations, Analyst.
- A permission guard checks `(permission, org, branch)` for every route; responses omit fields and actions the actor cannot use.
- **Maker-checker** for sensitive finance and admin actions through a pending-change object.
- Break-glass admin access time-boxed and audited.

### 13.3 Multi-tenancy
One database, scoped access. Merchant A can never reach Merchant B's private data; Bank A never Bank B's; Employer A never Employer B's; DealDash staff see only what their role permits. Mechanisms: `org_id`/`branch_id` on rows, scope filters injected by the repository layer, service-level permission checks, **cross-tenant negative tests in CI** (every endpoint is exercised with a foreign tenant's identifiers and must return not-found or forbidden), and no tenant identifiers accepted from clients without verification against the session.

---

## 14. PAYMENTS (PROVIDER ABSTRACTION)

A `PaymentProvider` interface (initiate, query, capture/confirm where applicable, void, refund, parse and verify webhook, reconcile report) with one adapter per PSP. Business modules talk only to the Payments module.
Flows: **initiate → pending → success | failure → retry → refund → reversal**; **webhooks** signature-verified, stored with unique provider event id, processed asynchronously, safe against duplicates and out-of-order delivery; **idempotency keys** on initiation and refund; **reconciliation** job compares provider reports to the ledger and queues exceptions for Finance, with no silent correction.
Only a verified webhook (or server-side status query) changes an order to paid. **No card data touches DealDash**: hosted fields, redirect or provider SDK only. We do not claim PCI certification; the integration style is chosen to minimise scope and the PSP's requirements are followed. Final PSP, Merchant of Record, voucher-fund treatment, licensing, VAT and settlement treatment: **VALIDATE-KSA / founder decision**.

---

## 15. QR AND REDEMPTION SECURITY

- Customer-visible QR contains a **secure redemption token** (opaque reference with key id, nonce, optional expiry and signature), **never an internal sequential id** and no personal data.
- Validation checks: instrument state, **branch**, validity window, **one-time use**, staff scope, **customer eligibility where rules require current eligibility**, replay protection (nonce, state transition), duplicate protection (unique constraint plus compare-and-set).
- **Redeem is an idempotent command** (idempotency key per scan attempt); every attempt and outcome is recorded; audit written.
- Typed-code fallback is rate-limited; no "use latest customer code" shortcut exists.
- **Online-first Staff PWA:** no offline redemption in MVP; offline shows a clear error and retry.

---

## 16. NOTIFICATIONS

One Notification module with channel adapters: **push (web push), in-app, SMS, email**. Templates in English and Arabic with versioning; **transactional vs marketing** separation; per-user, per-category preferences; consent records; frequency caps; **delivery log**, retry and failure handling; provider webhooks update delivery status. Provider choice per channel remains open.

---

## 17. FILES AND VIDEO

- **Object storage** for merchant images, campaign media, merchant and partner documents, support evidence and review evidence where appropriate. **Signed upload URLs**, type and size validation, content-type sniffing, **malware/security scanning step** (quarantine → scan → release; managed scanning service or equivalent), private buckets for documents with short-lived signed read URLs, access logging, per-tenant path prefixes and access control.
- **Video: managed provider** (or object storage plus a CDN/video-delivery service): upload, transcoding where supported, adaptive playback, **signed/private URLs where required**, analytics hooks. **No custom video infrastructure.** Provider open (TA-20).

---

## 18. ANALYTICS EVENTS AND AUDIT

### 18.1 Analytics events
A separate **structured event layer** (contracts in `packages/analytics`, ingestion endpoint, event table). Events: impression, detail view, merchant page view, save, directions click, reservation created / expired / redeemed, voucher purchase, payment result, voucher redemption, video view, qualified video view, reward issued, campaign state change, eligibility unlock. Operational logic never reads analytics events; aggregation jobs build daily aggregates. **No data warehouse programme** in MVP; an export path is documented for later.

### 18.2 Audit log
Append-only audit store (actor, role, organisation, action, entity, timestamp, previous and new state where relevant, reason, source/device/IP). Audited: authentication, role changes, merchant and partner approval, eligibility changes, campaign edits and approval, payment and refund, redemption, reward adjustments, settlement, admin decisions. Insert-only database privileges; reads restricted; no PAN, CVV, OTP, password or token content.

---

## 19. LOCALISATION
English and Arabic, LTR and RTL; **Plus Jakarta Sans** (English), **IBM Plex Sans Arabic** (Arabic); logical CSS properties; message catalogues in `packages/localization`; Western digits and Gregorian dates by default; bilingual merchant/partner content fields (publication requires both); notification, legal and receipt templates per language. RTL and Arabic visual tests for key screens.

---

## 20. SECURITY

TLS everywhere; encryption at rest via managed infrastructure plus application-level encryption for restricted fields; managed **secret management**; secure cookies/tokens; strict input validation; authorisation and tenant isolation at the API; rate limiting and **OTP abuse controls**; CSRF/XSS protection (cookie sessions use CSRF tokens; strict content security policy; output encoding); **secure file uploads**; **webhook signature validation**; idempotency; admin MFA; safe QR generation; audit; **secure logging** (no secrets or personal data); dependency and secret scanning in CI; penetration test before the pilot. **No PCI certification claim.**

---

## 21. RELIABILITY, ENVIRONMENTS, CI/CD, TESTING

- **Reliability:** automated backups with **tested restore**; deployment **rollback**; job retries and dead-letter handling; idempotency for API, payments and redemption; webhook retries; health checks; application monitoring, error tracking and alerting; kill switches (feature flags) per product.
- **Environments:** Local, Development, Staging, Production. Lower environments use **seed and anonymised data only**; no casual production data copies.
- **CI/CD (simple):** on pull request: lint, typecheck, unit tests, integration tests (Postgres service container), build, dependency/secret checks, contract/OpenAPI diff. Deploy: development auto; staging controlled; production approved. Preview environments optional.
- **Testing:** unit; integration; API; end-to-end; **permission and tenant-isolation tests**; **payment webhook tests**; **reservation concurrency tests**; **redemption idempotency tests**; **Watch & Earn duplicate-reward tests**; Arabic/RTL visual tests where practical; accessibility tests for key screens; reporting suppression (differencing) tests; ledger invariant tests.

---

## 22. HOSTING (not locked)

Hosting provider and region are **not locked** until Saudi data-residency and regulatory requirements are validated (**VK-25**). Architecture is **portable**: containerised API/worker, managed PostgreSQL with PostGIS, managed Redis, object storage, CDN, managed logging/monitoring, infrastructure as code. **No Kubernetes.**

| Option | Description | Notes |
|---|---|---|
| **Preferred** | Managed container/app hosting + managed PostgreSQL (PostGIS) + managed Redis + object storage + CDN, in a **region that satisfies the validated residency requirement** (an in-Kingdom region or provider if required) | Simplest operations for a lean team |
| Alternative A | A Saudi-based cloud or hosting provider with managed or self-managed Postgres | If residency requires; may need more ops effort |
| Alternative B | Global cloud region outside the Kingdom for staging and development only | Never for production data until VK-25 allows |
| Alternative C | Simple virtual machines with containers and managed backups | Lowest cost; more ops; fallback |
**Dependency:** the production region and provider depend on VK-25. Development and staging can start on any provider with synthetic data; migration is straightforward because of containers, standard Postgres and IaC.

---

## 23. EXTERNAL SERVICES (not vendor-locked)

| Service | Required before development | Required before staging | Required before pilot |
|---|---|---|---|
| **Payment provider (Saudi-compatible)** | Shortlist and sandbox request (long lead) | Sandbox integration | Production account, licensing, settlement agreement (VK-16/05) |
| **SMS OTP** | Provider shortlist | Test sender and sandbox | Registered sender identity and production volume (lead time to verify) |
| **Email** | – | Transactional provider (sandbox) | Verified domain, SPF/DKIM, production |
| **Web push** | – | Push keys and service worker | Production keys; opt-in measured |
| **Maps / geocoding** | – | Provider account | Production quota and billing |
| **Video delivery** | Provider shortlist | Sandbox/test account | Production plan, signed URLs |
| **Object storage + CDN** | – | Buckets and CDN | Production with lifecycle and access policies |
| **Monitoring / error tracking** | Choose tool | Wired in CI/staging | Alert routing and on-call |
| **Hosting** | Dev environment | Staging environment | Production in validated region (VK-25) |
| **Security testing** | – | – | Penetration test vendor booked early |
| **Arabic content QA, legal/compliance** | Engage early | Ongoing | Sign-offs |

---

## 24. PILOT CAPACITY ASSUMPTIONS (planning only, adjustable, not forecasts)

| Dimension | Assumption |
|---|---|
| Registered customers | 5,000 to 20,000 |
| Daily active customers | 1,000 to 4,000 |
| Peak concurrent users | 300 to 1,000 |
| Merchants / branches | 50 to 150 merchants; 100 to 400 branches |
| Active campaigns | 300 to 800 (all products) |
| Exclusive Deal burst | One deal receiving ~300 reservation attempts in 60 seconds; stock 50 to 200 |
| Voucher transactions | 200 to 1,000 purchases/day; peak 20/minute |
| Redemptions | Up to 1,500/day; peak 30/minute |
| Watch & Earn | 10,000 to 50,000 qualified-view attempts/day; peak 20 view starts/second |
| Notifications | Up to 50,000 messages/day (push/in-app), SMS limited to OTP and critical |
| Storage | Under 1 TB media in the pilot |
A single API instance pair, one primary PostgreSQL with a replica or managed HA, and a small Redis comfortably cover this range; load tests validate the concurrency scenarios.

---

## 25. WHAT WE DELIBERATELY DO NOT BUILD (with triggers to revisit)

| Excluded | Revisit when |
|---|---|
| Kubernetes | Need for many independently scaled services or multi-team deployment complexity |
| Microservices estate | A module needs independent scaling/ownership (for example view ingestion above sustained thousands of events/second) |
| Kafka / event streaming | Cross-service event volume or replay needs that the outbox + queue cannot serve |
| Elasticsearch / OpenSearch | Proven relevance problems or catalogue size/latency beyond PostgreSQL (for example p95 discovery above target after tuning) |
| Custom video infrastructure | Never expected; managed only |
| ML / recommendations | After data volume and product proof; Phase 3 |
| Data lake / warehouse | Analytics needs beyond aggregates and exports |
| Multi-region active-active | Expansion beyond one country or availability targets above single-region DR |
| Native apps for every portal | Portals remain web; native customer app only if PWA limitations are proven |
| Service mesh | Not applicable without microservices |

---

## 26. DECISIONS REGISTER

| ID | Decision | Status |
|---|---|---|
| TA-01 | Modular monolith; no microservices | **CLOSED (founder)** |
| TA-02 | TypeScript, Node.js + NestJS | **CLOSED** |
| TA-03 | PostgreSQL + PostGIS, Prisma | **CLOSED** |
| TA-04 | Next.js + React, monorepo, PWA-first (no native for pilot) | **CLOSED** |
| TA-05 | Queue framework: BullMQ on Redis (default) vs pg-boss | Open, low impact (default BullMQ) |
| TA-06 | Search: PostgreSQL/PostGIS, no search engine | **CLOSED** |
| TA-07 | Monorepo tooling (pnpm + Turborepo default) | Default; confirm in sprint 1 |
| TA-08 | Validation/schema library shared FE/BE (Zod default) and OpenAPI generation approach | Default; confirm in sprint 1 |
| TA-09 | REST/JSON + OpenAPI | Recommended |
| TA-10 | Hosting provider and region | **Open (VK-25)** |
| TA-13 | PSP selection | **Open (VK-16, FDR-44)** |
| TA-14 | SMS, email, web push, maps providers | Open, no lock-in (adapters) |
| TA-20 | Video provider | Open |
| TA-21 | Error tracking / monitoring tools | Open, low impact |
| TA-22 | Design-system implementation (CSS approach, component base) | Decide in sprint 1 within `packages/ui` |
| TA-23 | Team composition and hiring of 1 to 2 additional engineers (Build Plan) | **Founder decision** |

---

## 27. VALIDATE-KSA IMPACT ON ARCHITECTURE

| VK | Architectural handling |
|---|---|
| Merchant of Record, PSP/payment licensing, voucher-fund treatment (VK-05, VK-16) | Payment abstraction; ledger with distinct account families; model-neutral |
| VAT and e-invoicing (VK-03) | Tax fields on order lines, ledger entries and statements; invoice template versioning |
| Refund requirements; voucher expiry and value treatment (VK-04) | Configurable refund window and expiry policy; separate expiry ledger event |
| Unused campaign balance (VK-08) | Distinct ledger entry type |
| Data retention, privacy, deletion (VK-11, VK-15) | Retention policy table, deletion workflow, field encryption, legal-hold flag |
| **Data residency (VK-25)** | Portable hosting; region chosen after validation |
| Card/BIN handling (VK-13) | No PAN/CVV/last-4; limited metadata partner-side only |
| OTP/SMS (sender, consent, cost) | SMS adapter, throttling, templates, delivery tracking |
| Device fingerprinting | Device records kept minimal and configurable; no invasive fingerprinting by default |
| Rewards legal classification and expiry (VK-17) | Separate non-cash ledger; configurable expiry |
| Advertising rules; sponsored labelling (VK-07, VK-10) | Content moderation workflow, labelling fields, kill switches |
| Brand/logo usage (VK-14, VK-21) | Asset approval status on partner/merchant logos |
| Merchant KYB; e-signature (VK-18, VK-19) | Document store, risk-based review states, agreement versioning |
| Consumer complaint timelines (VK-24) | Case SLA timers and exportable records |
| Reviews (VK-20); consent (VK-23); claims (VK-01); attributes (VK-06) | Moderation tooling; consent records; guardrails; restricted attributes |
No legal conclusions are made; every item is configurable or isolated behind an interface so a validated answer does not force a redesign.

*End of Technical Architecture v0.2. No production code was written.*


---

## Addendum (Oct 2026) — Subscription engine architecture

Detail: `SUBSCRIPTION_LICENSING_ENTITLEMENT.md`.

- `apps/api/src/subscription` (global `SubscriptionModule`): `PlanService` (catalog, versions, price book, add-ons), `PricingResolver`
  (rate → promotion → version / book → discount → waiver, version keys), `SubscriptionService` (assign, accept, lifecycle, renewals, trials,
  summary), `AmendmentService` (preview / propose / accept / apply / applyDue, maker-checker), `UsageService` (resource counts, period
  meters, billable events), `BillingEventService` (Phase 5 hook), `SignalService` (Phase 4 outbox), `CommercialAccessService` (twelve-step
  explain, no side effects), `policy.ts` (enforcement policy resolution, period bounds), `FINANCIAL_STATUS_PROVIDER` (swappable).
- `platform/entitlement.service.ts` resolves effective entitlements (plan + override + add-on, legal-entity scope) and enforces
  `requireNewExposure`, `requireWithinLimit`, `assertLiveCampaignOpen`, `requireProduct`, `requireFeature`.
- Hooks in products: branches and team (limits, new exposure), commercial governance (campaign activation, billing trigger), watch
  (qualified view usage, live-campaign gate), Exclusive Deals and vouchers (reservation / checkout gate, redemption usage, voucher commission),
  master-data import (bulk rows), risk reversal (voids pending usage events). Redemption paths never call the new-exposure gate.
- Concurrency: period meters advance by a conditional `UPDATE … WHERE value + qty <= limit` (HARD) inside a transaction keyed by the usage
  event's unique idempotency key; billing events and signals are unique by key.
- Integrity in the database: CHECK constraints on every vocabulary; triggers for frozen published versions, append-only acceptances and usage
  events, and billing-event immutability.
- Scheduled job `subscription.run_due` (hourly, idempotent per slot).
- Configuration keys: `commercial.enforcement`, `commercial.signals`, `commercial.trial`, `commercial.metrics`, `commercial.campaign_billing`.
- UI: shared `packages/app-shell/src/subscription/subscription-views.tsx` (`PlanUsageWorkspace`, `SubscriptionAdminWorkspace`), merchant
  `/plan`, admin `/subscriptions`; `formatAmount` for non-SAR currencies.


## Addendum (Oct 2026) — Phase 4 / Phase 5 architecture

- Modules: `VisibilityModule` (projector, metrics, reporting, targets, alerts, early warnings, operations centre), `BillingModule`
  (finance access, billing accounts / PO / FX, invoicing, receivables, reconciliation; imports `FinanceModule`), `AiModule` (provider,
  service, evaluation; resolves product services through `ModuleRef`). All in the existing NestJS monolith.
- Background jobs on the existing job table (idempotency key per time slot; disabled under NODE_ENV=test): `visibility.analytics` (1 min),
  `visibility.alerts` (5 min), `visibility.digest` (hourly), `billing.daily` (hourly slot: expire quotations, mark overdue, billing run).
- Analytics is a projection with watermarks and a 2-minute overlap (no dual writes, no message bus); aggregation is SQL
  INSERT … SELECT … ON CONFLICT. Revisit triggers: event volume beyond Postgres aggregate refresh windows, or near-real-time needs below a
  minute.
- `FINANCIAL_STATUS_PROVIDER` now resolves to `ReceivablesFinancialStatusProvider` (`platform.module.ts`); consumers unchanged.
- The AI provider is an interface; the built-in provider is deterministic and keeps all data in the platform. A hosted model can be added
  behind the same interface; governance, tools, audit and metering do not change.
- Database guards: append-only triggers (analytics, AI), finance-document freeze trigger, invoice-line guard, allocation no-delete, CHECKs
  for every new vocabulary.
- Shared UI: `packages/app-shell/src/{visibility,billing,ai}`; dictionaries `packages/localization/src/dictionaries.phase45.ts`.

## Addendum (Oct 2026) — Market / country configuration architecture

`MarketService` (master, lifecycle, availability, market resolution), `MarketConfigService` (effective-dated tax / invoice / settlement /
policy versions with second-approver approval, providers, validation register, resolvers) and `MarketReadinessService` (activation gate)
live in the global PlatformModule next to the existing CountryService, ScopeService and EntitlementService. Hooks into existing code (no
redesign): `EntitlementService.requireProduct` (market availability), Live Deal submission, `PricingService.resolve` (market-aware pricing
and tax), `CommercialService` (campaign market, ledger-currency guard), `InvoicingService` (tax rules per line, invoice configuration at
issue), `BillingEventService` (market of the billed party), AI governance (AI availability per market). Configuration:
`markets` (available statuses, default market, default pricing markets, campaign ledger currencies).
<!-- stage7-addendum -->
## Addendum (Oct 2026) — Stage 7 architecture

`PartnersModule` (apps/api/src/partners): PartnerAccessService (tenant, scope, modules = type profile ∩ entitlements, authorized
markets, ingestion rule), onboarding / readiness, team, network (master data + IngestService), programmes (eligibility engine),
campaigns (shared Exclusive / Voucher engines via an in-process `partnerContext` that only this service sets; CommercialService),
benefits, dashboard (MetricsService). Hooks into shared code (additive): TenantService / AccessScopeService honour the partner context;
commercial adapters take the creator as owner; CommercialService accept / approve / pay for partners and entitlement on the owner;
EligibilityService accepts financial institutions / corporates; LoyaltyRulesService lets a partner fund points on an active merchant's
campaign; InboxService partner tasks; ImportService field mapping and template; TeamService.accept creates partner users. Partner app
(port 3004) with module-aware navigation (AppShell `hiddenKeys`).

<!-- stage7-founder-decisions -->
## Stage 7 founder approval and decisions (2026-10-10): APPROVED AND FROZEN

Shared-code hooks added for the decisions (additive): MerchantWatchService.create records creator / sponsor from the in-process partner
context and never auto-publishes a partner-owned budget; WatchFundingService posts funding, consumption, credit-back and close-out to the
budget owner and refuses merchant funding of a sponsor-owned budget; WatchCommercialAdapter names the budget owner as commercial OWNER;
CommercialService.assertEntitled resolves the owner through the product adapter; the eligibility engine's `trustedLevel` treats an
unevidenced ISSUER_VERIFIED card attribute as declared; PartnerNetworkService.createOffer / pendingPublication / decidePublication use
IngestService and the existing provenance record.

## Addendum (Oct 2026) — Stage 8 architecture
New Nest module `apps/api/src/ops` (adjustments, settlement, reconciliation, risk, restrictions, reviews, SLA, support, data requests,
reports) consuming the shared engines; `RestrictionCheckService` (global, @Optional) hooked where new exposure starts; delivery
tracking inside the existing notifications service; jobs ops.sla (5 min), ops.notifications (1 min), ops.restrictions (5 min),
ops.risk (15 min). Configuration key `operations` (zod schema, versioned SystemConfiguration). New tool:
`pnpm --filter @dealdash/api db:catalog:sync` syncs permissions / role matrix / create-only defaults on an existing database without the
development seed.
## Stage 8 founder approval (2026-10-10): APPROVED AND FROZEN
Stage 8 Operational Gap Closure is founder approved and frozen (docs/STAGE8_OPERATIONAL_GAP_CLOSURE.md). B8 closed (partner "Add a merchant" Stage 7
compatibility fix, now part of the frozen Stage 7 baseline); B9 monitored, not a regression. Pre-pilot items B1–B7 remain open for Stage 9 /
pilot readiness; VALIDATE-market items remain central. Stage 9 not started.
