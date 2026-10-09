# Phase 4: Visibility and Operations (Analytics, Targets, Alerts, Command Centre)

Status: built and verified 2026-10-09; FOUNDER APPROVED AND FROZEN 2026-10-09. Modular monolith (no Kafka, no new infrastructure).
Decisions: `docs/PHASE4_PHASE5_IMPACT.md` (D4-1 .. D4-9).

## 1. Analytics event framework

- **One governed taxonomy** (`packages/types/src/visibility.ts`: `ANALYTICS_EVENTS`, `EVENT_CLASSES`, `METRICS`). Products: LIVE, EXCLUSIVE, VOUCHER, WATCH, LOYALTY.
- **Projection, not double-writing.** `AnalyticsProjector` (`apps/api/src/visibility/analytics-projector.service.ts`) reads the sources of truth (deal events, reservations, redemptions, redemption attempts, payments, voucher instances / redemptions, refunds, Watch views and funding, reward entries and redemptions) through per-source watermarks with a 2-minute overlap. Every event has an idempotency key, so re-reading never duplicates. `catchUp()` keeps passing while a source returns a full batch.
- **Integrity in the database.** `AnalyticsEvent` is append-only (trigger). A CHECK constraint fixes the taxonomy and forbids `verified = true` on engagement events: client signals (impressions, clicks, directions) are never verified outcomes. Credited-back Watch views emit `WATCH_VIEW_CREDITED_BACK`, which is subtracted from qualified views and spend.
- **Honest metrics.** A click is never a sale, a direction request is never a visit, an issued credential is never a redemption. The UI says so in both languages.
- **Aggregation.** `MetricsService.aggregate()` rebuilds hourly `MetricAggregate` rows (INSERT … SELECT … ON CONFLICT; re-aggregation window `visibility.analytics.reaggregateHours`). Gauges (inventory, budget, payable, points outstanding) are read live. Reporting time zone: Asia/Riyadh.
- **Jobs** (skipped under NODE_ENV=test): `visibility.analytics` every minute, `visibility.alerts` every 5 minutes, `visibility.digest` hourly.

## 2. Reporting and hierarchical drill-down

`ReportingService.resolve()` decides access on every call: tenant, role permission (`merchant|partner.performance.read`, `admin.analytics.read`), scope (branch / unit / campaign allow-lists for scoped and branch-bound members), product entitlement, and the `ADVANCED_REPORTING` feature. Business → Country → Legal entity → Brand → Region → City → Branch → Campaign → (transactions through the support timeline / product screens). Grouping by country, legal entity, brand, region or city needs ADVANCED_REPORTING for a business; grouping by organization is DealDash only. Group names come back bilingual (`{ en, ar }`).

**Performance-to-finance linkage** (`financeLinkage`): Exclusive (verified redemptions vs inventory and case utilisation), Watch (qualified views vs campaign counter, billed events, spend), Voucher (payments vs redemptions billed) → MATCHED / DIFFERENCE / NOT_APPLICABLE on each campaign's performance view.

## 3. Targets, Target vs Actual, Expected-to-date, Forecast

`CampaignTarget` (13 target metrics with unit and direction). `TargetsService.progress()` returns target, actual, expected-to-date (linear for accumulating metrics), achievement, status (NOT_STARTED, ON_TRACK, AHEAD, AT_RISK, BEHIND, ACHIEVED, MISSED, ENDED) and a forecast **always labelled `FORECAST_ESTIMATE`** (method RUN_RATE or CURRENT_VALUE, confidence LOW / MEDIUM / HIGH; no forecast before `forecastMinElapsedBps` of the period). Milestone alerts (default 25 / 50 / 75 / 90 / 100 %, custom per target) fire once each; CAMPAIGN_BEHIND_TARGET after 25 % of the period when below `behindTargetBps`. Scoped members can only target what they can see.

## 4. Alerts, early warnings, rules, preferences, escalation

