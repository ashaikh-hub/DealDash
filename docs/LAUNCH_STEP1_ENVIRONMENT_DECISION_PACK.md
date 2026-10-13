# Launch Readiness — Step 1: Production & Staging Environment Decision Pack

> **Revised 2026-10-11:** the pilot market may be Pakistan. The single-region assumption below is superseded by
> `LAUNCH_STEP1_DECISION_PACK_REV2_MULTI_MARKET.md` (global platform + market deployment profiles). The Google Cloud Dammam design in
> this document is **kept as the KSA deployment profile**, and all VALIDATE-KSA items stand.

Prepared 2026-10-11 for the founder. **Recommendations only — nothing selected, configured, contracted or deployed.** Stage 9 is frozen;
this is not a new stage. Regulatory and residency questions are marked **VALIDATE-KSA** (numbering from
`STAGE9_PRODUCTION_LAUNCH_READINESS.md` §10) and are for qualified counsel — no conclusion is drawn here.

**How to read vendor facts.** Regional availability and prices below are from public information as known at preparation time and
change often. Every "Saudi availability" entry must be **re-confirmed in writing with the vendor** (service list per region, not just
"the region exists") before contracting. Costs are planning estimates (±50%), list-price based, in USD (×3.75 for SAR), excluding VAT,
support plans, staff and transaction fees unless stated.

## 0. What the frozen architecture needs (facts from the code)
- Containers: 1 NestJS API + 5 Next.js apps (`infra/docker/*`), stateless. Scheduled jobs run **inside** the API (claims via PostgreSQL
  `FOR UPDATE SKIP LOCKED`), so at least one API instance must always be running with CPU allocated.
- PostgreSQL **18 + PostGIS** (development and tests run on 18). Sessions, jobs, configuration and audit live in PostgreSQL.
- **No Redis today.** Rate limiting is in-memory per instance; the WAF is designed to be the shared limit.
- Providers behind interfaces with development adapters only: payment, SMS, email, push, storage, file scanning, video, maps, payout
  (manual is production-ready). **Production refuses to start** until each development adapter is replaced → every vendor selected
  below also needs an adapter built (engineering work, estimated in §D).

---

## 1. Production hosting architecture
| Field | Content |
|---|---|
| Requirement | Run the 6 containers with ≥ 2 API instances, managed PostgreSQL with PITR, object storage, secret manager, logging; in a location that satisfies KSA-1 |
| **Recommended** | **Google Cloud, Dammam region (`me-central2`)**: Cloud Run (API with min 2 instances, CPU always allocated; web apps min 1), Cloud SQL for PostgreSQL (HA), Cloud Storage, Secret Manager, Artifact Registry, Cloud Logging / Monitoring. Separate projects for staging and production |
| Alternative | Oracle Cloud (Jeddah / Riyadh regions) with OCI PostgreSQL; Alibaba Cloud via SCCC (Riyadh); STC Cloud / Huawei Cloud Riyadh; AWS or Azure **only if** their announced Saudi regions are generally available with the needed services at contract time |
| Why | An in-Kingdom hyperscale region in operation, managed container platform (no servers to patch), managed PostgreSQL with PostGIS, everything in one region and one bill; standard containers + standard PostgreSQL keep the exit door open |
| Saudi availability | In-Kingdom region (Dammam). **Confirm:** Cloud Run, Cloud SQL (and its PostgreSQL major versions), Secret Manager, Cloud Armor in `me-central2`; whether a **second in-Kingdom region** exists for DR (see §16) |
| Production dependency | Everything |
| External approval / contract | Cloud account + billing in the company's name; enterprise terms / DPA; **VALIDATE-KSA-1** (residency and cross-border transfer, incl. vendor support access) |
| Cost category | Usage-based infrastructure (largest fixed cost) |
| Founder decision | **YES — now** (gates every other step) |

