# DEALDASH ADMIN PORTAL: VISUAL DESIGN LANGUAGE

Version 0.2 (direction APPROVED; QA rules and propagation to A01-A31 added) · 2026-10-07
Scope: the reusable visual language of the Admin Portal, established through the first seven operational experiences (see `DEALDASH_ADMIN_HIFI_BATCH_01.md` and `docs/mockups/admin-hifi-batch-01.html`).
Inputs: Admin Portal wireframes v0.2 (31 pages, permission matrix, maker-checker), Merchant Portal visual design (tokens, shell, status vocabulary), customer baseline tokens (`Figma Files\design-tokens.json`).
No production code. Colour values labelled *derived* are computed from the approved tokens and must be confirmed in Figma.

> **Admin Portal status (approved):** structurally and visually **frozen for MVP**. The following remaining items are **QA / validation only** and do **not** block the next portal: tablet QA; keyboard and screen-reader QA; real-data stress testing; native Arabic review; final contrast verification in Figma; remaining VALIDATE-KSA items.

---

## 1. VISUAL DIRECTION

**One sentence:** *the quiet back office of DealDash*: unmistakably the same product as the customer app and Merchant Portal, but denser, calmer, and organised around **decisions**.

| Dimension | Admin treatment |
|---|---|
| Atmosphere | White cards on light lavender (`#F8F9FD`), deep navy text, one purple accent. No photography beyond merchant thumbnails; **no hero gradient cards**; one soft lavender wash only for the settlement net-payable card |
| Density | Operational: 13-px text, 44–48-px table rows, 16–18-px card padding, 16-px gutters (Merchant Portal: 14 px / 56 px / 24 px) |
| Hierarchy | **What needs me?** (queues) → **evidence** → **decision**. Page titles are 24 px; card titles 14 px; numbers are the loudest element on queue cards |
| Colour discipline | Purple = action and selection. Navy = emphasis, severity and counts. Green/amber/red are reserved for **status and consequences** (pass/warn/fail, approve/reject), never for decoration or risk severity |
| Shape | Same as brand: 16-px cards (20 in merchant), pill buttons and chips, 12-px inputs, 22-px modals, subtle 1-px borders, one low shadow for hover |
| Brand marks | Wordmark "Deal" navy + "Dash" purple with the caption **ADMIN**; environment tag "Pilot · Riyadh" so no one confuses environments |
| Tone | Plain operational English (and Arabic): verbs on buttons ("Request changes", "Reject"), consequences in one sentence, no jargon |

**What makes it DealDash and not a generic enterprise template:** the lilac active pill and segmented tab control carried over from the customer app; pill chips with icons; tinted (not saturated) statuses; rounded cards instead of hairline-boxed grids; the same purple used for exactly one primary action per area; friendly empty states; and the "decision panel" that always explains what an action will do.

**What stays out:** large charts, decorative gradients, illustrations, dark sidebars, tables with zebra stripes, bulk actions where each item needs its own evidence.

---

## 2. TOKENS (inherited and Admin-specific)

Base tokens from the approved system: navy `#0F0C42`, purple `#5B1AFC` (hover `#7E4DFF`), lilac `#EEE8FF`, page `#F8F9FD`, card `#FFFFFF`, secondary text `#5B5E80`, line `#E3E1F0`; mint `#1FBF8F`, amber `#F5A524`, red `#E93A52` (graphics only).

Derived (shared with the Merchant Portal): `purple-50 #F6F3FF` (hover, table header), `purple-300 #B9A4FF`, `slate-100 #EEF0F8` (neutral chip), success `#E2F7F0 / #0B7A5A`, warning `#FEF1D9 / #8A5A00`, danger `#FDE8EB / #B3203A`, danger solid `#C9213D`, approve green `#0E8F6A` (white text ≥ 4.9:1).

Admin-specific:
| Token | Value | Use |
|---|---|---|
| `approve` | `#0E8F6A` | Approve / Confirm buttons only |
| `warn-surface` | `#FEF1D9` | "Needs changes" decision button and warning banners |
| `legal-hold` | navy fill, white text | Legal-hold banner and chip |
| Type scale | Page title 24/32 · card title 14/20 · body 13/20 · table 12.5/18 · caption 11.5/16 · KPI 24/30 · queue count 30/34 | Admin density |
| Monospace | `ui-monospace` 12 px, left-to-right | IDs, references, PSP refs, codes |

