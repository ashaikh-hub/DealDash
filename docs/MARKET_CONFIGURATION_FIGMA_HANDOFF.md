# Admin → Markets — Figma handoff

The build is the reference. Components: existing `@dealdash/ui` (Card, KeyValue, StatusChip, Alert, Tabs in a horizontally scrollable
wrapper, Field / Input / Select / Checkbox / Textarea, tables, EmptyState, LoadingState). Shared view: `packages/app-shell/src/markets/
markets-views.tsx`. Copy: `packages/localization/src/dictionaries.markets.ts` (English + working Arabic; native review required).
Screenshots: `docs/screenshots/markets/` (desktop 1280 and phone 390, English and Arabic RTL) from `tooling/e2e/markets-browser.mjs`.

Navigation: **Markets** (after AI governance), `admin.markets.read`. Forms and actions appear only with `admin.markets.manage`; approvals
only with `admin.markets.approve`, and never for the person who made the draft / request ("A different administrator must approve.").

States every frame must show: **loading**, **empty** ("Nothing to show yet."), **error** (danger alert), **permission denied** (warning
alert "Not available to you"; market-scoped administrators see only their markets), **validation required** (warning chip / alert),
**blocked** (suspended or closed market: danger alert), **not ready** (danger alert), **effective-dated history** (version tables with
from / to, "Open-ended"), **Arabic RTL** (mirrored layout, Western digits).

## Frames

1. **Market list** — intro (market, not region, drives tax / currency / …); table: country (name + ISO), region, lifecycle chip (Planned
   neutral, Configuring / Testing info, Pilot warning, Active success, Suspended danger, Closed neutral) with "waiting for approval: …",
   currency, language, time zone, products open, readiness chip (Ready success, Validation required warning, Not ready / Blocked danger),
   Open. **Add a market** card (ISO code, names EN / AR, currency, languages) with the note that new markets start Planned with everything off.
2. **Market header** — name + code, lifecycle chip, "All markets"; tab bar: Overview, Products, Tax, Currency, Invoice, Payments,
   Settlement, Providers, Legal and compliance, Validation register, Readiness, Audit history.
3. **Overview** — key-values (country / ISO 3, region, status, launch date, currency, language, time zone, calling code, DealDash legal
   entity or "Not set", support contact, version) + master form. **Lifecycle and activation gate** card: pending-approval alert (requested
   status and reason) with Approve change (disabled for the requester) / Reject; otherwise "Move to" (only allowed next states), reason,
   Request change; closed-market note.
4. **Products** — table per product: status select (Off, Configuring, Testing, Pilot, Active, Suspended) or chip when read-only, since date.
   Note: open only when market AND product are Pilot / Active.
5. **Tax** — note on effective dating and versioning; draft form (rule code, tax type, rate %, effective from, registration reference,
   validation code, included-in-price, exempt, "applies to" checkboxes for every taxable item or "Everything taxable"); version table (rule
   summary, version, status chip Draft / Awaiting approval / Approved / Retired, effective from / to, Approve or "a different administrator
   must approve", Retire).
6. **Currency** — default, supported, billing, settlement, tax currency, decimals, rounding; FX note (approved rate, source, date; manual
   override needs a reason and a second approver).
7. **Invoice** — form (document kind, prefix, effective from, e-invoicing provider, validation state, validation code, QR required,
   required fields); version table with validation chip.
8. **Payments** — provider form (code, method, environment, credential reference with "never the secret" help, priority, status, fallback);
   table (provider + fallback marker, method, environment chip Mock neutral / Sandbox info / Production success, priority, status, credential
   reference shown as a reference).
9. **Settlement** — form (rule code, currency from supported list, frequency, cycle, minimum payout, hold days, effective from); version
   table (code, currency, frequency, legal-entity / business-specific markers).
10. **Providers** — same pattern for OTP, email, push, video, storage / CDN, maps, e-invoicing, KYB / KYC, identity, analytics.
11. **Legal and compliance** — policy form (category, policy, version / reference, validation code, required for launch); version table.
12. **Validation register** — status filter; add item (code with VALIDATE-<market>- placeholder, topic, description); item cards (code,
    topic, "Blocks activation" chip, status chip Open danger / In review warning / Resolved success / Risk accepted info / Not applicable
    neutral, description, decision, source reference) with Update (status, decision, evidence); closing statuses only for approvers.
13. **Readiness** — overall chip + explanatory alert (not ready / validation required / blocked); table: check, state chip (OK, Missing,
    Validation required), detail.
14. **Audit history** — time, change (plain-language action), by (role), reason, "Second approver" when approved by another person.

## Phone

Tabs scroll horizontally inside their card; tables scroll inside their card; no page-level horizontal scroll (verified at 390 px).
