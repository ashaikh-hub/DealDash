# Phases 4 and 5 — Figma handoff

Built screens to be reflected in Figma (the build is the reference). Components are the existing `@dealdash/ui` set: Card, KeyValue,
StatusChip, Alert, Tabs (in a horizontally scrollable wrapper on phones), Field / Input / Select / Checkbox / Textarea, tables, EmptyState,
LoadingState. Screenshots: `docs/screenshots/phase45/` (produced by `tooling/e2e/phase45-browser.mjs`; desktop 1280, phone 390, English and
Arabic RTL). Copy: `packages/localization/src/dictionaries.phase45.ts` (English + working Arabic; native review required).

Every screen has these states, which designs must include: **loading** (LoadingState), **empty** ("Nothing to show yet."),
**error** (danger Alert with the translated error), **permission denied / not in plan** (warning Alert "Not available to you" + reason,
e.g. Advanced Reporting or AI not in the plan), **financial hold** (billing: danger banner that states customer rights and records are not
affected), **Arabic RTL** (mirrored layout, Western digits, Arabic labels).

## Merchant portal

Navigation: **Performance** (`merchant.performance.read`), **Billing** (`merchant.finance.read`), **Assistant** (`merchant.ai.use`), after
"Plan and usage". Campaign managers see Performance and Assistant, not Billing; staff see none.

### Performance (`/[locale]/performance`) — tabs
1. **Overview** — period select (7 / 30 / 90 days); "Data as of …"; the honesty note (a click is not a sale …); one card per product
   (Live, Exclusive, Vouchers, Watch & Earn, Loyalty) with key-value metrics; "Not in your plan" chip for un-entitled products.
2. **Drill-down report** — Group by select (Product, Campaign, Branch, Day; Country, Legal entity, Brand, Region, City need Advanced
   Reporting), period select, breadcrumb chips of the current drill path, "Back to top level"; table with group name (bilingual),
   four measures, "Drill down" per row, totals row. Entitlement refusal state.
3. **Targets** — form (name, measure, product, target value, period); target cards: name, status chip (On track / Ahead success; At risk
   warning; Behind / Missed danger; Not started / Ended neutral), progress bar with an **expected-to-date marker**, key-values (measure,
   target, actual, expected to date, achieved %, **Forecast + "Forecast · estimate" chip + confidence**, period). AI-created targets show
   "Approved by a person".
4. **Alerts** — status filter; alert cards: title, severity chip (Information / Warning / Critical), status chip, "Escalated (level n)",
   body, category · time, **action button** (Add budget, View invoice …) or, without permission, the muted text "… someone with the right
   permission must do this"; Acknowledge, Resolve.
5. **Alert rules** — form (name, alert type, frequency, threshold with help, escalate after minutes, channel checkboxes); rule rows with
   type · frequency · channels · escalation and Turn on / Turn off.
6. **Notification preferences** — one row per category: frequency select, channel checkboxes, Mute.

### Billing (`/[locale]/billing`) — tabs
Invoices and notes (table: number or "Draft", type, status chip, issued, due, total, outstanding, Open → detail with key-values, tax
"pending confirmation" text when not configured, FX line, lines table with "Settled by", Dispute form for Finance), Billing accounts (per
legal entity and currency: default chip, status chip, legal entity, tax ID, terms, frequency, method, PO required, invoice contact, credit
available / limit; Change invoice contact), Receivables (aging table), Purchase orders (add form; table with used / remaining / status),
Statement (account select; opening, closing, movements with running balance), Reconciliation (Reconcile by select; table with Matched /
Difference chips; product flow cards with ✓ / ✗ checks). Financial-hold banner above the tabs.

### Assistant (`/[locale]/assistant`)
Heading "Growth assistant"; panel: intro (never buys, pays, publishes or commits), question box, example chips, Ask, "Let it prepare drafts
for my approval" checkbox; answer: "AI suggested" + autonomy chips, statements each with a kind chip (Fact success, Trend info, Forecast
(estimate) warning, Possible reason neutral, Suggestion info), draft cards ("AI drafted" chip, "Nothing happens until …", Approve /
Reject for approvers), action links ("you confirm"), disclaimer. Below: "Drafts awaiting a decision" list.

## Admin portal

Navigation: **Command Centre** (`admin.operations.read`), **Analytics** (`admin.analytics.read`), **Billing** (`admin.finance.read`),
**AI governance** (`admin.ai.use`).

- **Command Centre** (`/command-centre`) — tabs Health (Refresh; sections: campaign health table per product; transaction metric tiles;
  financial tiles with danger tone for overdue / reconciliation; integration table with state chips Healthy / Degraded / Not updated /
  Failing / Not configured and adapter "Mock (not live)"; risk tiles; platform tiles), Integrations, Alerts (+ "Check alerts now"), Customer
  timeline (search ≥ 3 characters, customer buttons with masked mobile, key-values, kind filter, timeline list: time, kind chip, event,
  reference, status, amount / points).
- **Analytics** (`/analytics`) — the Performance workspace for DealDash: grouping starts at Business; platform alert rules.
- **Billing and receivables** (`/billing`) — tabs Invoices and notes (status filter, Run billing; detail actions Issue / Approve and issue
  (disabled for non-approvers, maker-checker notice), Cancel draft, Send, Close dispute, credit / debit note form), Billing accounts (+ PO
  rule toggle, Place / Release financial hold), Receivables, Record payment, Purchase orders, Exchange rates (propose form; table with
  Approve / Reject only for a different person), Reconciliation (all dimensions).
- **AI governance** (`/ai`) — tabs Assistant (agent select: Finance / Operations and support), Drafts, Audit (table), Usage ("AI is not
  priced" notice + table), Evaluations (Run evaluation pack; summary chip; one row per case).

## Customer app

Profile → "Best-deal assistant" link (the five-tab bar is unchanged). `/assistant`: panel without drafting; example chips (best deals,
points, vouchers); recommendation cards: title, product chip, merchant, "why" bullets, merchant-stated saving, "Open to review and confirm".
Phone-first; RTL.