Fonts: Plus Jakarta Sans (English), IBM Plex Sans Arabic (Arabic), Western digits.

---

## 3. NAVIGATION SHELL

| Part | Spec |
|---|---|
| Sidebar | White, 232 wide, 1-px right border. Wordmark + **ADMIN**; groups **WORK** (Dashboard, Customers, Merchants, Partners, Campaigns, Money) and **ASSURE** (Risk, Support, Reports); **Administration** pinned in the footer; signed-in card (name, role, MFA state) at the bottom |
| Active item | Lilac pill with purple label (same as other DealDash surfaces) |
| Queue badges | Navy pill with count (purple when active) on Merchants, Campaigns, Money, Risk, Support; zero is hidden |
| Role-driven | A role sees only the items it may use (Support: Dashboard, Customers, Money, Support, Reports; Finance adds Merchants and Campaigns; Super Admin sees everything plus Administration) |
| Top bar | 56 px: **environment tag**, global search (`/`; searches customers, merchants, orders, codes, cases; results filtered by role), **role chip** (navy pill with the working role), My-queue bell, language |
| Super Admin notice | A persistent amber-tint line under the top bar: *"You are signed in as Super Admin. Use your working role for day-to-day tasks; Super Admin actions still need a reason and may need a second approver."* Super Admin is a governance role, not the default |
| Collapsible | Icon rail on narrower screens (as in the Merchant Portal) |

---

## 4. REUSABLE COMPONENT SYSTEM (17)

| # | Component | Spec |
|---|---|---|
| 1 | **Admin navigation shell** | Section 3 |
| 2 | **KPI card** | White 16-px card; label 11.5/700 secondary; value 24/800; one comparison line with a tinted delta chip. Only measured values. Money values are permissioned and show "Amounts need Finance access" otherwise |
| 3 | **Attention queue card** | Count 30/800 · title with icon · "Oldest …" age line · optional severity or SLA fragment · chevron; navy left accent on high-priority queues; card **absent** when the role lacks access |
| 4 | **Operational data table** | Toolbar (search, filter popovers, removable filter chips, saved view, export if permitted); lavender header (11.5/700); 44–48-px rows; hover wash; IDs in mono LTR; numeric columns end-aligned; row click opens detail; server pagination; no bulk actions in MVP |
| 5 | **Workbench layout** | Header card (identity, status chips, SLA) → three columns: **section rail** (200, sticky, with ✓ / ! / count indicators) · **main evidence** (stacked section cards) · **decision panel** (340, sticky) → **audit strip** along the bottom |
| 6 | **Decision panel** | Title with scale icon; blockers banner ("Approve is blocked: …"); stacked 44-px action buttons (Approve green, Request changes amber-tint, Reject red-outline, Escalate lilac); reason/note field; footer note explaining consequences. Buttons **disappear or become a read-only note** by permission |
| 7 | **Detail-page tabs** | Segmented lilac control with counts; used for Customer detail (9 tabs) and Merchant detail; ≤ 9 tabs scroll horizontally |
| 8 | **Audit / activity timeline** | Two forms: bottom **audit strip** (horizontal, last 4–5 events with actor and time) and vertical **timeline** (12-px dots, 2-px rail) inside cards; deep link to the full log |
| 9 | **Status chips** | Shared vocabulary (Draft, Pending review, Scheduled, Live, Paused, Expired, Rejected, Needs changes, Suspended) + Admin: **Awaiting second approval**, **Under investigation**, **Legal hold**, **Added card** (never "verified"), **Enhanced review**, **Not completed** |
| 10 | **Risk indicator** | Four-segment bar in **navy tints** + a word (Low / Medium / High / Critical). Meaning never depends on colour; red is not used for severity |
| 11 | **Maker / checker state** | Numbered steps in a soft grey card: ✓ done (mint), ② waiting (purple ring), ○ not yet; "Maker ≠ checker enforced"; if you are the maker: *"You requested this. You cannot approve it."* |
| 12 | **Confirmation modal** | 500-px, icon + title + consequence sentence, reason selector (required), note, impact banner ("recorded in the audit log", "customer is notified"), Cancel / destructive confirm; PII reveal modal adds "visible for 5 minutes" |
| 13 | **Evidence / document viewer** | Right drawer (520): preview, metadata, legibility chip, **"Viewing this document is logged"**, Accept / Reject document (permissioned) |
| 14 | **Search & filter system** | Global search; per-page search pill; filter buttons open popovers; active filters as removable lilac chips; "Clear all"; saved views |
| 15 | **Drawer** | Right-side, radius 22 on the inner edge, header / body / sticky footer; mirrors in RTL |
| 16 | **Warning banner** | Info (lilac), warning (amber), danger (rose), success (mint), **legal hold** (navy), **suspended** (solid red); icon + bold title + one sentence |
| 17 | **Empty / loading / error states** | Empty: lilac icon circle, title, one line ("All clear"); loading: skeleton shapes matching the layout; error: rose icon, plain sentence, Retry; **no-access** state: lock icon and a sentence naming who has access |

