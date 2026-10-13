# Launch Readiness — Step 2: Pakistan Pilot Staging Readiness

Status 2026-10-11. Engineering for a deployable **staging** environment in Google Cloud Doha is complete in the repository; nothing is
provisioned (no cloud account yet). **Production is not deployed; public launch is not authorized.** Founder decisions of 2026-10-11 are
recorded in `LAUNCH_STEP1_DECISION_PACK_REV2_MULTI_MARKET.md`.

## 1. What was built (repository only)
| Item | Where | Verified |
|---|---|---|
| Provider-neutral S3-compatible storage (SigV4, no SDK): GCS now, S3 / R2 / onshore later | `apps/api/src/providers/s3-storage.ts` | Matches AWS's published SigV4 reference signatures; 5 unit tests |
| Configuration: `STORAGE_PROVIDER=s3` + `S3_*`; boot check accepts the Cloud SQL connector socket as encrypted transport, still refuses plain TCP | `packages/config` | 6 config tests |
| Migration image target (runtime image has no Prisma CLI) | `infra/docker/api.Dockerfile` `--target migrate` | `pnpm deploy --prod` verified locally under pnpm 12 |
| Terraform cell module + Doha staging env (Cloud Run, Cloud SQL PITR, buckets, in-region secrets and logs, alerts, budget 50/70/90/100 %, keyless GitHub deploys, Cloudflare-only edge) | `infra/terraform` | `terraform validate` valid (google 7.46.1); not applied |
| Staging CI/CD: build 7 images, Trivy scan, migration job, API then web roll-out, readiness check | `.github/workflows/staging-gcp.yml`, `tooling/deploy/deploy-gcp.mjs` | Dry run correct; production refused; unconfigured target refused |
| Latency tooling | `tooling/latency/doha-mumbai.mjs` | Real run (below) |
| Urdu customer inventory | `tooling/i18n/customer-urdu-inventory.mjs` → `docs/translations/customer-urdu-inventory.csv` | 607 keys (regenerated 2026-10-13) |

Quality gates on the changed code: typecheck (config, API), lint 0 errors, format clean, S3 + config tests pass.

## 2. Doha vs Mumbai — measured 2026-10-11
Globalping probes in Pakistan (14: PTCL Lahore, Nayatel, Cyber Internet, Sharp Telecom, Aero Cable, LEAP Digitals, data-centre networks)
→ Google's official per-region endpoints, 3 rounds. Details: `docs/performance/latency-doha-mumbai-2026-10-11.md`.

| Region | Time to first byte (median / p90) | Total (median / p90) | Failures |
|---|---|---|---|
| **Doha** (me-central1) | **77 / 96 ms** | 361 / 478 ms | 3 / 42 |
| Mumbai (asia-south1) | 522 / 984 ms | 900 / 1,336 ms | 3 / 42 |
| Dammam (KSA reference) | 94 / 109 ms | 382 / 512 ms | 3 / 42 |

Mumbai is **not** materially better — it is markedly slower from these networks (consistent with indirect routing between Pakistan and
India). **Gap:** no probe on Jazz, Zong, Telenor or Ufone mobile data. Remaining test plan: run the same tool's targets from phones on
the four carriers in Karachi, Lahore and Islamabad (browser test against the same endpoints, or volunteer devices) —
**EXTERNAL ACTION (people with local SIMs)**.

## 3. Urdu (customer app) readiness
- Founder decision: customer app English + Urdu; business portals English for the pilot; Arabic kept.
- Inventory: **606 customer keys, ~3,200 English words** (`customer-urdu-inventory.csv`, translator-ready, placeholders listed;
  dynamic keys may add a few more).
- Design (to implement next, additive): add `ur` to the platform locale list as **English + Urdu overrides** (untranslated keys fall
  back to English, never break); per-app language lists (customer EN / UR / AR by market; business apps unchanged); RTL already
  supported; Urdu font (Noto Nastaliq Urdu) and line-height; Western digits; API treats `ur` content as English fallback (deal content is
  EN/AR); AI assistant and support replies tested in Urdu.
