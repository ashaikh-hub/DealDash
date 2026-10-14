# DealDash — Internal Staging Deployment Plan (Priority 2 preparation)

Status 2026-10-14: **plan only. Nothing is provisioned, no cloud account is used, no charges exist.** Builds on the founder-approved
staging decision of 2026-10-11 (Google Cloud Doha, staging only — not a production decision) and the repository work in
`LAUNCH_STEP2_PAKISTAN_STAGING_READINESS.md`. Production deployment and public launch are not authorized.

## 1. Target staging architecture
One "cell" (`infra/terraform/modules/gcp-cell`, env `infra/terraform/envs/staging-doha`), everything in one region:

```
Testers' browsers
   │  HTTPS
Cloudflare (DNS, TLS, WAF, Cloudflare Access login — only invited people get through)      [EDGE mode, once a domain exists]
   │
Google global external HTTPS load balancer + Cloud Armor (admits Cloudflare's IP ranges only)
   │
Cloud Run (me-central1, Doha)
   ├─ api        NestJS, min 1 / max 2 instances, CPU always on (scheduled jobs run in-process)
   ├─ customer   Next.js, 0–2 instances
   ├─ merchant / staff / partner / admin   Next.js, 0–2 instances each
   └─ migrate    Cloud Run job, run by each release before traffic moves
   │
Cloud SQL PostgreSQL 18 (private connector only) · Cloud Storage (files, backups) · Secret Manager · regional log bucket
```

**PRIVATE mode** (no domain yet): no load balancer, no public access at all; named engineers reach the services with
`gcloud run services proxy`. It is cheaper but unusable by non-engineer testers. **EDGE mode** is the target for internal UAT.

## 2. Region and cloud services
- Cloud: **Google Cloud**. Region: **me-central1 (Doha)** for every regional resource.
- Measured from Pakistan networks, time to first byte: Doha 77 ms, Dammam 94 ms, Mumbai 522 ms.
- Services used:
  - Cloud Run (services and job), Cloud SQL for PostgreSQL, Cloud Storage, Secret Manager, Artifact Registry;
  - Cloud Logging (regional bucket), Cloud Monitoring (alerts, uptime check), Cloud Billing budget;
  - IAM Workload Identity Federation;
  - EDGE mode only: global external Application Load Balancer, Cloud Armor, Certificate Manager.
- Outside Google: Cloudflare (Free plan + Access, free up to 50 users) and GitHub Actions.

## 3. Customer app
- Next.js image (`infra/docker/web.Dockerfile`, `APP=customer`) on Cloud Run.
- Host: `app.staging.<domain>`.
- `NEXT_PUBLIC_API_URL` is baked in at build time.
- Scales to zero (a cold start of a few seconds is acceptable in staging).
- English, Arabic and Urdu all ship.
- The development presentation layer (`presentation.ts`) is off, because it is gated on `NODE_ENV=development`. Staging therefore shows the data exactly as stored.

The four business portals deploy the same way: `merchant.`, `staff.`, `partner.` and `admin.staging.<domain>`.

## 4. API / backend
- NestJS image (`infra/docker/api.Dockerfile`), 1 vCPU and 1 GiB, at least one instance always running, at most two.
- Runtime settings: `NODE_ENV=production`, `APP_ENV=staging`, JSON logs, rate limits of 600/min overall and 20/min on sign-in.
- The production boot check (`productionSafetyProblems`) runs. In staging it allows development adapters only because `ALLOW_MOCK_PROVIDERS=true`, and it still refuses:
  - plain-TCP database connections;
  - the `postgres` admin account;
  - `TEST_DATABASE_URL`.
- Health checks: `/v1/health/live` for startup and liveness, `/v1/health/ready` after each deploy.
- Development endpoints (`/v1/dev/*`) return 404 in staging, because `NODE_ENV=production`. **See gap G-1.**

## 5. PostgreSQL / database
- Cloud SQL **PostgreSQL 18**, Enterprise edition, `db-g1-small` (1 shared vCPU, 1.7 GB), single zone, 10 GB disk that grows automatically.
- Database `dealdash_staging`, application role `dealdash_app` with a generated password.
- Reachable only through the Cloud SQL connector (IAM and mTLS). The public IP has no authorised networks, and the instance accepts encrypted connections only.
- PostGIS is created by the migrations.
- PostgreSQL 18 is generally available on Cloud SQL, and shared-core tiers are an Enterprise-edition option. Shared-core tiers are **not covered by the Cloud SQL SLA**, which is acceptable for staging.
- Confirm that `POSTGRES_18` with `db-g1-small` is offered in me-central1 at `terraform plan` time. That check is free. Fall back to PostgreSQL 17 only after the compatibility test.