Also established: key-value list, document row, checklist ("Checks" with ✓ / ! / ·), guardrail table (✓ / ! / ✕ circles), reason modal list, tabs inside drawers.

---

## 5. PERMISSION-AWARE INTERACTION MODEL

1. **Navigation** shows only permitted items (hidden, not greyed).
2. **Pages** a role may not open show a calm **no-access state** that names the roles that can ("Settlement information is limited to Finance and Super Admin (with maker-checker)").
3. **Cards and widgets** the role cannot use are **absent** (dashboard queue cards, KPI sub-values, tabs such as Payments and Risk on the customer record).
4. **Actions** follow three states: *available* (button), *request-only* (a different button: "Request suspension" sends to Risk), or *view-only* (the action area is replaced by one grey note: "View only. Merchant Management or Risk decide applications.").
5. **Maker-checker** is visible: the maker sees why they cannot approve; the checker sees "You are the checker. You did not create this request."
6. **Sensitive data** is masked by default with an audited **Reveal** that needs a reason.
7. **Consequence text** accompanies every sensitive button ("The customer is notified and can appeal through Support").
8. **Never shown to any Admin:** card digits, OTP codes, passwords, full ID numbers.

Demonstrated in the mockup with the **Signed in as** switcher (Support, Merchant Management, Operations, Finance, Risk, Super Admin): for example a Support user views a refund or payment but cannot approve it; a Finance user decides refunds and settlements but cannot change campaign content; a Risk user can block but cannot see settlement; Operations reviews campaigns but cannot decide refunds.

---

## 6. STATES AND MOTION
- Hover: lilac wash on rows and cards; focus ring 2 px `purple-2`; selected rail item lilac.
- No decorative motion; skeleton shimmer only (respects reduced motion); modals and drawers fade/slide in 160–240 ms.
- Destructive buttons (Reject, Block, Suspend) are outlined or tinted until the final confirmation modal, where the solid red button appears.
- Counts and ages are the primary visual signal on queues; colour is secondary.

---

## 7. RTL / ARABIC
- Shell mirrors: sidebar on the right, top-bar order reversed, drawers open from the left, decision panels and rails swap sides, chevrons and breadcrumbs mirror, tables mirror column order.
- IBM Plex Sans Arabic for Arabic text with +4 px line height; Western digits.
- **Operational identifiers stay LTR islands:** transaction/order/PSP IDs, references, codes, timestamps, SAR amounts, percentages, device ids, and chart time axes.
- Nav, queue titles and KPI labels shown in Arabic in the mockup are **illustrative placeholders**; native review required before launch. Not all UI is translated.

---

## 8. ACCESSIBILITY
Contrast per tokens (navy on white 18:1; secondary on lavender 5.9:1; white on approve green 4.9:1; chips use dark tint text); no meaning by colour alone (every status has icon + word; risk uses a bar and a word); keyboard-first tables and decision panels; visible focus; modals and drawers trap focus and return it; masked data announced as "masked"; reduced-motion respected.

---

