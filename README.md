# DealDash

DealDash is a consumer deal-discovery and merchant campaign platform for Saudi Arabia (pilot: Riyadh, SAR, Arabic + English with RTL).
This repository is the **MVP implementation**: one NestJS modular-monolith API and five Next.js apps (Customer PWA, Merchant, Staff PWA, Partner, Admin) in a pnpm monorepo.

> **Status: Stages 0 to 6, plus the shared Commercial Governance and Finance platform** (quotations, explicit acceptance, prepaid funding and approved credit, sponsors, holds, payments, documents, reconciliation; see [docs/COMMERCIAL_FINANCE.md](docs/COMMERCIAL_FINANCE.md)). Watch & Earn (campaigns, funded budgets, server-decided qualifying views, fraud screening) and the Rewards points ledger are built, see [docs/STAGE6.md](docs/STAGE6.md). Foundation, merchant onboarding and review, Live Deals with customer discovery, Exclusive Deals with free reservations and merchant staff redemption, and Vouchers with purchase, mock payments, QR redemption, refunds and the merchant payable ledger are built. The Partner Portal and settlement runs come in later stages. See [docs/STAGE2.md](docs/STAGE2.md), [docs/STAGE3.md](docs/STAGE3.md), [docs/STAGE4.md](docs/STAGE4.md) and [docs/STAGE5.md](docs/STAGE5.md) for what exists and how to run it.
> Product, rules and design documents are in [`docs/`](docs). Start with `docs/DEALDASH_TECH_ARCHITECTURE.md`, `docs/DEALDASH_BUILD_PLAN.md` and `docs/DEALDASH_TECH_SPIKES.md`.

## Docker is NOT required

Local development uses **native PostgreSQL** (the current developer workstation is Windows with PostgreSQL installed directly; hardware virtualization is unavailable so Docker Desktop cannot run).
An optional container file exists in `infra/docker-compose.optional.yml` for developers and CI that prefer containers.

## Repository layout

```
apps/
  api/        NestJS API + background worker (owns the Prisma schema and migrations)
  customer/   Next.js customer PWA            http://localhost:3001
  merchant/   Next.js merchant web app        http://localhost:3002
  staff/      Next.js staff PWA               http://localhost:3003
  partner/    Next.js partner web app         http://localhost:3004
  admin/      Next.js admin web app           http://localhost:3005
packages/
  ui/ types/ validation/ api-client/ auth/ localization/ analytics/ config/   (approved shared packages)
  app-shell/  shared shell used by all five apps (justified addition: removes five copies of auth/nav/RTL code)
  tsconfig/   shared TypeScript configs
docs/         product, rules, design and architecture documents
infra/        optional container definition
tooling/      Windows helpers
```

## Prerequisites (Windows 10/11, PowerShell)

| Tool | Version | Check |
|---|---|---|
| Node.js | 22 or newer (24 LTS is fine) | `node -v` |
| pnpm | 10 or newer (12 used here) | `pnpm -v` (install: `npm install -g pnpm`) |
| PostgreSQL | 16, 17 or 18 (native Windows install) | see below |
| PostGIS | matching your PostgreSQL version | see below |

### 1. Check PostgreSQL (read-only)

```powershell
powershell -ExecutionPolicy Bypass -File tooling\windows\check-postgres.ps1
```

It reports the service state, install folder, `psql` location (and the PATH change to make if `psql` is not on PATH), PostGIS files, pgAdmin and port 5432. It changes nothing.

Service check manually:

```powershell
Get-Service | Where-Object { $_.Name -match 'postgres' }          # should be Running
Start-Service postgresql-x64-18                                   # use your service name, from an elevated shell if stopped
```

Add `psql` to PATH for your user (adjust the version folder):

```powershell
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\Program Files\PostgreSQL\18\bin", "User")   # then open a new terminal
```

### 2. PostGIS

If the check says PostGIS is not installed: open **Application Stack Builder** (Start menu, PostgreSQL group), select your server, choose **Spatial Extensions > PostGIS**, install, then run `pnpm db:postgis` (see below).

## First-time setup

```powershell
pnpm install
pnpm build:packages
pnpm db:setup        # asks ONCE for the postgres superuser password (typed locally, hidden, never stored)
```

`pnpm db:setup` (idempotent) does all of this:

1. creates `.env` from `.env.example` with generated secrets and a generated password for the application role (the file is git-ignored, mode 600),
2. creates the least-privilege role **`dealdash_app`** (no superuser, no createdb, no createrole),
3. creates **`dealdash_dev`** and **`dealdash_test`** owned by `dealdash_app` (the default `postgres` database is never used by the app),
4. enables **PostGIS** in both databases (needs the superuser, which is why the password is asked once).

To avoid the prompt, put `ADMIN_DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/postgres"` in your local `.env` (never commit it).

Then:

```powershell
pnpm db:migrate      # apply Prisma migrations to dealdash_dev
pnpm db:seed         # small development dataset; REQUIRES your own SEED_USER_PASSWORD (see "Local development password" below)
pnpm db:status       # connection, migrations (applied/total) and PostGIS version; no credentials printed
```

### Local development password

