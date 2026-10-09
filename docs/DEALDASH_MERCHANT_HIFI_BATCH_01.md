# DEALDASH MERCHANT PORTAL: HIGH-FIDELITY BATCH 01

Version 0.1 (draft for visual-direction approval) · 2026-10-07
Screens: **M04 Dashboard · M05 Campaigns hub · M11 Exclusive Deal builder · M07 Exclusive Deal detail / monitor**, plus the Arabic RTL view of the shell and dashboard.
Not designed: the other 17 Merchant Portal screens, Partner, Admin, Staff app.
No production code was written.

## FOUNDER DECISIONS APPLIED (v0.2): supersede conflicting text below

| # | Decision | Effect |
|---|---|---|
| D1 | **Navigation:** 8 primary groups, not 11 top-level items. Final: **Dashboard, Campaigns, Redemptions, Insights, Finance, Business, Team**, with **Support and Settings in the pinned footer area**. Vouchers and Watch & Earn live **inside Campaigns** (prominent tabs with icons) and in dashboard shortcuts; no top-level clutter. | Replaces the 11-item sidebar of Batch 01 v0.1 |
| D2 | **White / light-lavender sidebar** with deep navy text, purple active state, restrained separators. No heavy dark-navy enterprise sidebar. | Approved as built |
| D3 | **Restrained gradient** only where it adds hierarchy: **Dashboard hero** and the **live campaign / Exclusive Deal monitor hero** (also the Watch & Earn campaign hero). Not on normal cards, tables or forms. | The funnel's first bar changed from gradient to solid navy; Finance uses a soft lavender summary card |
| D5 | **Builder collapses main navigation to an icon rail**; merchant can expand with one click (circular toggle). | Added toggle to the shell |
| D6 | **Live Exclusive Deal editing is intentionally strict.** Merchant may: pause, end, **raise or lower inventory within safe limits (never below reserved + redeemed)**, and adjust approved operational limits such as per-customer quantity within DealDash guardrails. **Not** while live: discount/value, core offer, eligibility, branches, material terms, major timing. Those require **a new version/campaign** or **DealDash review where supported**. **Every live edit is audit-logged.** | "Edit allowed fields" drawer rewritten: per-branch stock steppers with committed counts and allowed ranges, per-customer limit, "Create a new version" action, "Saved to Activity" footer |
| D7 | **Monitor definitions:** *Expired reservation* = the reservation hold timed out. *No-show* = confirmed reservation not completed that meets the approved no-show rule. Conversion stages: view â†’ reservation â†’ redeemed. | Definition note added under Reservation activity; Overview funnel unchanged |
| D8 | **Revenue:** show SAR revenue only where DealDash can reliably attribute it. Vouchers: actual sales revenue. Live Deals: discovery/engagement only. Exclusive Deals: reservations and confirmed redemptions. Watch & Earn: merchant spend, qualifying views, engagement. | Rules held in all Insights and detail screens |
| D9 | **Customer preview** follows the latest product rules: free Exclusive Deal reservation, no generic "Activate offer", frictionless Live Deals. **Customer screens S20, S26 and S31 require alignment during the customer-design update stage.** | Recorded; preview uses the updated rules |
| D10/D11 | **Arabic:** Western digits initially; **IBM Plex Sans Arabic** for Arabic UI; placeholder Arabic strings acceptable during design only; **all Arabic customer-facing and business-facing copy must be reviewed by a qualified native Arabic UX/content reviewer before production launch.** | Recorded |
| D12 | **Campaigns Hub:** hybrid card-like rows rather than a dense enterprise table; must still support search, filters, status, metrics, row actions. | Approved as built |

## 0. What was produced

| Artifact | Location | Notes |
|---|---|---|
| **Interactive high-fidelity mockups** (design review only) | `docs/mockups/merchant-hifi-batch-01.html` | One static HTML file, open in a browser at ≥ 1280 px wide. Top bar switches between M04, M05, M11, M07, M04 Arabic RTL and a Components & states sheet. Builder steps 1–9 are clickable; the limit-type cards change the form; the preview toggles Detail / Card and EN / AR; M07 has working tabs, a Pause modal and an Edit-allowed-fields drawer. Fonts load from Google Fonts (Plus Jakarta Sans, IBM Plex Sans Arabic). This is a **design artifact, not application code**: there is no data layer, routing or reuse intent. |
| This specification | `docs/DEALDASH_MERCHANT_HIFI_BATCH_01.md` | Final layouts, hierarchy, spacing, typography, interactions, states, responsive and RTL rules, and the shared component inventory |

All four screens and the RTL view were rendered and visually inspected at 1440 px width; several layout defects found in that review were fixed (collapsed-sidebar logo, wrapped inventory text, conversion card, stale "missing terms" check). **Tablet and phone layouts are specified here but were not rendered.**