Note: if Cloud SQL in-region does not yet offer PostgreSQL 18, run 17 after an engineering compatibility test (Prisma and PostGIS
features used are available on 17), or self-manage 18 on GKE / VMs (more operations work). Engineering will check this the day the
account exists.

## 2. Staging architecture
| Field | Content |
|---|---|
| Requirement | A production-like rehearsal environment for release candidates, migration rehearsal, restore drills, load tests and UAT; never public |
| **Recommended** | **Same cloud and region as production**, separate project and billing sub-account; smaller sizes (Cloud SQL single-zone, API min 1–2); provider **sandboxes**; `ALLOW_MOCK_PROVIDERS=true` only for providers not yet contracted; access behind an identity proxy (Cloudflare Access or Google IAP) + `noindex` |
| Alternative | Staging in a cheaper non-KSA region with synthetic data only (cheaper, but cannot hold restored production data and does not rehearse residency) |
| Why | Migration rehearsal on restored production data is now a release rule (incident 2026-10-11); that requires staging to be able to hold production data lawfully → same residency as production |
| Saudi availability | As §1 |
| Production dependency | Release process, UAT, pen test |
| External approval / contract | Same cloud contract; **VALIDATE-KSA-1/-8** for copying production data into staging (masking rules) |
| Cost category | Infrastructure (~35–45% of production at pilot size) |
| Founder decision | **YES — now** (confirms "same cloud, separate project") |

## 3. Saudi data-residency implications requiring validation (all **VALIDATE-KSA-1** unless noted)
Questions for counsel; engineering will implement whatever answer comes back.
1. Must customer personal data (names, mobile numbers, emails, location, case messages) be stored **only** in KSA? Does this extend to
   **backups**, **logs**, **staging copies** and **DR copies**?
2. Are cross-border transfers allowed for: transactional **email and SMS content** (sent via vendors outside KSA), **error tracking**
   (stack traces, redacted), **maps geocoding** (addresses sent to the maps API), **push** (device tokens via Apple / Google),
   **video viewing events**?
3. Does vendor **remote support access** from outside KSA count as a transfer?
4. Payment data: card data never touches DealDash (gateway-hosted); confirm obligations for transaction records (with **KSA-3**).
5. Retention and deletion periods (**KSA-8**) — drive backup retention and log retention settings.
6. If only one in-Kingdom region exists for the chosen cloud, is a DR copy outside KSA permitted (and where)?

## 4. PostgreSQL hosting
| Field | Content |
|---|---|
| Requirement | PostgreSQL 18 (or tested 17) + PostGIS; TLS; HA; PITR; least-privilege app role; read replica later |
| **Recommended** | **Cloud SQL for PostgreSQL**, HA (regional), PITR on, private IP, automated backups, `cloudsql.iam` users for humans, app role for the API |
| Alternative | OCI Database with PostgreSQL; Alibaba ApsaraDB RDS for PostgreSQL; self-managed on VMs / GKE with Patroni (only if 18 is mandatory and not offered managed) |
| Why | Managed failover, PITR and patching; PostGIS supported; same region as compute |
| Saudi availability | Confirm in-region and major version |
| Production dependency | Everything |
| External approval / contract | Part of cloud contract |
| Cost category | Infrastructure (second-largest; HA roughly doubles the instance price) |
| Founder decision | **YES — now** (follows §1; also approve HA from day one: recommended) |

## 5. Object storage / CDN
| Field | Content |
|---|---|
| Requirement | Private buckets for evidence, merchant media, invoices; signed upload / download URLs; versioning; encryption; public media through a CDN |
| **Recommended** | **Cloud Storage (in-region)** with uniform access, versioning, retention policy on the backup bucket; public merchant media cached by **Cloudflare** (§17). Adapter to build: `StorageProvider` (signed URLs) |
| Alternative | Cloud CDN / Media CDN instead of Cloudflare; OCI Object Storage; S3-compatible storage in-Kingdom from a local provider |
| Why | Same region and IAM as the database; signed-URL model already used by the local adapter |
| Saudi availability | In-region bucket; CDN edge caches public media only (merchant images — not personal data) |
| Production dependency | Pilot (boot check refuses local storage) |
| External approval / contract | Cloud contract; **KSA-1** for evidence files (personal data) |
| Cost category | Infrastructure (storage + egress) — small at pilot |
| Founder decision | **NO** (follows §1) |

