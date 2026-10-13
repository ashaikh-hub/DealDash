# Launch Readiness — Step 1 (Revision 2): Multi-Market Infrastructure Decision Pack

Prepared 2026-10-11 after the founder update: **Pakistan is the probable first production pilot market**; Saudi Arabia, UAE and Qatar
follow. Supersedes the single-region assumption of `LAUNCH_STEP1_ENVIRONMENT_DECISION_PACK.md` (that document's Google Cloud Dammam
design is **kept** as the KSA deployment profile). **Nothing is provisioned, configured, contracted or deployed. Public launch is not
authorized.** No regulatory conclusion is drawn: open questions are `VALIDATE-PAKISTAN-*` / `VALIDATE-KSA-*` / `VALIDATE-UAE-*` /
`VALIDATE-QATAR-*`, to be entered in the existing Market validation register (`MarketValidationItem`).

Vendor facts come from public sources as of October 2026 (list at the end) and **must be re-confirmed in writing per region and per
service** before any contract. Latency figures are **not measured yet** — §5 proposes a measurement before the choice is final. Costs
are planning estimates (±50%), USD.

## 0. What the frozen platform already gives us
- **One codebase, multi-market by configuration** (Market / Country Configuration is authoritative): Pakistan already exists as market
  `PK` (PKR, `Asia/Karachi`, +92), with a founder-approved Pakistan subscription catalog. Mobile validation is international (E.164).
- **Activation gate per market** (frozen): a market cannot go PILOT while anything is MISSING — DealDash legal entity registered in that
  market, currency / language / time zone, pricing, tax treatment, invoice configuration, **non-mock payment provider**, settlement,
  terms, privacy and consent, support contact, KYB, **OTP and email providers**, and signed-off local validations.
- **Validation register** with seven placeholder topics per next market: TAX, TAX-INVOICE, CONSUMER-PROTECTION, DATA-PROTECTION,
  PAYMENTS, KYB, language review.
- **Portable runtime**: standard containers + PostgreSQL + object storage behind interfaces; no Redis; no proprietary cloud services.
- **Gaps relevant to multi-market hosting (engineering, not re-architecture):**
  1. Providers are selected **per deployment** (environment variables), not per market. A deployment hosting two markets that need
     different SMS / payment providers needs a small *provider registry keyed by market* (not needed while one deployment = one market).
  2. Languages are **English and Arabic only**. Urdu is not supported (RTL support exists; Urdu needs translation and font work).
  3. A business operating in two markets that live in **different deployments** would have its data split; group reporting across
     deployments needs an additive aggregation service later (not needed for a single-market pilot).

## 1. Architecture: global platform + market deployment profiles (regional cells)

```
                         ┌───────────── GLOBAL (shared) ─────────────┐
                         │ Codebase · CI/CD · container images        │
                         │ Cloudflare DNS / TLS / WAF / edge          │
                         │ Shared NON-production staging              │
                         │ Monitoring tooling · on-call · status page │
                         └───────────────┬───────────────────────────┘
                 market → cell routing (DNS hostnames per market / cell)
        ┌──────────────────────┼──────────────────────┐
  CELL "ME-Doha" (pilot)   CELL "KSA-Dammam" (later)   CELL "UAE" (later, location TBD)
  markets: PK (+QA later)  markets: SA                 markets: AE
  API + 5 web apps         API + 5 web apps            ...
  PostgreSQL (HA, PITR)    PostgreSQL (HA, PITR)
  storage · backups · logs storage · backups · logs
  secrets · providers      secrets · providers
```

- A **cell** is one complete production deployment of the *same* images in one location, with its own database, storage, backups,
  logs, secrets and provider credentials. Each market is **active in exactly one cell** (enforced operationally: in every other cell
  that market stays PLANNED / disabled — the existing lifecycle already supports this).
- A **deployment profile** is the per-cell set of settings: hosting region, database / storage / backup / log locations, retention,
  backup cross-border policy, and the provider credentials. Business rules per market (tax, invoicing, settlement rule, privacy and
  consent texts, retention periods, pricing) stay in **Market configuration** inside the cell's database, as today.
