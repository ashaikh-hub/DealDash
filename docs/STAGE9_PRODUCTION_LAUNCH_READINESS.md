# Stage 9 — Production & Public Launch Readiness

Status: **FOUNDER APPROVED AND FROZEN (2026-10-11) as technically complete — public launch NOT authorized** (see the approval
section at the end). Nothing has been deployed, launched, committed or pushed.
Companion documents: `PRODUCTION_RUNBOOK.md`, `DISASTER_RECOVERY.md`, `SECURITY_TESTING_HANDOFF.md`, `PROVIDER_READINESS_MATRIX.md`,
`UAT_PLAN.md`, `GO_LIVE_CHECKLIST.md`.

**Two different questions, two different answers.**
- *Is the Stage 9 readiness work complete?* Yes — every section below is implemented, documented or explicitly handed to its owner.
- *Can DealDash go live?* **Not yet, by design**: no hosting, no contracted provider, no regulatory answers, no UAT. Those are
  categories B–D of the audit (§Audit), not engineering defects.

Honesty rules followed: no penetration test has been performed; no physical device has been tested; no vendor has been selected; no
regulatory question has been answered; no Arabic string is marked natively reviewed.

## 1. What Stage 9 changed (summary)
| Area | Change |
|---|---|
| Runtime hardening | Production boot check refuses unsafe configuration; JSON logs with redaction + access log; per-IP rate limits (auth stricter); trusted-proxy hops; helmet tuned (frame deny, HSTS in production); security headers on all five web apps; `/v1/health/live` and `/v1/health/ready` |
| B1 settlement rule (VALIDATE-KSA) | Configurable cut-off time (market time zone), reserve % and release days, payout method, failed-payout retry limit, tax treatment (informational / withheld). Values are **not** set by engineering |
| B2 payouts | `PayoutProvider` (manual default, mock for tests); `PAYOUT_PENDING`; instruct by a finance approver who did not prepare the statement; retry limit; signed status callbacks; idempotent results; ledger on PAID; polling job |
| B3 notifications | Per-user hourly throttle (default 20, governed); channel fallback; signed delivery receipts |
| B4 points | Proportional reversal on partial refunds, cumulative across refunds, configurable rounding (FLOOR); never reverses twice |
| B5 Arabic | Export / import workflow for native review (CSV with placeholders checked); reviewed overrides file starts empty; status per key |
| B6 case replies | Customer reads DealDash's shared messages and replies in the app (optional evidence reference); case returns to DealDash; card numbers refused; 10 replies/hour; business never sees customer messages; **a note sent when asking the customer is now shared with them** (found by the browser run) |
| B7 controls editor | Structured forms for every governed setting (reasons, SLA, approvals, risk, notifications, reviews, platform limits, launch); request → second-person approval → applied (or scheduled); stale proposals refused; full history and rollback; no raw JSON |
| Launch controls | Pilot mode (open / allowlist of merchants and partners); per-market emergency stops for NEW purchases, reservations, Watch & Earn views and campaigns — immediate, reasoned, audited; existing rights untouched |
| Privacy | Legal holds (place / lift by a different person) block deletion requests |
| Release engineering | CI: secret scan, drift check, prod-dependency audit, CodeQL; release workflow with a manual, protected production gate; Dockerfiles; deploy script that refuses without hosting secrets |
| Backup / DR | Verified backup and restore tools; restore now empties the target first (defect found and fixed) |
| Accessibility | One `h1` per page (sign-in panel and customer home fixed) |

## 2. Frozen-scope discipline
No frozen Stage 1–8 design was redesigned. Changes to earlier code were limited to: the B4/B6/B7 founder-listed pre-pilot items; the
Stage 8 transition note to the customer becoming shared (required for B6 to work); heading levels for accessibility; test helpers that
relied on "an h1 means signed in". The MVP still sells one voucher per order (frozen founder decision); B4 logic is general.

## 3. Environments, hosting, database (sections: environments, hosting, production DB)
Four tiers (local, test, staging, production), strictly separated; production is never reset or reseeded (tools refuse). Hosting is
provider-neutral and **not selected**: requirements in runbook §2 (KSA residency **VALIDATE-KSA-1**, managed PostgreSQL 18 + PostGIS
with TLS and PITR, ≥ 2 API instances, WAF). The API connects as a least-privilege role (boot check refuses the admin account).

## 4. Backup and disaster recovery
See `DISASTER_RECOVERY.md`. Tested locally: backup → restore into an empty test database → **RESTORE VERIFIED** (row counts match the
manifest; every ledger journal balances). RPO / RTO / retention are proposals awaiting the founder.

