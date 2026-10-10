# DEALDASH BUILD PLAN

Version 0.2 (lean startup replan; draft for approval) · 2026-10-07
Scope: how the frozen MVP is built by a **lean startup team** to a **controlled Riyadh pilot**, preserving all four products (Live Deals, Exclusive Deals, Vouchers, Watch & Earn). **Planning document only; no code.**
Companions: `DEALDASH_TECH_ARCHITECTURE.md` v0.2, `DEALDASH_DATA_MODEL.md` v0.2, `DEALDASH_API_ARCHITECTURE.md` v0.2.

> **Superseded:** the v0.1 plan (about 56 weeks, about 15 people, native-app-capable customer client, ten sequential stages) is **no longer the target**. It is kept only as context. The approved target is the **16 to 24 week** lean plan below, with the honest capacity assessment in section 3.

> **All estimates are planning estimates (about ±30%), built bottom-up from the frozen screen and module counts and shaped by the leverage in section 2. They are not commitments.** They must be recalibrated after Sprint Group 1 using measured velocity.

---

## 1. WHAT IS BEING BUILT (frozen scope, unchanged)

| Surface | Delivery | Frozen scope |
|---|---|---|
| Customer | Mobile-first **PWA** (Next.js) | 26 core screens plus states/sheets (Customer MVP Final) |
| Merchant | Responsive Next.js | 21 core screens |
| Staff | Mobile-first **PWA** (online-first) | 6 core screens |
| Partner | One responsive Next.js app | 14 core pages (bank, scheme, employer) |
| Admin | Responsive Next.js | 31 pages |
| Backend | **One NestJS modular monolith** | 29 domain modules + supporting modules |
Roughly **100 screens** and **29 modules**, with four products that each have their own lifecycle. Phase 2 items stay out (Play & Win, gifting, promo codes, deposits, partial redemption, pooled inventory, Employee Pass QR, Google/Apple sign-in, Follow/Like, Boost, student eligibility, card verification, automated payouts, partner self-publishing, offline redemption, native apps).

---

## 2. HOW THE LEAN PLAN GAINS SPEED (leverage that is built in)

1. **One language and one repo**; shared types, validation schemas and a **generated API client** so a backend change surfaces as a compile error, not a bug.
2. **PWA instead of native apps**: one customer codebase, no store reviews, same Next.js skills as the portals.
3. **One backend, one database, no distributed infrastructure.**
4. **One design system package** (tokens, RTL-safe components, patterns already frozen in the five design sets) shared by all five apps.
5. **Pattern reuse across portals**: shell, list/detail/workbench templates, tables, tabs, drawers, status chips, wizards and the permission-aware controls are built once; most of the ~70 portal screens are compositions.
6. **Config-driven generic admin pages** for list/detail/queue screens where the designs use the same template (T1 to T7).
7. **Managed services and provider adapters** (PSP, SMS, email, push, maps, video, storage) instead of custom infrastructure.
8. **Frozen designs and rules**: no discovery work during build; changes via change notes.
9. **Parallel workstreams** with clean module boundaries (section 7).
10. **Phase 2 stays out** and "pilot depth" operations: semi-manual settlement payouts and reconciliation, basic reports.
11. **Test automation from week 1** so integration and hardening are not a late wall.
Not assumed: any speed-up from AI-assisted coding. If the team uses it, treat as upside.

---

## 3. HONEST ASSESSMENT: DOES 16 TO 24 WEEKS WORK?

### 3.1 Effort model (engineer-weeks, pilot depth, including tests and integration)
| Sprint group | Scope | Estimate (engineer-weeks) |
|---|---|---|
| SG1 | Foundation | 12 |
| SG2 | Merchant + Admin foundation | 9 |
| SG3 | Live Deals + Discovery + customer shell | 16 |
| SG4 | Exclusive Deals + reservations + Staff PWA | 11 |
| SG5 | Vouchers + payments + ledger core + redemption + refunds | 18 |
| SG6 | Watch & Earn + rewards + fraud basics + video | 16 |
| SG7 | Partner Portal + Eligibility + employer OTP + partner reports | 14 |
| SG8 | Operations: settlements, finance, support, reviews, risk, reporting, notifications, remaining Admin | 16 |
| SG9 | Pilot hardening (integrations finalised, security, load/concurrency, device QA, UAT, pen test fixes) | 12 |
| **Total** | | **≈ 124 engineer-weeks** (QA engineer and part-time DevOps are additional) |

### 3.2 What the lean team can deliver
| Plan | Engineers | Effective capacity (about 85% productive, lead partly non-coding) | Duration to go/no-go |
|---|---|---|---|
| **Plan L (lean as specified)** | 5 (1 lead + 3 full-stack + 1 frontend/PWA) | ≈ 4.0 engineer-weeks/week | **≈ 30 to 32 weeks** |
| **Plan L+ (recommended)** | 7 (1 lead + 4 full-stack + 2 frontend) | ≈ 5.6 engineer-weeks/week | **≈ 22 to 24 weeks** |
| Plan L− (scope trimmed inside operations) | 5 | ≈ 4.0 | ≈ 26 to 28 weeks if Admin/ops depth is reduced further (see 3.4) |
| 16-week variant | 10 to 11 engineers | ≈ 8 | Roughly the old team size; **not recommended** |