- Adding a market later = either *activate it in an existing cell* (if its residency answer allows) or *create a new cell from the same
  infrastructure-as-code module*. Never a new codebase.

### Deployment profile — fields per market (to be written as infrastructure-as-code variables + Market configuration)
| Field | Pakistan (pilot) | Saudi Arabia (later) | UAE | Qatar |
|---|---|---|---|---|
| Hosting region | Google Cloud Doha `me-central1` (recommended; §2) | Google Cloud Dammam `me-central2` | TBD (VALIDATE-UAE) | Doha `me-central1` (candidate) |
| Database location | same as hosting | in-Kingdom (VALIDATE-KSA-1) | TBD | Doha |
| Storage / backup / log location | same region; cross-border DR per VALIDATE-PAKISTAN-RESIDENCY | in-Kingdom; DR copy per VALIDATE-KSA-1 | TBD | TBD |
| Payment provider | Pakistani aggregator (wallets + cards + Raast) | Saudi gateway (mada) | TBD | TBD |
| Payout | manual bank / Raast transfers (pilot) | manual (pilot) | TBD | TBD |
| SMS / OTP | PTA-registered route (local entity) | Saudi provider | TBD | TBD |
| Email · push · maps | global providers (if residency allows) | same | same | same |
| Tax · invoicing · settlement · privacy · retention | Market configuration (VALIDATE-PAKISTAN) | Market configuration (VALIDATE-KSA) | VALIDATE-UAE | VALIDATE-QATAR |
| Legal / regulatory readiness | validation register + activation gate | same | same | same |

## 2. Pakistan pilot — infrastructure review
| # | Topic | Findings | Assessment |
|---|---|---|---|
| 1 | Cloud regions for Pakistan | **No AWS, Azure or Google Cloud region in Pakistan**, none announced near-term. Nearest hyperscale regions: Gulf (Google Doha, Google Dammam; AWS UAE and Bahrain; Azure UAE; Oracle UAE) and India (Mumbai, Delhi). Local Pakistani clouds exist (e.g. Data Vault Pakistan — Karachi, PTCL Smart Cloud, QCloud) | Choice is **offshore Gulf hyperscaler** vs **onshore local cloud**. India regions not recommended (cross-border sensitivity and connectivity risk — VALIDATE-PAKISTAN-RESIDENCY) |
| 2 | Managed PostgreSQL | Google Doha: Cloud SQL for PostgreSQL listed for `me-central1` (**confirm version 18 or test 17**, PostGIS, HA). Local clouds: managed PostgreSQL + PostGIS + PITR **not confirmed** — likely self-managed on VMs | Hyperscaler far less operational risk |
| 3 | Container hosting | Google Doha: Cloud Run and GKE listed at launch (a press report noted the service catalogue once lagged the announcement — **confirm current list**). Local clouds: VMs / Kubernetes of varying maturity | As above |
| 4 | Object storage / CDN | Google Cloud Storage in Doha; **Cloudflare has edge locations in Karachi, Lahore and Islamabad** (TLS terminates in-country; static assets cached in-country) | Good: the web apps' static content is served from inside Pakistan whichever origin is chosen |
| 5 | Latency | Not measured. Gulf regions are the nearest hyperscale option over submarine cables to Karachi; Lahore / Islamabad / Peshawar and mobile networks add more. Cloudflare in-country edge removes most static-asset latency; API calls still travel to the origin | **Measure before contracting** (§5) |
| 6 | Production support | Hyperscaler: paid support plans, global; local clouds: local-language, same time zone support, smaller scale | Hyperscaler + a local implementation partner if wanted |
| 7 | Disaster recovery | Doha has 3 zones (HA across zones). Region-level DR: second Google region (Dammam) — **cross-border copy needs VALIDATE-PAKISTAN-RESIDENCY and VALIDATE-QATAR / KSA host-country answers** | Zone-level HA from day one; region DR per answers |
| 8 | Pilot cost | §4 | ≈ same as the KSA pilot estimate |
| 9 | Residency / privacy | Pakistan has **no enacted comprehensive data-protection law**; a Data Protection Act draft went to consultation in Oct 2025; earlier drafts proposed tiers with **critical personal data processed only in Pakistan**. Sector rule: SBP's cloud-outsourcing framework for regulated entities (offshore material workloads of banks / designated PSOs need SBP approval) | **VALIDATE-PAKISTAN-RESIDENCY** and **-SBP**: the answer may require onshore hosting for some data, now or when the law passes → keep portability (§9) |
| 10 | Payment connectivity | Wallets dominate (JazzCash and Easypaisa: tens of millions of monthly actives); Raast instant payments (incl. P2M QR); cards via banks; aggregators offer wallets + cards + bank transfer through one API | Gateways are reachable over the internet from any region — hosting location does not constrain payments; **licensing / merchant-of-record does** (VALIDATE-PAKISTAN-PAYMENTS / -SBP) |
| 11 | SMS / OTP connectivity | Business SMS needs **PTA registration and registration with each carrier** (Jazz, Zong, Telenor, Ufone); alphanumeric senders need a **registered short code**; provider guidance states **only Pakistan-headquartered companies may send OTP over local routes**; Telenor / Ufone may show the short code instead of the brand | Needs a **DealDash Pakistani entity** (also required by the market activation gate) — VALIDATE-PAKISTAN-ENTITY / -SMS. Start registration early |
| 12 | Operational / vendor support | Same cloud as the KSA candidate → one contract, one IaC toolset, one skill set | Favours Google Cloud |

