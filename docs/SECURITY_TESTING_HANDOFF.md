# DealDash — Security Review and Penetration-Test Handoff

Stage 9. **No penetration test has been performed.** This document is the internal application security review (code and
configuration, done by engineering) and the package for an independent tester. The tester is **not selected** (founder decision).

## 1. Scope for the penetration test
- API (`/v1/*`, NestJS) and the five web apps: customer (3001), merchant (3002), staff (3003), partner (3004), admin (3005).
- Roles: guest; customer; staff; merchant owner / manager; partner roles; DealDash admin roles (super admin, operations, finance, risk,
  support, content, market). A test account per role is created in **staging** (never production) by engineering.
- Out of scope until contracted: third-party providers' own platforms; infrastructure of the (unselected) hosting provider.
- Environment: staging with provider sandboxes. **Production testing only with written founder approval and a window.**
- Priority areas (business-logic abuse matters more than generic scanning here):
  1. Tenant isolation — merchant A reaching merchant B's deals, reservations, settlements, cases, files (by id guessing).
  2. Partner isolation — partner reaching merchants outside its network or another partner's records.
  3. Money — voucher checkout, payment webhooks (signature, replay), refunds (partial, duplicate, over-refund), settlement runs,
     payouts (B2 instruct / callback), adjustments, reward points (earning, reversal B4, negative balances).
  4. Inventory races — reservations and vouchers beyond stock; double redemption; replayed QR / manual codes.
  5. Maker-checker — a single person completing a two-person action (config changes B7, adjustments, refunds above threshold,
     data requests, legal-hold lift, settlement overrides, payouts).
  6. Authentication — OTP brute force and request flooding, password lockout, MFA bypass for admin, session fixation / revocation, CSRF.
  7. Customer case replies (B6) — reading other customers' cases, card data in replies, HTML / script injection.
  8. File upload and signed-URL access (evidence, media).
  9. AI assistant / copilot — prompt injection that tries to reach other tenants' data or trigger actions without approval.

## 2. Authentication and session controls (as implemented)
| Control | Implementation |
|---|---|
| Customer / staff sign-in | Mobile OTP; code TTL 300 s; 5 attempts; resend cooldown 30 s; 5 requests / hour / number (governed configuration, bounded) |
| Merchant / partner sign-in | Email + password (hashed); lock after 5 failures for 15 minutes; optional TOTP MFA |
| Admin sign-in | Password + **mandatory** TOTP MFA (`auth.admin.mfa_required`) |
| Sessions | Server-side session record; cookie `httpOnly`, `SameSite=Lax`, `Secure` in production; idle timeout 60 min; absolute 14 days; revocable |
| CSRF | Per-session token required in `X-CSRF-Token` on state-changing requests |
| Native clients | `Authorization: Bearer` accepted (audience-checked) |
| Rate limiting (Stage 9) | Per-IP limits for the whole API and stricter for `/v1/auth/*` POSTs; `429` + `Retry-After`; health and webhooks exempt. **In-memory per instance** → the WAF provides the shared limit in production |
| Errors | OTP failures never reveal remaining attempts; an unknown account and a wrong password get the same response. **Known residual:** a *locked* account answers `RATE_LIMITED`, so after 5 failures an attacker learns the email exists (low; tester to assess; candidate fix E-6: answer locked and unknown alike) |

## 3. Application security review (OWASP Top 10 2021, internal — not a pen test)

| Risk | Controls in place | Residual / to test |
|---|---|---|
| A01 Broken access control | Permission codes per endpoint (`@RequirePermissions`); audience per app; tenant scoping in services; other tenants' records return **404** (not 403); maker-checker enforced server-side (different person), not only in the UI | Tester to attempt IDOR across every id-taking endpoint |
| A02 Cryptographic failures | TLS required to the database in production; `FIELD_ENCRYPTION_KEY` for sensitive fields; HMAC-SHA256 signed callbacks with timing-safe comparison and a 5-minute window; no card data stored (PAN pattern refused: `CARD_DATA_FORBIDDEN`) | Key escrow and rotation procedure (E-5) |
| A03 Injection | Prisma parameterised queries; raw SQL only with bound parameters; Zod validation on every body / query; React escapes output | Tester: stored XSS through names, reviews, case notes, campaign text (EN/AR) |
| A04 Insecure design | Append-only ledgers and histories (DB triggers); idempotency keys on money-moving POSTs; inventory by conditional update under the row lock (`… WHERE available >= q`) plus a per-customer advisory lock; governed configuration with bounds | Business-logic abuse list in §1 |
| A05 Security misconfiguration | Boot-time production safety check; helmet (frame deny, HSTS in production, no-referrer); web apps send X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy (camera only staff, location only customer), COOP, a minimal CSP (`frame-ancestors 'none'; object-src 'none'; base-uri 'self'`); Swagger UI off in production | **No script-src CSP yet** (needs Next.js nonces) — hardening item E-1 |
| A06 Vulnerable components | `pnpm audit --prod` in CI (critical blocks); CodeQL; SBOM per release | 2026-10-11: production deps 0 critical, **2 high** (`postcss` inside Next.js — build-time CSS processing of our own files), 3 moderate (`postcss`, `js-yaml` via Swagger, not served in production). Dev-only: 2 critical in `tinypool` (vitest test runner). Triage item A-2 |
| A07 Identification / authentication failures | §2 | Credential stuffing against merchant / partner email login (WAF + lockout) |
| A08 Software / data integrity | Signed webhooks; release images by tag; protected production environment; migrations forward-only with drift check | GitHub environment protection to configure (founder) |
| A09 Logging / monitoring failures | JSON logs with redaction; access log; complete audit log (actor, reason, before/after) for every business change; health endpoints | Alert routing to configure with the vendor |
| A10 SSRF | The API makes outbound calls only to configured provider endpoints; no user-supplied URLs are fetched server-side | Confirm when real provider adapters are added |

Stage 9 security tests (`apps/api/test/stage9-production.e2e.test.ts`, `packages/config/src/config.test.ts`): rate limiting returns 429
with `Retry-After`; security headers present; production boot check refuses unsafe settings and never echoes secrets; signed
callback verification (bad signature, stale timestamp, replay idempotent); customer case isolation (another customer → 404); PAN in a
reply refused; maker-checker on config changes, legal-hold lift and payouts.

## 4. Data protection
- Personal data: mobile numbers, names, emails, device data, location (coarse unless permitted), case messages, uploaded evidence.
- Card data: **never** handled — the payment provider's hosted fields / redirect; free-text card numbers are refused.
- Privacy operations: data export and deletion requests (reviewed by a person; deletion blocked by open money matters and **legal
  holds**, Stage 9); retention periods are **VALIDATE-KSA**.

## 5. What the tester receives
Staging URLs; one account per role (created on request); this document; `docs/DEALDASH_API_ARCHITECTURE.md`; the OpenAPI
(`packages/api-client/openapi.json`, 670 paths); the permission catalogue; rules of engagement signed by the founder.

## 6. Findings process
Severity by CVSS 3.1 + business impact. Critical / high: fixed and retested before public launch. Medium: fixed before or within 30 days
of launch with founder sign-off. Low: backlog. Each finding gets an owner, a fix commit and a retest result in the go-live record.