Placeholders to replace before sign-off: merchant photography is CSS gradient "bokeh"; icons are a generic open outline set; Arabic strings are illustrative and need a native reviewer; the phone preview uses a simplified rebuild of the customer Exclusive Deal detail (to be replaced by the real customer components once revised for free reservation).

> **Live Deal editing (final, v0.2.4):** For an active Live Deal, **minor non-commercial edits** (typo, formatting and translation corrections and other non-material descriptive corrections) **may publish immediately with a full audit trail**. **Material edits require review or a revised version.** Material = discount/value, core proposition, eligibility, participating branches, campaign dates where material, important terms and conditions, and anything that materially changes what the customer receives. **DealDash may tighten this rule for merchants or content flagged by risk controls.** (Exclusive Deals remain stricter per D6.) Merchant Portal is structurally frozen for MVP; remaining work is visual QA only (7 screens not yet inspected in-browser, tablet/phone states, Arabic/RTL drawn review, final photography/icons, alignment of customer screens S20, S26, S31).

---

## 1. VISUAL DIRECTION SUMMARY

**Idea:** the portal is the *back-of-house of the same product*. A merchant should feel they are looking at DealDash from the other side of the counter: same lavender-white atmosphere, navy confidence, one purple verb, rounded cards and pill controls, and the customer's own deal card appearing inside the builder.

| Direction | How it shows up in Batch 01 |
|---|---|
| Premium, calm | White cards on `#F8F9FD`, 24-px gutters, 1px borders with the approved low shadow, no zebra tables, no heavy dividers |
| Energetic but controlled | One **navy-to-purple hero card** per screen (Dashboard "Performance today", Monitor campaign hero), a pulsing Live chip, large countdown numerals, a live phone preview |
| Business-readable | Plain labels ("Needs attention", "Add stock", "Reserve for free"), one action per attention item, concise KPI cards |
| Brand continuity | Wordmark "Deal" navy + "Dash" purple, segmented lilac tabs, pill buttons/chips, customer Exclusive Deal card reproduced in the preview, flame as the only orange accent |
| Not generic SaaS | Hero cards, branch stock bars, choice cards with icons, the customer preview, real merchant photography in thumbnails, friendly microcopy; no left-heavy navy admin chrome |

**Visual system decisions applied (all within approved tokens):** white sidebar with lilac active pill (not navy); one primary purple action per screen; status chips tinted, only Suspended is solid; orange limited to the 16-px Hot marker plus the customer card inside the preview; chart palette purple / navy / lilac-300 / slate.

---

## 2. GLOBAL SPECIFICATIONS (apply to all four screens)

### 2.1 Layout grid and spacing

| Item | Spec |
|---|---|
| Viewport | Designed at 1440; content area = viewport − 248 (sidebar) = 1192; centred, max 1360 |
| Page padding | 28 top · 32 sides · 56 bottom |
| Grid | 12 columns, 24 gutter; common spans 4 / 5 / 6 / 7 / 8 / 12 |
| Card | White, radius 20, 1px `#E3E1F0`, padding 24, shadow `0 1px 2px rgba(20,22,58,.06)`; hero radius 24, padding 28 |
| Section gap | 24 between cards; 16 inside card groups; 10–12 between list items |
| Table row | 56 (hub), 48–56 (reservation tables), header 44 on `#F6F3FF` |
| Heights | Buttons 36 / 44 / 48; inputs 48; chips 28 (24 in tables); icon buttons 40; top bar 64; builder header 72; builder footer 72 |

### 2.2 Typography (as built)

| Role | English | Arabic |
|---|---|---|
| Hero number (countdown) | Plus Jakarta Sans 800, 56/60, tabular | IBM Plex Sans Arabic 700 |
| Page / greeting title | 800, 28/36, -0.01em | 700, 28/42 |
| Builder step title | 800, 26/34 | 700, 26/40 |
| KPI figure | 800, 28–32 | 700 |
| Card title | 800, 16/24 | 600 |
| Body | 500, 14/22 | 400, 15/26 |
| Table / secondary | 500, 13/20, secondary `#5B5E80` | 400, 14/24 |
| Caption / chip | 500–700, 12/16 | 400–600, 13/20 |
| Labels | 600, 13/18 | 600, 14/22 |

### 2.3 Colour use

Primary action `#5B1AFC` (hover `#7E4DFF`); tab/selected tint `#EEE8FF`; hover wash `#F6F3FF`; text `#0F0C42`; secondary `#5B5E80`; lines `#E3E1F0`; Live chip `#E2F7F0 / #0B7A5A`; warning `#FEF1D9 / #8A5A00`; danger `#FDE8EB / #B3203A`, solid `#C9213D`; hero `linear-gradient(135deg,#0F0C42,#4313D6)`. Derived tokens and contrast values are in the visual design specification section 1.3.

