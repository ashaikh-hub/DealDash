# DEALDASH TECHNICAL SPIKES (Stage 0)

Version 0.1 · 2026-10-07 · Environment: Windows 11, PostgreSQL 18.6 (native, no Docker), PostGIS 3.6.2, Node.js 24 LTS, pnpm 12.
Method: the smallest working proof for each spike, kept in the repository as tests or scripts. **Where something was only reasoned about and not executed, it says so.**

Summary: **no spike found a blocker.** Items that need real phones (iOS web push, camera scanning, background video) were **not tested** and remain a Sprint-Group-4/6 device check.

---

## 1. Prisma + PostgreSQL + PostGIS (verified, executed)

| Question | Result |
|---|---|
| PostgreSQL + Prisma | **Prisma 7.10** with the **`@prisma/adapter-pg`** driver adapter, generator `prisma-client` (output `apps/api/src/generated/prisma`, CommonJS). Prisma 7 needs a `prisma.config.ts` (datasource URL lives there, not in `schema.prisma`) and does not auto-load `.env` (we load the repo-root `.env` ourselves) |
| Migrations | `prisma migrate deploy` applies hand-reviewed SQL. The initial migration was produced with `prisma migrate diff --from-empty --to-schema ... --script` and then edited (PostGIS extension at the top). Custom SQL migration for triggers and constraints. **Result: both migrations apply cleanly to dev and test (2/2).** |
| PostGIS column | Declared in the Prisma schema as `Unsupported("geography(Point,4326)")?` with `@@index([location], type: Gist)`. Prisma never reads or writes it |
| Writing coordinates | The app writes plain `latitude`/`longitude` decimals through normal Prisma calls. A **database trigger** (`MerchantBranch_sync_location`) maintains the geography point. Verified: inserts and updates (a moved branch becomes searchable immediately) |
| Nearby / distance / radius | Raw SQL through `$queryRaw` with **bound parameters** (`Prisma.sql`): `ST_DWithin` for the radius filter (uses the GiST index) and `ST_Distance` for ordered distances in metres. Verified against seed data: central Riyadh, 15 km → Olaya 2,721 m, KAFD 6,690 m, Al Malqa 11,419 m; Jeddah (~850 km) excluded |
| Constraints Prisma cannot express | Check constraints (latitude/longitude ranges, "mobile or email present"), triggers (append-only audit log), extension creation: all in custom SQL migrations. Verified by tests (invalid latitude rejected, foreign key rejected, duplicate mobile rejected, audit UPDATE/DELETE/TRUNCATE rejected) |
| Atomic updates for stock | Not exercised yet (Exclusive Deals stage). The conditional `updateMany` + affected-row-count pattern is supported by Prisma; will be proven with the 300-concurrent-reservation test in Sprint Group 4 |
| Extension privileges | `CREATE EXTENSION postgis` needs a superuser, so `pnpm db:setup` (run once with the superuser password) enables it per database; the migration's `CREATE EXTENSION IF NOT EXISTS` is then a no-op for the app role |
| **Defect found and fixed** | The Windows PostgreSQL installer defaults the server time zone to local (Riyadh). Raw SQL `now()` compared against Prisma `timestamp` (no zone) columns was skewed by 3 hours and made a job retry run immediately. **Fix:** every connection forces `timezone=UTC`, and raw SQL uses `now() AT TIME ZONE 'UTC'`. Rule for future raw SQL: always UTC |
| Reset workflow | `pnpm db:reset` / `db:test:reset` drop tables, enums and functions that are **not** extension members (so PostGIS survives) then migrate (and seed for dev). Refuses non-local hosts and names not ending `_dev` / `_test`. Tests do this automatically for `dealdash_test` |
| Roles | `dealdash_app`: no superuser, no createdb, no createrole; owner of the two databases (needed to run migrations). In production use separate migration and runtime roles |

## 2. OpenAPI and typed client (verified, executed)