### Recommendation for the Pakistan pilot cell
- **Recommended:** **Google Cloud Doha (`me-central1`)** — Cloud Run (API min 2 instances, CPU always allocated; web apps min 1), Cloud SQL
  for PostgreSQL HA with PITR, Cloud Storage, Secret Manager, Cloud Logging in-region; **Cloudflare** in front (Karachi / Lahore /
  Islamabad edge). *Conditional on:* (a) the latency measurement in §5 being acceptable, (b) written confirmation of the service list and
  PostgreSQL version in Doha, (c) VALIDATE-PAKISTAN-RESIDENCY not requiring onshore hosting for the pilot's data.
- **Alternative A (offshore):** AWS UAE (`me-central-1`) or Bahrain (`me-south-1`) — mature service catalogue; but a second cloud next to
  the KSA (Google Dammam) plan unless KSA also moves to AWS once its Saudi region is live.
- **Alternative B (onshore, if required):** a Pakistani cloud / data centre (e.g. Data Vault Pakistan, PTCL Smart Cloud, QCloud) running
  our containers on Kubernetes / VMs with self-managed PostgreSQL + PostGIS (Patroni, WAL archiving). Lowest latency and residency-proof;
  **more operations work and risk**; managed-service and support levels to be assessed by proposal.
- **Mumbai (`asia-south1`) — alternative only under the founder's conditions** (see "Provisional founder direction" below): materially
  better measured latency, suitable provider connectivity, and VALIDATE-PAKISTAN permitting the cross-border processing. Singapore /
  Europe — avoidable latency.

## 3. Pakistan-specific provider dependencies
| Capability | Requirement | Direction (shortlist — founder selects) | Dependency |
|---|---|---|---|
| Legal entity | DealDash company registered in Pakistan | Required by the market activation gate and (per provider guidance) for OTP over local SMS routes | **VALIDATE-PAKISTAN-ENTITY** — lead time |
| Payments | Wallets (JazzCash, Easypaisa), cards, Raast P2M; hosted checkout; refunds incl. partial; signed webhooks; settlement reports | Request proposals from aggregators that unify wallets + cards + bank transfer in one API, and compare with the wallets' own gateways | Merchant account, KYB; **VALIDATE-PAKISTAN-PAYMENTS / -SBP**; adapter must support **partial refunds per method** (wallet refund behaviour to confirm) |
| Payouts | Pay merchants per settlement rule | **Manual bank / Raast transfers for the pilot** (built) | Company bank account; settlement rule values (VALIDATE-PAKISTAN-PAYMENTS) |
| SMS / OTP | Fast OTP on all four carriers; registered short code + sender | Local aggregator with direct carrier connections, or an international aggregator with local registration (LOA); consider **WhatsApp OTP as a fallback channel** (B3 fallback exists; Meta business verification) | PTA + carrier registration; **VALIDATE-PAKISTAN-SMS** (OTP rules, Do-Not-Call Register for promotional messages, consent) |
| Email | Transactional email | Same global provider (Postmark recommended) | DNS on the global domain; residency (VALIDATE-PAKISTAN-RESIDENCY) |
| Push | Web push | Standard Web Push (no vendor) | — |
| Maps | Geocoding, Urdu / English place names | Google Maps Platform (strong Pakistan coverage) | Billing account |
| Video | Only if Watch & Earn is in the pilot | Defer unless in pilot | VALIDATE-PAKISTAN advertising rules |
| Language | English (+ Urdu?) | Pilot in **English** is possible today; **Urdu needs translation + font work** | Founder decision (A0-c) |
| Billing in USD | Paying offshore cloud / SaaS bills from a Pakistani entity | — | **VALIDATE-PAKISTAN-FX** (foreign-exchange rules, card limits) |