**Conclusion:** the stated lean team can deliver the full four-product pilot in roughly **30 weeks**, which is **outside** the 16 to 24 week target. **The target is reachable at 22 to 24 weeks by adding two engineers (one backend/money-focused full-stack, one frontend/portal-focused).** 16 weeks is not realistic with all four products and five surfaces.

### 3.3 The exact critical-path blockers
1. **Engineering capacity on the money chain**: Ledger → Payments → Voucher purchase → Redemption → Refund → Settlement is sequential, correctness-critical and about 45 engineer-weeks of backend work. With 2 backend-capable engineers this chain alone takes ≈ 20+ weeks and cannot be parallelised further without more backend people.
2. **External lead time for the Saudi payment provider** (selection, contract, KYB, sandbox, production approval) and the **SMS sender registration**: these start at week 0 and can gate SG5 (payments in staging) and the pilot. Their duration is outside engineering control and should be treated as a risk until confirmed.
3. **Open VALIDATE-KSA items that gate launch** (payment model, VAT, refunds/expiry, retention, residency): they do not block building but can block go-live.
No technology blocker was found: the stack, PWA strategy and monolith are suitable.

### 3.4 Levers if the founder keeps the team at 5
- Reduce Admin and Partner depth to **generic templates only** (no bespoke polish), accept manual operations (settlement payout, reconciliation) and basic reports for the pilot: saves about 8 to 10 engineer-weeks (Plan L−, ≈ 26 to 28 weeks).
- Launch the pilot with **fewer merchants and branches** (reduces hardening and support load, not build effort).
- Start the **PSP and SMS processes immediately**.
- Stage the pilot: **internal and friendly users first**, then invited merchants, which lets hardening overlap the tail of SG8.
- Do **not** remove products, security or privacy controls to save time.

### 3.5 Effect of adding 1 or 2 engineers
| Addition | Effect |
|---|---|
| **+1 backend/money-focused full-stack** | Splits the money chain (ledger/payments vs vouchers/redemption/settlement) and moves Watch & Earn earlier; saves about 4 to 5 weeks |
| **+1 frontend/portal-focused** | Runs Customer PWA and portals fully in parallel; saves about 2 to 3 weeks |
| **Both** | Plan L+: **22 to 24 weeks** |
| Specialist short engagements (security, payments, Arabic QA) | Do not change the capacity model but protect quality and avoid rework |

---

## 4. TEAM ASSUMPTION

### 4.1 Plan L (as specified)
| Role | Count | Notes |
|---|---|---|
| Technical Lead / Senior Full-Stack | 1 | Architecture, money/ledger design, code review, ~70% hands-on |
| Full-Stack Engineers | 3 | Backend-leaning (commerce), backend-leaning (money/engagement), portal-leaning |
| Frontend / PWA Engineer | 1 | Design system, customer PWA, staff PWA |
| QA / Automation Engineer | 1 | Test harness, E2E, concurrency, tenant isolation, RTL/accessibility checks |
| DevOps / Cloud | Part-time (≈ 0.2 to 0.3 FTE) | Environments, CI/CD, monitoring, backups |

### 4.2 Plan L+ (recommended): add two
+1 Full-Stack (backend/money) and +1 Frontend (portals).

### 4.3 Temporary specialist support (not core hires)
Security review and penetration testing (pre-pilot); payment integration advisor (PSP adapter and reconciliation review); native Arabic UX/content reviewer (weeks of effort at SG3 and SG9); Saudi legal/compliance advisor (VALIDATE-KSA workstream); optional design support for the ten new customer screens and component library polish.

### 4.4 Product and design
Product definition and UX are substantially complete (frozen); the founder acts as product owner with fast decisions and acceptance. A designer on short engagements handles the design-system implementation details and RTL polish.

---

## 5. SPRINT GROUPS (scope, exit criteria)

Two-week sprints; groups overlap (section 6). Each group ends with a working demo in staging.

### SG1: Foundation
Monorepo (apps and packages), app shells for all five frontends and the API, **design system v1** (tokens, core components, RTL), Prisma + PostgreSQL + PostGIS setup, **API skeleton with OpenAPI → generated client**, **Identity** (mobile OTP, portal login, MFA-ready), sessions/cookies/CSRF, **RBAC with organisation/branch scope**, tenancy scaffolding with isolation tests, **Audit**, **System Configuration + feature flags**, **localisation (AR/EN, RTL, fonts)**, files upload skeleton, notification adapter skeleton, queue/worker skeleton, **CI/CD**, environments (dev, staging), observability basics.
**Exit:** customer signs in by OTP in staging, Admin sees the customer and the audit entry; tenancy tests pass; PWA installable shell; AR/EN switch works; generated client in all apps.

### SG2: Merchant and Admin foundation
Merchant onboarding (registration, documents, click-accept agreement), **Merchant, Merchant Branch, Merchant Staff** modules, users/roles, Admin merchant workbench (review queue, decisions with bilingual reasons, suspend/reactivate, trust level), Admin users/roles/config/audit views, customer masked view.
**Exit:** a merchant applies, DealDash approves, merchant invites staff and adds branches with coordinates; all audited.

### SG3: Live Deals and Discovery
**Live Deals** module and Merchant builder (bilingual, branches, media, structured terms, preview), **Campaign Approval/guardrails** (auto-publish vs review), **Discovery** (PostGIS nearby, categories, text search, map pins, filters), customer **onboarding wizard** (OTP, email, DOB/18+, gender optional, location, interests, consents, resume), customer Home, Explore (Live), deal detail, merchant page, saved items, notifications feed, **eligibility visibility** (public and geography; locked/hidden logic scaffolding), guest read-only mode, analytics events layer v1.
**Exit:** a merchant publishes a Live Deal (auto or reviewed); a customer finds it nearby in Arabic and English, RTL correct; discovery events recorded.