- **NestJS 11** + `@nestjs/swagger` 11 + **`nestjs-zod`** (Zod 4). Request validation and OpenAPI both derive from the **shared Zod schemas** in `packages/validation` (`createZodDto`). No duplicated type declarations.
- `pnpm api:contract` builds the app **without a database**, writes `packages/api-client/openapi.json` (22 paths) and generates `src/schema.d.ts` with `openapi-typescript`. The typed client uses `openapi-fetch` (`credentials: 'include'`). CI regenerates and fails on drift. Verified: regeneration is idempotent.
- **Finding:** `tsx`/esbuild does not emit decorator metadata, so NestJS dependency injection fails when run with `tsx`. The API therefore runs with **`@swc-node/register`** (`pnpm dev:api`) and is tested with swc under Vitest (`unplugin-swc`). `tsx` is used only for decorator-free scripts (database tooling, seed).
- Validation strategy: Zod at every controller boundary (400 with field-level errors and stable codes), unknown query values rejected, ids validated as UUIDs, sort fields allow-listed.
- Limitation: `nestjs-zod` + the OpenAPI cleanup are young libraries; contract tests (generated types compile in all apps) guard against regressions.

## 3. PWA capabilities (architecture-level; **not tested on real devices**)

Verified in this environment: the customer and staff Next.js apps serve a **web manifest**, 192/512 icons, a **service worker** (`/sw.js`, static assets cache-first, navigation network-first with an offline page, **API and non-GET requests never intercepted**) and `/en` + `/ar` routes. Installability criteria are met on paper; **actual install prompts were not exercised in a browser on a phone.**

| Capability | Position | Status |
|---|---|---|
| Installable PWA | Manifest + SW + HTTPS in production | Assets verified; install not tested on devices |
| Service worker | Static shell only; no API caching; **no offline redemption** (offline page tells the user an internet connection is required) | Implemented |
| Camera access / QR scanning | `getUserMedia` over HTTPS; QR decoding by a JS library with a typed-code fallback (the `BarcodeDetector` API is not universal) | **Not implemented or tested yet (Sprint Group 4)** |
| Web push | Works for **installed** PWAs on recent iOS versions; Android browsers support it broadly; opt-in friction is the real risk. In-app feed, SMS for critical events and email are the fallback channels | **Not tested (Sprint Group 3)** |
| iOS Safari limitations | Push only for home-screen installs; background timers and media behaviours are restricted; Wake Lock support varies | Known risks, to be device-tested |
| Android browsers | Strong PWA support (install prompt, push, camera) | Expected, to be device-tested |
| Offline redemption | **Deliberately not supported** | By design |

**Could any limitation force a native app?** None found so far. The trigger to reconsider would be measured: web-push opt-in too low to support reservation reminders, unreliable camera scanning on the staff's devices, or Watch & Earn playback qualification failing on common browsers. The API already supports bearer tokens for a future React Native/Expo client.

## 4. Arabic and RTL (verified where executed)

| Item | Result |
|---|---|
| Next.js RTL layout | `/ar` renders `<html lang="ar" dir="rtl">` in all five apps (verified by fetching the production build). The design system uses **logical CSS properties only**; a unit test fails the build if physical `left/right` properties are introduced |
| Fonts | Plus Jakarta Sans (Latin 400-800) and IBM Plex Sans Arabic (Arabic 400-700) via **self-hosted `@fontsource` packages** (offline-safe for the PWA). Latin text inside Arabic pages falls back correctly. **Visual QA on a real screen is still pending** (native-Arabic review item) |
| Mixed Arabic/English | Identifiers, amounts and codes use `dd-ltr` (bidi isolation); the OTP input stays left-to-right inside RTL (tested); merchant names such as "Daily Dose \| ديلي دوز" render in the demo table |
| Forms and tables | Table and form components are tested inside `dir="rtl"`; numeric columns align to the end with LTR digits; locale switcher mirrors (tested) |
| Localization structure | `packages/localization`: typed EN/AR dictionaries (a test enforces identical keys), `/en` and `/ar` routes via middleware with `Accept-Language` negotiation, formatters (Western digits, Gregorian dates, Riyadh time zone, SAR from halalas), bilingual content type `{en, ar}` |
| **PostgreSQL search for Arabic** | Executed on PostgreSQL 18.6: the built-in **`arabic` text-search configuration exists**; `pg_trgm` and `unaccent` are available. Results: Arabic full-text matches ("نوبو" finds "مطعم نوبو الرياض"); **the `arabic` configuration also matches hamza variants** ("احمد" finds "أحمد"); app-side normalisation (`normalizeArabic`) also works; trigram similarity handles English typos ("Harbor Grill" finds "Harbour Grill"); partial Arabic substring and mixed-script queries match. **Conclusion: PostgreSQL search is sufficient for the pilot**; relevance tuning is a Sprint-Group-3 task |