## 4. Expected Pakistan pilot monthly cost (USD, ±50%)
| Line | Pilot (≤ 5k users) |
|---|---|
| Production cell — compute (API + 5 web apps) | 250–450 |
| Production cell — Cloud SQL HA + PITR | 300–650 |
| Production cell — storage, egress, backups | 40–120 |
| Production cell — logging / monitoring | 50–150 |
| Shared staging (§7) | 300–600 |
| Cloudflare (Pro → Business) | 25–250 |
| Email · maps · Sentry (if used) | 30–200 |
| **Infrastructure total** | **≈ 1,000–2,400** |
| SMS / OTP | per message — **quote needed** (Pakistani rates per message are expected to be lower than KSA, but carrier registration fees apply) |
| Payment fees | % per method (wallets, cards, Raast differ) — negotiate |

Alternative B (onshore) may have lower raw compute prices but adds operations effort (database administration, patching, backups) —
compare by proposal including support.

## 5. Latency and user-experience considerations
- **Measure before contracting (no provisioning needed):** run browser / CLI latency tests (public cloud ping tools) from **Karachi,
  Lahore and Islamabad**, on **each of Jazz, Zong, Telenor and Ufone mobile data** plus one fixed-line ISP, to Google Doha, Google
  Dammam, AWS UAE / Bahrain, and one onshore provider. Decision rule proposal: median API round trip ≤ 120 ms and p95 ≤ 250 ms from
  mobile networks; otherwise prefer the closer option.
- Cloudflare's in-country edge serves the web apps' static assets and terminates TLS near users (biggest win for first load).
- Pakistani users are mostly on **mobile data and mid / low-end Android**: set a performance budget (first load on 4G ≤ 3 s), keep
  images compressed (already resized server-side), test on low-end devices (UAT device matrix).
- Staff redemption must stay fast on weak networks: validation is a single small API call — measure it in UAT at real branches.
- Network instability: idempotency keys already make retries safe for purchases and redemptions.

