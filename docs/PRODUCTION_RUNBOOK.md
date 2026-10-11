# DealDash — Production Runbook

Stage 9. Provider-neutral (hosting, CDN/WAF, secret manager, object storage, logging and alerting vendors are **not selected** — founder
decisions). Nothing here has been deployed: **no production environment exists**. Every step that needs a vendor says so.

## 1. Environments

| Tier | Purpose | Data | Providers | Who deploys |
|---|---|---|---|---|
| local | developer machines | `dealdash_dev` seed data, never real | development adapters | developer |
| test | automated tests | `dealdash_test`, wiped on every run | development adapters | CI / developer |
| staging | release candidate, UAT, migration rehearsal, restore drills | restored copy of production (masked before UAT access is widened) or synthetic | provider **sandboxes**; development adapters only with `ALLOW_MOCK_PROVIDERS=true` | `release.yml` after a tag build |
| production | customers | real | contracted providers only | `release.yml`, **manual**, protected `production` environment, required reviewers |

Rules: production never shares a database, secret, provider key, test user or test money with any other tier. Production is
**never** reset or reseeded (`db.ts reset` refuses any database not named `*_dev` / `*_test`; the restore tool refuses targets not
named `*_test` / `*_restore` / `*_staging`).

## 2. Hosting requirements (provider-neutral)
- **Region / residency:** customer personal data and transaction data hosted in a region that satisfies the KSA answer
  (**VALIDATE-KSA-1**, see the readiness doc). Recovery region likewise.
- **Compute:** containers (`infra/docker/api.Dockerfile`, `infra/docker/web.Dockerfile`, non-root). API: ≥ 2 instances behind a
  load balancer. Web apps: ≥ 2 instances each, or a Node-capable edge platform.
- **Database:** managed PostgreSQL 18 with PostGIS, TLS required, PITR, automated backups, a read replica optional; the API connects
  as the least-privilege application role (never the admin role — the boot check refuses `postgres`).
- **Object storage:** private bucket, versioning, server-side encryption, signed URLs (adapter to build once selected).
- **Edge:** TLS 1.2+, HSTS, WAF with rate limiting and bot protection (the API's in-memory limiter is per instance; the WAF is the
  shared limit), DDoS protection.
- **Secrets:** a managed secret manager; never in images, repository or CI logs.
- **Jobs:** the API runs the scheduled jobs in-process (`ops.*`, sweeps). With several API instances the job runner's database
  claim prevents double runs; verify this in staging under two instances (go-live item).

## 3. Configuration (environment)
See `.env.example`. In production the API **refuses to start** if: any provider is a development adapter; storage is `mock` or
`local`; the payout adapter is `mock`; the database is a `_dev` / `_test` database, lacks `sslmode=require|verify-full`, or uses the
`postgres` account; `TEST_DATABASE_URL` is set; secrets are short or look like development values; `API_PUBLIC_URL` or any
`CORS_ORIGINS` entry is not https or is localhost; rate limits are 0; logs are not JSON (`productionSafetyProblems`, packages/config).
Messages name the setting, never its value.

Minimum production settings: `NODE_ENV=production`, `APP_ENV=production`, `LOG_FORMAT=json`, `RATE_LIMIT_PER_MINUTE` (proposed 600),
`AUTH_RATE_LIMIT_PER_MINUTE` (proposed 20), `TRUST_PROXY_HOPS` = the number of proxies in front of the API, the two webhook secrets.

Business parameters are **not** environment variables: they are governed configuration (Admin → Rules and controls), changed by
request + approval by a second person, with history and rollback.

## 4. Secrets
| Secret | Rotation | Notes |
|---|---|---|
| `SESSION_SECRET` (≥ 32 chars) | 90 days or on suspicion | Rotation signs everyone out |
| `FIELD_ENCRYPTION_KEY` | Planned re-encryption only | **Escrow** in two places; loss = unrecoverable encrypted fields |
| Database role password | 90 days | Application role only |
| Provider API keys | Per provider policy | One key per tier |
| `PAYOUT_WEBHOOK_SECRET`, `NOTIFY_WEBHOOK_SECRET` | 180 days | Callbacks carry `X-DealDash-Signature: t=…,v1=HMAC` with a 5-minute window |
| Deploy hook URL / token | On staff change | GitHub environment secrets |