### SG4: Exclusive Deals
**Exclusive Deals** builder with per-branch inventory, **Reservations** (atomic reserve, configurable hold default 30 min, expiry job, cancel, no-show strikes and restriction), customer Hot list/detail/reserve sheet/code with timer, **Staff PWA** (OTP login, scan/validate/redeem, history; online-first), **Redemptions** module core, Merchant allocations and reservation views.
**Exit:** 300 concurrent reservation attempts on 100 units produce exactly 100 reservations; expiry returns stock once; staff redeems once, second scan says already redeemed.

### SG5: Vouchers and payments
**Payments** abstraction + first PSP adapter (sandbox), webhooks (idempotent, out-of-order safe), **Ledger core** (accounts, journals, sale/redemption/refund/reversal, fee rules versioned, accrual configurable), **Vouchers** and **Voucher Purchases** (stock hold, order, ownership, QR token, validity, expiry job), **Refunds** (full, before redemption), customer voucher detail/checkout/order status/My Deals/code screens, merchant voucher builder and redemption list, Admin orders/payments/refunds/exceptions.
**Exit:** a sandbox purchase yields an active voucher; duplicate webhooks never double-activate; staff redeems; ledger balanced after every scenario; refund before redemption works.

### SG6: Watch & Earn and Rewards
**Watch & Earn** (campaign builder, pre-funded budget through Payments and Ledger, rate cards and qualifying policy configuration, targeting, caps), **view pipeline** (tokens, events, qualification, still-watching, frequency/device caps, budget hard cap), **Rewards** (reward ledger, holds/release/reverse, catalogue config, redemption, expiry, admin adjustments with maker-checker), **Fraud/Risk basics** (rules, flags, blocklists, ALLOW/BLOCK/FLAG), managed **video** integration, customer Watch & Earn hub, reels player, still-watching, reward unlocked, rewards, redeem, activity; Merchant W&E campaigns; Admin W&E monitoring and risk queue.
**Exit:** a funded campaign cannot exceed budget under concurrent views; invalid views excluded; held reward released or reversed; no point-to-SAR display anywhere.

### SG7: Partner and Eligibility
**Partner, Bank, Card Scheme, Employer** modules; **Eligibility engine** (attributes, rule sets with AND/OR/NOT, evaluation at discovery, reservation, purchase and redemption); customer **My benefits** (issuer → product → tier selection, employer work-email OTP, reverification, locked-offer component, requirement panel); Partner Portal (onboarding, dashboard, eligibility rule builder, type modules, merchants, proposals and change requests, users, organisation, support); Admin partner workbench and domain/BIN verification; **partner reports with suppression service**.
**Exit:** employer onboarded, domain verified, employee verifies by OTP and sees unlocked offers; bank proposes products/tiers and a rule; suppression differencing tests pass; no PAN/CVV/last-4 anywhere (schema and log scans).

### SG8: Operations
**Settlements** (runs, statements bilingual with tax fields, manual payout recording, adjustments, negative carry-forward, disputes), reconciliation exceptions workflow, **Support Cases** (customers, merchants, partners, appeals), **Reviews** (Verified evidence, reporting, moderation), notifications completeness (all templates, preferences, frequency caps, delivery log), reporting (merchant Insights, Admin dashboards), account deletion and data request workflow, remaining Admin pages, Finance views.
**Exit:** a sandbox merchant statement reconciles to ledger and PSP; all notification templates exist in AR and EN; deletion workflow anonymises and retains required records; Admin pages complete per permission matrix.

### SG9: Pilot hardening
Production PSP and provider cut-over rehearsals, **OTP/SMS, email, maps, push, video** production setup, Arabic and RTL QA with native reviewer, accessibility checks, **real-device QA** (customer and staff phones, iOS and Android browsers, PWA install and web push behaviour), security review and **penetration test with fixes**, **load and concurrency tests** (Hot burst, discovery, W&E streams), backup/restore drill, runbooks and on-call, UAT with pilot merchants, launch checklist and kill-switch rehearsal.
**Exit:** go/no-go checklist (section 10) green.

---

## 6. SCHEDULE, PARALLEL PATHS AND DEPENDENCIES

### 6.1 Timeline (weeks from start; both plans)
| Group | Plan L+ (7 engineers) | Plan L (5 engineers) | Depends on |
|---|---|---|---|
| Stage 0: decisions, vendors started, repo/environments, design-system plan | W0 to W2 | W0 to W2 | founder decisions; vendor processes start |
| SG1 Foundation | W1 to W4 | W1 to W5 | Stage 0 |
| SG2 Merchant + Admin foundation | W3 to W7 | W4 to W9 | SG1 identity/RBAC |
| SG3 Live Deals + Discovery | W5 to W10 | W6 to W13 | SG1, merchant approval from SG2 |
| SG4 Exclusive Deals + Staff | W9 to W13 | W11 to W17 | SG3 deals, redemption core |
| SG5 Vouchers + payments + ledger | W9 to W16 (adapter prep from W6) | W12 to W21 | SG3, PSP sandbox, ledger |
| SG6 Watch & Earn + Rewards | W11 to W18 | W15 to W24 | SG5 ledger/payments (budget funding), media |
| SG7 Partner + Eligibility | W12 to W19 | W17 to W25 | SG3 (eligibility visibility), SG2 |
| SG8 Operations | W15 to W21 | W20 to W28 | SG5, SG6, SG7 |
| SG9 Pilot hardening | W19 to W24 | W26 to W32 | feature-complete |
| **Go / no-go** | **≈ W24** | **≈ W31 to W32** | |
| Soft launch (internal → invited) | W24 to W26 | W32 to W34 | |