## 6. VALIDATE-PAKISTAN items (questions for qualified Pakistani counsel / tax adviser — no answers given)
Existing register topics (seeded): **TAX**, **TAX-INVOICE**, **CONSUMER-PROTECTION**, **DATA-PROTECTION**, **PAYMENTS**, **KYB**,
language review. Proposed additional / sharpened items:
| Code | Question |
|---|---|
| VALIDATE-PAKISTAN-ENTITY | Does DealDash need a Pakistani company to contract merchants, collect payments, settle, invoice and send OTP over local routes? Registration steps and lead time |
| VALIDATE-PAKISTAN-RESIDENCY | May customer / merchant personal data, backups and logs be hosted outside Pakistan today? How would the pending data-protection law (draft tiers incl. "critical personal data") classify DealDash's data, and what transition period is expected? Is a DR copy abroad allowed? |
| VALIDATE-PAKISTAN-SBP | Does DealDash's model (collecting voucher payments, settling to merchants, reward points) make it an SBP-regulated entity (PSO / PSP / EMI) or require it to operate only through a licensed provider? If regulated, how does SBP's cloud-outsourcing framework apply to offshore hosting? |
| VALIDATE-PAKISTAN-PAYMENTS | Merchant-of-record model; holding funds before settlement; wallet / Raast refund rules; settlement rule values (cycle, reserve, cut-off, withholding) |
| VALIDATE-PAKISTAN-SMS | PTA and carrier registration, short code, OTP traffic rules, Do-Not-Call Register and consent for non-OTP messages |
| VALIDATE-PAKISTAN-TAX | Which authority taxes DealDash's fees and commissions (federal and / or provincial sales tax on services, by province of the merchant / customer); withholding on merchant payouts; registration duties |
| VALIDATE-PAKISTAN-TAX-INVOICE | Invoice format and any e-invoicing / real-time reporting obligation for DealDash's own invoices |
| VALIDATE-PAKISTAN-CONSUMER-PROTECTION | Voucher validity, refunds, cancellations, complaint handling; provincial consumer-protection rules |
| VALIDATE-PAKISTAN-POINTS | Legal nature of reward points (stored value?), expiry, liability |
| VALIDATE-PAKISTAN-PROMOTIONS | Rules for advertising discounts / promotions and sponsored video |
| VALIDATE-PAKISTAN-RETENTION | Retention periods for transaction, tax and personal data; deletion rights |
| VALIDATE-PAKISTAN-CYBER | Obligations of online service providers under cyber-crime / telecom law (records, lawful requests) |
| VALIDATE-PAKISTAN-FX | Paying offshore cloud and SaaS vendors in USD from a Pakistani entity (foreign-exchange rules, card limits) |
| VALIDATE-PAKISTAN-LANGUAGE | Must consumer terms, notices or receipts be available in Urdu? |
| VALIDATE-PAKISTAN-ECOMMERCE | Registration or policy obligations for e-commerce / marketplace platforms |

KSA items (VALIDATE-KSA-1 … 16) are **kept unchanged**; UAE and Qatar keep their seeded open questions, plus a residency / hosting-location
question each (VALIDATE-UAE-RESIDENCY, VALIDATE-QATAR-RESIDENCY — Qatar's answer also decides whether hosting *other* markets' data in
Doha raises any host-country obligation).

## 7. Staging: one shared environment or per market?
**Recommendation: A — one shared, non-production staging environment for all markets**, with these rules:
- Located in the **pilot cell's region** (Doha) so Pakistan latency, provider callbacks and region services are tested realistically.
- **Synthetic data only**; no production data is ever copied into shared staging.
- All markets are configured in it (PK, SA, AE, QA) — market behaviour is configuration, so one staging tests every profile; **provider
  sandboxes per market** (Pakistani payment / SMS sandboxes for PK; Saudi ones later). Because providers are selected per deployment
  today, staging runs the **pilot market's** providers; testing a second market's real sandboxes in the same staging needs the
  *provider registry keyed by market* (§0 gap 1) — planned before the second market, not needed now.
- **Migration rehearsal on production data** (release rule since 2026-10-11) happens in an **ephemeral rehearsal database inside the
  production cell's region and project** (restore → migrate → verify → delete), so production data never leaves its cell. This removes
  the main reason for per-market staging.
- **Market-specific staging becomes necessary only if** a market's law forbids even synthetic / test operation abroad, a provider's
  sandbox requires in-country origin IPs, or UAT for that market must use real in-country networks end-to-end. None is known for
  Pakistan today (VALIDATE-PAKISTAN-RESIDENCY to confirm).

## 8. Shared globally vs market-specific
**Shared globally:** one codebase and container images; CI/CD, release process and approvals; IaC modules; Cloudflare account (DNS, WAF,
edge — with per-market data-processing settings where required); shared staging; email provider (where residency allows); maps; error
tracking (where residency allows); monitoring tooling, dashboards, on-call and incident process; vendor management; security scanning
and pen testing (scoped per cell).

**Market- / cell-specific:** production region; database, storage, backups, log buckets and their retention; secrets and provider
credentials; payment and payout providers; SMS sender / short code and provider; tax, invoicing, settlement rule, privacy and consent
texts, retention periods, pricing (Market configuration); DealDash legal entity; support contact; country domains or redirects (later,
same brand); the market's validation register and activation state.