## 6. Storage
- **`…-files` bucket** (uploads and merchant media):
  - private, public access prevented, versioned (old versions deleted after 30 days);
  - CORS limited to the four app origins;
  - reached through the provider-neutral S3 adapter with the runtime account's HMAC key; browsers use pre-signed URLs.
- **`…-backups` bucket:** logical backups, retained 30 days, **not locked** (a lock is irreversible; production only).
- **Terraform state:** a separate private, versioned, in-region bucket. It holds generated secrets, so it is restricted to the platform owner and engineers.

## 7. Authentication
- **Application sign-in is unchanged:**
  - customers use phone OTP;
  - business and admin users use password + TOTP;
  - sessions are cookies with CSRF protection.
- **In staging the SMS provider is the development adapter.** No real SMS is sent. Codes for synthetic test numbers appear in the admin **Staging test inbox** (G-1), and are no longer written to the log.
- **Who can open staging at all:** Cloudflare Access, with an e-mail one-time PIN or Google sign-in for an explicit list of tester e-mails. A second login sits in front of the app login.
- **Deployments:** GitHub OIDC → Workload Identity Federation. There are **no service-account keys anywhere**, and only the `staging` environment of `ashaikh-hub/DealDash` is trusted.

## 8. Environment variables and secrets
Only names are listed here; no values appear in the repository, CI logs or this document.

- **Non-secret settings, set by Terraform:**
  - `NODE_ENV`, `APP_ENV`, `API_PORT`, `API_PUBLIC_URL`, `CORS_ORIGINS`;
  - `LOG_FORMAT`, `RATE_LIMIT_PER_MINUTE`, `AUTH_RATE_LIMIT_PER_MINUTE`, `TRUST_PROXY_HOPS`;
  - `STORAGE_PROVIDER=s3`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`;
  - `ALLOW_MOCK_PROVIDERS=true`;
  - the `*_PROVIDER` settings stay at their defaults (development adapters; payouts `manual`).
- **Secrets** (Secret Manager, replicated only in me-central1, passed to the services as references):
  - `DATABASE_URL`, `SESSION_SECRET`, `FIELD_ENCRYPTION_KEY`;
  - `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`;
  - `PAYOUT_WEBHOOK_SECRET`, `NOTIFY_WEBHOOK_SECRET`;
  - all generated by Terraform; none is typed by a person.
- **GitHub `staging` environment:**
  - variables `GCP_PROJECT`, `GCP_REGION`, `GCP_ARTIFACT_REGISTRY`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOYER_SA`, `STAGING_API_URL` and `STAGING_HEALTH_URL`, all taken from Terraform outputs;
  - secrets `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`, a Cloudflare service token for the post-deploy readiness check.
- Staging secrets are **never** shared with development or production.
- **Also set by Terraform:**
  - `MERCHANT_APP_URL` and `PARTNER_APP_URL` (G-3, closed);
  - `STAGING_TEST_PHONE_PREFIXES` and `STAGING_TEST_EMAIL_DOMAINS` (G-1).
- **Seed-only secrets** (G-2): `SEED_USER_PASSWORD` and `SEED_ADMIN_TOTP_SECRET`, generated, and given only to the seed job.

## 9. Logging and monitoring
- **Logs:**
  - every log goes to a regional bucket in me-central1, kept 30 days;
  - the global `_Default` bucket is excluded, so logs stay in-region;
  - the API writes structured JSON;
  - the load balancer logs 20 % of requests.