## 6. Redis
| Field | Content |
|---|---|
| Requirement | None today: sessions, jobs, config and idempotency are in PostgreSQL; rate limits are per instance + WAF |
| **Recommended** | **No Redis for pilot.** Add a managed Redis (Memorystore, in-region) when any is true: > 4 API instances, WAF limits insufficient for login abuse, or a measured hot-path needs caching (≈ the 100k-user stage). Code change is small (rate-limiter store; item E-2) |
| Alternative | Use it from day one (simpler to reason about multi-instance limits; ~$50–150/month at pilot size) |
| Why | One less stateful system to secure, back up and pay for during the pilot |
| Saudi availability | Memorystore in-region to confirm when needed |
| Production dependency | None for pilot |
| External approval / contract | None |
| Cost category | Infrastructure (deferred) |
| Founder decision | **NO** (engineering recommendation; revisit at 100k) |

## 7. Video provider (Watch & Earn)
| Field | Content |
|---|---|
| Requirement | Upload, transcoding, adaptive playback, playback events for qualification; signed playback |
| **Recommended** | **Decide first whether Watch & Earn is in the pilot.** If yes: **Cloudflare Stream** (upload + encode + deliver, per-minute pricing, same vendor as edge). If no: defer the choice |
| Alternative | Mux; in-cloud build (Cloud Storage + Transcoder API + Media CDN — in-region storage, more engineering); Bunny Stream |
| Why | Fastest integration, predictable per-minute cost, no video infrastructure to run |
| Saudi availability | Delivery from KSA edge locations; **storage and encoding location to confirm** (videos are merchant ads — usually not personal data; viewing events stay in DealDash's database) |
| Production dependency | Only if Watch & Earn is in the pilot |
| External approval / contract | Vendor account; **KSA-5** (sponsored-content / advertising rules) |
| Cost category | Usage-based — **can become the largest cost at scale** (minutes delivered) |
| Founder decision | **YES — now: is Watch & Earn in the pilot?** Vendor choice can wait if not |

## 8. Payment gateway
| Field | Content |
|---|---|
| Requirement | Hosted card entry (DealDash never sees card data), **mada**, Apple Pay, 3-D Secure, refunds incl. partial, signed webhooks, settlement reports for reconciliation, sandbox |
| **Recommended** | **Shortlist and request proposals from Saudi-based gateways**: Moyasar, HyperPay, Tap Payments; plus Checkout.com as the international option. Engineering preference on integration grounds: a clean REST API with hosted payment page + signed webhooks + partial refunds (fits `PaymentProvider` directly) |
| Alternative | Amazon Payment Services; PayTabs; a bank acquirer directly (slower) |
| Why | mada and local acquiring are essential for KSA conversion; local providers typically onboard faster for KSA merchants of record |
| Saudi availability | Local providers operate in KSA; **confirm each provider's current SAMA authorization and the services covered (VALIDATE-KSA-3)** |
| Production dependency | Pilot (no purchases without it) |
| External approval / contract | Merchant account / KYC of the company; **KSA-3** (merchant-of-record model, holding funds before settlement, licensing); **KSA-6** (VAT on fees) |
| Cost category | Per-transaction fees (% + fixed, mada vs credit card differ) — not infrastructure; negotiate |
| Founder decision | **YES — now** (longest lead time: KYC + contract typically weeks) |

## 9. Payout / settlement integration (B2)
| Field | Content |
|---|---|
| Requirement | Pay merchants per approved settlement rule; record the bank reference; reconcile |
| **Recommended** | **Manual bank payouts for the pilot** (built and tested: finance approver who did not prepare the statement records the bank reference). Revisit an automated option after the pilot |
| Alternative | Payment gateway's payout / split-settlement product (if the chosen gateway offers it); bank host-to-host or corporate API |
| Why | Pilot merchant count is small; no extra contract; the automated path is already behind `PayoutProvider` |
| Saudi availability | Company bank account in KSA |
| Production dependency | Pilot settlements (also needs the **B1 rule — KSA-2**) |
| External approval / contract | Company bank account; merchant bank-account verification (**KSA-11**) |
| Cost category | Bank fees per transfer; finance staff time |
| Founder decision | **YES — now: accept manual payouts for the pilot** |

## 10. SMS / OTP provider
| Field | Content |
|---|---|
| Requirement | OTP for customers and staff (sign-in depends on it), delivery receipts, KSA operator routes, Arabic, registered sender name |
| **Recommended** | **Unifonic** (Saudi-based, direct local routes, OTP product) |
| Alternative | Taqnyat; Msegat; Twilio Verify (international; local route quality and sender registration to verify) |
| Why | OTP delivery speed in KSA decides whether customers can sign in at all; local providers handle sender-name registration with the operators |
| Saudi availability | Local |
| Production dependency | **Pilot (critical)** |
| External approval / contract | Contract; **sender-name registration (lead time — start early)**; **KSA-4** (consent, quiet hours for non-OTP messages) |
| Cost category | Per message — **material at scale** (see §18) |
| Founder decision | **YES — now** (registration lead time) |

## 11. Email provider
| Field | Content |
|---|---|
| Requirement | Transactional email (merchant / partner / admin notices, invoices), SPF / DKIM / DMARC, bounce and complaint callbacks |
| **Recommended** | **Postmark** (transactional-only, strong deliverability, simple API) |
| Alternative | Amazon SES (cheapest at volume); SendGrid; Microsoft 365 / Google Workspace relay (not for volume) |
| Why | Low volume at pilot; deliverability matters more than price |
| Saudi availability | Processed outside KSA — **VALIDATE-KSA-1** (keep email bodies minimal: no case text, no addresses) |
| Production dependency | Pilot (business users) |
| External approval / contract | Vendor account; DNS records on the company domain |
| Cost category | Per-email, small |
| Founder decision | **YES — now** (quick, but blocks merchant onboarding notices) |

## 12. Push notifications
| Field | Content |
|---|---|
| Requirement | Notices to customers / staff when the app is closed |
| **Recommended** | **Standard Web Push (VAPID) — no vendor** for the pilot web apps; Firebase Cloud Messaging + APNs when native apps exist |
| Alternative | OneSignal (managed, analytics) |
| Why | The apps are web apps today; Web Push works through the browsers' own push services with keys DealDash holds |
| Saudi availability | Browser push services are global (device tokens leave KSA — **KSA-1** question 2) |
| Production dependency | Not required for pilot (SMS / email / in-app inbox cover it) |
| External approval / contract | None for VAPID; Apple developer account for native later |
| Cost category | Free (VAPID) |
| Founder decision | **NO — can wait** |

## 13. Maps / location
| Field | Content |
|---|---|
| Requirement | Geocode branch addresses, show maps, distance; Arabic place names |
| **Recommended** | **Google Maps Platform** (best KSA coverage and Arabic) |
| Alternative | Mapbox; HERE; Apple MapKit JS |
| Why | Coverage and Arabic quality in Saudi cities matter more than price at pilot volume |
| Saudi availability | Global API; addresses sent for geocoding — **KSA-1** question 2 (branch addresses are business data, customer location stays on the device / in DealDash) |
| Production dependency | Pilot (branch setup, discovery) |
| External approval / contract | Billing account; terms restrict caching / mixing with other maps (lock-in, §19) |
| Cost category | Usage-based, small at pilot (free monthly usage tiers) |
| Founder decision | **YES — now** (quick self-serve) |

## 14. Monitoring / logging
| Field | Content |
|---|---|
| Requirement | Central redacted logs, metrics, uptime, alerts with on-call routing, error tracking |
| **Recommended** | **Cloud Logging + Cloud Monitoring (in-region)** for logs, metrics, uptime and alerts; **Sentry** for front-end / API error tracking with PII scrubbing |
| Alternative | Grafana Cloud; Datadog (richer, costlier); self-hosted Grafana / Loki in-region (more operations) |
| Why | In-region logs keep residency simple; Sentry is the fastest way to see real user errors |
| Saudi availability | Cloud Logging in-region (confirm log bucket location); Sentry data in US / EU — **KSA-1** question 2 |
| Production dependency | Pilot |
| External approval / contract | Sentry account; on-call tool (optional) |
| Cost category | Usage-based (log volume) |
| Founder decision | **YES — now** (confirm Sentry or "in-region only") |

## 15. Security scanning
| Field | Content |
|---|---|
| Requirement | Code, dependency, container and running-app scanning; independent penetration test before public launch |
| **Recommended** | Already in place: CodeQL, `pnpm audit --prod`, secret scan. Add: **Dependabot**, **Trivy** image scan in CI, **OWASP ZAP** baseline scan against staging (all free). Penetration test by an **independent accredited firm with KSA presence**, booked once staging is stable |
| Alternative | Snyk (commercial SCA / container); cloud-native vulnerability scanning in Artifact Registry |
| Why | Free tooling covers the automated part; the human test is what matters for launch |
| Saudi availability | Local and regional firms available |
| Production dependency | Public launch (pen test); pilot (automated scans) |
| External approval / contract | Pen-test contract + rules of engagement |
| Cost category | Tools free; pen test is a one-off fixed fee |
| Founder decision | **NO now** for tools; **YES later** (pen-test firm, at staging) |

## 16. Backup / restore
| Field | Content |
|---|---|
| Requirement | PITR, daily logical backups (`db-backup.mjs`), restore drills (`db-restore-verify.mjs`), object-storage versioning, encryption-key escrow |
| **Recommended** | Cloud SQL automated backups + **PITR 14 days** (proposal); weekly verified logical dump to a separate backup bucket with **retention lock**; monthly restore drill into a `*_restore` instance; RPO ≤ 5 min / RTO ≤ 4 h (proposals) |
| Alternative | Longer PITR (up to the platform maximum) at higher cost; third-party backup vault |
| Why | Two independent copies (platform + logical); drills prove they work |
| Saudi availability | In-region. **Cross-region DR copy needs a second in-Kingdom region or a KSA-1 answer** permitting an out-of-Kingdom copy |
| Production dependency | Pilot |
| External approval / contract | None beyond cloud |
| Cost category | Storage (small) |
| Founder decision | **YES — now**: RPO / RTO and retention (approve or amend the proposals); retention final after **KSA-8** |

## 17. Domain / DNS / TLS / WAF
| Field | Content |
|---|---|
| Requirement | Company domain(s), DNS, TLS certificates, WAF, DDoS protection, rate limiting, bot protection, access control for staging |
| **Recommended** | **Cloudflare** (DNS, TLS, WAF + rate-limiting rules, DDoS, Cloudflare Access for staging), plan tier per traffic. Domain: brand `.com` and/or `.sa` (a `.sa` registration needs a Saudi entity's documents) |
| Alternative | Google Cloud Armor + Cloud DNS + Google-managed certificates (all in one cloud, fewer edge locations in KSA) |
| Why | Edge locations inside KSA, strong WAF / bot tooling, one place for DNS + TLS + staging access |
| Saudi availability | Edge locations in KSA; **confirm where TLS termination and request logs are processed (KSA-1)** — regional data-processing options exist on higher plans |
| Production dependency | Pilot |
| External approval / contract | Domain registration in the company's name; Cloudflare account / plan |
| Cost category | Fixed monthly plan |
| Founder decision | **YES — now** (domain names to use) |

---

## 18. Estimated monthly cost (USD, planning estimates ±50%)
Assumptions: "active users" = monthly actives; DAU ≈ 15% of MAU; sessions last 14 days so OTP ≈ 1–2 SMS per active user per month;
Watch & Earn ≈ 20% of actives watching ~10 minutes / month (pilot: low). Production + staging, excluding VAT, support plans, staff,
payment fees and bank fees.

| Line | Controlled pilot (≤ 5k users) | 100,000 active users | 1,000,000 active users |
|---|---|---|---|
| Compute (API + 5 web apps) | 250–450 | 1,200–2,500 | 6,000–14,000 |
| PostgreSQL (HA; replicas at scale) | 300–600 | 1,500–3,000 | 8,000–18,000 |
| Redis | 0 | 150–400 | 800–2,000 |
| Storage + egress + CDN | 30–100 | 300–900 | 2,500–8,000 |
| Cloudflare (DNS / WAF / Access) | 25–250 | 250–2,000 | 2,000–6,000+ (enterprise) |
| Logging / monitoring / Sentry | 50–200 | 400–1,200 | 2,500–8,000 |
| Maps | 0–100 | 300–1,500 | 2,000–10,000 |
| Email | 15–50 | 50–200 | 300–1,000 |
| Staging environment | 300–600 | 600–1,500 | 1,500–4,000 |
| **Infrastructure subtotal** | **≈ 1,000–2,300** | **≈ 4,800–13,000** | **≈ 25,000–70,000** |
| Video delivery (if Watch & Earn on) | 0–100 | 200–2,000 | 2,000–20,000 |
| **SMS / OTP (per-message, quote needed)** | 50–300 | 3,000–12,000 | 30,000–120,000 |
| Payment gateway fees | % of GMV (not infrastructure) | % of GMV | % of GMV |

Two things stand out: **SMS can exceed the whole infrastructure bill at scale** (worth negotiating volume pricing early and keeping
sessions long), and **video delivery grows with engagement**. Staging stays roughly flat.

## 19. Vendor lock-in risks
| Component | Lock-in | Why / mitigation |
|---|---|---|
| Compute (Cloud Run) | Low | Standard containers; move to any container platform |
| PostgreSQL (Cloud SQL) | Low | Standard PostgreSQL; logical dumps restore anywhere (proven) |
| Object storage | Low–medium | Interface-based adapter; data copy needed at exit (egress cost) |
| Payment gateway | **Medium–high** | Merchant contract, settlement flows, reconciliation formats; saved-card tokens (if ever used) are not portable — keep card saving off or use network tokens |
| SMS | Low | Interface; sender-name registration must be redone |
| Email | Low | DNS records only |
| Maps (Google) | **Medium** | Terms restrict caching / mixing; store our own coordinates for branches |
| Video | **Medium** | Video library must be exported / re-encoded; keep originals in our bucket |
| Cloudflare | Low–medium | DNS / WAF rules to recreate |
| Monitoring | Low | Logs are JSON; alerts re-created |
| Cloud provider as a whole | Medium | Avoid proprietary data services (no Firestore / proprietary queues); infrastructure as code |

## 20. Select now vs keep provider-neutral
**Select now** (lead time, or blocks staging): cloud + region (§1–2, 4, 5); domain / DNS / WAF (§17); payment gateway (§8 — longest
lead time); SMS provider (§10 — sender registration); email (§11); maps (§13); monitoring choice (§14); manual payouts yes / no (§9);
backup objectives (§16); Watch & Earn in pilot yes / no (§7).

**Can stay provider-neutral for now**: Redis (§6); push vendor (§12 — Web Push needs none); video vendor (§7, if Watch & Earn is not in
the pilot); payout provider (§9, after pilot); penetration-test firm (§15, book when staging is stable); file-scanning vendor
(public-launch item; pilot uses type / size checks — founder accepted risk needed); hosted AI model (optional).

---

## A. Decisions the founder must make now
1. **Cloud provider and region** for staging and production (recommended: Google Cloud, Dammam) — and engage counsel on **KSA-1** in
   parallel (answers may change the email / monitoring / DR choices, not the core hosting choice).
2. **Domain names** and DNS / edge provider (recommended: Cloudflare).
3. **Payment gateway shortlist** to request proposals from (recommended: Moyasar, HyperPay, Tap; Checkout.com as international option).
4. **SMS provider** (recommended: Unifonic) — and start sender-name registration.
5. **Email provider** (recommended: Postmark).
6. **Maps provider** (recommended: Google Maps Platform).
7. **Monitoring**: in-region cloud logging + Sentry (or in-region only).
8. **Manual merchant payouts for the pilot**: yes / no.
9. **Is Watch & Earn in the pilot**: yes / no.
10. **Backup objectives**: approve or amend RPO ≤ 5 min, RTO ≤ 4 h, PITR 14 days (retention final after KSA-8).
11. **Monthly budget envelope** for pilot infrastructure (≈ $1,000–2,300 + SMS + payment fees).

## B. Decisions that can wait
Redis (at ~100k users); push vendor (until native apps); video vendor (if Watch & Earn is not in the pilot); payout automation (after
pilot); penetration-test firm (book when staging is stable — before public launch); file-scanning vendor (before public launch);
hosted AI model (optional); higher Cloudflare tier (at scale); read replicas (at scale).

## C. External dependencies
Cloud contract + DPA; company bank account; payment gateway KYC and contract; SMS sender-name registration; domain registration (a
`.sa` domain needs Saudi entity documents); Apple / Google developer accounts (only for native apps later); counsel answers
**KSA-1 … KSA-16** (KSA-1, -2, -3, -4 block the pilot); native Arabic reviewer; pen-test firm; UAT participants (pilot merchants,
partner, customers); GitHub `production` environment reviewers (founder action).

## D. Recommended sequence to create the staging environment
1. **Founder decisions A1–A2, A7, A10** (cloud, domain, monitoring, backup objectives); counsel engaged on KSA-1.
2. Create the cloud organisation, billing, **separate staging and production projects**, admin accounts with MFA, budget alerts.
3. Register / move the domain to the DNS provider; staging hostnames (e.g. `*.staging.<domain>`) behind access control, `noindex`.
4. Engineering: **infrastructure as code** for network, Cloud SQL (PostgreSQL + PostGIS, PITR), buckets (incl. retention-locked
   backup bucket), Secret Manager, Artifact Registry, Cloud Run services, log buckets and alerts. *(~1–2 weeks)*
5. GitHub: `staging` and `production` environments, required reviewers, tag protection, **OIDC federation to the cloud** (no long-lived
   keys), implement the deploy hook behind `tooling/deploy/deploy.mjs`.
6. Engineering: **storage adapter** first (the boot check needs it), then **SMS**, **email**, **maps**; **payment sandbox** adapter as
   soon as the gateway is chosen. Until each exists, staging runs that provider with `ALLOW_MOCK_PROVIDERS=true` (marked "simulated" in
   UAT). *(~1 week per adapter, payment ~2 weeks incl. reconciliation mapping)*
7. First release tag → images (+ Trivy scan) → staging deploy → migrations → catalog sync → **synthetic staging data** (never the dev
   seed's passwords, never production data until KSA-1 / -8 allow masked copies).
8. Configure PITR, take a backup, run the **restore drill** into a `*_restore` instance; set alerts and uptime checks.
9. Smoke test (runbook §8), ZAP baseline scan, load test on staging hardware.
10. Pilot configuration in staging (KSA market, cities, allowlist, emergency-stop drill, settlement rule with **UAT placeholder values**
    until KSA-2 is answered).
11. UAT entry criteria (`UAT_PLAN.md` §1) → begin UAT; book the penetration test.

Steps 4–6 are engineering work that changes the repository (adapters, IaC, deploy hook). They start only after founder approval of
this pack, without reopening frozen stages.

**Stop for founder approval.**