## 9. Is Google Cloud still the preferred overall platform?
**Yes, as primary platform — not as a lock-in.** It has regions where three of the four markets are likely to be served (Doha for the
Pakistan pilot and Qatar; Dammam for KSA), one contract, one IaC toolset, managed PostgreSQL and containers. It has **no UAE region**
(based on current public information), so the UAE cell's location is open: Doha / Dammam if VALIDATE-UAE allows, otherwise a UAE
region of another cloud (AWS, Azure, Oracle). Because DealDash runs only standard containers, standard PostgreSQL and S3-style object
storage behind interfaces, a cell can run on another cloud — or onshore in Pakistan if the law requires it — **with the same code**;
only the IaC module for that provider differs.

## 10. How KSA Dammam fits later without re-architecture
1. Apply the same IaC module with the **KSA profile** to `me-central2` → a new cell (separate project, database, storage, logs,
   secrets).
2. Deploy the **same release tag** (same images); run migrations; catalog sync.
3. Configure Saudi providers (gateway with mada, Saudi SMS) and Market configuration for SA in that cell; SA passes the activation gate
   there. In the Doha cell, SA stays PLANNED / disabled — no Saudi customer data ever exists in Doha.
4. DNS: Saudi hostnames (or the SA routing rule) point to the Dammam cell at Cloudflare.
5. Before SA goes live alongside PK: build the **provider registry keyed by market** only if a cell must host two markets with different
   providers (Dammam hosting only SA does not need it), and the **cross-cell business directory / reporting** only if one business
   operates in both PK and SA. Both are additive; nothing frozen is redesigned.

## 11. Can staging proceed before final Pakistan regulatory validation?
**Yes — with conditions.** Staging holds synthetic data only, is not public, uses provider sandboxes, and its location does not lock
production in (production can still move onshore if VALIDATE-PAKISTAN-RESIDENCY requires it — the IaC module is portable). What must
**not** proceed before the answers: production pilot provisioning with real data (needs VALIDATE-PAKISTAN-ENTITY, -RESIDENCY, -SBP,
-PAYMENTS, -SMS at minimum), payment production contracts, and the market's activation to PILOT.

## A. Founder decisions (revised)
| # | Decision | Recommendation | Now? |
|---|---|---|---|
| **A0** | **Pilot launch market** | **Pakistan** as the first controlled production pilot (probable) — confirm to start entity, SMS registration and Pakistani counsel | **Yes** |
| A0-b | Engage Pakistani counsel / tax adviser on VALIDATE-PAKISTAN items (priority: ENTITY, RESIDENCY, SBP, PAYMENTS, SMS) | Yes | **Yes** |
| A0-c | Pilot language(s) for Pakistan | English for the pilot; decide on Urdu (engineering + translation) after the pilot or if VALIDATE-PAKISTAN-LANGUAGE requires | **Yes** |
| **A1** | Platform and pilot cell | Google Cloud as primary platform; **Pakistan pilot cell in Doha**, *subject to* the latency measurement (§5) and VALIDATE-PAKISTAN-RESIDENCY; KSA Dammam profile preserved for later | **Yes** (after a 1–2 day measurement) |
| A1-b | Staging model | **One shared staging** in the pilot region, synthetic data only; ephemeral rehearsal databases inside production cells | **Yes** |
| **A2** | Domain / edge | Global DealDash domain on **Cloudflare** (edge in Karachi / Lahore / Islamabad); one brand; country domains may redirect later | **Yes** |
| **A7** | Monitoring | Provider-neutral JSON logs (already built); **logs stored in each cell's region** with per-market retention; Sentry only where the market's residency answer allows (start with in-region only for PK until VALIDATE-PAKISTAN-RESIDENCY) | **Yes** |
| **A10** | Backup / DR | Keep the approved technical targets (RPO ≤ 5 min, PITR 14 days, HA where supported, weekly verified logical backup, monthly restore drill, bad-release recovery ≤ 30 min); **location, retention and cross-border DR configurable per market** (profile field), set from VALIDATE-PAKISTAN / -KSA / -UAE / -QATAR answers | **Yes** (targets) / later (per-market values) |
| A-pay | Pakistan payment shortlist to request proposals from | Aggregators unifying wallets + cards + Raast, compared with the wallets' own gateways | **Yes** (lead time) |
| A-sms | Pakistan SMS route | Start PTA / carrier / short-code registration once the entity exists | **Yes** (lead time) |