### 2.4 Shell (shared by all four screens)

| Part | Spec |
|---|---|
| Sidebar (248, white, 1px right border) | Wordmark + "for Business"; three labelled groups: **RUN** Dashboard · Campaigns · Vouchers · Watch & Earn · Redemptions; **UNDERSTAND** Insights · Finance; **MANAGE** Business · Team; **bottom** Support · Settings and the merchant card (logo, name, Verified). Active item = lilac pill with purple label; a small purple dot on Campaigns signals items needing attention; a circular toggle beside the wordmark collapses/expands the rail; items 44 high, radius 14, icon 20 + label 14/700 |
| Collapsed mode (76) | Used on the builder to give the form room: monogram "D" in a purple rounded square, icon-only items, avatar-only merchant card |
| Top bar (64, white) | Left: merchant avatar + name + verified tick, **branch selector** pill ("All branches"); centre: search pill with `/` hint; right: help, notifications (purple count badge), EN / عربي segmented toggle, user avatar |
| Navigation (final, D1) | **Seven primary items** in three groups (RUN: Dashboard, Campaigns, Redemptions; UNDERSTAND: Insights, Finance; MANAGE: Business, Team) plus **Support and Settings pinned in the footer area**. Vouchers and Watch & Earn are tabs inside Campaigns and dashboard shortcuts. Finance is hidden for users without finance permission. |

---

## 3. M04: MERCHANT DASHBOARD

**Question it answers:** "What is happening in my DealDash business right now?"

### 3.1 Final layout (desktop, 12-column)

| Row | Content | Span |
|---|---|---|
| Header | Greeting "Good morning, Akif" (28/800) + subtitle; right: **Today ▾** outline button and the single **+ Create campaign ▾** primary | – |
| 1 | **Performance today** hero (navy→purple) | 8 |
| 1 | **Exclusive Deals running now** card | 4 |
| 2 | **Needs attention** (4 items) | 7 |
| 2 | **Quick actions** (2×2 tiles) | 5 |
| 3 | **Watch & Earn performance** (3 stats + 7-day area chart) | 7 |
| 3 | **Recent redemptions** (4 rows) | 5 |
| 4 | **Recent activity** (two-column feed) | 12 |

### 3.2 Component hierarchy and content hierarchy

1. **Hero "Performance today"**: title 20/800, "Updated just now · All branches", Live-data pill; four metrics separated by thin dividers: **Active campaigns 6** (2 ending soon), **Reservations today 14** (+4 vs yesterday), **Voucher sales 9** (sold; 3 redeemed), **Qualifying views 318** (+12%); 36/800 numerals; a 12-bar hourly activity strip at the bottom in translucent white. No revenue figures.
2. **Exclusive Deals running now**: flame marker, count chip; row with thumbnail, "Dinner for Two · 30% off", branches, Live chip; **countdown 01:42:18** (30/800) and **12 / 40 remaining**; stacked stock bar with legend (Available / Reserved / Redeemed); tonal full-width **Open monitor** button (opens M07).
3. **Needs attention**: attention cards with a 4-px left accent (amber, red or purple), 36-px tinted icon, bold sentence, one-line reason, one tonal action. Items: *Free dessert with two mains needs changes → Fix*; *Exclusive Deal inventory low at Riyadh Park → Add stock*; *Voucher sale ends in 2 days → View*; *Watch & Earn budget 92% used → Add budget*. Max five; "View all" link.
4. **Quick actions**: four tiles (icon in lilac circle, bold title, one-line hint): Create Live Deal, Create Exclusive Deal, Create Voucher, Create Watch & Earn. Hover raises with lilac border.
5. **Watch & Earn performance**: stats Qualifying views · Qualification rate · Campaign spend (of SAR 1,200 funded) with delta chips; area chart (purple 2.5px line, 22% → 0 fill, three gridlines, direct day labels).
6. **Recent redemptions**: icon avatar, item, "type · branch · first name", time right-aligned.
7. **Recent activity**: dot colour = event type; sentence; relative time.

### 3.3 Interaction behaviour
- Create campaign opens a menu of the four products; each Quick action opens the matching builder.
- Hero metrics and attention items are links to the relevant list/detail.
- Branch selector and "Today" filter all widgets; chart range menu "Last 7 days".
- Open monitor → M07. Needs attention actions deep-link (Fix → builder step, Add stock → drawer).

### 3.4 Desktop and responsive behaviour

| Breakpoint | Behaviour |
|---|---|
| Desktop ≥ 1280 | As above |
| Laptop 1024–1279 | Sidebar collapses to the 76-px icon rail; hero metrics stay 4-up with smaller numerals; Row 1 becomes 7/5 |
| Tablet 768–1023 | Sidebar in a slide-in drawer; hero full width, metrics 2×2; Exclusive Deals card full width below; attention and quick actions stacked; recent lists single column |
| Phone < 768 | Bottom bar (Home, Campaigns, Redemptions, Support, More); hero metrics as a horizontal snap strip; **Needs attention first**, then Exclusive Deals running, quick actions as a 2×2 grid; chart simplified; recent activity collapsed to 3 rows |