## 5. Tenant isolation (verified, executed; mandatory pattern)

Implemented in `TenantService` and enforced by tests that run against the real database:
- **Merchant A cannot access Merchant B**: profile, branch list and single branch return **404** (never 403) so existence is not revealed; creating a branch in B is rejected and nothing is written.
- **Partner A cannot access Partner B** (bank vs bank, bank vs employer): 404.
- **Branch-restricted staff** see only their own branch (list contains exactly one branch; other branches of the same merchant are 404; creating branches is forbidden). A branch-scoped manager role is also limited to its branch.
- **Unauthorized roles**: merchant finance and campaign managers cannot create branches (403); finance cannot read what it has no permission for; partner read-only users lack `partner.users.manage`; admin analyst/support cannot read the audit log; customers cannot call admin APIs.
- Cross-audience: a merchant session is not valid in the partner or admin apps (401/403).
- Suspended organisations and revoked memberships lose access immediately.
The rules: tenant routes work on the caller's own organisation only; queries always include the organisation id; permissions are checked in guards, never only in the UI.

## 6. Other findings and deviations from the architecture documents

| Item | Detail |
|---|---|
| Sessions | Opaque, random, **server-side revocable sessions** (token hash stored, idle and absolute expiry from configuration, CSRF token bound to the session) instead of short-lived access + rotating refresh tokens. Simpler and revocable; the bearer-token path exists for a future native client. Refresh rotation can be added without API changes |
| Job queue | A small **PostgreSQL-backed queue** (`FOR UPDATE SKIP LOCKED`, retries with backoff, dead-letter state, idempotency keys) instead of BullMQ/pg-boss, to avoid a Redis dependency for the foundation (decision TA-05 stays swappable behind `JobsService`). Redis is not required yet |
| Next.js version | **Next 15.5** (not 16) to avoid the middleware-to-proxy rename and other unknowns; `middleware.ts` is used for locale routing |
| pnpm | pnpm 12 uses `allowBuilds` (not `onlyBuiltDependencies`) in `pnpm-workspace.yaml` |
| TypeScript | 5.9 (the native TypeScript 7 compiler is not adopted: decorator metadata support unverified) |
| Extra shared packages | `app-shell` (shared auth state, login flows, navigation, locale switcher; removes five copies), `tsconfig` (self-contained configs because tools resolved `extends` through symlinks incorrectly) |
| OTP lockout semantics | Attempts against the wrong audience count as failed attempts toward the account lockout (deliberate) |
| Docker | Not required. Docker Desktop cannot run on this workstation (no hardware virtualization). `infra/docker-compose.optional.yml` is optional; CI uses a PostGIS service container |
| `AGENTS.md` | Generated by the Turborepo tool (not by the team); harmless |

## 7. Not done in Stage 0 (honest list)
Real-device PWA tests (iOS and Android); QR scanning prototype; web-push end-to-end; load/concurrency tests (Exclusive Deal stock); native Arabic visual review; contrast verification in Figma; production hosting region (VK-25).