**Can wait:** UAE cell location; Qatar activation; KSA cell activation (when SA becomes a launch market); provider registry keyed by
market and cross-cell business reporting (before a second market goes live); Redis; push vendor; video vendor (unless Watch & Earn is in
the PK pilot); payout automation; pen-test firm (book when staging is stable).

## Provisional founder direction (2026-10-11) — recorded; nothing provisioned
1. Pakistan is the probable first controlled production pilot market.
2. There is currently no Google Cloud Pakistan region.
3. **Staging:** Google Cloud Doha (`me-central1`) is the preferred candidate.
4. **Pakistan pilot production:** Google Cloud Doha is the preferred *provisional* candidate, **subject to VALIDATE-PAKISTAN**.
5. **Google Cloud Mumbai** remains an alternative only if measured Pakistan latency is materially better, payment / provider connectivity is
   suitable, and VALIDATE-PAKISTAN permits the relevant cross-border processing.
6. If formal Pakistani legal / regulatory validation requires applicable customer or sensitive data to remain in Pakistan, Pakistan
   production uses an **approved onshore hosting / provider arrangement**.
7. Portability is preserved: standard containers, PostgreSQL, portable logical backups, provider-neutral storage / provider abstractions,
   no unnecessary proprietary cloud services.
8. KSA Dammam stays the preferred KSA production candidate for the later Saudi launch.
9. Doha is kept as strategically useful for the Qatar launch.
10. **SBP cloud-outsourcing requirements are not treated as automatically applicable to DealDash** — only if DealDash falls within a
    regulated category, or a regulated partner arrangement (e.g. a bank or licensed payment provider contract) requires them.
11. VALIDATE-PAKISTAN, VALIDATE-KSA, VALIDATE-QATAR and VALIDATE-UAE are maintained separately.
12. **Validate before Pakistan production:** current personal-data protection law / status; cross-border personal-data processing;
    sensitive-data localization; payment-data handling; payment gateway structure; tax / invoicing; retention; merchant KYB; SMS / OTP
    sender requirements; bank / partner contractual requirements; whether any DealDash activity creates SBP-regulated obligations.
13. **Authority of sources:** blogs, vendor articles and news reports (including those listed below) are **orientation only** and are never
    the basis of a regulatory conclusion. Answers must come from official Government of Pakistan, MoITT, PTA, SBP, FBR, provincial revenue
    authorities and other competent-authority sources, plus formal legal advice where required, recorded as evidence in the Market
    validation register.

## Founder decisions (2026-10-11) — Pakistan pilot / staging
1. **Staging cloud — APPROVED:** prepare staging in Google Cloud Doha (`me-central1`). Staging only; **not** approval of Doha as the
   Pakistan production region (that stays subject to the Doha vs Mumbai latency results, VALIDATE-PAKISTAN, provider connectivity and the
   legal / data-residency assessment). No production deployment.
2. **Doha vs Mumbai latency — APPROVED:** objective comparison from representative Pakistani networks (DNS / connect, TLS, API
   response, stability, packet loss where measurable). No fabricated results; where external test locations / accounts are needed, the
   test plan and dependency are documented.
3. **Pakistan legal / tax adviser — REQUIRED BEFORE PRODUCTION**, does not block staging. Scope prepared; no adviser selected or engaged
   without founder approval.
4. **Pakistan legal entity — NOT created / restructured yet.** Structure determined by legal / tax review first; the information and
   documents providers and merchants are likely to require are prepared in the meantime.
5. **Payment providers — SHORTLIST / SANDBOX ONLY.** No production contract or credentials; no provider assumed acceptable without
   validation.
6. **SMS / OTP — APPROVED DIRECTION:** a suitable local SMS / OTP provider or aggregator is the primary OTP channel. WhatsApp OTP is
   **not** a launch dependency. Selection and production sender registration remain separate founder / external actions.
7. **Pilot language — APPROVED:** customer app **English + Urdu**; Merchant, Merchant Staff, Partner and Admin may stay English for the
   pilot. Localization-ready architecture; Arabic stays for KSA / UAE / Qatar (never removed). Urdu AI / customer-support quality tested.