### 3.5 States

| State | Visual |
|---|---|
| Loading | Skeleton hero and cards in the same grid |
| Empty (activated, nothing live) | Zeros in muted ink; **Get started** card with three steps (Add branches, Invite your team, Create your first campaign); Exclusive Deals card replaced by "Fill quiet moments" empty state |
| Warning | Attention items in amber; stock bar turns amber when low |
| Error | Widget-level error card with Retry; other widgets unaffected |
| Suspended | Solid-danger banner on top; hero and lists read-only; Create disabled with tooltip |
| Success | Toast after quick actions (e.g. "Stock added · Undo") |

### 3.6 RTL (rendered in the mockup)
Sidebar moves to the right; top bar mirrors (merchant and branch at the right, language toggle and avatar at the left); greeting and subtitle right-aligned; hero metrics order reverses with dividers on the opposite edges; attention accent bars move to the right; chevrons and the arrow in **Open monitor** mirror; chart time axis stays **left-to-right** with Arabic weekday labels at 11 px; numbers remain Western digits in LTR islands; mixed text ("صباح الخير، Akif", "Dinner for Two · 30% off") renders in correct bidi order; IBM Plex Sans Arabic with +4 px line height.

---

## 4. M05: CAMPAIGNS HUB

### 4.1 Final layout
Header (title, subtitle, **+ Create campaign ▾**) → segmented tabs **All 12 · Live Deals 4 · Exclusive Deals 2 · Vouchers 4 · Watch & Earn 2** with a **Needs attention · 3** quick-filter chip at the far end → one white card containing the **toolbar** (search in English or Arabic, Status, Branch, Date filters, sort note "Needs attention first"), a lavender column header, the **hybrid rows**, and a footer (rows per page, range, pager).

### 4.2 Hybrid row design (table/card)
Rows behave like soft cards inside the table: 14/20 padding, radius 16, 6-px gap, hover = lilac wash with lilac border, entire row clickable. Columns (grid `2.5 / 1.15 / 1.35 / 1.35 / 1.45 / 1.7 / 36`):

| Column | Content hierarchy |
|---|---|
| Campaign | 44-px rounded thumbnail; **name** (14/700, truncates); type line with icon (Live Deal, Exclusive Deal with flame, Voucher, Watch & Earn) |
| Branches | "Olaya · Riyadh Park", "All branches (3)", "Riyadh · 5 km" |
| Status | The nine-status chip system (icon + label) |
| Dates | Primary line (e.g. "Today 12:00") and secondary line ("Ends 17:42") |
| Performance | Bold figure ("8,420 impressions") + delta ("↑ 18% vs last Exclusive Deal") or reason ("Not live yet") |
| Key metric | **Product-specific:** Live "322 directions · 1,960 detail views"; Hot "12 of 40 left · 17 redeemed" + stock bar; Voucher "48 sold · 31 redeemed" + bar; Watch & Earn "920 / 1,000 views" + bar (amber when budget ≥ 90%) |
| Actions | `⋯` icon button |

Coverage in the mockup: all nine statuses appear (Needs changes, Suspended, Live ×5, Paused, Pending review, Scheduled, Draft, Expired, Rejected). Sort places items needing attention first.

### 4.3 Interaction behaviour
- Tabs filter rows and update the range text; sidebar **Vouchers** and **Watch & Earn** jump here pre-filtered.
- Clicking a row opens its detail page (Dinner for Two → M07).
- Status/Branch/Date filters open popovers with removable chips (not rendered); search matches Arabic or English titles.
- Row menu: View, Edit (if allowed by status), Pause/Resume, End, Duplicate (Phase 2).
- No bulk selection in MVP.

### 4.4 Responsive, states, RTL
| Topic | Spec |
|---|---|
| Tablet | Rows become **cards**: thumbnail + name + status chip on top; two facts (dates, key metric) below; chevron; filters collapse into a "Filters" button |
| Phone | Same cards, one per row, key metric only; tabs become a horizontal scroller |
| Loading | 6 skeleton rows |
| Empty (tab) | Icon, one sentence, one Create button per product ("Fill quiet moments with an Exclusive Deal") |
| Filtered-empty | "No results. Clear filters" |
| Warning / error | Amber/red chips with tooltips for reviewer notes; in-card error with Retry |
| RTL | Column order mirrors, first column at the right, `⋯` at the left, numerics LTR, pager arrows mirror; Arabic titles truncate at the end edge |

---

## 5. M11: EXCLUSIVE DEAL BUILDER