The repository secret scan (`tooling/security/secret-scan.mjs`) runs in CI; it reported no findings on 2026-10-11.

## 5. CI/CD
- `ci.yml`: install, secret scan, lint, typecheck, test DB reset + migrations + **schema drift check**, API + app tests, build, and a
  dependency audit of production dependencies (critical blocks; high reported).
- `codeql.yml`: static analysis.
- `release.yml`: on a version tag — container images per app, release record (notes, migration list, previous tag = rollback
  reference, SBOM) and staging deploy. **Production only by manual dispatch for an existing tag through the protected environment.**
- `tooling/deploy/deploy.mjs` refuses to run until the target's deploy secrets exist ("BLOCKED: hosting … not configured").
- **Founder configuration required in GitHub:** `production` environment with required reviewers (at least the founder), branch / tag
  protection, and environment secrets. Not done (no repository settings access from here).

## 6. Release procedure
1. CI green on `main`; release notes reviewed.
2. Tag `vX.Y.Z` → images, release record, staging deploy.
3. **Migration rehearsal:** staging database restored from the latest production backup (`db-restore-verify` into `*_staging`), then the
   release's migrations applied there. A migration that passes only on an empty database is not accepted (incident 2026-10-11,
   `DISASTER_RECOVERY.md`).
4. Smoke test on staging (§8) and the UAT scripts touched by the release.
5. Founder (or delegate) approves the `production` environment run.
6. Production: take an on-demand backup; apply migrations (`prisma migrate deploy`, forward-only); roll out the API, then the web apps.
7. Smoke test production; watch the dashboards for 30 minutes; record the release.

**Rollback:** redeploy the previous tag. Migrations are additive, so the previous version runs on the new schema. Never edit an applied
migration; fix forward.

## 7. Observability
- **Logs:** JSON, one line per event, redacted (authorization, cookies, passwords, OTP codes, tokens, card-like numbers); access log
  with request id, method, path, status, duration, user id (no bodies).
- **Health:** `GET /v1/health/live` (process up) and `GET /v1/health/ready` (database reachable, migrations applied, recent job
  failures; 503 when not ready) — the load balancer uses `ready`.
- **Alerts (to configure with the vendor):** ready=503 for 2 minutes; 5xx rate > 2% for 5 minutes; p95 latency > 1.5 s; failed jobs
  in the last hour > 0; payment webhook signature failures; payout `FAILED`; notification delivery failure rate; database CPU /
  storage / replication lag; certificate expiry < 21 days.
- **Business signals already in the product:** Command Centre exceptions, SLA breaches, reconciliation breaks, settlement holds.

## 8. Smoke test (after every deploy)
Health ready = 200; customer: home loads, a deal opens, OTP sign-in (staging: development SMS; production: a staff test number
agreed with the founder); merchant and admin sign-in; staff validation screen opens; the payment provider's test transaction in
staging only; no new 5xx in the logs.

## 9. Incidents
Severity: **S1** customers cannot buy / redeem, data or money at risk; **S2** a portal or provider degraded; **S3** minor.
1. Acknowledge, name an incident lead, open the incident log.
2. Contain: **emergency stops** (Admin → Rules and controls → Launch controls) stop NEW purchases, reservations, Watch & Earn views or
   campaigns per market immediately — what customers already hold stays valid. Pause a campaign, a merchant or a partner through
   their normal controls.
3. Communicate (customer notice templates: founder-approved copy needed — UAT item).
4. Recover (`DISASTER_RECOVERY.md`), reconcile money, lift the stops with a reason.
5. Post-incident review within 5 working days.

## 10. Launch controls
- **Pilot mode** (`launch.controls`): `OPEN` or `ALLOWLIST` (only listed merchant / partner organisations are visible to customers
  and can activate campaigns). Changed by request + second-person approval.
- **Emergency stops** per market: immediate, reason required, audited, permission `admin.launch.control` (Operations, Super admin).