- **Needed:** a professional Urdu translator and a native reviewer (**EXTERNAL**). Engineering estimate after translation: 3–5 days.

## 4. Pakistan pilot code blockers — RESOLVED (founder approved 2026-10-13, commit `a022f78`)
At the time of this review two code blockers were found:
- the customer money path was SAR-only;
- the display time zone was fixed to Asia/Riyadh.

Both were corrected by the founder-approved cross-market currency / time-zone correction:
- currency and time zone now come from Market / Country Configuration or the originating record (PK = PKR / Asia/Karachi, KSA = SAR / Asia/Riyadh);
- a development-only UAT gate lets the TESTING Pakistan market take new business (staging and production keep the normal gates).

See `docs/LAUNCH_STEP2B_CROSS_MARKET_CURRENCY_TIMEZONE.md`. Still open, and not technical:
- the founder-approved PKR commercial values (paid products stay CONFIGURATION REQUIRED until then);
- Urdu translation;
- the Pakistan SMS/OTP and payment providers.

## 5. Payment providers — shortlist / sandbox only (no contract, no credentials)
Authority to check each candidate against: SBP lists of [PSOs / PSPs](https://www.sbp.org.pk/f_links/f_links_pso.asp),
[EMIs](https://www.sbp.org.pk/PS/EMI.htm) and [DFS players](https://www.sbp.org.pk/DFS/Players.html) (licence type and whether
in-principle or commercial). Vendor marketing is not authority.

| Candidate type | Examples to evaluate | Methods | What to verify before sandbox |
|---|---|---|---|
| Wallet-owned gateways | JazzCash (Mobilink Microfinance Bank), Easypaisa | wallet, cards, voucher / OTC | licence holder; refunds incl. partial; webhooks; settlement reports |
| Aggregators (one API: wallets + cards + bank transfer) | e.g. Simpaisa, Safepay, XPay, PayFast | wallets, cards, IBFT / Raast | **SBP licence status on the official list**; partial refunds per method; signed webhooks; reconciliation files; settlement timing; KYB |
| Bank card gateways | acquiring banks' hosted payment pages | cards | merchant-of-record fit; refunds; reconciliation |
| Raast P2M | through a licensed participant | instant bank payments | refund mechanics; who integrates |

Per provider the evaluation sheet records: regulatory status (from SBP list), cards, bank / account payments, wallets, refunds, webhooks,
reconciliation, settlement, sandbox, API quality, onboarding requirements, fees (quote), payout capability, integration estimate
(1.5–3 weeks for one adapter incl. reconciliation mapping). Sandbox sign-up can start without a Pakistani entity for most; production
onboarding needs VALIDATE-PAKISTAN-ENTITY / -PAYMENTS / -SBP.

## 6. SMS / OTP — direction approved: local provider / aggregator
Authority: PTA numbering and short-code procedure ([FAQ](https://www.pta.gov.pk/assets/media/2025-04-29-faqs_numbering.pdf),
[short-code SOP](https://www.pta.gov.pk/assets/media/2025-04-29-sop_allocation_short_code_content_based_services.pdf)): CVAS
registration certificate, short-code allocation (annual number fee and processing fee per PTA), registration with each carrier.
Shortlist approach: (a) local aggregators with direct connections to Jazz, Zong, Telenor and Ufone — verify their PTA registration and
carrier agreements; (b) carriers' own enterprise SMS; (c) international aggregators only with local registration (LOA). Evaluate: OTP
delivery time per carrier, delivery receipts (callback), sender / short-code handling on Telenor / Ufone, price per message, sandbox.
WhatsApp OTP is not a launch dependency. Staging uses the development SMS inbox until a sandbox exists; one adapter ≈ 1 week.

## 7. Watch & Earn — video provider (approved for the pilot)
Existing `VideoProvider` abstraction (upload + playback); qualification, fraud rules and points stay server-side and provider-neutral.
Options: Cloudflare Stream (same edge vendor, PoPs in Karachi / Lahore / Islamabad, per-minute pricing); Mux; Bunny Stream; in-cloud
(Cloud Storage + Transcoder + CDN: in-region storage, more engineering). Staging: development video adapter until a sandbox account
exists (**EXTERNAL: vendor trial account**); adapter ≈ 1 week. VALIDATE-PAKISTAN-PROMOTIONS covers sponsored-video rules.

## 8. Pakistan legal / tax adviser — scope (no adviser selected or engaged)
Entity structure for DealDash in Pakistan; federal and provincial tax (sales tax on services / digital services, withholding on
merchant payouts, registrations); invoicing / e-invoicing; consumer terms; privacy / data protection (current law status, draft bill
tiers); cross-border hosting and processing (Doha staging and production candidate); payment-flow structure and merchant of record;
merchant settlement; vouchers (validity, refunds, breakage); loyalty / rewards points; Watch & Earn advertising and rewards; KYB / KYC;
SBP (whether any activity is regulated; partner-contract obligations), PTA (SMS / OTP, short codes), FBR and provincial authorities;
retention; cyber-crime-law obligations. Deliverable: written answers per VALIDATE-PAKISTAN item with sources, entered in the Market
validation register as evidence.

## 9. Information pack likely required by providers / merchants (prepare; no entity created)
Company registration documents of the contracting entity (SECP certificate, memorandum / articles), tax registration (NTN / STRN as
applicable), directors' and beneficial owners' identity documents, registered address and proof, bank account letter, authorised
signatory letter, website / app links (staging demo), terms of service, privacy policy, refund policy, product description and
expected volumes, merchant onboarding (KYB) policy, data-protection and security summary (`SECURITY_TESTING_HANDOFF.md`), contact for
compliance. Which entity signs is the adviser's first answer.

## 10. VALIDATE-PAKISTAN — all still open
ENTITY, RESIDENCY, SBP, PAYMENTS, SMS, TAX, TAX-INVOICE, CONSUMER-PROTECTION, POINTS, PROMOTIONS, RETENTION, CYBER, FX, LANGUAGE,
ECOMMERCE, KYB, DATA-PROTECTION (plus the founder's list: personal-data law status, cross-border processing, sensitive-data
localization, payment-data handling, gateway structure, tax / invoicing, retention, KYB, SMS sender rules, bank / partner contract
requirements, SBP obligations). KSA / UAE / Qatar registers unchanged.

## 11. FOUNDER / EXTERNAL ACTIONS REQUIRED
1. Google Cloud organisation, billing account (USD — VALIDATE-PAKISTAN-FX for paying from Pakistan), staging project.
2. Terraform state bucket + first `terraform apply` (engineer with project access).
3. GitHub: `staging` environment and its variables (from Terraform outputs); later `production` with required reviewers.
4. Domain confirmation + Cloudflare account (needed for UAT access — PRIVATE mode works only for engineers).
5. Alert e-mail addresses and engineer accounts for staging access.
6. Payment sandbox accounts for the shortlisted providers (after shortlist approval).
7. SMS provider sandbox / test account; PTA / carrier registration later (entity-dependent).
8. Video provider trial account.
9. Urdu translator and native reviewer.
10. Pakistan legal / tax adviser selection (scope §8).
11. Mobile-carrier latency tests (§2).
12. Decision on §4 (multi-currency consumer flows, market time zone) before Pakistan UAT of purchases.

## 12. Staging cost estimate (Doha, list prices, ±50%)
PRIVATE mode ≈ **USD 110–170 / month**; EDGE mode (load balancer + Cloud Armor) ≈ **USD 145–215 / month** — within the USD 300 target
and the USD 600 ceiling (alerts at 50 / 70 / 90 / 100 %). Excludes provider sandbox fees (usually free) and GitHub Actions minutes for
image builds.