### 5.1 Final layout

```
┌ header 72: ‹ Campaigns / New Exclusive Deal  ‹Draft›  Saved just now        ✓ EN + AR complete · Ask DealDash to help translate ┐
├ rail 264 (card) ┬ form column (fluid, content ≤ 720) ─────────────────────┬ preview column 392 (sticky) ───────────────┤
│ ring 3/9        │ "Step 3 of 9" · Step title 26/800 · helper                │ stage (lavender)  [Detail|Card]   [EN|AR]  │
│ 1 Basics ✓      │ ┌ form cards ─────────────────────────────────────────┐   │   phone frame 312 × 560 (customer Hot card)│
│ 2 Deal config ✓ │ │ …                                                    │   │ ┌ DealDash checks ──────────────────────┐ │
│ 3 Branch &… ●   │ └──────────────────────────────────────────────────────┘   │ │ ✓ Valid campaign dates                │ │
│ 4 … 9 Publish   │ banners / locked rows                                      │ │ ✓ Arabic & English content supplied   │ │
│                 │                                                            │ │ ✓ Branch selected                     │ │
│                 │                                                            │ │ ⚠ Inventory very low at Riyadh Park   │ │
│                 │                                                            │ │ ⚠ Missing terms → ✓ Terms added (7+)  │ │
├ footer 72 (sticky): [‹ Back]  Drafts save automatically            Save draft · [Preview] · [Continue →] / [Submit →] ┤
```

The sidebar collapses to the icon rail on this screen so the form and preview have room.

### 5.2 Stepper
Vertical rail inside a white card: top block with a **progress ring** (n/9) and "Step n of 9 · name"; nine steps each with a 28-px numbered circle, label (14/700) and one-line helper; completed = purple circle with check and purple connector; current = lilac pill with purple border circle; clickable. Steps: **1 Basics · 2 Deal configuration · 3 Branch & inventory · 4 Eligibility · 5 Timing · 6 Content · 7 Terms · 8 Review & preview · 9 Publish / submit** (9 is a result state, not a form).

### 5.3 Steps (content hierarchy)

| Step | Content |
|---|---|
| 1 Basics | Bilingual **Deal name** (EN | AR side by side with language tags) and **short description**; helper tip; "EN + AR" completeness chip |
| 2 Deal configuration | **What do customers get?** segmented (% off · SAR off · Buy 1 get 1 · Free item) and discount chips (20–60%, 30% selected) with the pre-approved-rules hint; **How is this deal limited?** three choice cards **Time · Quantity · Time + quantity** (icon, title, one line) with an info line that restates the rule; **Reservations** card: toggle "Free reservation" on, **Hold duration** (30 minutes default, 15–60 allowed), **Reservations per customer** stepper (2), and a locked dashed row **Paid deposit: Coming later** |
| 3 Branch & inventory | Table card: branch (toggle + name + address), **Units** stepper, opens-today hours, "Customers will see 20 left"; excluded branch dimmed with "Closed today"; total row "2 branches · 40 units in total"; amber banner "Riyadh Park may sell out quickly"; locked row "Shared stock across branches: Coming later" |
| 4 Eligibility | Three radio cards: Everyone (selected), Customers with an eligible bank card, Verified employees; each explains the locked-offer message customers will see |
| 5 Timing | Start now / Schedule for later; **How long?** chips 30 min · 1 h · 2 h · 3 h · Until closing; info banner "Ends today at 17:42" (shown for time modes); for quantity-only: "No end time" card |
| 6 Content | Photo gallery uploader (Cover badge, add tile), format guidance |
| 7 Terms | Common-term checkboxes; optional bilingual free text; info banner confirming selected terms |
| 8 Review & preview | Green "Within pre-approved rules" banner; summary card with seven rows and Edit links |
| 9 Publish / submit | Result panel: **"Your Exclusive Deal is live"** (check icon, explanation, **Open live monitor** primary, Create another). Other variants listed beneath: Scheduled · Pending review · Needs changes |

**Dynamic behaviour (built):** the limit-type cards drive the form. *Time:* inventory columns and units disappear, step 3 reads "Time-limited deals do not use stock", the preview shows only the countdown. *Quantity:* the countdown and duration chips disappear, the "No end time" card appears, the preview shows the stock bar only. *Both:* everything shows.

### 5.4 Form field system
Inputs 48 high, radius 14, 1px line, focus = purple-2 border + lilac-50 fill + soft ring. **Bilingual field:** two inputs side by side, floating tags **EN** and **AR** (purple 10/800), the AR input RTL with Plex Arabic. Choice cards radius 20; selected = 2px purple border + lilac-50 + filled icon circle. Toggle 44×24 purple. Stepper = bordered control with lilac − / + buttons. Locked rows = dashed border on slate with a lock icon and a "Coming later" chip. Banners: info (lilac), warning (amber), success (mint).