### 6.2 Parallel workstreams (Plan L+ ownership)
| Stream | Owner(s) | Content |
|---|---|---|
| **A. Backend commerce** | FS-1, FS-2 | Merchants, branches, Live/Exclusive Deals, reservations, discovery, redemption core, vouchers |
| **B. Backend money and engagement** | Lead, FS-3 | Ledger, payments, settlements, rewards, Watch & Earn, fraud |
| **C. Customer PWA and Staff PWA** | FE-1 (+ FS as needed) | Design system, onboarding, discovery, deals, checkout, codes, rewards, Watch & Earn, staff scan |
| **D. Merchant, Admin, Partner web** | FE-2, FS-4 | Portals on shared patterns; generic admin templates |
| **E. Integrations, security, DevOps** | Lead + DevOps (part-time) + specialists | PSP, SMS, email, push, maps, video, CI/CD, hardening, pen test |
| **F. QA automation** | QA | Test harness from week 1; tenant isolation; concurrency; idempotency; E2E; RTL/accessibility |
| **G. Vendor and validation lead times** | Founder + advisors | PSP contract and onboarding, SMS sender, hosting region (VK-25), legal items, pen-test booking, Arabic QA |
(Plan L: streams A and B share fewer hands; D partly merged with C; hence longer windows.)

### 6.3 Critical path (Plan L+)
```
Stage 0 decisions → SG1 Foundation → SG2 Merchant approval → SG3 Live Deals + Discovery
     → [PSP sandbox + Ledger core] → SG5 Vouchers/Payments/Redemption/Refund → SG8 Settlements/Reconciliation
     → SG9 Hardening + pen test → Go/no-go
```
Parallel to the critical path: Exclusive Deals (SG4), Watch & Earn/Rewards (SG6), Partner/Eligibility (SG7), most of Admin and portals, customer onboarding and rewards screens, Staff PWA, notifications. External critical items: **PSP onboarding and SMS sender registration (start W0)**, hosting region decision.

### 6.4 Dependency summary
- Eligibility visibility (basic) is needed in SG3; full Eligibility in SG7.
- Staff PWA and redemption core ship with SG4 (reservations) and extend to vouchers in SG5.
- Watch & Earn needs Ledger and Payments (budget funding) from SG5 but can start campaign/view work in SG6 earlier using the ledger skeleton.
- Settlements need redemption events and the Ledger (SG5) and are completed in SG8.
- Partner reporting needs analytics events (from SG3) and suppression service (SG7).

---

## 7. GATES

| Gate | When | Criteria |
|---|---|---|
| **G0 Decisions** | W2 | Stack confirmed (done), team plan (L or L+) chosen, hosting approach for dev/staging, PSP and SMS processes started, VALIDATE-KSA tracker live |
| **G1 Skeleton** | End SG1 | OTP login, RBAC, tenancy tests, audit, CI/CD, PWA shell, AR/EN/RTL |
| **G2 First publish** | End SG3 | Merchant publishes Live Deal; customer discovers it |
| **G3 First paid voucher** | End SG5 | Sandbox purchase → redeem → ledger balanced → refund tested |
| **G4 Engagement** | End SG6 | W&E campaign end-to-end with budget cap and fraud holds |
| **G5 Feature complete** | End SG8 | All frozen screens and modules functional at pilot depth |
| **G6 Go / no-go** | End SG9 | Section 10 checklist |

Quality gates for every sprint: lint, typecheck, unit and integration tests, tenant-isolation tests, no hard-coded business values, AR/EN strings, audit events, feature flag, demo.

---

## 8. EXTERNAL SERVICES AND VENDOR DEPENDENCIES

| Service | Before development | Before staging | Before pilot | Lead-time note |
|---|---|---|---|---|
| Payment provider | Shortlist, request sandbox, start commercial/KYB | Sandbox integration | Production account, settlement agreement, licensing check | **Long and uncertain; start W0** |
| SMS OTP | Shortlist | Test sender | Registered sender identity, production volume | **To be verified; start W0** |
| Email | – | Provider sandbox | Domain verification, SPF/DKIM | Short |
| Web push | – | Keys, service worker | Production keys | Short |
| Maps / geocoding | – | Account | Production quota | Short |
| Video delivery | Shortlist | Test account | Production plan | Medium |
| Object storage + CDN | – | Buckets and CDN | Production policies | Short |
| Monitoring / error tracking | Choose | Wired in | Alert routing | Short |
| Hosting | Dev env | Staging | **Production region per VK-25** | Depends on validation |
| Penetration testing | – | – | Booked early | Scheduling lead time |
| Arabic QA, legal/compliance | Engage | Ongoing | Sign-offs | Ongoing |
No vendor is locked by this plan; each sits behind an adapter.

---