8. **Domain / naming — APPROVED PRINCIPLE:** one global brand; `app.`, `merchant.`, `partner.`, `admin.`, `api.<domain>`; staging
   clearly separated and access-controlled; domain ownership not assumed until confirmed.
9. **Staging budget — APPROVED:** hard ceiling **USD 600 / month**, target ≤ USD 300; budget alerts at 50 / 70 / 90 / 100 %; no HA or
   production-scale resources in staging unless a specific readiness test needs them.
10. **Watch & Earn — APPROVED for the Pakistan pilot** (funding, points economics, qualification / fraud rules, acknowledgement, budget
    controls, redemption, financial visibility preserved); managed-video provider behind the existing abstraction; options prepared, no
    production commitment.
11. **Engineering go-ahead — APPROVED** for staging deployability (IaC, environment configuration, storage / provider abstractions, CI/CD
    staging hook, health, secret references, staging database / migrations, monitoring, protected routing, Urdu customer localization,
    latency tooling, provider sandbox readiness). Not permitted: public launch, production deployment, real production payment
    credentials, irreversible vendor commitments, regulatory assumptions, production customer data, destructive changes to frozen
    Stages 1–9.

## Sources (public, accessed 2026-10-11 — orientation only, not regulatory authority)
- Pakistan cloud providers / no hyperscaler region: [Data Vault — Top 10 Cloud Service Providers in Pakistan (2026)](https://datavault.com.pk/top-10-cloud-service-providers-in-pakistan/)
- Pakistan data-protection status: [Digital Policy Alert — Data Protection Act 2025](https://digitalpolicyalert.org/change/16682-data-localisation-requirement-in-data-protection-act-2025), [ITIF — Pakistan's cross-border data transfer regulation](https://itif.org/publications/2025/05/16/pakistan-cross-border-data-transfer-regulation/), [Mondaq — Why Pakistan is stalling on data protection](https://www.mondaq.com/privacy-protection/1716564/why-pakistan-is-stalling-on-data-protection-a-nations-digital-dilema)
- SBP cloud outsourcing: [ProPakistani — SBP criteria for outsourcing to cloud](https://propakistani.pk/2023/01/18/sbp-sets-criteria-for-outsourcing-regulated-entities-workload-to-cloud-providers/amp/), [SBP BPRD Circular 2023](https://www.sbp.org.pk/bprd/2023/C1.htm)
- Payments landscape: [Simpaisa — Pakistan's digital payment revolution 2026](https://www.simpaisa.com/blogs/pakistans-digital-payment-revolution-2026-stats-trends-whats-next/), [Simpaisa — JazzCash integration 2026](https://www.simpaisa.com/blogs/how-to-accept-jazzcash-payments-on-your-website-step-by-step-2026/)
- SMS rules: [Telerivet — Sending SMS in Pakistan: PTA compliance](https://www.telerivet.com/blog/pakistan-sms-compliance-pta), [Infobip — Pakistan LOA guidelines](https://www.infobip.com/docs/essentials/mena-registration/pakistan-letter-of-authorization-loa-guidelines.md), [sent.dm — Pakistan SMS guide](https://sent.dm/en/resources/tools/pakistan-sms-guide)
- Edge in Pakistan: [ProPakistani — Cloudflare data centres in Karachi, Lahore, Islamabad](https://propakistani.pk/2018/12/29/cloudflare-launches-three-data-centers-across-pakistan-for-faster-internet/), [CDNPlanet — Pakistan CDN](https://www.cdnplanet.com/geo/pakistan-cdn/)
- Google Doha region services: [Network World — Google picks Qatar for second Middle Eastern region](https://www.networkworld.com/article/972086/google-picks-qatar-for-second-middle-eastern-cloud-region.html), [Cloud SQL for PostgreSQL region availability](https://cloud.google.com/sql/docs/postgres/region-availability-overview?hl=pt)
- Latency tools for §5: [Google Cloud latency test](https://www.gcpspeed.com/), [AWS Cloud Ping](https://www.cloudping.cloud/aws)