### 5.5 Live mobile preview
Sticky "stage" (`#E9E7F5`, radius 24) containing a 312 × 560 phone frame (navy 8-px bezel, notch). **Detail view** reproduces the customer Exclusive Deal page: photo header with merchant and branch line, "30% off" in purple 25/800, Hot chip, description, stock bar with **"Only 12 remaining"**, **"Ends in 01:42:18"**, "Open to everyone" panel, "Reserve for free · Held for 30 minutes · Up to 2 per customer", bottom bar **"Free · 30 min hold" + "Reserve my spot"**. **Card view** shows the discovery card. Toggles: **Detail | Card** and **EN | AR** (the AR toggle switches the frame to RTL with Arabic copy). Fields update the preview live in the real build; in this mockup the mode toggle does.

### 5.6 DealDash checks
A card under the preview: ✓ Valid campaign dates · ✓ Arabic & English content supplied · ✓ Branch selected · ⚠ Inventory very low at Riyadh Park · ⚠ Missing terms (becomes ✓ Terms added from step 7) and a lilac verdict line ("Likely to publish instantly once terms are added" → "Within pre-approved rules: should publish instantly"). Severity: ✓ success, ⚠ advisory (does not block), blocked variant (red) disables Continue.

### 5.7 Actions and behaviour
**Back / Continue** (primary, 48 high; becomes **Submit** on step 8), **Save draft** (text), **Preview** (tonal, opens full-screen preview). Autosave status text in the header. Rail steps are clickable. Validation shows inline errors and an amber ! on the step. Leaving with unsaved changes asks Save draft / Discard.

### 5.8 Responsive, states, RTL
| Topic | Spec |
|---|---|
| Laptop 1024–1279 | Rail 220, preview 340, phone 280 × 520 |
| Tablet | Rail becomes a compact "Step 3 of 9 · Branch & inventory" bar with a steps sheet; preview becomes a **Preview** button opening a full-height sheet; bilingual fields switch to an EN | AR segmented control |
| Phone | One field group per screen with a progress bar; footer buttons stack; dismissible "Best on a larger screen" banner |
| States | Loading skeleton form; field errors; guardrail warning / blocked; autosave failure ("Couldn't save, retrying"); payment n/a; result variants (Published, Scheduled, Pending review, Needs changes) |
| RTL | Rail on the right, preview on the left; Back/Next swap sides with mirrored arrows; the stepper connector runs on the right edge; AR input already RTL; the phone frame flips when AR is chosen |

---

## 6. M07: EXCLUSIVE DEAL DETAIL / MONITOR

### 6.1 Final layout
Breadcrumb (Campaigns › Exclusive Deals › Dinner for Two) → **hero campaign card** → segmented tabs **Overview · Performance · Reservations (41) · Activity · Settings** → tab content.

### 6.2 Hero campaign card (navy→purple, radius 24, padding 28 × 32)
- **Top row:** 84-px rounded photo thumbnail with white 2px ring; **Live** chip (white, pulsing dot) + "Exclusive Deal · Time + quantity"; title **"Dinner for Two · 30% off"** (30/800); meta "Olaya · Riyadh Park · Started today 12:00 · Ends 17:42". Right: **Pause** (white button, primary control), **Edit allowed fields** (ghost), **End campaign** (ghost danger).
- **Bottom row:** left **Time left 01:42:18** (56/800 tabular) with "Ends at 17:42 or when stock sells out"; right **12 of 40 units available** with 14-px segmented stock bar (Redeemed white · Reserved lilac-300 · Available purple-2 · No-show pink) and legend with counts; note "Customers see: ‘Only 12 remaining’".

### 6.3 Overview tab
1. **Five KPI cards:** Impressions 8,420; Detail views 1,960 (23%); Reservations 41 (9 active); Confirmed redemptions 17 (scanned by your staff); Conversion 2.1% (view → reservation) and 41% (reserved → redeemed). No revenue is shown.
2. **Inventory by branch** (8 columns): per branch a name/units column, a 12-px stacked bar, and "5 available · 10 redeemed · 4 reserved · 1 no-show".
3. **Reservation activity:** four counters (Active 9, Redeemed 17, Expired 8, No-show 2) and a mini table (masked code, first name, branch, units, status chip, time).
4. **Side column (4):** **Deal summary** (offer, limited by, reservation, per customer, eligibility, approval chip "Auto-approved") and a lilac note **"While it is live"** explaining what can change.