- **Alerts** (e-mail to the founder's alert addresses):
  - API 5xx errors above 5 in 5 minutes;
  - a failed migration job;
  - in EDGE mode, the API readiness uptime check failing for 10 minutes;
  - the billing budget.
- Query Insights is on; statements slower than 1 second are logged.
- No Sentry or other third-party APM until the residency question is answered.

## 10. Backups
- Cloud SQL automated daily backups: 14 kept, plus 7 days of point-in-time recovery, all in-region.
- Logical `pg_dump` exports go to the backups bucket (30 days) before risky releases.
- One restore drill into a scratch database is part of the GO checklist.
- Staging holds synthetic data only, so its backups protect the test schedule, not customers.

## 11. Domain / staging URLs
The approved naming principle gives:
- `app.staging.<domain>`
- `merchant.staging.<domain>`
- `staff.staging.<domain>`
- `partner.staging.<domain>`
- `admin.staging.<domain>`
- `api.staging.<domain>`

**The domain is not yet confirmed (founder).** Until then the cell runs in PRIVATE mode, with no public URLs. Staging pages get `noindex` and are never linked publicly.

## 12. SSL
- **Browser to Cloudflare:** Cloudflare's edge certificate.
- **Cloudflare to the load balancer:** a Google-managed certificate (Certificate Manager, DNS authorisation). This works behind the Cloudflare proxy, with Cloudflare SSL mode set to **Full (strict)**.
- **Database:** connector mTLS plus `ENCRYPTED_ONLY`.
- There is no HTTP origin anywhere.

## 13. Deployment process
1. **One-time setup (engineer with project access):**
   - create the state bucket;
   - `terraform init`, then `terraform plan`; the plan is reviewed by the founder for cost and resources;
   - `terraform apply` with placeholder images;
   - copy the outputs into the GitHub `staging` environment.
2. **Each release:**
   - tag `vX.Y.Z` on approved `main`;
   - the `staging-gcp.yml` workflow builds 7 images (api, migrate, 5 web) and scans them with Trivy (high/critical are reported);
   - `tooling/deploy/deploy-gcp.mjs` then runs:
     1. the migration job (forward-only `prisma migrate deploy` plus the permission-catalogue sync; no seed, no reset);
     2. the API roll-out;
     3. the web roll-outs;
     4. the readiness check.
3. **Rollback:** redeploy the previous tag's images. Migrations are forward-only, so a broken migration means a fix-forward or a point-in-time restore.
4. The deploy tool refuses any target other than `staging`.
5. **Once, after the first release:** `node tooling/deploy/seed-gcp.mjs` with the same variables. It runs the one-off synthetic seed (G-2) and refuses anything but staging and an empty database.

## 14. GitHub integration / CI-CD
- The existing `ci.yml` (lint, typecheck, tests, `pnpm audit --prod`), `codeql.yml` and `release.yml` stay as they are.
- `staging-gcp.yml` does nothing until the repository variables exist.
- **Needed:**
  - the GitHub `staging` environment, restricted to tags `v*`;
  - optionally a required reviewer, which makes every staging deploy wait for your click.
- No production environment is created.

## 15. Database migrations and seed data
- **Migrations:** the 24 existing migrations apply to an empty database through the migrate job. This is the same forward-only path the dev database used, with no reset.
- **Seed:** staging receives **synthetic data only**, and never a copy of the dev database. The one-off `dd-staging-seed` job (G-2, closed) runs once, after the first release.
- **First admin:** created by the seed (`super@dealdash.test`, plus the other role accounts). It signs in with the seed password and the shared authenticator key, both read in Secret Manager.

## 16. Security controls
- **Not reachable from the internet:**
  - Cloudflare Access and Cloud Armor allow traffic from Cloudflare only;
  - Cloud Run ingress is internal-and-load-balancer only;
  - the database has no network path except the connector;
  - the buckets are private with public access prevented.
- **Secrets:** generated, stored in in-region Secret Manager, never in images, Git or CI logs. Deploys are keyless (OIDC).
- **Application protections already built:**
  - the boot safety check;
  - rate limits;
  - CSRF;
  - field encryption of personal data;
  - audit trail;
  - launch controls (allowlist and per-market stops).
- **Pipeline:** image vulnerability scan, CodeQL and dependency audit.
- **Spending:** hard caps through sizing (max instances, shared-core DB, no HA) plus budget alerts. A budget alerts; it does not stop spending.

## 17. Access controls
| Who | Access |
|---|---|
| Founder | Project Owner + Billing (your Google account) |
| Engineer(s) | Editor-level on the staging project only; listed in `engineer_members` |
| Testers | Cloudflare Access e-mail list, then app accounts with roles |
| GitHub Actions | Deployer account: `run.developer`, `artifactregistry.writer`, `run.invoker`, and "act as runtime" only |
| Runtime | Cloud SQL client, log/metric writer, its bucket, its secrets — nothing else |

Production gets a separate project later; nobody's staging access carries over to it.

## 18. Estimated monthly staging cost
List prices, ±50 %. Doha is priced above US regions.

| Item | PRIVATE | EDGE |
|---|---|---|
| Cloud SQL `db-g1-small` + 10–20 GB SSD + backups | 35–50 | 35–50 |
| API, 1 instance always on (1 vCPU / 1 GiB) | 55–75 | 55–75 |
| 5 web apps, scale to zero | 5–20 | 5–20 |
| Storage, Artifact Registry, Secret Manager, logs (mostly free tier) | 5–15 | 5–15 |
| Load balancer forwarding rule + Cloud Armor policy and rules | — | 25–40 |
| Data egress (internal testing) | 1–5 | 1–5 |
| **Total (USD / month)** | **≈ 110–170** | **≈ 145–215** |

- **Outside Google:**
  - Cloudflare Free plan + Access: USD 0 for up to 50 users;
  - domain: about USD 10–20 a year if new;
  - GitHub Actions: about 70 build minutes per release, within the free allowance on most plans.
- **Budget:** a USD 600 ceiling with alerts at 50, 70, 90 and 100 % and on the forecast, against the target of USD 300 or less.

## 19. Resources that charge from the moment they are created
Running costs start even with no traffic:
- **Cloud SQL instance:** billed every hour it exists, even when idle. This is the largest fixed cost. Stopping the instance stops compute charges, but storage is still billed.
- **API Cloud Run service (min 1 instance, CPU always on):** billed continuously. Setting min = 0 would stop scheduled jobs.
- **Load balancer forwarding rule and Cloud Armor policy (EDGE only):** billed hourly.
- **Small but immediate:** the Cloud SQL IPv4 address, stored container images, bucket storage, Secret Manager versions.

Free until used: web apps at zero, logging up to the free tier, Workload Identity, IAM, budgets, Certificate Manager (a few certificates).

**Mitigations:**
- delete the cell with `terraform destroy` after removing deletion protection;
- or stop Cloud SQL and set API min = 0 between test cycles.

## 20. External providers still missing
| Need | Staging uses | Real provider status |
|---|---|---|
| SMS / OTP | development adapter (code appears in the log) | Pakistan local aggregator — not selected; PTA / carrier registration depends on the entity |
| E-mail | development adapter | not selected (Postmark recommended) |
| Push | development adapter | not selected (FCM/APNs need app accounts) |
| Payments | development adapter (no real money) | PK shortlist only; no sandbox accounts |
| Payouts | `manual` | manual process until a provider exists |
| Video (Watch & Earn) | development adapter | not selected (Cloudflare Stream / Mux / Bunny) |
| Maps tiles | in-app ring map without tiles | not selected |
| AI assistant | built-in governed rules (no external model) | none needed for staging |
| Error tracking / APM | Cloud Logging only | pending residency |
| Cloudflare, domain | needed for EDGE mode | founder action |

## Confirmations
- **Deployed:** the API, the customer app, the merchant, staff, partner and admin portals, all 24 migrations, and synthetic seed data (after G-2).
- **Mocked / test-only:**
  - SMS, e-mail, push, payments, video and maps are development adapters;
  - payouts are manual;
  - no real money moves, and no real SMS or e-mail is sent;
  - all data is synthetic;
  - Pakistan stays TESTING, and paid products stay CONFIGURATION REQUIRED.
- **Needs your account, credentials or approval:**
  - Google Cloud organisation, billing account and staging project;
  - approval of the `terraform plan` and of the first `apply`;
  - domain choice and Cloudflare account;
  - the GitHub `staging` environment (repository admin);
  - alert e-mail addresses;
  - the tester and engineer e-mail lists;
  - approval of gap fixes G-1 to G-3.
- **Data residency:**
  - For staging with synthetic data, **no residency issue is expected**: no real personal data is processed, and everything stays in Doha.
  - Testers' own e-mails and phone numbers are the only real personal data. Use dedicated test numbers where possible.
  - VALIDATE-PAKISTAN-RESIDENCY remains open for the **pilot/production** data. It does not block staging.
- **Region support:**
  - Doha supports every service used: Cloud Run, Cloud SQL PostgreSQL, Cloud Storage, Secret Manager, Artifact Registry and regional log buckets.
  - Serverless NEGs serve the global load balancer; the global load balancer, Cloud Armor and Certificate Manager are global services.
  - To confirm at `terraform plan` (free): that PostgreSQL 18 with the `db-g1-small` tier is offered in me-central1.

## Engineering gaps G-1 to G-3 — CLOSED 2026-10-14 (repository only, nothing provisioned)
- **G-1 staging test inbox.**
  - Staging runs a production build, so `/v1/dev/*` does not exist; with development adapters, sign-in codes and invitation links reached nobody, and their bodies went to the log.
  - Now the development SMS and e-mail adapters keep messages addressed to configured **synthetic** recipients:
    - `STAGING_TEST_PHONE_PREFIXES`: at least 8 digits, so never a whole country; staging uses `+966500000` (the seeded range) and `+92000000`, which no real Pakistani mobile uses;
    - `STAGING_TEST_EMAIL_DOMAINS`: reserved test domains only; staging uses `test`.
  - Kept messages are stored in `StagingTestMessage`, field-encrypted and removed after 24 hours.
  - Admins see them under **Notification operations → Staging test inbox**, which needs the existing `admin.notifications.manage` permission. Every read is audited.
  - Outside staging the route does not exist and nothing is stored. The production boot check refuses either setting.
  - In staging, message bodies (codes, links) and full numbers no longer appear in the logs.
  - Migration `20270110000000_staging_test_inbox` adds one empty table.
- **G-2 staging seed.**
  - A one-off Cloud Run job, `dd-staging-seed`: same image as the migration job, command `tsx prisma/staging-seed.ts`. It is started with `node tooling/deploy/seed-gcp.mjs` after the first release.
  - It loads the development seed's **synthetic** data and uploads its sample images to the bucket.
  - It prepares Pakistan as **TESTING** through the governed services (shared with `scripts/ops/pk-uat-market.ts`). The development-only UAT gate is not set.
  - **Refusals:**
    - not staging, or not a complete, safe staging configuration;
    - the database already has accounts;
    - it has already run (audit marker `staging.seed.completed`).
  - **Credentials:**
    - the shared seed password and a shared authenticator key are generated by Terraform into Secret Manager (`dd-staging-seed-user-password`, `dd-staging-seed-admin-totp-secret`);
    - only the seed job receives them, and they are never printed;
    - the founder reads them in Secret Manager.
  - The portals have **no first-time authenticator set-up screen** (the API service exists but is not exposed). That is why the seeded admin accounts get the shared key: each seeded admin signs in with the shared password, then a code from an authenticator app loaded with the shared key.
- **G-3 invitation links.**
  - Terraform now sets `MERCHANT_APP_URL` and `PARTNER_APP_URL` to `https://merchant.` and `https://partner.staging.<domain>` (a `.invalid` placeholder in PRIVATE mode).
  - The production boot check refuses http or localhost values for both, so a missing setting stops the API instead of sending localhost links.
- **New open item (production, not staging):** first-time two-step set-up for real administrators — the routes and screen need to be built before go-live.

## GO / NO-GO checklist (founder)
| # | Item | Owner |
|---|---|---|
| 1 | This plan approved | Founder |
| 2 | Google Cloud organisation, billing account and staging project exist; billing currency/payment method OK | Founder |
| 3 | Budget accepted: about USD 110–215/month, ceiling USD 600 | Founder |
| 4 | Domain confirmed and Cloudflare account created (else PRIVATE mode, engineers only) | Founder |
| 5 | Alert e-mails, engineer list and tester list provided | Founder |
| 6 | GitHub `staging` environment created (repository admin) | Founder / engineer |
| 7 | G-1, G-2 and G-3 fixed, tested and committed — **done 2026-10-14** | Engineering |
| 8 | `terraform plan` reviewed: only the listed resources, region me-central1, PostgreSQL 18 available | Founder + engineer |
| 9 | Data rule accepted: synthetic only, no copy of dev data, Pakistan stays TESTING | Founder |
| 10 | After apply: first release deployed, readiness green, alerts received in a test, one restore drill done | Engineering |

**GO** when 1–9 are ticked. **NO-GO** if any of 1, 2, 3, 8 or 9 is open.
