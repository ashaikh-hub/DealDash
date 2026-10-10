# Stage 8 — Operations Figma handoff

The build is the reference: Admin `apps/admin/features/ops-kit.tsx`, `ops-control.tsx`, `ops-finance.tsx`, `ops-trust.tsx`,
`ops-service.tsx`; shared case panel `packages/app-shell/src/operations/operations-views.tsx` (CasesPanel / CaseDetail /
CaseWorkActions); merchant `apps/merchant/features/settlements-reviews.tsx`; customer `apps/customer/features/care.tsx`. Components are
the shared `@dealdash/ui` set (Card, KeyValue, StatusChip, Alert, Tabs, Field / Input / Select / Textarea, tables, EmptyState,
LoadingState, ErrorState). Copy: `packages/localization/src/dictionaries.stage8.ts` (English + working Arabic; native review
required; established terms قضية / القضايا for cases and شاهد واكسب for Watch & Earn). Screenshots: `docs/screenshots/stage8/` from
`tooling/e2e/stage8-browser.mjs`.

Visual direction: the existing DealDash enterprise system (white / lavender surfaces, navy text, purple accents, rounded cards,
restrained shadows), desktop-first operations layouts that reflow to 390 px, Arabic right-to-left with Western digits. Operations
screens are dense but calm: status chips carry the meaning (success / info / warning / danger / neutral), money is always right-aligned
LTR with its currency, references are LTR monospace-like.

## States every frame shows
English · Arabic / RTL · loading · empty (per screen copy) · error with retry · access denied ("You do not have access to this. Ask an
administrator if you need it.") · awaiting approval ("Waiting for a second person to decide." / the requester never sees approve) ·
financial hold (settlement on hold + reason; financial hold restriction "never releases on its own") · resolved / applied ·
SLA warning / breached chips.

## Frames
1. **Command Centre → Exceptions** — drill filters (market, legal entity, business account, brand, city, branch, product, campaign),
   Apply / Back to global, level breadcrumb, 15 area cards (count chip, "Work these" link), open cases by market buttons, businesses
   with most open cases.
2. **Cases list** — filters status / team / severity / SLA; table: reference, type + subject, priority + severity chips, status +
   "Waiting for you" (business) + overdue, SLA due + SLA chip; New case form (type, subject, description, priority, business).
3. **Case detail** — header (reference, type, status, severity, SLA chip, due), facts row (team, market, transaction, financial
   impact, escalation level), awaiting-approval alert with the proposed resolution, Work panel (team + Assign to me, severity + save,
   Move to + note, Contact log: channel, direction, what was said), approval request (proposed resolution, impact) or decision (reason,
   Approve resolution / Send back) or "You requested this approval", history list, notes (kind / channel chips, internal chip),
   evidence, resolve (outcome incl. Rejected), closed note.
4. **Support** — tabs Support requests (card, type, escalate / escalated to), Customer (search, summary key-values, restriction alert,
   corrections note), Timeline (shared), Refunds (lookup by order / voucher, eligibility card with window, market policy, VALIDATE
   items, blockers, order-level refund form, refund queue table), Privacy requests (retention note, create, list with decision).
5. **Financial adjustments** — request form (kind, direction, amount or points, business, customer, case, reason code, reason, note
   about approvals), filter, cards (reference, kind, status chip, amount, reason, applied-as reference, failure + Retry, decision bar).
6. **Settlements** — run bar (market, merchant, rule note), filters (status, exceptions only), table, detail card (hold alert,
   breakdown key-values, tax note, payouts, payout form, reason, Hold / Release / Mark failed / Reverse, release note).
7. **Reconciliation** — Run internal checks, statement import (source, currency, lines textarea + help + parse error), filters,
   exceptions table (external / DealDash / difference / status chip / Resolve / Open a case), resolve card, recent runs.
8. **Fraud review** — Run the rules now, filters (status, area), flag cards (rule, area, decision chip, status, signals, Review →
   human-decision note, reason, also-restrict (kind, days, reason code), Clear / Confirm, Open a case).
9. **Restrictions and holds** — rights note, request form (kind, applies-to ID with per-kind help, days, reason code, scope
   checkboxes, reason), list cards (kind, status, subject, scope, period, reason, financial-hold alert, decision bar, Lift + reason).
10. **Moderation** — filters (waiting / status, content), item cards (content type, product, reports + reasons, review stars +
    Verified chip, decision form: decision, reason code, reason).
11. **Notification delivery** — Process retries now, count chips per status, filters (status, channel), table (template + version,
    locale, market, channel, status + failure / suppressed reason, attempts / max + next retry, last attempt, Retry).
12. **SLA and escalation** — Check SLAs now, area cards (open, warning chip, breached chip), late-work table (reference, area, state,
    due, escalation level), "Everything is on track" state.
13. **Operational reports** — period select, Download CSV, five cards (cases + aging, money operations, reconciliation, fraud and
    redemption, delivery and integrations), privacy note.
14. **Configuration (Rules and controls)** — market note, version, JSON editor (read-only without permission), parse error, reason,
    Save new version / Discard, change history.
15. **Merchant → Reviews** — summary line, review cards (stars, author first name, Verified visit chip, status chip), Report (reason,
    note, Send), no edit / remove.
16. **Merchant → Finance → Settlement statements** — statement cards (period, status chip, payable / paid, hold alert, breakdown,
    payouts, tax note), empty state.
17. **Customer → Merchant page → Reviews tab** — summary, Write a review (rating, text, Verified rule note), review cards (Verified
    visit chip, Report with reason), signed-out prompt.
18. **Customer → My requests** — cards (title, plain-language status chip: In progress / We need your reply / Closed, reference, date,
    shared notes, resolution).
19. **Customer → My data** — Get a copy / Delete my account (confirmation alert explaining what is kept), request list with status
    and Download for a completed export.