## 9. ENVIRONMENTS, CI/CD, TESTING (summary)
Local, Development (auto-deploy), Staging (controlled), Production (approved). Seed and anonymised data only in lower environments. Pull-request pipeline: lint, typecheck, unit, integration, build, dependency/secret checks, OpenAPI diff. Mandatory suites: **permission/tenant tests, payment webhook tests, reservation concurrency tests, redemption idempotency tests, Watch & Earn duplicate-reward tests, ledger invariants, suppression differencing tests**; RTL visual and accessibility checks for key screens. Detailed in Tech Architecture section 21.

---

## 10. PILOT GO / NO-GO CHECKLIST
| Area | Criteria |
|---|---|
| Functional | Each product passes end-to-end in staging; staff redemption proven on real devices; guest/onboarding/under-18 paths verified |
| Money | PSP production cut-over rehearsed; reconciliation run; ledger balanced; refund and reversal drills; first settlement dry run |
| Privacy and security | Pen test findings closed; no card data anywhere; partner reports aggregate-only; tenant isolation green; backup restore drill done |
| Performance | Concurrency and load scenarios from Tech Architecture section 24 pass with margin |
| Localisation | Native Arabic review complete; RTL QA passed |
| Operations | Runbooks, on-call, support coverage in Arabic and English, merchant onboarding playbook, fraud playbook, kill switches rehearsed |
| Compliance | Launch-gating VALIDATE-KSA items signed off or risk-accepted by the founder |
| Commercial | Pilot merchants and partners contracted; fee rules, rate cards and reward rules configured |
| PWA | Real-device matrix passed; install and web push opt-in behaviour measured; no blocking limitation |

---

## 11. TECHNICAL RISKS

| ID | Risk | Mitigation |
|---|---|---|
| R-01 | **Lean team capacity vs scope** (the main schedule risk) | Plan L+ recommendation; generic admin templates; measure velocity after SG1; protect critical path |
| R-02 | PSP/SMS onboarding lead times | Start W0; adapters; sandbox first; alternative provider shortlist |
| R-03 | **Money correctness defects** (ledger, refunds, webhooks) | Ledger invariants, idempotency, reconciliation, payment advisor review, drills |
| R-04 | Exclusive Deal concurrency | PostgreSQL atomic updates, concurrency tests from SG4, load test |
| R-05 | **PWA limitations** (iOS web push, camera scan, background video, wake lock) | Early real-device spikes in SG1/SG3/SG4; fallbacks (in-app, SMS, typed code); native wrapper only if proven necessary |
| R-06 | Watch & Earn qualification integrity in a browser | Server-driven timeline validation, still-watching checks, device limits, fraud rules, real-device QA |
| R-07 | Arabic text search and RTL quality | Native reviewer early; trigram fallback; RTL visual tests |
| R-08 | Tenant-isolation mistakes | Repository-level scoping, negative tests per endpoint in CI |
| R-09 | Prisma gaps (PostGIS, partial indexes, locking) | Raw SQL inside migrations and a few tested repository methods; confirm in SG1 |
| R-10 | VALIDATE-KSA changes a rule | Configuration and model-neutral design; weekly tracker |
| R-11 | Hosting region forces a late move | Portable containers and standard Postgres; decide before staging holds real data |
| R-12 | Scope creep and unfrozen design changes | Change notes; Phase 2 list enforced |
| R-13 | Key-person dependency in a small team | Pairing on money/ledger, documentation, code review, bus-factor review at G1 |
| R-14 | Video cost and playback variety | Managed provider, duration and size limits, early cost model |
| R-15 | Third-party outages | Adapters, retries, degraded modes, runbooks |

---

## 12. DECISIONS NEEDED FROM THE FOUNDER
| ID | Decision | Needed by | Recommendation |
|---|---|---|---|
| **TA-23** | **Team plan: L (5 engineers, ≈ 30 to 32 weeks) or L+ (7 engineers, ≈ 22 to 24 weeks)** | G0 (W2) | **L+**, or L− with reduced operations depth if hiring is not possible |
| TA-13 | PSP selection process owner and shortlist | Start W0 | Begin immediately |
| TA-10 | Hosting for dev/staging now; production region after VK-25 | W2 / before staging data | Portable managed stack |
| TA-14 | SMS, email, push, maps provider shortlist | W0 to W6 | Adapters; no lock-in |
| TA-20 | Video provider | Before SG6 | Managed provider |
| BP-02 | Pilot scale targets (confirm or adjust Tech Architecture section 24) | Before SG9 load tests | Conservative defaults |
| BP-03 | Pilot guardrail posture (more manual review at the start) | Before SG3 end | More manual review initially |
Everything else is configuration.

---