- **Codes**: `ALERT_CODES` (category, severity, action) cover target milestones and every early warning in the brief: budget / inventory projected exhaustion, voucher and reward inventory low, points funding low, sponsor / credit / PO near limit, campaign / voucher / reward expiry, quotation expiring, invoice due / overdue, settlement pending, behind target, feed stale / integration error, payment failures and redemption rejections rising, suspicious branch activity, reconciliation difference, low activity, funding / approval required, subscription limit / lifecycle, financial hold.
- **Detection**: `EarlyWarningService.run()` (thresholds in `visibility.alerts.thresholds`); subscription `CommercialSignal`s are consumed into alerts.
- **Dedupe**: one alert per code / organization / subject / cooldown window (`cooldownHours`).
- **Rules** (`AlertRule`): type, trigger threshold(s), frequency (Immediate / Digest / Critical only), channels (In-app, Email, Push, SMS, Task inbox), recipient roles / users, legal entity / country / branch / product / campaign scope, escalation steps. Organization rules override platform defaults. Validation: roles must belong to the organization type; recipients must be members; scope objects must be the organization's own.
- **Preferences** (`NotificationPreference`, per person and category): frequency, channels, mute. CRITICAL_ONLY skips informational alerts (delivery recorded as SKIPPED_SEVERITY). Muting never hides anything from the team.
- **Escalation**: unacknowledged alerts escalate by step (`afterMinutes`, `toRoles`); acknowledging or resolving stops escalation and closes the task-inbox item.
- **Actionable**: each alert carries an action (Add budget, Add inventory, View invoice, Review quotation …) with a target screen and the permission it needs; the list marks `actionAllowed` per viewer. The action opens the normal screen, where RBAC, scope, maker-checker, acceptance, finance approval and audit still apply. Nothing executes from the alert itself.

## 5. Operations Command Centre and integration monitoring

`/v1/admin/visibility/command-centre` (`admin.operations.read`): campaign health per product (live, pending, paused, ending soon, underperforming, funding low, financial hold, inventory used up, suspended), transaction health (24 h, from governed events), financial health (funding, open / overdue invoices per currency, merchant payable, settlements pending, reconciliation exceptions, holds, credit, PO, pending billing events), integration health (Visa, Mastercard, bank and partner feeds incl. NOT_CONFIGURED, bulk import, payment gateway (MOCK), SMS / email / push (MOCK, from deliveries), video, maps, webhooks, sync jobs), risk (fraud flags, duplicates, suspicious devices, staff misuse, unusual redemptions, reward farming, reconciliation anomalies), platform health (DB latency, job backlog and failures, analytics lag, process). A business sees its own integration health at `/v1/orgs/:orgId/integration-health`.

## 6. Customer support timeline

`/v1/admin/visibility/customers?q=` and `/customers/:userId/timeline` (`admin.customers.read`): account, reservations, redemptions, orders, payments, refunds, vouchers, Watch views, points, rewards, support cases, disputes, risk checks and notifications, newest first. Masked mobile number; references only (codes, tokens and QR payloads are never returned); 404 for non-customers.

## 7. API

Business (`merchant`, `partner` audiences), `/v1/orgs/:orgId/…`: `performance/overview`, `performance/report`, `performance/campaigns/:product/:campaignId`, `targets` (GET/POST), `targets/:id/archive`, `alerts`, `alerts/:id/(acknowledge|resolve)`, `alert-rules` (GET/POST/PUT), `integration-health`.
Personal: `/v1/me/notification-preferences` (GET/PUT).
DealDash, `/v1/admin/visibility/…`: `overview`, `report`, `campaigns/:product/:id`, `refresh`, `targets`, `alerts`, `alerts/evaluate`, `alerts/:id/:action`, `alert-rules`, `command-centre`, `integrations`, `platform-health`, `customers`, `customers/:userId/timeline`.

## 8. Screens

Merchant `/performance` (Overview, Drill-down report, Targets, Alerts, Alert rules, Notification preferences). Admin `/command-centre` (Health, Integrations, Alerts, Customer timeline), `/analytics`. Shared components in `packages/app-shell/src/visibility/visibility-views.tsx`. Partner screens are Stage 7 (the partner APIs exist now).

## 9. Verification

API: `apps/api/test/visibility.e2e.test.ts` (17 tests). Components: `apps/merchant/features/performance.test.tsx`, `apps/admin/features/visibility.test.tsx`. Browser: `node tooling/e2e/phase45-browser.mjs` (59 checks incl. Arabic RTL and phone width; screenshots in `docs/screenshots/phase45`).