Every seeded business and admin account shares one development password that **you** choose. It is never stored in the repository, never generated for you and never printed.

```powershell
$env:SEED_USER_PASSWORD = "<your own password, at least 12 characters>"   # set it in the same terminal BEFORE seeding
pnpm db:seed          # refuses to run without it
```

- Do not reuse a real password and never commit it (the browser QA scripts under `tooling/e2e` also read it from the environment).
- Re-seeding or `pnpm db:reset` resets every seeded account to whatever `SEED_USER_PASSWORD` is at that moment, so export it first.
- If an older shared throwaway password was used on your machine, re-seed with your own value to replace it.

Other database commands: `pnpm db:reset` (wipe + migrate + seed dev), `pnpm db:test:reset` (wipe + migrate test). Reset commands refuse to run unless the database is local and its name ends in `_dev` / `_test`.

## Run

```powershell
pnpm dev:api          # API on http://localhost:4000  (docs: /docs, health: /v1/health)
pnpm dev:customer     # one app (3001). Others: dev:merchant (3002), dev:staff (3003), dev:partner (3004), dev:admin (3005)
pnpm dev              # everything in parallel
```

Open `http://localhost:3001` (English) or `http://localhost:3001/ar` (Arabic, RTL).

Development sign-in (the seed prints the accounts):

| App | Method | Notes |
|---|---|---|
| Customer / Staff | mobile OTP | The code is printed in the API console and shown in the sign-in box in development (mock SMS provider). Seed: customer `+966500000001`, staff `+966500000100` |
| Merchant / Partner | email + password | e.g. `owner@harbourgrill.test`, `admin@bank.test` (password: the `SEED_USER_PASSWORD` you chose before seeding) |
| Admin | email + password + TOTP | e.g. `super@dealdash.test`; the current TOTP code is shown in the sign-in box in development (`/v1/dev/totp`) |

All providers (SMS, email, push, payments, video, maps) are **mocks**; storage is a **development adapter** that keeps files on local disk (`apps/api/.storage`, git-ignored) behind signed, expiring URLs. No vendor is selected. Business code depends on interfaces in `apps/api/src/providers`.

### Stage 2: merchant onboarding and review

Merchant app `http://localhost:3002` (Arabic `/ar`) and Admin app `http://localhost:3005` (Arabic `/ar`). Sample merchants, accounts, rules and the
VALIDATE-KSA items are in [docs/STAGE2.md](docs/STAGE2.md). Real-browser check: `node tooling/e2e/stage2-browser.mjs`.

## Design sources

See [docs/DESIGN_SOURCE_MAP.md](docs/DESIGN_SOURCE_MAP.md). For Voucher journeys the current MVP visual source of truth is `figma-handoff/stage5/` with [docs/STAGE5_FIGMA_HANDOFF.md](docs/STAGE5_FIGMA_HANDOFF.md). Original customer screens **09, 22, 28, 29, 30, 32, 33 and 53 are OUTDATED / SUPERSEDED FOR MVP** (gifting, promo codes, loyalty-point payment, saved cards, partial redemption); the historical files stay in `Figma Files/` for reference only and must not be implemented.

## Quality commands

```powershell
pnpm lint
pnpm typecheck
pnpm build:packages ; pnpm build
pnpm test                       # all unit, integration, API, tenant-isolation and shell tests
pnpm --filter @dealdash/api test    # API suite only (needs the test database; skips DB tests with a warning if TEST_DATABASE_URL is unset)
pnpm api:contract               # regenerate the OpenAPI contract and the typed client (commit the result)
```

The API test run wipes and re-migrates `dealdash_test` automatically (refuses any other database).

## Troubleshooting PostgreSQL connections

| Symptom | Fix |
|---|---|
| `ECONNREFUSED 127.0.0.1:5432` | Service not running: `Start-Service postgresql-x64-18` (name from the check script) |
| `password authentication failed for user "dealdash_app"` | `.env` password differs from the database role. Re-run `pnpm db:setup` (it resets the role password to the one in `.env`) |
| `password authentication failed for user "postgres"` during setup | Wrong superuser password. Re-run and retype it |
| `database "dealdash_dev" does not exist` | Run `pnpm db:setup` |
| `extension "postgis" is not available` | Install PostGIS with Stack Builder, then `pnpm db:postgis` |
| `permission denied to create extension "postgis"` | Extensions need the superuser: `pnpm db:postgis` |
| `psql` not recognised | Add its folder to PATH (see above) or use the full path |
| API starts but `/v1/health` says `degraded` | Migrations pending or PostGIS not enabled: run `pnpm db:migrate`, `pnpm db:postgis` |
| Port 4000 / 300x busy | Change `API_PORT` in `.env` or stop the other process |
| Firewall prompt on first run | Allow Node.js on private networks (local only) |

## Security notes

- Never commit `.env` (git-ignored). Passwords are never in source files; the setup script generates them locally.
- The app role is not a superuser. In production, use separate migration and runtime roles.
- `AuditLog` is append-only (database triggers reject UPDATE/DELETE/TRUNCATE).
- Every API permission and tenant check is enforced in the backend; UI hiding is cosmetic.