## 13. VALIDATE-KSA DEPENDENCIES
| Item | Needed by | Gates launch? |
|---|---|---|
| VK-25 data residency / hosting | Before staging holds real data | Yes (production region) |
| VK-16 / VK-05 payment model, Merchant of Record, voucher funds, licensing | PSP choice (W0 to W6), confirm before SG5 go-live | Yes |
| VK-03 VAT, e-invoicing | SG5 receipts, SG8 statements | Yes for production receipts |
| VK-04 refund window, voucher expiry and value | SG5 | Yes (customer terms) |
| VK-08 unused campaign balance | SG6 | Before Watch & Earn launch |
| VK-11 / VK-15 privacy, retention, deletion | SG8 | Yes |
| VK-12 cohort threshold | SG7 | Before partner reporting is live |
| VK-13 card/BIN handling | SG7 | Confirms design |
| VK-17 rewards classification and expiry | SG6 | Before rewards launch |
| OTP/SMS rules, device fingerprinting | SG1 / SG9 | Yes for SMS sender; fingerprinting kept minimal |
| VK-07 / VK-10 advertising and sponsored rules | SG6 | Before Watch & Earn launch |
| VK-14 / VK-21 brand and logo use | SG7 | Before partner logos shown |
| VK-18 / VK-19 merchant KYB, e-signature | SG2 | Before merchant onboarding scale |
| VK-20 reviews, VK-23 consent, VK-24 complaints, VK-01 claims, VK-06 attributes | SG3 to SG9 | Per feature |
All stay open; unresolved items default to the safer configuration.

---

## 14. RECOMMENDED FIRST CODING STAGE
**Sprint Group 1 (Foundation), starting with a one-week "Sprint 0" spike block:**
1. Repo, tooling and CI/CD skeleton; environments (dev, staging) as code.
2. **Spikes to remove risk early:** (a) Prisma + PostGIS + partial indexes + raw SQL migration workflow; (b) generated OpenAPI → typed client pipeline; (c) PWA install, web push and camera QR scan on real iOS and Android devices; (d) Arabic full-text and RTL rendering with the two fonts; (e) tenancy scoping and isolation-test harness.
3. Then the SG1 scope: Identity, RBAC with org/branch scope, audit, configuration/flags, localisation, design system v1, app shells.
Deliverable at the end of the stage: the walking skeleton (G1).

---

## 15. TRACEABILITY
| Frozen document | Built in |
|---|---|
| Customer MVP Final | SG1, SG3, SG4, SG5, SG6, SG7, SG8, SG9 |
| Merchant Portal | SG2, SG3, SG4, SG5, SG6 |
| Staff design | SG4, SG5 |
| Partner Portal | SG7, SG8 |
| Admin Portal | SG2 to SG8 progressively |
| Business Rules | Per module; configuration from SG1 |
| Data Model / API Architecture | Implemented per sprint group |

*End of Build Plan v0.2. No production code was written.*


---

## Addendum (Oct 2026) — Build status: Subscription, licensing & entitlement engine

- Sequencing: Stages 0–6 built; shared-platform Phases 1–3 built (Phase 3 approved and frozen). The subscription / licensing / entitlement
  engine is built as the **prerequisite to Phase 5** and awaits founder approval. FD-24 CLOSED.
- **Not started:** Phase 4 (alerts; consumes `CommercialSignal`), Phase 5 (billing & finance; consumes `CommercialBillingEvent` and replaces the
  financial-status provider), Stage 7 (partner portal screens incl. partner subscription view).
- Before pilot launch: assign an explicit plan to every real business (Admin → Subscriptions → Readiness); native Arabic review of the
  subscription copy; confirm add-on prices (unpriced add-ons are arranged by DealDash).
- Verification commands: API e2e `pnpm --filter @dealdash/api test`; browser `node tooling/e2e/subscription-browser.mjs`
  (API + merchant + admin running, `SEED_USER_PASSWORD` set).

### Launch-readiness tracking (founder approvals, Oct 2026)

- Subscription / Licensing / Entitlement architecture **FOUNDER APPROVED AND FROZEN**; Stage 4 Exclusive Deal commercial regression fix
  **FOUNDER APPROVED**.
- LR-SUB-01 Every real pilot / production Business Account has an explicit Merchant Plan or Enterprise Contract / Licence (hard rule).
- LR-SUB-02 Native Arabic review of all copy (including subscription screens) before pilot / production.
- LR-SUB-03 Add-on prices: configurable / to be commercialized; none invented.
- LR-SUB-04 `ADMIN_DATABASE_URL` setup credential does not authenticate locally (development / setup configuration item). Before Stage 9:
  verify setup scripts, least-privilege credentials, no production secret in source, clean setup / migration run.
- LR-SUB-05 **CLOSED** (Oct 2026): all user-facing copy, tests, Figma / handoff and current docs use "Exclusive Deal"; remaining `hot-*` / `HotDeal*` identifiers are recorded as LEGACY INTERNAL NAME — NOT USER FACING (Master Blueprint addendum, Terminology).
- QA note: Stage 4 and Stage 6 browser journeys need a fresh seed (relative dates / times); the Phase 3 browser script pauses its QA
  earning rule at the end of each run.