## 9. WHAT TO PROPAGATE TO THE REMAINING ADMIN SCREENS
List pages → data table + queue header; detail pages → tabs or workbench; every decision → decision panel; every sensitive action → reason modal + audit strip; every money or reward change → maker-checker state; every configuration change → propose/approve with versioning. See the wireframe inventory (A01–A31).


---

## 10. QA-DRIVEN SHARED RULES (v0.2)

Added after the visual QA (`DEALDASH_ADMIN_VISUAL_QA.md`). They apply to **every** Admin page.

1. **Identifier isolation.** IDs, references, PSP refs, codes, amounts, dates and times are left-to-right isolates inside any text, in LTR and RTL.
2. **High-impact action group.** Reject, Suspend, Block, Void, Cancel run and similar actions sit under a labelled divider **"High-impact · audited"**, with a red-tinted surface and rose border; solid red is used only on the final confirmation button.
3. **Dense table rules.** Fixed layout with defined column widths (`id 112`, `amount 96`, `status 132`, `action 44`), ellipsis truncation with full text on hover, per-cell text direction, 40-px minimum rows, mono IDs.
4. **No gradients in Admin.** The settlement summary and all hero-like surfaces use flat lilac or white.
5. **Single role indicator** (top bar chip) and the Super Admin notice.

---

## 11. PROPAGATION: ALL MVP ADMIN PAGES (A01–A31)

No new visual languages were introduced. Every remaining page is built from the same seven templates. Mockups: `docs/mockups/admin-hifi-batch-01.html` (A02, A04, A06, A11, A18, A20-style settlement detail, A24) and `docs/mockups/admin-hifi-batch-02.html` (25 further pages generated from the shared patterns, with the role switcher and RTL).

### 11.1 Templates

| Template | Anatomy | Used by |
|---|---|---|
| **T1 List page** | Title + subtitle + primary action → optional KPI strip → segmented tabs → toolbar (search, filters, saved view) → dense table → footer; row click opens detail or quick drawer | A03, A05, A08, A10, A14, A15, A17, A19, A21, A22, A23, A25, A28, A29, A31 |
| **T2 Detail page** | Header card (identity, chips, meta, actions) → tabs → main cards + side cards → audit strip | A04, A07, A09, A12, A16, A20 |
| **T3 Workbench** | Header card → section rail · evidence · sticky decision panel → audit strip | A06, A11, A18, A24, A26 |
| **T4 Case / conversation** | Workbench with conversation, evidence, notes and decision panel | A26 |
| **T5 Config** | Tabs → versioned settings table → "Propose change" modal (approver ≠ proposer) | A30, A31 (templates, legal) |
| **T6 Report** | Filters + KPI cards + simple bar/line charts (two chart types only) + export | A27 |
| **T7 Auth** | Centred card, MFA step, invite flow | A01 |

### 11.2 Page-by-page treatment

