# DealDash — Go-Live Checklist

> **2026-10-11:** Stage 9 founder approved and frozen as technically complete. **Public launch is NOT authorized.** The statuses below
> are unchanged by that approval; overall go-live remains **NOT READY**.

Stage 9 status as of 2026-10-11. Statuses: **READY** (done and evidenced) · **NOT READY** (work remains that DealDash can do) ·
**BLOCKED** (waits on an external dependency or a founder decision) · **VALIDATION REQUIRED** (regulatory / legal answer needed —
VALIDATE-KSA). The **overall go-live status is NOT READY**: no environment, vendor or regulatory answer exists yet. This is expected
at this point: Stage 9 prepares the launch, it does not launch.

## 1. Product and code
| # | Item | Status | Evidence / owner |
|---|---|---|---|
| G1 | Stages 1–8 frozen; Stage 9 changes limited to readiness items | READY | Stage 9 doc §2 |
| G2 | Automated tests: API 844/844; apps / packages 421; browser 684 checks across 12 suites; load 9/9; accessibility 20/20 | READY | Stage 9 doc §Tests |
| G3 | Typecheck, lint (0 errors), format, production build of all apps | READY | CI gates |
| G4 | Pre-pilot items B4 (proportional points reversal), B6 (customer case replies), B7 (governed controls editor) | READY | Built + tested |
| G5 | B5 native Arabic review | NOT READY | Tooling ready (5,676 strings exported, all NEEDS_NATIVE_REVIEW); reviewer to be appointed (founder) |
| G6 | B3 notification providers | BLOCKED | Vendors not selected (P2–P4); throttling / fallback / receipts built |
| G7 | B2 payouts | READY (manual) / BLOCKED (provider) | Manual payouts work; provider adapter after selection; founder to accept manual payouts for pilot |
| G8 | B1 KSA settlement rule | VALIDATION REQUIRED | Fields configurable (cut-off, reserve, release, method, retries, tax treatment); values need VALIDATE-KSA-2 answers and approval in Markets |

## 2. Environments and infrastructure
| # | Item | Status | Evidence / owner |
|---|---|---|---|
| G9 | Hosting provider and KSA-compliant region | BLOCKED | Founder decision; VALIDATE-KSA-1 |
| G10 | Staging environment | BLOCKED | After G9 |
| G11 | Production environment | BLOCKED | After G9 |
| G12 | Managed PostgreSQL 18 + PostGIS with PITR, TLS | BLOCKED | After G9 |
| G13 | Object storage adapter + bucket | BLOCKED | Vendor (P5) then adapter |
| G14 | Secret manager; secrets generated per tier; encryption key escrowed | BLOCKED | After G9 |
| G15 | CDN / WAF / DDoS; shared rate limiting | BLOCKED | Vendor (P11) |
| G16 | Container images built and scanned | NOT READY | Dockerfiles written; not built locally (no Docker here); first build in CI |
| G17 | Jobs run once with ≥ 2 API instances (SKIP LOCKED claim verified in code) | NOT READY | Verify in staging |

## 3. Release management
| # | Item | Status | Evidence / owner |
|---|---|---|---|
| G18 | CI: tests, drift check, secret scan, prod-dependency audit, CodeQL | READY | `.github/workflows` |
| G19 | Release workflow with manual production gate | READY (code) | `release.yml` |
| G20 | GitHub `production` environment with required reviewers; tag protection | NOT READY | Founder configures in GitHub |
| G21 | Migration rehearsal on restored production data before each release | READY (procedure + tooling) | Runbook §6; proven 2026-10-11 |
| G22 | Production deployment authorised | BLOCKED | Founder approval at go-live |

## 4. Security
| # | Item | Status | Evidence / owner |
|---|---|---|---|
| G23 | Internal application security review | READY | `SECURITY_TESTING_HANDOFF.md` §3 |
| G24 | Independent penetration test; critical / high fixed and retested | BLOCKED | Tester not selected; **not performed** |
| G25 | Production boot safety check | READY | `productionSafetyProblems` + tests |
| G26 | Dependency triage (2 high in production deps: `postcss` via Next.js) | NOT READY | Item A-2: confirm Next.js upgrade path before public launch |
| G27 | Script Content-Security-Policy with nonces | NOT READY | Item E-1 (hardening; pen test to assess) |

## 5. Data, backup and recovery
| # | Item | Status | Evidence / owner |
|---|---|---|---|
| G28 | Backup / restore tooling with verification | READY | `DISASTER_RECOVERY.md` §3–4 |
| G29 | RPO / RTO / retention approved | BLOCKED | Founder decision (+ VALIDATE-KSA-8 retention) |
| G30 | PITR restore drill in staging | BLOCKED | After G12 |
| G31 | Privacy notice, terms, data retention and deletion periods | VALIDATION REQUIRED | VALIDATE-KSA-8, -13 |
| G32 | Legal holds | READY | Built + tested |

## 6. Providers
| # | Item | Status |
|---|---|---|
| G33 | Payment provider contracted, sandbox UAT passed, production keys | BLOCKED (P1; VALIDATE-KSA-3) |
| G34 | SMS sender ID registered; OTP delivery verified in KSA | BLOCKED (P2; VALIDATE-KSA-4) |
| G35 | Email domain verified (SPF / DKIM / DMARC) | BLOCKED (P3) |
| G36 | Maps / geocoding | BLOCKED (P8) |
| G37 | Video hosting (if Watch & Earn is in the pilot) | BLOCKED (P7; VALIDATE-KSA-5) |
| G38 | Logging / alerting with on-call routing | BLOCKED (P13) |

## 7. Operations and people
| # | Item | Status |
|---|---|---|
| G39 | Pilot configuration: market, cities, pilot merchants / partners allowlist, emergency stops tested | NOT READY (configure in staging, then production) |
| G40 | Support, operations and finance staff trained; roles assigned (least privilege) | NOT READY |
| G41 | Incident process, on-call rota, customer notice templates (EN / AR) | NOT READY (runbook §9 written; rota and templates pending) |
| G42 | Merchant payout KYC and agreements | VALIDATION REQUIRED (VALIDATE-KSA-11) |

## 8. Acceptance
| # | Item | Status |
|---|---|---|
| G43 | UAT executed and signed (EN + AR) | NOT READY (`UAT_PLAN.md`; needs staging) |
| G44 | Device matrix executed on physical devices | NOT READY (**not performed**) |
| G45 | Accessibility: keyboard and screen-reader spot checks | NOT READY (automated sweep 20/20 done) |
| G46 | Performance test on staging hardware | NOT READY (local baseline done; not a capacity figure) |
| G47 | Founder go / no-go | BLOCKED (after all above) |

## 9. Regulatory (VALIDATE-KSA) — answers come from qualified counsel, not from engineering
See the Stage 9 readiness doc §KSA checklist for each question. All **VALIDATION REQUIRED**.