- Next approved sequencing: Phase 4 (visibility / operations) and Phase 5 (billing / finance / AI), possibly in parallel. Not started.
  Stage 7 not started.- TR-01 (test reliability, monitored): the customer Watch & Earn player component test ("plays, sends heartbeats with the view token,
  then completes at the end and shows the reward") failed once under parallel `turbo` load (2026-10-09) and passed in two isolated
  re-runs. Not a product regression unless it reproduces consistently; it is monitored in every full regression and stabilised at
  the test / runtime cause if it recurs (never hidden by re-running).

## Addendum (Oct 2026) — Build status: Phases 4 and 5 (awaiting founder approval)

Built: Phase 4 visibility / operations, Phase 5 billing / finance, governed AI foundation, screens (EN / AR, RTL, phone), docs.
Stage 7 not started.

**Verification (2026-10-09)**
- API: 755 / 755 tests in 47 files (new: `visibility.e2e` 17, `billing.e2e` 19, `ai.e2e` 13).
- Packages and apps: localization 20, auth 7, app-shell 11, merchant 104, admin 85, customer 61, staff 34, partner 3, ui 14, validation 6,
  config 3, analytics 4, api-client 2.
- ESLint: 0 errors (64 pre-existing `no-explicit-any` warnings in older API test files). TypeScript: 24 / 24. Builds: API and all five apps.
- Browser (Edge): Phase 4/5 59 / 59, Phase 3 32 / 32, subscription 31 / 31, Stage 2 30 / 30, Stage 3 98 / 98, Stage 4 121 / 121
  (fresh seed), Stage 5 99 / 99, Stage 6 88 / 88 (fresh seed).
- Dev database migrated after a pg_dump backup (no reset); schema drift check empty.

**TR-01 (Watch & Earn player timing test)**: did not reproduce in this cycle (customer suite 61 / 61 in the full run and in isolation).
Still monitored; not treated as a regression.

**Issues found and fixed during this cycle** (all covered by tests now): report group names returned bilingual objects that one screen
rendered directly (crash) → localized label; a duplicated dictionary key made the invoice "Issued" column read "Document processed." →
separate key + test; AI plan / trend / target wording mixed money minor units with counts → verified-outcome counts and money formatting;
the task inbox status for resolved alerts used a value outside the allowed set → DONE; statements with a credit balance violated the
non-negative total → total = amount due, signed closing kept in the statement data; a hook-defined component broke Fast Refresh →
top-level component.

**Legacy internal names (documented technical debt, no user-facing effect)**: `HotDeal*` models / `hot-*` modules and routes for Exclusive
Deals; `*Halalas` column names (minor units in any currency); `FinanceDocument.lines` JSON on pre-Phase-5 case invoices (new documents use
`InvoiceLine`). New code uses Exclusive / minor-unit naming.

**Deferred / not in MVP (explicit)**: partner portal screens for performance, billing and the partner copilot (Stage 7; APIs exist);
L4 bounded autonomy (architecture ready, disabled); L5 (never in MVP); hosted LLM provider (interface ready); Urdu answers; write-off
(statutory confirmation); real email / push / SMS / payment / video / maps providers (mock adapters); multi-currency general ledger
(GL stays SAR).

**VALIDATE-KSA carried**: VAT / e-invoicing (ZATCA) format, numbering and QR on tax invoices; write-off and bad-debt treatment; FX rate
source of record; proforma treatment; statement retention; AI data residency and consent wording; Arabic copy native review.


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

## Addendum (Oct 2026) — Build status: Market / country configuration (awaiting founder approval)

Built on the frozen Phases 1–5 (extended, not redesigned): market master with lifecycle and maker-checker activation gate, region grouping,
per-market product availability (enforced on campaign submission / activation, Live Deals and AI), effective-dated tax / invoice /
settlement / policy configuration with second-approver approval and database-frozen versions, providers (references only), market-aware
campaign pricing and tax, invoicing with per-line tax rule versions and market invoice configuration, central validation register (VK-01..25
and the founder launch-readiness items mapped), readiness, market-scoped administration, audit history, Admin → Markets workspace (EN / AR,
RTL, phone). Stage 7 not started. Details: `docs/MARKET_COUNTRY_CONFIGURATION.md`.

**Verification (2026-10-09)**: API 777 / 777 (48 files; new `markets.e2e` 22); packages and apps all green (admin 92, merchant 104,
customer 61, staff 34, localization 21, auth 8, app-shell 11, ui 14, validation 6, config 3, analytics 4, api-client 2, partner 3);
TypeScript 24 / 24; ESLint 0 errors (64 pre-existing warnings in older API test files); builds: API and all five apps. Browser (Edge):
Markets 19 / 19, Phase 4/5 59 / 59, Phase 3 32 / 32, subscription 31 / 31, Stage 2 30 / 30, Stage 3 98 / 98, Stage 5 99 / 99, Stage 4
121 / 121 and Stage 6 88 / 88 on a fresh seed. Dev database backed up and migrated (no reset), no schema drift. TR-01 did not reproduce.

**Fixed during the cycle**: secret-reference pattern case mismatch between API validation and the database CHECK; the market test now
closes its test market (shared test database) instead of leaving it open.

**Behaviour changes to note**: the legacy countries endpoint cannot toggle `enabled`; campaign pricing in markets other than SA needs
market pricing (`PRICING_NOT_AVAILABLE`); campaigns priced in a non-SAR currency are refused (`MARKET_CURRENCY_NOT_SUPPORTED`) until a ledger
decision; invoice tax now comes only from approved market tax rules (the old `taxProfile.vatBps` JSON is no longer read — no rule was ever
configured there); market-neutral pricing-agreement tax applies only in approved default pricing markets.

**Deferred / not built (explicit)**: payout execution consuming settlement rules (later stage; resolver ready); runtime routing of payments
to real per-market providers (abstraction + selection ready, adapters are mocks); subscription / licence assignment is not gated by market
product status (admin-governed; readiness reports it); no tax rate, statutory invoice format or legal position is seeded for any market.
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
<!-- stage7-build-status -->
## Addendum (Oct 2026) — Build status: Stage 7 Enterprise Partner Portal (founder approved and frozen 2026-10-10; see below)

Built on the frozen Phases 1–5, subscription engine and Market / Country configuration (consumed, not redesigned): partner Business
Account model, onboarding / readiness lifecycle with a second DealDash approver, partner users / delegation / market scope, home
dashboard, merchant network (manual / bulk with field mapping / API) on the one ingestion pipeline, referenced vs registered
merchants, provenance and duplicate review, card programmes (BIN prefixes only) and employer programmes, eligibility rules on the shared
engine, partner-created Exclusive Deals and Vouchers on the shared engines (merchant approves its own obligations), Live Deal partner
benefits, Watch & Earn points sponsorship, shared commercial / finance / billing, performance drill-down, alerts, tasks, disputes,
the governed copilot; partner app, Admin → Partners, merchant partner-benefit decisions, customer partner extra. Stage 8 not started.
Details: `docs/STAGE7_PARTNER_PORTAL.md`, Figma: `docs/STAGE7_FIGMA_HANDOFF.md`, screenshots `docs/screenshots/stage7`.

**Verification (2026-10-10)**: API 801 / 801 (49 files; new `partner-portal.e2e` 24); packages and apps all green (partner 12,
admin 95, merchant 104, customer 61, staff 34, localization 22, auth 9, app-shell 11, ui 14, validation 6, config 3, analytics 4,
api-client 2); TypeScript 24 / 24; ESLint 0 errors (64 pre-existing warnings); builds 15 / 15. Browser (Edge, fresh test database,
generated password; development credentials untouched): Stage 7 35 / 35, Markets 19 / 19, Phase 4/5 59 / 59, Phase 3 32 / 32,
subscription 31 / 31, Stage 2 30 / 30, Stage 3 98 / 98, Stage 4 121 / 121, Stage 5 101 / 101, Stage 6 88 / 88. Dev database backed up
(`.tools/stage7/backup`) and migrated (no reset, no reseed), no drift.

**Found and fixed during the cycle**: the partner ingestion gate first placed on the shared Phase 2 import / integration routes broke
three frozen master-data tests (moved to the portal routes; FD-S7-2); rule builder sent an empty condition (400); the shared commercial
summary formatted the unit count as money (pre-existing; now a number); an Active partner was told to "complete onboarding";
seed-created sample partners were not grandfathered; two API suite files timed out only under parallel load (passed alone, 801 / 801).

**Expectation updated**: `tooling/e2e/subscription-browser.mjs` readiness check — the Stage 7 seed gives the sample bank and employer
their own agreements, so they no longer appear among businesses without one.

**Founder decisions — CLOSED (2026-10-10)** (previously blocked for founder approval):
- FD-S7-1 YES — partner-owned Watch & Earn budgets (Sponsor / Funder on the shared Watch engine; implemented).
- FD-S7-2 NO — the Phase 2 generic import / integration routes keep their frozen behaviour (no change).
- FD-S7-3 — card issuer / product / tier VERIFIED only with trusted evidence (database CHECK + engine; implemented).
- FD-S7-4 YES — partner-created / imported Live Deals with confirmed publication rights (implemented on master data / provenance).

## Stage 7 status (2026-10-10): FOUNDER APPROVED AND FROZEN

The founder approved Stage 7 subject to recording FD-S7-1 to FD-S7-4, which are closed and implemented (details:
`docs/STAGE7_PARTNER_PORTAL.md` → "Founder decisions"; migration `20270104000000_stage7_founder_decisions`, additive; development
database backed up and migrated, no reset / reseed, no drift). Re-run after the decisions (materially affected suites): API 804 / 804
(full suite), partner 15 / 15, admin 96 / 96, localization 22 / 22, TypeScript 24 / 24, ESLint 0 errors (64 pre-existing warnings);
browser on a fresh test database: Stage 7 40 / 40, Stage 6 Watch & Earn 88 / 88, Stage 3 Live Deals / eligibility 98 / 98. No
regression. Stage 7 is frozen: further changes need founder approval. **Stage 8 has not started.**

## Stage 8 status (2026-10-10): FOUNDER APPROVED AND FROZEN
Operational Gap Closure & Admin Operations built (`docs/STAGE8_OPERATIONAL_GAP_CLOSURE.md`, Figma `docs/STAGE8_FIGMA_HANDOFF.md`).
Regression (fresh test database): API 827/827 (51 files, incl. Stage 8 21 e2e + 2 unit); admin, merchant, customer, partner, staff
app suites and packages green (admin 112, merchant 109, customer 66, staff 34, partner 15, packages); typecheck 24/24; lint 0 errors (64 baseline
warnings); builds 15/15; browser Stage 8 48/48, Stage 2 30/30, Stage 3 98/98, Stage 4 121/121, Stage 5 101/101, Stage 6 88/88,
Phase 3 32/32, Phase 4/5 59/59, Markets 19/19, Subscription 31/31, Stage 7 40/40 (an intermittent partner "Add a merchant" failure is
recorded as gap B8). Development database backed up, migrated (20/20), catalog synced, no drift.
Stage 9 not started.
## Stage 8 founder approval (2026-10-10): APPROVED AND FROZEN
Stage 8 Operational Gap Closure is founder approved and frozen (docs/STAGE8_OPERATIONAL_GAP_CLOSURE.md). B8 closed (partner "Add a merchant" Stage 7
compatibility fix, now part of the frozen Stage 7 baseline); B9 monitored, not a regression. Pre-pilot items B1–B7 remain open for Stage 9 /
pilot readiness; VALIDATE-market items remain central. Stage 9 not started.
