# Stage 2: Merchant onboarding, review and lifecycle

Scope delivered (and nothing beyond it): merchant sign-up, application wizard, legal/business profile, branches with
opening hours, merchant users and branch staff, document upload, authorised representative, settlement (IBAN) details,
agreement acceptance, application submission, the Admin review workbench (claim, document review, request changes,
approve, reject), suspend/reactivate, risk tier and trust level, and a full audit trail.

Not started (Stage 3 and later): Live Deals, Exclusive Deals, Vouchers, Watch & Earn, Partner Portal functionality, payments,
payouts, customer discovery. The merchant sidebar still lists the Stage 1 "coming later" placeholders for those areas.

## How to run and view it

```powershell
pnpm install
pnpm build:packages
pnpm db:migrate               # applies the Stage 2 migration (20261009000000_stage2_merchant_onboarding)
$env:SEED_USER_PASSWORD = "choose-a-dev-password"   # typed locally; never commit it
pnpm db:seed                  # sample merchants incl. two waiting for review and one empty draft

pnpm dev:api                  # http://localhost:4000   (OpenAPI docs: /docs)
pnpm dev:merchant             # http://localhost:3002   (Arabic: /ar)
pnpm dev:admin                # http://localhost:3005   (Arabic: /ar)
```

| What | Where | Sign in |
|---|---|---|
| Merchant app | http://localhost:3002 and http://localhost:3002/ar | `owner@newcafe.test` (empty draft: walk the wizard), `owner@olivebakery.test` / `owner@spiceroute.test` (submitted), `owner@harbourgrill.test` / `owner@dailydose.test` (active). Password = your `SEED_USER_PASSWORD`. Or create a new account at `/en/signup`. |
| Admin app | http://localhost:3005 and http://localhost:3005/ar | `risk@dealdash.test` (review), `merchant-management@dealdash.test` (review + suspend/trust/bank), `super@dealdash.test`. Password = `SEED_USER_PASSWORD`; the TOTP code is shown in the sign-in box in development. |

Development conveniences (not available when `NODE_ENV=production`): verification codes, invitation links and the TOTP
code are shown in the UI from `GET /v1/dev/last-email`, `/v1/dev/last-sms` and `/v1/dev/totp`.

Uploaded files go to `apps/api/.storage` (git-ignored) through the **development storage adapter** (`STORAGE_PROVIDER=local`).

## Rules implemented

| Area | Rule |
|---|---|
| Application lifecycle | `DRAFT -> SUBMITTED -> IN_REVIEW -> (CHANGES_REQUESTED -> RESUBMITTED -> IN_REVIEW) -> APPROVED / REJECTED`. The applicant can edit only in `DRAFT` and `CHANGES_REQUESTED`; branches are locked while under review. Every submission stores a snapshot so the reviewer sees what changed. |
| Submit gate | The server checks completeness (business, documents, representative, category/branding, branches with location and hours, settlement, agreement, e-mail and mobile verification). The same checklist drives the UI. |
| Activation | Organisation becomes `ACTIVE` only when the application is approved **and** the current agreement version is accepted. |
| Permissions before activation | Draft/onboarding merchants keep only profile, branch, application, agreement and support permissions. Suspended merchants keep profile read and support only. Enforced on every request by the API (`ActorService`), not by the UI. |
| Reviewer workflow | Claim before deciding. Request changes (sections, documents, EN/AR message), approve, reject (reason, EN/AR, appealable flag), release to queue, per-document accept/reject, internal notes. |
| Risk tier | `STANDARD` / `ENHANCED`. A configurable suggestion (category, IBAN holder mismatch, rejected document) is shown but never applied automatically. **Enhanced review needs two different reviewers** to approve. |
| Trust level | `NEW` / `STANDARD` / `TRUSTED`, changed only with `admin.merchants.manage` and a reason (before/after audited). It is a foundation only: nothing else consumes it yet. |
| Suspend / reactivate | `admin.merchants.manage` + reason. Takes effect on the merchant's very next request. |
| Team | Owner/Admin invite users (e-mail roles set a password; staff sign in with SMS OTP and are bound to one branch). The last active owner can never be removed or demoted. Deactivation revokes sessions immediately. |
| Documents | Signed upload intent, direct upload, completion check (size, magic-byte type, scanner hook, SHA-256). Files are private; reviewers get short-lived signed links. |
| Settlement | IBAN format + ISO 13616 checksum only. Stored encrypted; masked everywhere; never written to the audit log. Ownership verification is a manual Finance action. |
| Agreement | Versioned (`AgreementVersion`), accepted only by the named authorised signatory; the acceptance stores version, signatory, entity, time, IP and user agent. |
| Audit | Append-only (database triggers). Every state change records actor, role, organisation, subject merchant, reason, before/after and request id. |

## VALIDATE-KSA (deliberately NOT decided in code)

- **Document requirements** are configuration (`merchant.document_requirements`), currently three placeholders marked
  "to be confirmed". Real Saudi KYB requirements must come from counsel.
- **Agreement text** is placeholder text, labelled as such in both languages.
- **IBAN** is format-checked only. No bank-account verification service is integrated and no regulatory conclusion is implied.
- **Risk criteria** (`merchant.risk_criteria`) are mock values.
- **Re-application after rejection** (`merchant.reapply_after_rejection`) is stored as configuration but no re-apply flow exists yet.

## API surface added

Merchant (own organisation only; another organisation returns 404): `/v1/merchant-signup/*` (public), `/v1/merchants/:orgId/application/*`,
`/v1/merchants/:orgId/files/*`, `/v1/merchants/:orgId/branches/:id` (PATCH, `/status`), `/v1/merchants/:orgId/team/*`, `PATCH /v1/merchants/:orgId/profile`.
Admin: `/v1/admin/merchants` (list, `/queue`, `/:orgId`, `/:orgId/audit`, `claim`, `release`, `documents/:id/review`, `request-changes`,
`approve`, `reject`, `notes`, `risk-tier`, `trust-level`, `suspend`, `reactivate`, `bank/verify`).
Development storage: `/v1/storage/upload/:token`, `/v1/storage/download/:token` (signed, expiring, bound to key and size).
The generated contract is `packages/api-client/openapi.json`; regenerate with `pnpm api:contract`.

## Tests

```powershell
pnpm test                                  # all packages, apps and the API (needs the test database)
node tooling/e2e/stage2-browser.mjs        # real Edge/Chrome end to end (needs API + merchant + admin running, SEED_USER_PASSWORD set)
```

The browser script writes screenshots (English, Arabic/RTL, phone width) to `docs/screenshots/stage2/`.