**Incident and lesson (2026-10-11).** The Stage 9 migration failed on the development database (append-only trigger refused the
`CaseNote` backfill; it had passed on the empty test database). Recovered without data loss (backup first; guarded removal of the two
partially-added columns; migration marked rolled back), fixed with the established trigger-lift pattern, **rehearsed on a restored copy
of real data**, then applied: 12 notes → BUSINESS, 12 → DEALDASH, content checksum unchanged, no drift. New release rule: migrations
are rehearsed on restored production data in staging.

## 5. Secrets and authentication
Secrets only from the platform secret manager; rotation table in runbook §4; field-encryption key escrow required. Authentication as
implemented (OTP for customers / staff, password + lockout for businesses, mandatory TOTP for admins, server-side sessions with idle
and absolute expiry, CSRF tokens) — `SECURITY_TESTING_HANDOFF.md` §2, including one known low residual (locked-account enumeration,
E-6).

## 6. Application security and penetration-test handoff
Internal OWASP review in `SECURITY_TESTING_HANDOFF.md` §3. **Pen test not performed**; scope, priorities (tenant isolation, money,
races, maker-checker, auth, B6, uploads, AI) and process are ready for the tester the founder selects. Secret scan: no findings.
Dependency audit (production deps): 0 critical, 2 high (`postcss` inside Next.js, build-time only), 3 moderate.

## 7. CI/CD and release management
`ci.yml`, `codeql.yml`, `release.yml` (runbook §5–6). Production deploys only by manual dispatch of an existing tag through the
protected environment. The founder must configure the GitHub `production` environment's required reviewers (A-3).

## 8. Observability
Structured, redacted logs; access log; readiness reflects database, migrations and failed jobs; alert list in runbook §7. The
logging / alerting vendor is not selected (P13).

## 9. Providers (payment, payout, comms / OTP, storage / media, video, maps)
`PROVIDER_READINESS_MATRIX.md`. Every capability is behind an interface with a development adapter; production refuses development
adapters. Manual payouts are production-ready today if the founder accepts them for the pilot.

## 10. KSA readiness checklist — VALIDATE-KSA (questions for qualified counsel; **no answers are given here**)
| Id | Question | Affects |
|---|---|---|
| KSA-1 | Where must customer personal data, transaction data, files, logs and backups be stored; are cross-border transfers allowed and on what basis? | Hosting, storage, logging, providers, AI |
| KSA-2 | Settlement rule for merchants: payout cycle, minimum payout, reserve / holdback, cut-off, withholding or tax treatment, required merchant KYC (B1) | Settlement rule values |
| KSA-3 | Payment acceptance: licensing of the PSP / acquirer, required schemes (e.g. mada), 3-D Secure, merchant-of-record model, whether DealDash may hold customer funds before settlement | Payment provider, flows |
| KSA-4 | Messaging: SMS sender-ID registration, consent for non-OTP messages, quiet hours, opt-out | SMS / email / push |
| KSA-5 | Advertising rules for sponsored video and rewarded viewing (disclosures) | Watch & Earn |
| KSA-6 | Tax: VAT on platform fees and vouchers; e-invoicing obligations for DealDash's own invoices | Billing, invoices, settlement tax lines |
| KSA-7 | Consumer protection: refund rights and windows for vouchers, voucher expiry rules, mandatory pre-purchase disclosures | Refund rules, voucher terms |
| KSA-8 | Personal data retention periods, deletion and export timelines, breach notification duties | Retention config, DR retention |
| KSA-9 | Are permits required to advertise discounts / promotions, and who obtains them (merchant or platform)? | Deal publishing |
| KSA-10 | Legal nature of reward points: expiry, liability, consumer rights | Rewards |
| KSA-11 | Merchant onboarding verification (commercial registration, bank account ownership) | Merchant onboarding, payouts |
| KSA-12 | Obligations for hosting user reviews (takedown timelines, records) | Reviews / moderation |
| KSA-13 | Terms of service and privacy policy: content, language requirements (Arabic), consent capture | Legal pages, sign-up |
| KSA-14 | Lawful exceptions to telling a person they are restricted / under review | Restrictions |
| KSA-15 | E-commerce platform registration or licensing for DealDash itself | Company readiness |
| KSA-16 | Accessibility obligations for consumer digital services, if any | Accessibility scope |