| # | Page | Template | Key visual notes | Pattern reuse |
|---|---|---|---|---|
| A01 | Sign in & MFA | T7 | Centred card, "Admin" wordmark caption, MFA next-step banner; invite acceptance and MFA enrolment as steps | Banners, fields |
| A02 | Dashboard | custom (done) | KPI strip, attention queues, my next items | KPI card, queue card, table |
| A03 | Customers | T1 | Masked phone in mono, risk bar, eligibility chips ("Added card"), Requests tab with legal-hold flag | Table, chips, risk indicator |
| A04 | Customer detail | T2 (done) | 9 tabs, reveal and suspend modals | Tabs, modal |
| A05 | Merchants | T1 | Tabs All · Applications · Suspended · Obligations; risk tier chips; SLA column | Table, chips |
| A06 | Merchant application review | T3 (done) | Rail with indicators, evidence drawer | Workbench, decision panel |
| A07 | Merchant detail | T2 | 11 tabs; Finance tab absent for non-finance roles; audit strip | Tabs, key-values |
| A08 | Partners | T1 | Applications · Active · Domain & BIN verification | Table |
| A09 | Partner detail / review | T2 (+decision panel in application mode) | Eligibility configuration table (products, tiers, BIN/IIN ranges, effective dates); reporting permissions card showing "aggregate only, cohort 10 (pilot)"; customer-level sharing "none granted" | Tabs, table, banner |
| A10 | Campaigns | T1 | One list, five tabs, product chip, review reason, key metric by product; no bulk actions | Table, chips |
| A11 | Campaign review | T3 (done) | Adaptive by product | Workbench |
| A12 | Campaign detail | T2 | Adaptive: Hot shows inventory & reservations with committed vs available; corrections card (non-material alone, material 2nd approver); Voucher purchases; W&E views & fraud, budget and balance | Tabs, table, decision rules |
| A13 | Voucher & code trace | T2-lite (special) | Search + lifecycle chips (Created → Purchased → Active → Redeemed / Refunded / Expired) + vertical timeline with ledger refs; actions incl. extend validity (Ops approves, Finance checker if financial effect) and **void for fraud** in the high-impact group | Timeline, high-impact group |
| A14 | Moderation | T1 | Videos · Reviews · Reported · Translations; reason templates | Table, drawer |
| A15 | Payments | T1 | Order, item, merchant, customer, amount, status, PSP ref; Failed and Disputes tabs; no card data | Table, mono IDs |
| A16 | Payment detail | T2 | Timeline, ledger entries, provider data, linked objects | Timeline, key-values |
| A17 | Refunds | T1 | Maker, checker, status columns; statuses Requested → … → Completed/Failed | Table, maker/checker |
| A18 | Refund case | T3 (done) | Eligibility, evidence, financial effect | Workbench |
| A19 | Settlements | T1 + KPI strip | Runs, Merchant balances (held, eligible, negative), Payouts, Adjustments, Exceptions; configuration notes (no hard-coded frequency) | Table, maker/checker |
| A20 | Settlement run detail | T2 | Statements per merchant, holds and negatives, approvals card; negative balance shown with text, not just colour | Table, maker/checker |
| A21 | Reconciliation | T1 | Daily and Exceptions tabs; difference column; "no silent corrections" | Table |
| A22 | Rewards | T1 | Accounts · Ledger · Adjustments & holds · Rules & catalogue · Liability & expiry; non-cash notice | Table, maker/checker |
| A23 | Risk queue | T1 | Nine tabs by risk type; severity bar + word; owner and state | Risk indicator, table |
| A24 | Risk case | T3 (done) | Signals, timeline, linked devices, scoped Block modal | Workbench, high-impact group |
| A25 | Support inbox | T1 | Tabs Customer · Merchant · Partner · Disputes · Appeals · Campaign issues; SLA column | Table |
| A26 | Case workspace | T4 (special: **appeal**) | Original decision preserved card, customer appeal, conversation, decision panel; "the person who made the original decision cannot decide this appeal"; outcomes recorded with reviewer, time, reason | Workbench, banner |
| A27 | Reports | T6 | KPI cards, simple horizontal bars, operations card; money values permissioned; Partner tab aggregate with suppression | KPI card |
| A28 | Admin team | T1 | Privileged-rights column, temporary-access expiry, MFA state; tabs Users · Roles & permissions · Invitations · Sessions & MFA · **Access review** (quarterly + immediate triggers) | Table, banner |
| A29 | Audit log | T1 (special) | Dense table, record drawer with previous → new state, reason, source; viewing is logged | Table, drawer |
| A30 | System configuration | T5 | Versioned settings with "Propose change" modal; approver is not the proposer; rollback | Table, modal |
| A31 | Reference data & content | T5/T1 | Networks & issuers (Visa, Mastercard, Amex, mada), employers, categories, templates (AR/EN), macros, legal versions; brand-mark permission placeholders | Table |

### 11.3 Screens that need special treatment (beyond the templates)
1. **A13 Voucher & code trace**: lifecycle visual and the high-impact void action.
2. **A26 Appeal case**: preservation of the original decision, second-level reviewer rule and outcome record.
3. **A12 Exclusive Deal tab**: committed vs available inventory and the corrections rules.
4. **A29 Audit log record drawer**: before/after diff view.
5. **A30 Config**: propose/approve/rollback with effective dates.
6. **A27 Reports**: chart style and permissioned money values.
7. **A01 Sign-in/MFA/invite**: security-sensitive copy and states.

*End of Admin visual language v0.2.*
