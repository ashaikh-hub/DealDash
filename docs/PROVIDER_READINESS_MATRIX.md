# DealDash — Provider Readiness Matrix

Stage 9, 2026-10-11. **No vendor has been selected** for any row below; selection is a founder decision and is not made here. Every
provider sits behind an interface in `apps/api/src/providers/interfaces.ts`, so a contracted vendor is one adapter class plus
configuration, without touching product code. The production boot check (`productionSafetyProblems`) **refuses to start** while any
row still uses a development adapter, so a missing vendor can never reach customers silently.

Status legend: **READY** (works in production as is) · **ADAPTER NEEDED** (interface + development adapter exist; vendor adapter to
build after selection) · **NOT SELECTED** (founder decision) · **VALIDATE-KSA** (regulatory question to answer before go-live).

| # | Capability | Interface / today | Production status | Blocking for | KSA / regulatory questions (not answered here) | Needed from the vendor | Engineering after selection |
|---|---|---|---|---|---|---|---|
| P1 | **Payment (card / wallet checkout, refunds, webhooks)** | `PaymentProvider`; `MockPaymentProvider` (hosted-page flow, signed webhooks, refunds, partial refunds) | NOT SELECTED · ADAPTER NEEDED | Pilot and public launch | VALIDATE-KSA-3: licensed PSP / acquirer requirements, mada support, 3-D Secure, settlement currency, merchant-of-record model | Sandbox + production keys; webhook signing scheme; refund API; settlement reports | Adapter + webhook signature verification; sandbox UAT of checkout / refund / partial refund / duplicate webhook; reconciliation import mapping |
| P2 | **SMS (OTP, notices)** | `SmsProvider`; `MockSmsProvider` (dev inbox) | NOT SELECTED · ADAPTER NEEDED | Pilot (customers and staff sign in by OTP) | VALIDATE-KSA-4: sender-ID registration, OTP routing rules, consent / quiet hours for non-OTP messages | Registered sender ID; delivery-receipt callbacks; KSA route quality | Adapter; delivery receipts to `/v1/webhooks/notifications` (signed); fallback order (B3 `fallback`) |
| P3 | **Email** | `EmailProvider`; `MockEmailProvider` | NOT SELECTED · ADAPTER NEEDED | Pilot (merchant / partner / admin notices, invoices) | VALIDATE-KSA-4 (consent) | Verified domain (SPF / DKIM / DMARC); bounce + complaint callbacks | Adapter; DNS records; bounce handling |
| P4 | **Push** | `PushProvider`; `MockPushProvider` | NOT SELECTED · ADAPTER NEEDED | Public launch (web push optional for pilot) | VALIDATE-KSA-4 | App credentials (web push / mobile) | Adapter; device-token lifecycle |
| P5 | **Object storage (evidence, media, invoices)** | `StorageProvider`; `LocalStorageProvider` (signed, expiring URLs), `MockStorageProvider` | NOT SELECTED · ADAPTER NEEDED | Pilot | VALIDATE-KSA-1 (residency of stored personal data) | Private buckets, versioning, encryption, signed URLs, lifecycle rules | Adapter (signed upload / download); migration of any local files |
| P6 | **File scanning (malware)** | `FileScanner`; `DevFileScanner` (type sniffing + size limits only) | NOT SELECTED · ADAPTER NEEDED | Public launch (pilot acceptable with type / size checks and staff-only evidence — founder decision) | — | Scanning API or bucket-event scanning | Adapter; quarantine path |
| P7 | **Video hosting / streaming (Watch & Earn)** | `VideoProvider`; `MockVideoProvider` | NOT SELECTED · ADAPTER NEEDED | Watch & Earn at pilot (if in pilot scope) | VALIDATE-KSA-5: content / advertising rules for sponsored video | Upload, transcoding, playback with view events | Adapter; playback event mapping to the existing qualification rules |
| P8 | **Maps / geocoding** | `MapsProvider`; `MockMapsProvider` | NOT SELECTED · ADAPTER NEEDED | Pilot (branch addresses, distance) | — | Geocoding + map tiles; Arabic place names | Adapter; usage limits |
| P9 | **Settlement payouts (B2)** | `PayoutProvider`; `ManualPayoutProvider` (**default**), `MockPayoutProvider` | **READY for manual payouts** (finance pays from the bank and records the bank reference) · provider adapter NOT SELECTED | Nothing for pilot if manual payouts are accepted (**FOUNDER DECISION**) | VALIDATE-KSA-2: payout cycle, minimums, KYC of merchants, withholding (B1) | Bank file format or payout API; status callbacks | Adapter; signed status callbacks already implemented (`/v1/webhooks/payouts`) |
| P10 | **Hosting / compute / managed PostgreSQL** | Dockerfiles; provider-neutral runbook | NOT SELECTED | Everything | VALIDATE-KSA-1 (residency, cross-border transfer) | KSA-region (or approved) hosting; managed PostgreSQL 18 + PostGIS with PITR | Infrastructure as code; deploy hook; staging + production |
| P11 | **CDN / WAF / DDoS** | — | NOT SELECTED | Public launch | — | TLS, WAF rules, rate limiting, bot protection | Configuration; shared rate limits |
| P12 | **Secret manager** | Environment variables | NOT SELECTED | Pilot | — | Managed secrets with access audit | Wiring in deploy |
| P13 | **Logging / monitoring / alerting** | JSON logs, health endpoints, audit log | NOT SELECTED | Pilot | VALIDATE-KSA-1 (log residency; logs are redacted) | Log store, metrics, alert routing (on-call) | Dashboards + alert rules (`PRODUCTION_RUNBOOK.md` §7) |
| P14 | **AI model for the assistants** | `AiProvider`; `BuiltinAiProvider` (rules-based classifier; grounded answers only) | **READY as built-in** · hosted model NOT SELECTED (optional) | Nothing (built-in works) | VALIDATE-KSA-1 if a hosted model receives personal data (today it never does) | — | Optional adapter |
| P15 | **Email/SMS template content (Arabic)** | Localization dictionaries | Copy exists; **native review pending (B5)** | Pilot | — | — | Import reviewed CSV (`tooling/i18n/import-translations.mjs`) |
| P16 | **Penetration tester** | `SECURITY_TESTING_HANDOFF.md` | NOT SELECTED | Public launch | — | Independent test against staging | Fix + retest findings |
| P17 | **E-invoicing (if DealDash issues tax invoices)** | Billing / invoices exist (Phase 5) | Requirement unknown | Depends on VALIDATE-KSA-6 | VALIDATE-KSA-6: e-invoicing obligations for DealDash's own fees | Possibly a certified e-invoicing integration | To scope after the answer |

## Selection criteria the founder may use (not a recommendation of any vendor)
KSA presence and data residency; sandbox quality; webhook / callback signing; Arabic support; delivery or success rates in KSA;
pricing at pilot and at scale; contract exit terms and data export; support SLA; certifications relevant to the capability.

## Pilot minimum set (engineering view; founder decides)
P1 payment, P2 SMS, P3 email, P5 storage, P8 maps, P10 hosting, P12 secrets, P13 logging — plus P9 manual payouts accepted, and P7 only
if Watch & Earn is in the pilot. Each needs a sandbox for UAT in staging before production keys are issued.