## 11. Performance and load baseline (local; **not a capacity figure**)
`tooling/e2e/stage9-load.mjs` on a fresh test database, single API instance in development mode on one laptop
(`docs/performance/stage9-load-baseline.json`):

| Path (20 concurrent) | p50 | p95 | Errors | Throughput |
|---|---|---|---|---|
| Health ready | 49 ms | 93 ms | 0 | 343/s |
| Live Deals list | 115 ms | 146 ms | 0 | 175/s |
| Exclusive Deals list | 89 ms | 132 ms | 0 | 208/s |
| Vouchers list | 84 ms | 112 ms | 0 | 235/s |
| Search | 82 ms | 106 ms | 0 | 238/s |

Correctness under concurrency: 20 parallel OTP sign-ins (285 ms); **Exclusive Deal race — 40 units asked for 29 available: 28
reserved, 1 left, never oversold, units conserved exactly**; the same checkout sent 10 times at once → one order; 10 buyers at once →
10 holds, stock never negative. Production capacity testing runs on staging hardware (D).

## 12. Device testing matrix
`UAT_PLAN.md` §4. **No physical device testing has been performed.** Automated runs used headless Edge at desktop and phone widths in
English and Arabic.

## 13. Accessibility (practical MVP level)
`tooling/e2e/stage9-a11y.mjs`: language and direction, one main heading, labelled controls, named buttons / links, image alt, unique
ids, keyboard focus moves visibly, body contrast ≥ 4.5:1, reflow at 320 px — on the start page of all five apps (EN and AR), customer
explore / profile, admin cases / configuration / settlements. First run 10/20: **every signed-out page lacked a main heading** →
fixed (sign-in panel title is the page `h1` where it is the page; customer home hero is the `h1`). Now **20/20**. Not done: screen
reader passes and keyboard-only journeys (UAT X2). This is not a WCAG certification.

## 14. Privacy, retention, legal hold
Data export / deletion requests (Stage 8) now respect **legal holds**: placed with a reason, lifted only by a different person, and
deletion is blocked while one is active. Retention periods: VALIDATE-KSA-8.

## 15. Business continuity
Emergency stops (immediate, per market), pilot allowlist, manual payouts as a fallback to a payout provider, notification channel
fallback, DR procedures, incident process (runbook §9). Single-person dependency: the founder holds production approval — a named
delegate is recommended (A-3).

## 16. Pilot configuration (to apply in staging, then production — all through governed controls)
Market SA (SAR, Asia/Riyadh); pilot cities; **pilot mode ALLOWLIST** with the pilot merchants and partners; emergency stops off
(drill once); approved settlement rule (after KSA-2); OTP and password limits (defaults: 5 attempts, 5 OTP requests / hour, lock after
5 failures for 15 minutes); reservation hold 30 minutes, max 3 active; notification throttle 20 / hour; reasons and SLAs reviewed by
operations; Watch & Earn on or off by founder decision.

## 17. UAT
`UAT_PLAN.md` — scripts for every portal and journey, EN and AR passes, device matrix, entry / exit criteria. Not started (needs staging).

## 18. Launch controls
Built and tested (API and browser): allowlist, stops, audit, permission `admin.launch.control` (Operations, Super admin).

## 19. Go-live checklist
`GO_LIVE_CHECKLIST.md` — 47 items. Overall: **NOT READY** (expected).

## Tests (2026-10-11)
| Suite | Result |
|---|---|
| API (vitest, 52 files, fresh test database) | **844 / 844** |
| Stage 9 API tests (`stage9-production.e2e.test.ts`) | 17 / 17 (B1/B2, B3, B4, B6, B7, launch, legal hold, health / headers, rate limit) |
| Apps and packages | **421 / 421** (admin 117, merchant 109, customer 67, staff 34, partner 18, localization 24, ui 14, app-shell 11, auth 10, validation 6, config 5, analytics 4, api-client 2) |
| Browser regression (real Edge, fresh test database per suite) | **684 checks, all passing**: stage2 30, stage3 98, stage4 121, stage5 101, stage6 88, phase3 32, phase4/5 59, markets 19, subscription 31, stage7 40, stage8 48, stage9 17 |
| Load / concurrency baseline | 9 / 9 |
| Accessibility sweep | 20 / 20 |
| Typecheck / lint / format / build | 24/24 · 0 errors (64 existing warnings) · clean · 15/15 |
| Secret scan · drift check · restore test | no findings · no difference · RESTORE VERIFIED |