### 6.4 Other tabs (all rendered in the mockup)
- **Performance:** funnel **Impressions → Detail views → Reservations → Confirmed redemptions** (stepped bars with percentages, caption that redemptions are confirmed by staff scanning and revenue is not estimated) and "Reservations per hour" bars (current hour in lilac-300).
- **Reservations:** search by code; status segmented filter (All · Active · Redeemed · Expired · No-show); branch filter; table with masked code, first name, branch, units, status, time; footer "Showing 9 of 41 · customer first names only".
- **Activity:** vertical timeline (stock added, reservation expired and units released, approved automatically, submitted, draft created).
- **Settings:** locked configuration list ("Locked while live") and "What you can change" (add stock, pause/resume, end early; discount, terms, branches locked).

### 6.5 Overlays (built)
- **Pause modal** (520, radius 26): pause icon, "Pause ‘Dinner for Two’?", impact sentence, optional reason select, amber note "The countdown keeps running while paused", buttons **Keep live** / **Pause deal**.
- **Edit allowed fields drawer** (520, radius 26, scrim 40% navy) per **D6**: banner "operational settings only, every change saved to Activity"; **Inventory per branch** steppers showing the committed count (reserved + redeemed) and the allowed range (e.g. 14 to 50) so stock can be raised or lowered but never below commitments; **Reservations per customer** stepper within DealDash limits; a locked row "Need to change anything else?" with **Create a new version**; sticky footer "Saved to Activity with your name and time" + Cancel / Save changes.

### 6.6 Interaction behaviour
Pause → modal → status chip becomes Paused (hero buttons switch to Resume). Add stock updates the bars and the customer-visible "remaining". End campaign opens a destructive confirm with impact ("Existing reservations remain valid"). Tabs preserve scroll; reservation rows open a drawer (not built). Countdown ticks live.

### 6.7 Responsive, states, RTL
| Topic | Spec |
|---|---|
| Laptop | KPI cards 5-up shrink; side column drops below main |
| Tablet | Hero stacks (countdown above inventory); KPI cards 2-up + 3-up; branch rows stack; tables → cards; drawer → full-width sheet |
| Phone | Monitoring view: hero compact (status, countdown, remaining, Pause), KPIs in a snap strip, tabs scrollable, reservations as cards |
| Status variants | **Live** (as built), **Paused** (Resume primary, banner), **Sold out** (bars full, banner), **Ended** (Results shown first), **Suspended** (solid-red banner, controls removed), **Pending review / Needs changes** (read-only banner and Fix & resubmit) |
| Loading / empty / error | Skeleton hero and cards; empty Reservations "No reservations yet"; stock-conflict toast "Stock changed, refresh" |
| RTL | Hero thumbnail and text mirror; countdown and numbers stay LTR islands; stock bars fill from the start edge (right); funnel grows from the right; tables mirror; drawer opens from the left |

---

## 7. SHARED MERCHANT PORTAL COMPONENT INVENTORY

(Established by Batch 01; every item exists in the mockup file.)

| # | Component | Variants / key spec | First used in |
|---|---|---|---|
| 1 | **Portal navigation shell** | White sidebar (248 / 76 collapsed), grouped items, lilac active pill, attention dot, merchant card, monogram when collapsed | all |
| 2 | **Header (top bar)** | Merchant + verified, branch selector, search with `/`, help, notifications badge, language toggle, avatar | all |
| 3 | **KPI card** | Label, 28–32/800 figure, delta chip (positive/neutral), optional second line | M04, M07 |
| 4 | **Hero campaign card** | Gradient, thumbnail, status chip, title, meta, controls, countdown, segmented stock bar | M07 (and M04 hero variant) |
| 5 | **Status chip system** | 9 required statuses + secondary (Awaiting funding, Sold out); icon + label; Live pulses; Suspended solid | M05, M07, M11, M04 |
| 6 | **Data table** | Toolbar, lavender header, hybrid rows (card-like), hover wash, row menu, footer pager; compact table variant for reservations | M05, M07 |
| 7 | **Filter system** | Search pill, filter buttons (popover), removable chips, quick-filter chip, sort note, segmented status filter | M05, M07 |
| 8 | **Builder stepper** | Vertical rail with progress ring, 28-px step circles, connector, states done/current/todo/error | M11 |
| 9 | **Form field system** | Text, textarea, **bilingual field**, select, toggle, stepper, choice card, radio card, checkbox, gallery uploader, locked row, helper/error text | M11 |
| 10 | **Live mobile preview** | Stage + phone frame, Detail/Card and EN/AR toggles, countdown and stock bar | M11 |
| 11 | **Alert / banner system** | Info, success, warning, danger, suspended; icon + title + sentence + optional action | M11, M07, comps |
| 12 | **Drawer** | 520, radius 26, header/body/sticky footer, scrim | M07 |
| 13 | **Modal** | 520, icon + title + impact sentence + fields + footer buttons | M07 |
| 14 | **Empty state** | Lilac icon circle, title, sentence, one button | comps (all lists) |
| 15 | **Loading state** | Skeleton shapes matching layout, shimmer, reduced-motion safe | comps |
| 16 | **Error state** | Danger-tint icon, plain sentence, Retry; widget-level | comps |
| 17 | **Chart style** | Area line (purple 2.5px), funnel bars, hour bars, stacked stock bars; palette purple/navy/lilac-300/slate; legends with dots; no orange/red series | M04, M07 |
| 18 | **Tab pattern** | Segmented lilac track with white active segment and count pills; underline variant for drawers | M05, M07 |
| + | Attention card, quick-action tile, list row, timeline, toast, result panel, tooltip | Attention/tile/list/timeline/result built; toast in comps | M04, M07, M11 |

The **Components & states** sheet in the mockup shows 1, 5, 11–18, buttons, tabs, forms, KPI and hero in isolation.

---

## 8. AREAS WHERE THE MERCHANT PORTAL RISKS LOOKING TOO GENERIC

| Risk | Where it shows | Mitigation proposed |
|---|---|---|
| Tables and KPI cards read as "any dashboard" | M05 hybrid rows, M04 KPIs | Keep the hybrid card-rows, thumbnails with real merchant photography, product-specific key metrics, one hero per screen; avoid adding more KPI tiles |
| Generic outline icon set | Everywhere | Design a small DealDash icon set matching the customer app (rounded, slightly heavier), custom flame/voucher/reel icons |
| Placeholder gradient "photos" | Thumbnails, preview | Use real merchant imagery; photography is the biggest brand lever in this portal |
| Sidebar + top bar skeleton is standard | Shell | The wordmark, grouped labels, lilac pill and merchant card help; add a branded empty/onboarding illustration style and subtle motion on Live chip/countdown |
| Charts | M04, M07 | Keep to two chart types; style with rounded caps and direct labels; avoid default chart library look |
| Purple on white can feel flat in dense screens | M05 | Use the lilac wash on hover/selected rows and the gradient hero sparingly for rhythm |
| Settings-style screens (later) | Team, Settings, Business | Reuse choice cards, friendly microcopy and the preview pattern rather than plain forms |
| The Components sheet reads like a UI kit | Comps | It is a reference sheet only, not a customer-facing screen |

---

## 9. DESIGN DECISIONS (all APPROVED, see the decisions table at the top)

| # | Decision | Proposed in Batch 01 |
|---|---|---|
| D1 | **Navigation:** your brief lists 11 items; the approved architecture had 8 | Show all 11, but **Vouchers** and **Watch & Earn** are shortcuts into the Campaigns hub tabs (no new screens); **Team** top-level; Support and Settings pinned at the bottom |
| D2 | **White sidebar** instead of the navy sidebar in the wireframes | White with lilac active pill; grouped under RUN / UNDERSTAND / MANAGE |
| D3 | **Gradient hero** use | Two uses: Dashboard hero and Monitor hero (one per screen). Confirm this is not "excessive gradients" |
| D4 | **Orange** | Only the 16-px flame marker and the stock bar inside the customer-style phone preview (reproducing the customer design) |
| D5 | **Collapsed sidebar on the builder** | Icon rail with monogram "D" to maximise form + preview space |
| D6 | **Edit allowed fields while Exclusive Deal is live** | **Approved:** operational edits only (pause, end, stock within safe limits never below reserved + redeemed, per-customer limit within guardrails); everything material needs a new version or DealDash review; all edits audited |
| D7 | **Definitions on the monitor** | *Expired* = a held reservation that timed out and was released; *No-show* = confirmed no-show counted toward the strike model; *Conversion* shown as view→reservation and reservation→redeemed |
| D8 | **No revenue anywhere on these screens** | Dashboard shows voucher *units* only; finance strip omitted (permissioned, not designed in this batch) |
| D9 | **Preview fidelity** | The phone preview shows the **updated** customer rules (free reservation, "Only 12 remaining", no activation); the real customer screens (S20, S26, S31) must be revised to match |
| D10 | **Arabic numerals** | Western digits in tables/figures and Arabic words in labels; confirm vs Eastern digits (UXF-12) |
| D11 | **Arabic copy** | Illustrative; needs native review before any sign-off |
| D12 | **Hybrid rows in Campaigns** | Card-like rows inside a table card (instead of a dense table) |

---

## 10. KNOWN LIMITATIONS OF THIS BATCH

- Desktop (1440) only was rendered; tablet/phone behaviour is specified, not drawn.
- RTL rendered for the shell and M04; M05, M11 and M07 RTL are specified but not rendered (the mockup's EN | AR toggle on the builder preview does flip the phone frame).
- Navigation now links across both mockup files (see Batch 02 for the other 17 screens).
- Mockup HTML is for design review only and should not be used as a code base.

*End of High-Fidelity Batch 01 specification. Remaining 17 Merchant Portal screens not designed. Stopping for visual-direction approval.*