Found and fixed by this round of testing: customer could not see DealDash's question on a case (B6); signed-out pages had no main
heading; the migration backfill blocked by the append-only trigger; restore left newer objects in the target; Stage 8 browser step and
four sign-in helpers that encoded the old behaviour.

## Database
Migration `20270106000000_stage9_production_readiness` (CaseNote author kind and evidence reference with backfill; settlement rule
controls; reserves and payout attempts; `PAYOUT_PENDING`; payout provider; `ConfigChangeRequest`; `LegalHold`; CHECK constraints, frozen
ones widened). Development database: backed up (`dealdash_dev-pre-stage9-migration-20261011T075858Z.dump`), recovered from the failed
first attempt (§4), migrated with `migrate deploy`, catalog synced (permissions 148 → 149, grants 417 → 419, users unchanged 60), no
drift, backed up again (`dealdash_dev-post-stage9-migration-20261011T080249Z.dump`).

## Audit
**A — must be done before the pilot / public launch (DealDash-side; no vendor needed)**
- A-1 B5 native Arabic review of pilot screens: appoint the reviewer; run export → review → import (tooling ready).
- A-2 Dependency triage: `postcss` (2 high, inside Next.js, build-time only) — move to a Next.js release that bundles a fixed
  `postcss`; `tinypool` (2 critical, vitest only, never shipped) — move to a vitest release on `tinypool` ≥ 2.1.2.
- A-3 GitHub: `production` environment with required reviewers (founder + named delegate), tag protection, environment secrets.
- A-4 First container image build and image scan in CI (not buildable locally — no Docker here).
- A-5 Operations readiness: pilot configuration, an emergency-stop drill, staff roles, on-call rota, EN / AR customer notice templates.
- A-6 Founder decisions: RPO / RTO / backup retention; manual payouts for the pilot (yes / no); file scanning before public launch.

**B — external provider dependency** (founder selects; then adapter + sandbox UAT): hosting and region (P10), managed database with
PITR, staging and production environments, payment (P1), SMS (P2), email (P3), push (P4), object storage (P5), file scanning (P6),
video (P7), maps (P8), payout provider (P9, optional), CDN / WAF and shared rate limiting (P11), secret manager (P12),
logging / alerting (P13), penetration tester (P16). Then: PITR restore drill, multi-instance job check, pen-test fixes and retest.

**C — VALIDATE-KSA**: KSA-1 … KSA-16 (§10), including B1 settlement rule values (KSA-2).

**D — UAT items**: all `UAT_PLAN.md` scripts in EN and AR; physical device matrix; screen-reader and keyboard-only passes;
performance test on staging hardware; payment / SMS sandbox journeys; native Arabic review in context.

**E — post-launch (tracked, not hidden)**
- E-1 Script Content-Security-Policy with nonces (Next.js); today: frame-ancestors / object-src / base-uri only.
- E-2 Shared (Redis or edge) rate-limit store if the WAF's limits are not enough; today per instance.
- E-3 Several vouchers per order (MVP: one per order; B4 already handles the general case).
- E-4 Automated statement ingestion (SFTP / API) — Stage 8 class D.
- E-5 Field-encryption key rotation (re-encryption tooling).
- E-6 Answer locked and unknown accounts alike (removes a low enumeration signal).
- E-7 Stage 8 class D items: ML fraud scoring, bulk case operations, business-hours SLA calendars, merchant replies to reviews.
- E-8 Optional hosted AI model behind the existing `AiProvider` (built-in works).

No MVP-critical defect is deferred silently.

## Founder approval (2026-10-11): APPROVED AND FROZEN — technical readiness only
Stage 9 is founder approved as **technically complete** and frozen. This approval does **NOT** approve DealDash for public launch.
The five statuses stay distinct: TECHNICALLY READY · EXTERNAL DEPENDENCY PENDING · VALIDATE-KSA · UAT REQUIRED · PRODUCTION READY.
Technical readiness: achieved. Production readiness: **pending**. Public launch: **not authorized**. No Stage 10 exists.

Open and NOT complete (must not be marked complete silently): production environment / hosting; production database; production
secrets / configuration; vendor / provider selections; payment production setup; settlement / payout production setup; SMS / OTP /
email / push production providers; penetration / security testing; native Arabic review; physical device testing; formal UAT; backup
retention decision; RPO / RTO approval; manual payout process for the pilot (if used); GitHub production / release reviewers; remaining
VALIDATE-KSA items (KSA-1 … KSA-16, including B1); the final go-live checklist (`GO_LIVE_CHECKLIST.md`, overall NOT READY).
