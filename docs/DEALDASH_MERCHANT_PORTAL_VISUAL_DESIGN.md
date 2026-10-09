# DEALDASH MERCHANT PORTAL: VISUAL DESIGN SPECIFICATION

Version 0.1 (draft for founder approval) · 2026-10-07
Scope: **visual design of the 21 approved Merchant Portal MVP core screens (M01–M21)**. Partner Portal, Admin Portal and the Staff app are not designed here. No production code.
Inputs: `DEALDASH_MERCHANT_PORTAL_WIREFRAMES.md` v0.2 (with finance and insights clarifications F-1, F-2), `DEALDASH_UX_ARCHITECTURE.md` v0.3, Business Rules, and the customer design baseline in `Figma Files\` (63 screens, `design-tokens.json`).
Deliverable type: a **visual specification** (design language, tokens, components, layouts, states, rules). It is the brief for high-fidelity mockups; it is not itself a mockup. Colour values marked **derived** are computed from the approved tokens and must be confirmed against the Figma source when mockups are built.

> **Live Deal editing (final, v0.2.4):** For an active Live Deal, **minor non-commercial edits** (typo, formatting and translation corrections and other non-material descriptive corrections) **may publish immediately with a full audit trail**. **Material edits require review or a revised version.** Material = discount/value, core proposition, eligibility, participating branches, campaign dates where material, important terms and conditions, and anything that materially changes what the customer receives. **DealDash may tighten this rule for merchants or content flagged by risk controls.** (Exclusive Deals remain stricter per D6.) Merchant Portal is structurally frozen for MVP; remaining work is visual QA only (7 screens not yet inspected in-browser, tablet/phone states, Arabic/RTL drawn review, final photography/icons, alignment of customer screens S20, S26, S31).

---

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

---

## 1. MERCHANT PORTAL DESIGN LANGUAGE

### 1.1 Intent

The Merchant Portal is **the business side of the same DealDash product**. A merchant who has seen the customer app should recognise it instantly: same lavender-white atmosphere, navy confidence, one purple accent, rounded cards, pill chips and buttons, segmented tabs, and the navy-to-purple "balance card" for headline numbers. What changes is **density and structure** (tables, forms, charts) not personality.

| Brand cue in the customer app (observed in the 63 screens) | How the portal carries it |
|---|---|
| Light lavender page `#F8F9FD`, white cards with 20–22 radius | Same page and card treatment on every screen |
| Deep navy headings (800 weight) and secondary slate text | Same hierarchy; navy never replaced by black |
| One purple accent for actions, selected states and links | Purple is the only action colour; no secondary brand colour |
| Segmented pill tabs on a lilac track (Explore, Rewards, My Deals) | Reused for page tabs and detail-page tabs |
| Pill chips, large pill buttons, bottom sheets with 26 radius | Pill buttons and chips; modals and drawers use the sheet radius |
| Navy-to-purple gradient balance cards (Rewards, Savings) | The **hero summary card** for headline figures (Finance net payable, campaign delivery) |
| "How it works" three-step icon rows, friendly microcopy | Onboarding "Why we ask" cards and empty states |
| Orange/red gradient for **Hot** only | Orange appears only as a small Exclusive Deal type marker; never as chrome or CTA |
| Wordmark "Deal" navy + "Dash" purple | Same wordmark with the caption "for Business" |

### 1.2 Principles (design tests)

1. **Premium and calm.** Generous whitespace, few borders, one accent. If a screen feels like a generic admin template, simplify.
2. **Purple is the verb.** The primary action on a screen is the only purple filled button.
3. **Numbers first, ornament never.** Headline figures are large (32/800) and sit on white or the hero gradient card.
4. **Status is visible but quiet.** Chips are tinted, not saturated; only Suspended is solid.
5. **Honest metrics.** Anything DealDash cannot prove is labelled as a signal (Live Deals) and never shown as sales (clarification F-2).
6. **Progressive, not regulatory.** Onboarding explains *why* each item is asked.
7. **Bilingual by construction.** Every layout is specified for LTR and RTL; no fixed-width Latin assumptions.

### 1.3 Colour tokens

**Approved base tokens** (from `design-tokens.json`)

| Token | Hex | Use in portal |
|---|---|---|
| `navy` | `#0F0C42` | Headings, body text, wordmark "Deal", hero gradient start |
| `navy-2` | `#0A0830` | Rare: deepest surfaces (hero gradient shadow) |
| `purple` | `#5B1AFC` | Primary buttons, links, active tab text, focus accents, chart series 1 |
| `purple-2` | `#7E4DFF` | Hover/pressed lift, focus ring, chart series 2 |
| `lilac` | `#EEE8FF` | Tab track, selected row, tonal buttons, Pending review chip background |
| `bg` | `#F8F9FD` | Page background |
| `card` | `#FFFFFF` | Cards, tables, drawers, modals |
| `ink` | `#0F0C42` | Primary text |
| `ink-2` | `#5B5E80` | Secondary text, table headers, captions |
| `line` | `#E3E1F0` | 1px borders, dividers |
| `mint` | `#1FBF8F` | Success icons and graphics (not text) |
| `amber` | `#F5A524` | Warning icons and graphics (not text) |
| `red` | `#E93A52` | Danger icons and graphics (not small text) |
| `stage` | `#E9E7F5` | Backdrop behind device previews |

**Derived business tokens** (computed from the approved palette to meet contrast; confirm in Figma)

| Token | Hex | Purpose | Contrast check |
|---|---|---|---|
| `purple-50` | `#F6F3FF` | Hover wash, table header tint, input focus background | n/a |
| `purple-300` | `#B9A4FF` | Chart series 3, disabled purple | n/a |
| `purple-600` | `#4A12D6` | Primary button pressed; gradient end | white text 8.94:1 |
| `ink-3` | `#6F7296` | Placeholder text, disabled labels (**not for text on `slate-100`**: 4.08:1 fails; use `ink-2` there) | 4.64:1 on white |
| `slate-100` | `#EEF0F8` | Neutral chip and skeleton base | n/a |
| `success-bg` / `success-text` | `#E2F7F0` / `#0B7A5A` | Live chip, success banners | 4.76:1 |
| `warning-bg` / `warning-text` | `#FEF1D9` / `#8A5A00` | Needs changes chip, warning banners | 5.31:1 |
| `danger-bg` / `danger-text` | `#FDE8EB` / `#B3203A` | Rejected chip, error banners | 5.63:1 |
| `danger-solid` | `#C9213D` | Suspended chip, destructive button, error text on white | white text 5.57:1 |
| `hero-gradient` | `linear-gradient(135deg, #0F0C42 0%, #4313D6 100%)` | Hero summary card (matches the customer balance card; sample exact stops from S48 in Figma) | white text ≥ 9.1:1 across the gradient |

Rules: token `mint`, `amber` and `red` are **never used as text on white** (contrast 2.36:1, 2.04:1, 4.04:1); use the derived `*-text` tokens. White text on the raw `red` token fails at small sizes; use `danger-solid`.

**Dark theme:** the customer tokens include dark values (`bg #0C0E2B`, `card #171A47`, `ink #F2F1FF`, `ink-2 #A6A9D3`, `line #2A2E66`, `lilac #25226B`). The portal is **light-first**; dark mode is a later option using the same token mapping (not designed in this document).

### 1.4 Typography

| Style | English (Plus Jakarta Sans) | Arabic (IBM Plex Sans Arabic) | Use |
|---|---|---|---|
| Display number | 32/40, 800, tabular figures | 32/44, 700 | KPI figures, hero amounts |
| Page title | 28/36, 800, tracking -0.01em | 28/42, 700 | Page header |
| Section title | 18/26, 800 | 18/30, 700 | Card and section headings |
| Card title | 16/24, 700 | 16/28, 600 | Cards, drawer titles |
| Body | 14/22, 500 | 15/26, 400 | Paragraphs, form values |
| Body strong | 14/22, 700 | 15/26, 600 | Emphasis, table first column |
| Table cell | 13/20, 500 | 14/24, 400 | Tables |
| Label | 13/18, 600 | 14/22, 600 | Field labels |
| Caption | 12/16, 500 | 13/20, 400 | Helper text, metadata, chips |
| Button | 14/20, 700 (large CTA 15/700 per token) | 15/24, 600 | Buttons |

Notes: Plex Arabic has no ExtraBold, so 800 maps to 700 in Arabic. Arabic text receives roughly 10–20% more line height. Numerals use tabular figures; the Western vs Eastern digit decision (UXF-12) is a switch in tokens, defaulting to Western digits in tables and money.

### 1.5 Shape, elevation, spacing, grid, iconography, motion

| Aspect | Spec |
|---|---|
| Radius | Chip 99; button 99 (pill, as in customer app); input 14; card 20; hero card 24; modal and drawer 26 (drawer rounds its inner edge); table container 20; image 16 |
| Borders | 1px `line` on cards and inputs; no heavy outlines |
| Elevation | Resting card: border only plus `0 1px 2px rgba(20,22,58,.06)`. Raised (hover, dropdown): the approved card shadow `0 1px 2px rgba(20,22,58,.06), 0 6px 18px rgba(20,22,58,.07)`. Drawer: `0 12px 40px rgba(15,12,66,.16)`. Modal: `0 20px 60px rgba(15,12,66,.20)` over a 40% navy scrim |
| Spacing | 8-pt grid (4 for micro). Card padding 24 (compact 16). Card gap 24. Section gap 32. Page padding 32 desktop / 24 laptop / 16 tablet and phone |
| Grid | 12 columns, 24 gutter, content max width 1280 centred in the area right of the sidebar |
| Iconography | One open **outline** family, 20 px, stroke 1.75, rounded caps and joins; filled variants only for status icons. Icon + text always accompany status (colour is never the only signal) |
| Imagery | Real merchant photography with 16 radius; blurred placeholders only while loading; covers use 16:9, logos 1:1 on white circle |
| Motion | 150–200 ms ease-out for hover, drawers 240 ms, page transitions none; progress bars animate once; respects reduced-motion (instant state change) |

### 1.6 Do and don't

| Do | Don't |
|---|---|
| Use white cards on lavender with generous padding | Use dense grey admin chrome, striped zebra tables, or heavy dividers |
| Use the hero gradient card at most once per screen | Use gradients on buttons, headers or sidebar |
| Use purple as the only action colour | Introduce teal/blue/orange as accent colours |
| Keep Exclusive Deal orange to a 16-px flame marker and the preview of the customer card | Colour page headers or CTAs orange for Exclusive Deals |
| Label Live Deal metrics "Discovery signals" | Show merchant sales revenue for Live Deals |
| Write friendly "why we ask" copy | Show legal or compliance jargon in onboarding |

---

## 2. NAVIGATION SHELL

### 2.1 Visual layout (desktop ≥ 1280)

```
┌────────────────┬───────────────────────────────────────────────────────────────────────────────┐
│ Deal|Dash      │ [≡]  Branch: All branches ▾        🔍 Search campaigns or codes…   EN|عربي 🔔③ (AK)│ 64
│ for Business   ├───────────────────────────────────────────────────────────────────────────────┤
│                │  ▌ banner zone (only when needed)                                              │
│ ⌂  Home        │  Breadcrumb › …                                                               │
│ ◈  Campaigns   │  Page title                                          [ + Primary action ]     │
│ ✓  Redemptions │  one-line description / status chips                  [ Secondary ] [ ⋯ ]      │
│ ▥  Insights    │                                                                               │
│ ▤  Business ▾  │  ( segmented tabs on lilac track )                                             │
│     Team       │  ┌───────────────── card ─────────────────┐ ┌──────── card ──────────────┐     │
│ ₪  Finance     │  │                                        │ │                            │     │
│ ?  Support     │  └────────────────────────────────────────┘ └────────────────────────────┘     │
│ ⚙  Settings    │                                                                               │
│                │                                                                               │
│ ┌────────────┐ │                                                                               │
│ │ (HG) Harbour│ │                                                                               │
│ │ Grill ✓     │ │                                                                               │
│ └────────────┘ │                                                                               │
└────────────────┴───────────────────────────────────────────────────────────────────────────────┘
 248 (sidebar)      content area: padding 32; max content width 1280
```

### 2.2 Sidebar

| Property | Spec |
|---|---|
| Surface | **White** with a 1px `line` right border (approved D2: not navy); wordmark at top (navy "Deal" + purple "Dash", caption "for Business" in `ink-2` 12/500) |
| Width | 248 expanded, 72 collapsed (icon rail), full-height, fixed |
| Item | Height 44, radius 14, icon 20 + label 14/700 `ink-2`; hover `purple-50`; **active:** `lilac` pill, label and icon `purple`, no side bar; focus ring 2px `purple-2` |
| Items | **Final (D1):** Dashboard, Campaigns, Redemptions, Insights, Finance, Business, Team in three quiet groups; **Support and Settings pinned in the footer**. (Earlier draft: Business with a child Team link.) Items the role cannot use are not rendered. Finance renders only for the Owner and users granted Finance view or manage (F-1) |
| Count badges | Campaigns shows a small purple dot when something needs attention (changes requested, translation missing); no numeric clutter |
| Merchant card | At the bottom: logo circle, merchant name 14/700, **Verified** chip (mint) when approved; click opens the merchant switcher only if the user belongs to several merchants (P2); otherwise opens Business |
| Collapsed | Icons only with tooltip labels; the merchant card becomes the logo circle |

### 2.3 Top bar

| Element | Spec |
|---|---|
| Surface | White, 64 high, bottom 1px `line`; sticky |
| Left | Menu toggle (visible ≤ 1279), **branch switcher** (pill, 40 high: pin icon + "All branches" + chevron; opens a popover with search and checklist) |
| Centre | **Global search** (pill input 360–480, `purple-50` fill, magnifier icon, shortcut hint `/`); results popover groups Campaigns and Codes |
| Right | Language toggle (EN / عربي segmented pill), notification bell with purple count badge (opens the notification drawer), user avatar (initials on navy circle) with menu: name, role, Settings, Sign out |
| Suspended | Bell and search remain; creation actions elsewhere are disabled |

### 2.4 Page header anatomy

| Part | Spec |
|---|---|
| Breadcrumb | 12/500 `ink-2`, chevron separators, last item navy; shown on detail pages and builders only |
| Title | 28/800 navy; status chip(s) to the right of the title on detail pages |
| Description | 14/500 `ink-2`, max one line |
| Primary CTA | Single purple pill button, right-aligned, 44 high; with leading `+` icon for create actions |
| Secondary actions | Tonal (lilac) pill button and a `⋯` icon button opening a menu |
| Tabs | Segmented pill control below the header (lilac track, white active segment with card shadow, purple active text) |
| Banner zone | Full-width banners above the header; one at a time, stacked by priority: Suspended > Payout hold > Needs changes > Translation incomplete > Info |

### 2.5 Responsive shell

| Breakpoint | Sidebar | Top bar | Content |
|---|---|---|---|
| Desktop ≥ 1280 | Expanded 248 | Full | Padding 32 |
| Laptop 1024–1279 | Collapsed 72 (expands as overlay on hover/click) | Full | Padding 24 |
| Tablet 768–1023 | Hidden; slide-in drawer from the menu button | Branch switcher and language move to an overflow menu; search becomes an icon | Padding 16; tables become card lists |
| Phone < 768 | Hidden; **bottom bar** (Home, Campaigns, Redemptions, Support, More) | Compact: logo, bell, avatar | Single column |
| RTL | Mirrors: sidebar on the right; menu/overflow/drawers swap sides | Mirrors | Mirrors |

---

## 3. COMPONENT LIBRARY

Each component lists variants, states and key dimensions. All components are specified in LTR and mirror in RTL.

### 3.1 Actions

| Component | Variants | Spec |
|---|---|---|
| Button | **Primary** (purple fill, white text), **Tonal** (lilac fill, purple text), **Outline** (white, 1px `line`, navy text), **Text** (purple, no fill), **Destructive** (`danger-solid` fill) and **Destructive tonal** (`danger-bg`/`danger-text`) | Pill radius; heights 36 / 44 (default) / 48 (builder footer, onboarding); padding 20; icon left (RTL: right); states: default, hover (`purple-2` / `purple-50`), pressed (`purple-600`), focus (2px `purple-2` ring, 2px white offset), disabled (`slate-100` fill, `ink-3` text), loading (spinner replaces icon, label stays) |
| Icon button | Default, tonal | 40 circle; used for ⋯, close, filters |
| Link | Inline | Purple 700 underline on hover |
| Split / create menu | "+ Create campaign ▾" | Primary button with chevron; menu lists Live Deal, Exclusive Deal, Voucher, Watch & Earn with icon, name and one-line descriptor |

### 3.2 Forms

| Component | Spec |
|---|---|
| Text input | 48 high, radius 14, 1px `line`, 14/500, label above (13/600), helper below (12/500 `ink-2`); focus: 2px `purple-2` border + `purple-50` fill; error: 1px `danger-solid` + icon + message; disabled: `slate-100` |
| **Bilingual field** | Two inputs side by side labelled **EN** and **AR** (pill tag in each corner); AR input is RTL-aligned with IBM Plex Sans Arabic; a small status dot on the label ("complete / missing AR / missing EN"); on tablet becomes an EN | AR segmented switch above a single input |
| Textarea | 112 min, counter bottom-right, same states |
| Select / multi-select | Same box; multi-select shows removable pill tags inside; popover list with search for > 8 options |
| Number & money | Right-aligned figures with `SAR` suffix tag (tag mirrors in RTL); step buttons for quantities |
| Date & time | Riyadh time; date popover calendar (Gregorian, Hijri option later), time as two dropdowns; range picker for filters |
| Radio card / choice card | Large selectable card (radius 20, 1px `line`, selected: 2px `purple` border + `purple-50` fill + check), used for choices like Exclusive Deal limit type and eligibility |
| Toggle | 44×24 pill, purple on, `slate-100` off, label + helper to the right |
| Checkbox / radio | 20 px, radius 6 / full circle, purple checked |
| File upload (dropzone) | Dashed 1.5px `purple-300` border, radius 20, `purple-50` fill, icon + "Drag a file here or Browse", accepted types in caption; file row below: icon, name, size, status chip, replace/remove |
| Image gallery uploader | Grid of 16:9 tiles radius 16, first tile marked "Cover", drag to reorder, remove icon on hover, add tile |
| Map pin picker | Embedded map 16 radius with draggable pin, address search above |
| Opening-hours grid | 7 rows (day, open switch, from, to, "+ add range"), "copy to all days" text button, exceptions list below |
| Stepper (number) | − [n] + control inside input |

### 3.3 Navigation and structure

| Component | Spec |
|---|---|
| Segmented tabs | Lilac track radius 99, 4 padding; segments 40 high, 14/700; active: white fill + card shadow + purple text; count in a small `slate-100` pill. Used for page and detail tabs (≤ 6 tabs); overflow scrolls horizontally |
| Underline tabs | For drawers and modals only: 14/700, 2px purple underline |
| Breadcrumb | See 2.4 |
| **Stepper rail (builders, onboarding)** | Vertical list in a white card; each step: 28 circle (number; ✓ when complete; ! when error) + label 14/700 + optional sub-label; connecting 2px line (`line`, purple when complete); current step: `lilac` pill background; completed steps clickable; error steps show an amber dot |
| Pagination | Rows-per-page dropdown (25 / 50 / 100), range text, page pills; sits in the table footer |
| Dropdown menu | White, radius 16, raised shadow, item 40 high with icon; destructive items at the bottom in `danger-text` |
| Breadcrumb-less detail back link | "← Campaigns" text button in the header for builders |

### 3.4 Containers and data

| Component | Spec |
|---|---|
| **Card** | White, radius 20, 1px `line`, padding 24; header row: card title + optional action link |
| **Stat (KPI) card** | Label 13/600 `ink-2`, value 32/800 navy, delta chip (mint ↑ / `ink-2` neutral / danger ↓ with arrows and words), optional 40-px sparkline (purple 1.5px); clickable cards get a chevron on hover |
| **Hero summary card** | `hero-gradient`, radius 24, white text, value 40/800, caption in `#C9C3FF`; used for Finance net payable and campaign delivery |
| **Attention card (list item)** | Card row with 4px left accent in warning/danger, icon, sentence, action link/button |
| **List row** | 64 high, thumbnail 40, title 14/700, meta 13/500 `ink-2`, trailing chip or action |
| **Data table** | Framework in section 8 |
| **Drawer** | Right, 520 wide (440 laptop), radius 26 on inner edge, header (title + close), scrollable body, sticky footer for actions; scrim 40% navy; Esc closes; focus trapped |
| **Modal** | Centred 480 (confirmations) / 640 (forms); radius 26; title 18/800, body, footer buttons right-aligned (RTL: left); destructive modals state impact in one sentence and require reason where specified |
| **Banner** | Full width, radius 16 inside content width, icon + title 14/700 + one sentence + optional action; variants **info (lilac), success, warning, danger, suspended (danger solid)** |
| **Toast** | 360 wide, bottom-start corner (bottom-left LTR, bottom-right RTL), icon + message + optional Undo; auto-dismiss 5 s (errors persist) |
| **Tooltip** | Navy fill, white 12/500, radius 10, 8px offset |
| **Chip** | See status system (section 9) and filter chips: pill 32, `slate-100` default, selected `lilac` + purple text + check |
| **Avatar** | 32/40 circle initials on navy (staff) or logo on white (merchant) |
| **Timeline** | Vertical, 2px `line` rail, 12px dots (status-coloured), event title 14/700, meta 12/500, expandable diff for edits |
| **Progress / stock bar** | 8 high pill track `slate-100`; fill purple (delivery, stock); warning colour only for "low" states; value labels outside the bar |
| **Empty state** | Centre block: 56-px outline icon in a `lilac` circle, title 18/800, one sentence `ink-2`, one primary or tonal button |
| **Skeleton** | `slate-100` shapes matching final layout, soft shimmer (disabled with reduced motion) |
| **Result panel** | Large (72) icon in a tinted circle (success / info / warning / danger), title 24/800, explanation, up to two buttons; used for builder submit results and onboarding states |

### 3.5 Data visualisation

| Rule | Spec |
|---|---|
| Palette | Series 1 `purple`, 2 `navy`, 3 `purple-300`, 4 slate `#8E91B5`; maximum four series; positive/negative deltas may use success/danger text tokens; **no orange or red series** |
| Line / area | 2px strokes, area fill 8% purple, rounded joins, gridlines `line` 1px, axis labels 12/500 `ink-2` |
| Bars | 8px radius tops, 24 max width, 12px gap |
| **Funnel** (Live Deals) | Horizontal stepped bars shrinking left to right, each labelled with value and step conversion; always captioned "Discovery signals. They do not prove visits or sales." |
| Labelling | Direct labels where possible; legends below charts; tooltips on hover/focus; tables available as an alternative (toggle) |
| Empty/no-data | Faded axes and "No data for this period" with suggestion |
| RTL | See section 12 |

---

## 4. DASHBOARD SPECIFICATION (M04)

### 4.1 Visual layout (desktop)

```
Page header:  Good morning, Akif                                  [ + Create campaign ▾ ]
              Showing: All branches · Today

Row 1 (4 × stat cards, each 3 columns, 112 high)
 ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌─────────────────────────────┐
 │ Live campaigns│ │ Reservations  │ │ Redemptions   │ │ Watch & Earn delivery        │
 │ 6             │ │ today  14     │ │ today  27     │ │ 620 / 1,000 paid views       │
 │ 2 ending soon │ │ 3 expiring    │ │ +8% vs last wk│ │ ▓▓▓▓▓▓░░░░  62%              │
 └───────────────┘ └───────────────┘ └───────────────┘ └─────────────────────────────┘

Row 2 (8 columns | 4 columns)
 ┌─ Needs attention (4) ─────────────────────────┐  ┌─ Recent activity ───────────────┐
 │ ▌⚠ Hot "Dinner for Two", Riyadh Park: 6 left   │  │ ● Redeemed · Voucher · Olaya     │
 │   [ Add stock ]                                │  │ ● Reserved · Hot · Riyadh Park   │
 │ ▌✎ Live "30% off" needs changes   [ Fix ]      │  │ ● Voucher sold · Pay 80, get 100 │
 │ ▌A AR text missing  "Lunch reel" [ Complete ]  │  │ … (last 10)                      │
 └────────────────────────────────────────────────┘  └─────────────────────────────────┘

Row 3 (12 columns)
 ┌─ Your live campaigns (top 5) ────────────────────────────────────────────  View all → ┐
 │ type · title · branches · status · one signal  (compact table)                          │
 └────────────────────────────────────────────────────────────────────────────────────────┘

Row 4 (Owner and Finance-view only)   hero card:  Next payout  SAR 8,420  ·  Settlement-eligible SAR 9,100 · View finance →
```

| Element | Visual rule |
|---|---|
| Stat cards | Standard KPI card; the whole card is a link to its list; Watch & Earn card shows a purple progress bar; if the merchant has no Watch & Earn campaign it is replaced by "Vouchers sold today" (units). **No sales revenue is shown for Live Deals** (F-2); voucher SAR amounts only for the Owner and Finance-view users (F-1) |
| Needs attention | Attention-card list; max 5 items then "View all (n)"; each item has icon, sentence and one action; order by urgency (suspended, stock low, ends soon, needs changes, translation missing, review pending, payout hold) |
| Recent activity | Compact timeline of operational events (redemptions, reservations, voucher sales) with time; no customer names beyond first name |
| Campaign table | Compact density (row 44), columns type icon, title, branches, status chip, signal; hover raises row; click opens detail |
| Finance hero strip | `hero-gradient` card, full width, 96 high, white text; **rendered only for Owner and Finance-view holders** (otherwise the row is absent, no placeholder) |
| Branch filter | Top-bar switcher changes all widgets; page subtitle names the scope |
| Banners | Suspended (solid red), Needs changes, Translation incomplete, Payout hold, above the greeting |

| State | Visual |
|---|---|
| Loading | Skeleton cards in the same grid; table skeleton rows |
| Empty (activated, no campaigns) | Row 1 shows zeros in muted `ink-3`; large **Get started** card with three steps (Add branches, Invite your team, Create your first campaign) as icon rows with buttons; hero strip hidden until the first statement |
| Warning | Attention items in amber; stock-low bars turn warning-coloured |
| Error | Widget-level error card ("Couldn't load this. Retry") without blocking others |
| Success | Toast on actions performed from the dashboard (e.g., "Stock added") |
| Suspended | Red banner; stat cards read-only; Create CTA disabled with tooltip |

Responsive: tablet 2×2 stat cards, Row 2 stacked; phone single column with stat cards in a horizontal snap-scroll strip, Needs attention first.

---

## 5. ONBOARDING SPECIFICATION (M01, M02, M03)

### 5.1 Tone and structure

Onboarding must feel like **setting up a shop window**, not filling in forms for a regulator. Every step has: a friendly title, one sentence of "why we ask", progress that never goes backwards, autosave, and a way to leave and come back.

| Principle | Visual and copy treatment |
|---|---|
| Progress indication | Left rail with **progress ring** ("Step 2 of 8 · 25% done") above the step list; a thin linear progress also at the top of the form card on tablet/phone |
| Save and continue | Sticky footer: Back (tonal), **Save draft** (text), **Save & continue** (primary). "Saved just now" status text in the rail |
| Why we ask | Each step has a right-hand **"Why we ask"** card (lilac, icon, 2–3 short lines) e.g. Documents: "We check your business details once so customers can trust DealDash merchants." Never legal jargon |
| Document upload | Dropzone with accepted formats and size, a checklist of required documents with ✓ as uploaded, expiry date field, per-file status chip (Uploading, Uploaded, Needs a clearer copy) |
| Review screen | Summary cards per section with an Edit text button, a completion checklist, one declaration checkbox, then **Submit application** |
| Submitted / pending | Application status page with a calm timeline, reassurance copy, expected timing (configuration), and a support link |
| Request changes | Amber banner and a **"What we need from you"** list with one **Fix** button per item that deep-links to the right step; reviewer notes in plain language |
| Approval | Success result panel with confetti-free celebration: check icon, "You're approved", then agreement signature if pending, then **Go to dashboard** |
| Reassurance | Footer text: "You can save and finish later." |

### 5.2 M01 visual (sign in / register)

Split layout: left half is a `hero-gradient` panel with the white wordmark, a short promise ("Reach nearby customers. Fill quiet moments."), and three rounded photo tiles of food, retail and service imagery (real merchant-style photography, 20 radius); right half is the form card (480) on `bg`. On tablet the hero collapses to a 160-high band above the card.

### 5.3 M02 visual (wizard)

```
┌ top: wordmark · "Save & exit" · EN|عربي ─────────────────────────────────────────────────┐
│ ┌ rail (280) ─────┐ ┌ form card (max 720) ──────────────────────┐ ┌ help (320) ───────┐  │
│ │ ◔ 25% · Step 2/8 │ │ Step title (28/800)                        │ │ ┌ Why we ask ──┐  │  │
│ │ ✓ Business       │ │ helper sentence (14/500 ink-2)             │ │ │ lilac card    │  │  │
│ │ ● Documents      │ │ [ dropzone ]  …                            │ │ └──────────────┘  │  │
│ │ ○ Representative │ │ checklist of required documents            │ │ Accepted files    │  │
│ │ …                │ │                                            │ │ Need help? chat   │  │
│ └──────────────────┘ └────────────────────────────────────────────┘ └───────────────────┘  │
│ sticky footer:  [ ← Back ]                      Saved just now   [ Save draft ] [ Save & continue ]│
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

Per-step visual notes:

| Step | Visual emphasis |
|---|---|
| 1 Business details | Bilingual fields (EN | AR) for legal and trade name; short fields in a two-column grid |
| 2 Documents | Dropzone + required-document checklist; expiry date inputs; clear "why" card |
| 3 Authorised representative | Simple two-column form; toggle "This person will sign the agreement" |
| 4 Category & branding | Category choice cards with icons; logo and cover uploaders with live crop; description EN | AR; right panel shows a live **merchant-page preview** |
| 5 Branches & hours | Branch cards in a list with "+ Add branch"; each opens the branch editor (map pin + hours grid) in place; at least one required |
| 6 Settlement / IBAN | IBAN input with grouping and bank-name auto-fill; reassurance copy about payouts and name matching |
| 7 Agreement | Agreement viewer card (scrollable, EN | AR tabs), signatory name, signature pad or typed-name e-sign with checkbox, version tag; Download PDF |
| 8 Review & submit | Summary cards in a two-column grid; completion checklist on the right; declaration; **Submit application** primary |

### 5.4 M03 visual (application status variants)

Centered 880 container. Top: **status hero card** (white, 24 radius) with the large status icon, title, reference, and a horizontal 5-step timeline (Submitted, In review, Decision, Agreement, Activated). Below: variant panel.

| Variant | Visual |
|---|---|
| In review | Lilac panel, clock icon, "We're reviewing your documents", expected time |
| Enhanced review | Same lilac panel with neutral wording "A few extra checks are in progress" |
| Needs changes | Warning panel; list of items each with section name, reviewer note and **Fix** button; primary **Fix & resubmit** |
| Rejected | Danger-tint panel, reason, **Appeal** tonal button |
| Approved | Success panel, "Sign your agreement" primary if pending |
| Activated | Success result panel + **Get started** checklist |
| Suspended | Solid-danger banner at the top of the page and a danger-tint panel: what is paused, what continues, support contact |

---

## 6. CAMPAIGN BUILDER FRAMEWORK (M10–M13)

One framework, four products. Steps are **slots**; each product fills or omits slots, so no irrelevant fields appear. The wireframe-stage step lists (6/6/6/8) are normalised here into the **8 steps + a Submit/Publish status state** (UX conflict C-01).

### 6.1 Framework slots and per-product mapping

| Slot | Framework label | Live Deal (M10) | Exclusive Deal (M11) | Voucher (M12) | Watch & Earn (M13) |
|---|---|---|---|---|---|
| 1 | **Basics** | Title AR/EN, description AR/EN | Title AR/EN, description AR/EN | Title AR/EN, description AR/EN | Campaign name AR/EN, **link target** (merchant page / Live Deal / Exclusive Deal / Voucher / product-service) |
| 2 | **Offer / campaign configuration** | Mechanic and value | **Limit type** (time / quantity / both), mechanic and value | **Face value, selling price**, saving % | **Paid views and budget** (cost estimate), **frequency** (stricter-only), optional **prizes** |
| 3 | **Branches** | Branch multi-select | **Inventory per branch** (table) | Branch multi-select | **Locations**: areas of Riyadh or radius around branches |
| 4 | **Eligibility / targeting** | Everyone / bank card / employer | Everyone / bank card / employer | Everyone (card-restricted P2, shown disabled) | **Audience**: groups, interests (no age/gender in MVP) |
| 5 | **Dates / limits** | Start, optional end | Start, duration/end, **reservation hold (default 30 min)**, **per-customer limit** | **Quantity, per-customer cap, validity** (days from purchase or fixed date) | Start and end dates |
| 6 | **Content** | Photos (1–5), optional ordinary merchant video | Photos (1–5) | Photos (1–5) | **Video upload**, thumbnail, CTA label, title |
| 7 | **Terms** | Structured terms + text; **controlled redemption (off by default)** | Structured terms + text | Structured terms + text (platform refund/expiry notes read-only) | Campaign and prize terms |
| 8 | **Review & Preview** | AR/EN preview, guardrails, translation | AR/EN preview with countdown and stock bar | AR/EN preview "pay X, get Y" | Reel preview, link preview, moderation notice, **fund budget** |
| 9 | **Submit / Publish status** (result state, not a form step) | Published · Scheduled · Pending review · Needs changes | same | same | Published · Scheduled · Pending review · Needs changes · **Awaiting funding** · Payment failed |

Step counts are therefore all 8 (Voucher and Live Deal could merge slots visually if a slot has only one or two fields: slots with fewer than three fields may be **combined on one page** with section headers while keeping their rail entry).

### 6.2 Layout

```
┌ header bar ──────────────────────────────────────────────────────────────────────────────┐
│ ← Campaigns   New Exclusive Deal   ‹Draft›    Saved just now         Translation ‹Missing AR›    │ 72
├ rail 264 ───────┬ form column (fluid, content max 720) ────────────────┬ preview 360 ─────┤
│ ✓ 1 Basics      │ Step 3 of 8                                           │ ┌ device stage ─┐│
│ ✓ 2 Offer       │ Branches & inventory   (24/800)                        │ │ ░ phone frame │ │
│ ● 3 Branches    │ helper sentence                                        │ │  customer card│ │
│ ○ 4 Eligibility │ ┌ form card ─────────────────────────────────────┐    │ │  / detail     │ │
│ ○ 5 Dates       │ │ fields …                                        │    │ └───────────────┘│
│ ○ 6 Content     │ └─────────────────────────────────────────────────┘    │ [Card|Detail] [EN|AR]
│ ○ 7 Terms       │ ┌ DealDash check ───────────────────────────────┐      │ ┌ DealDash check ┐│
│ ○ 8 Review      │ │ ✓ Within pre-approved rules / ⚠ review needed  │      │ │ summary        ││
│                 │ └─────────────────────────────────────────────────┘      │ └───────────────┘│
├─────────────────┴───────────────────────────────────────────────────────┴───────────────────┤
│ [ ← Back ]                                         [ Save draft ]              [ Next → ]      │ 72
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Region | Spec |
|---|---|
| Header bar | White, 72 high; back link, title, status chip (Draft), autosave text, **translation chip** (Complete / Missing AR / Missing EN) with "Ask DealDash to help translate" link |
| Rail | White card, stepper rail component (3.3) with progress count "3 of 8" |
| Form column | Step title 24/800, helper 14/500 `ink-2`, then form cards (radius 20); sections inside a step separated by 32 space; the **DealDash check** card at the end of the step shows relevant guardrail messages |
| **Preview panel** | Sticky; stage background `stage` (`#E9E7F5`), radius 24; phone frame 390 wide showing the real customer card/detail components from the approved design; switches **Card / Detail** and **EN / AR (RTL)**; updates live as fields change; shows locked/eligibility labels and countdown/stock bar for Exclusive Deals |
| Footer bar | White, sticky, 72 high, top border; **Back** (tonal), **Save draft** (text), **Next** (primary, 48 high); on the last step primary becomes **Submit** (or **Fund & submit** for Watch & Earn) |
| Autosave | Every 30 s and on step change; "Saved just now" / "Saving…" / "Couldn't save, retrying" |

### 6.3 Validation and guardrail behaviour

| Aspect | Visual |
|---|---|
| Field validation | Inline error under the field (icon + sentence, `danger-text`); the field border turns `danger-solid`; errors appear on blur and on Next |
| Step validation | Next is enabled but, if invalid, scrolls to the first error and shows a footer note "2 items need attention"; the rail marks the step with an amber **!** |
| **Guardrail messages** | A **DealDash check** card in the form column and a compact summary in the preview panel. Three variants: **success** (mint ✓ "Within pre-approved rules, this should publish instantly"), **review** (warning "This will be reviewed first: discount above the usual range", with the specific reason and what would change that), **blocked** (danger "Not allowed: contains prohibited terms", Next disabled) |
| Translation gate | Publish disabled until both languages exist; message links to the missing fields; "Ask DealDash to help translate" opens a request panel |
| Merchant-trust notice | For merchants under extra pilot review, an info line "During the pilot, DealDash may review more campaigns" |

### 6.4 Submit / Publish status (slot 9)

Rendered as a full-page **Result panel** in the form area (the rail shows all steps ✓; the footer shows "Back to campaign"):

| Result | Visual | Actions |
|---|---|---|
| **Published** | Success icon, "Your campaign is live" | View campaign, Create another, Promote with Watch & Earn (for deals) |
| **Scheduled** | Success icon with calendar, "Goes live on {date}" | View campaign |
| **Pending review** | `lilac` clock icon, "We'll review it shortly. You'll be notified"; campaign locked | View status, Back to campaigns |
| **Needs changes** | Warning icon, reviewer notes with **Fix** buttons into the step | Fix & resubmit |
| **Awaiting funding** (Watch & Earn, when the user lacks Finance: manage) | Info icon, "Sent to {Owner/finance approver} to fund" | View campaign |
| **Payment failed / pending** | Warning icon, retry button, receipt link | Retry payment |
| **Blocked** | Danger icon with the reason | Edit |

### 6.5 Builder responsive behaviour

| Breakpoint | Behaviour |
|---|---|
| Desktop | Rail + form + preview as above |
| Laptop 1024–1279 | Rail collapses to numbered circles with step name on hover; preview narrows to 320 |
| Tablet | Rail becomes a horizontal compact bar ("Step 3 of 8 · Branches" + steps sheet); preview becomes a **Preview** button opening a full-height sheet; bilingual fields switch to EN | AR segmented control |
| Phone | One field group per screen with a top progress bar; footer buttons stack; banner "Best on a larger screen" dismissible |

---

## 7. DETAIL-PAGE FRAMEWORK (M06, M07, M08, M09, M19)

```
┌ breadcrumb: Campaigns › Exclusive Deals ────────────────────────────────────────────────────────┐
│ Dinner for Two · 40% off   ‹Live›  ⏱ 01:12:40 left                [ Add stock ] [ Pause ] [ ⋯ ] │
│ Olaya · Riyadh Park · Started today 12:00                                                   │
│ banners (Needs changes / Suspended / Translation …)                                        │
│ [ KPI strip: 3–4 stat cards ]                                                              │
│ ( Overview | Performance | Reservations | Activity | Settings )   ← segmented tabs         │
│ ┌ main (8 columns) ───────────────────────────────┐ ┌ side (4 columns) ──────────────┐     │
│ │ tab content cards / tables                      │ │ Summary card · customer preview │     │
│ └─────────────────────────────────────────────────┘ │ · key dates · linked items      │     │
│                                                       └────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

| Part | Spec |
|---|---|
| Header | Title 28/800, status chip(s) right of title, meta line (branches, dates), **one primary action** (varies by status: Edit, Pause, Resume, Fix & resubmit, Add stock) |
| KPI strip | 3–4 stat cards (product-specific); absent in Draft |
| Tabs | Segmented tabs: **Overview**, **Performance**, **Activity**, **Redemptions/Reservations/Sales** where relevant, **Settings/Configuration** (read-only summary + edit link) |
| Main/side | Main holds the tab's primary content; side holds persistent context (summary, customer preview toggle EN/AR, linked campaign or Watch & Earn link, key dates) |
| Activity tab | Timeline component with edit diffs and review decisions |
| Status-variant rules | Banner on top explains the variant; actions follow the status (e.g. Draft: Edit/Submit; Needs changes: Fix & resubmit; Suspended: no actions + support link; Pending review: read-only) |

Per-product tab sets: **Live Deal:** Overview · Performance (discovery signals) · Activity. **Exclusive Deal:** Live monitor · Reservations · Results · Activity. **Voucher:** Overview · Sales & redemptions · Refunds · Activity. **Watch & Earn:** Monitor · Performance · Prizes · Budget & unused balance · Activity. **Statement:** single page with summary and lines table.

---

## 8. DATA-TABLE FRAMEWORK

One table pattern for Campaigns, Reservations, Sales, Redemptions, Team, Branches, Statements, Payouts, Invoices, Cases.

```
┌ toolbar ───────────────────────────────────────────────────────────────────────────────────┐
│ 🔍 Search…        [Status ▾] [Branch ▾] [Date ▾]  (active filters as removable chips)   [⚙ Columns] [⭳ Export] │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ Title ▲            Branches     Dates            Status           Signal                  ⋯ │ header 44, purple-50 fill
│ 30% off tasting…   All (3)      4 Oct – 11 Oct   ‹Live›           322 directions          ⋯ │ row 56
│ Free dessert       Olaya        5 Oct – open     ‹Pending review› –                       ⋯ │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ Rows per page [25 ▾]        1–25 of 112                                      ‹ 1 2 3 … 5 ›   │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Aspect | Spec |
|---|---|
| Container | White card radius 20, 1px `line`; no zebra striping |
| Toolbar | Search input (pill, 40), filter buttons opening popovers, active filters shown as removable chips below, columns menu, export (permissioned) |
| Header row | 44 high, `purple-50` fill, 12/700 `ink-2` labels (sentence case), sortable columns show a caret on hover and arrow when active; sticky on scroll |
| Rows | 56 high comfortable (44 compact via density toggle), 13/500, first column body-strong; hover `purple-50`; focus ring on keyboard; selected row `lilac` when its drawer is open |
| Status column | Status chip (section 9); never colour-only |
| Numeric columns | Right-aligned tabular figures; units in header |
| Row actions | `⋯` icon button opening a menu; primary action is the row click (drawer or detail page) |
| Pagination | Footer with rows per page (25/50/100), range, page pills; server-side |
| **Bulk actions** | **None in MVP** (no checkboxes), because no MVP workflow needs them; candidate for Phase 2 (bulk pause) |
| Empty | Table card shows the empty-state component with a relevant action; filtered-empty variant shows "No results. Clear filters" |
| Loading | Skeleton rows (6) |
| Error | In-card error with Retry |
| Responsive | Tablet: rows become **cards** (title, status chip, two key facts, chevron); phone: same cards; wide tables on tablet may keep a horizontal scroll with a sticky first column when comparison matters (Statement lines) |
| RTL | Column order mirrors; row actions at the start edge; numeric columns stay right-aligned in LTR figures but their header aligns to the start edge |

---

## 9. STATUS SYSTEM

### 9.1 Chip specification

Chip: pill, 28 high, padding 12, icon 14 + label 12/700, 1px border in the status colour at 24% opacity. **Every status has an icon and a label**; colour is never the only cue. The nine required statuses:

| Status | Icon | Background | Text/icon | Border | Where it appears | Meaning |
|---|---|---|---|---|---|---|
| **Draft** | pencil | `slate-100` | `ink-2` `#5B5E80` | dashed `line` | Campaigns, builders | Not submitted |
| **Pending review** | clock | `lilac` `#EEE8FF` | `purple` `#5B1AFC` | purple 24% | Campaigns, application | Awaiting DealDash decision; locked |
| **Scheduled** | calendar | white | navy | 1px purple | Campaigns | Approved, starts later |
| **Live** | filled dot (pulses once) | `success-bg` `#E2F7F0` | `success-text` `#0B7A5A` | mint 24% | Campaigns | Visible to customers |
| **Paused** | pause bars | `#E6E8F5` (derived slate-blue) | navy | `line` | Campaigns | Merchant or DealDash paused |
| **Expired** | clock-off | `slate-100` | `ink-2` `#5B5E80` (5.5:1; `ink-3` would fail at 4.08:1) | none | Campaigns | Time ended |
| **Rejected** | x-circle | `danger-bg` `#FDE8EB` | `danger-text` `#B3203A` | red 24% | Campaigns, application | Final rejection |
| **Needs changes** | pencil-alert | `warning-bg` `#FEF1D9` | `warning-text` `#8A5A00` | amber 24% | Campaigns, application | Edit and resubmit |
| **Suspended** | lock | `danger-solid` `#C9213D` | white | none | Campaigns, merchant | DealDash-imposed block (the only solid chip) |

### 9.2 Secondary statuses

| Status | Style | Notes |
|---|---|---|
| Sold out / Completed | `slate-100`, check-circle, navy | Inventory or budget finished |
| Cancelled | `slate-100`, slash, `ink-2` | Ended early by merchant |
| Archived | text-only `ink-3` | Hidden by default |
| **Awaiting funding** (Watch & Earn) | `lilac`, coin icon, purple | Draft family: waiting for a Finance: manage holder |
| Moderation: Processing / In review / Rejected | `lilac` / `lilac` / `danger` variants | Watch & Earn video |
| Translation: Complete / Missing AR / Missing EN / Help requested | success / warning / warning / lilac | Builders and lists |
| Voucher instance: Active / Redeemed / Expired / Refunded / Voided | success / navy-on-slate / ink-3 / lilac / danger | Sales tables |
| Reservation: Reserved / Redeemed / No-show / Cancelled | lilac / success / warning / slate | Exclusive Deal tables |
| Money: Draft / Issued / Paid / Disputed / Pending / Failed / Returned | slate / lilac / success / warning / lilac / danger / danger | Finance |
| Merchant **Verified** | mint check with `success-text` label | Reserved for the approved merchant badge (never for cards) |

### 9.3 Status in other components

| Component | Rule |
|---|---|
| Banner | Same colour family as the chip (lilac info, warning, danger, suspended solid) |
| Timeline dots | 12px in the status colour with the status icon in the card on hover |
| Result panel | Large icon circle tinted with the status background |
| Stock/progress bars | Purple fill; amber only when "low"; never red unless depleted with a consequence |
| Naming | The portal uses these names in every language; mapping from the earlier vocabulary: *Under review → Pending review*, *Changes requested → Needs changes*, *Rejected* added |

---

## 10. SCREEN-BY-SCREEN VISUAL SPECIFICATION (21 MVP core screens)

Each entry: **Layout** (grid and regions), **Visual emphasis**, **Components**, **States** (empty / loading / warning-error / success). Shared shell, banners and overlays follow sections 2–9. Content and permissions are in the wireframe document.

### M01. Sign in & registration
- **Layout:** two halves. Left 50%: hero gradient panel with white wordmark, headline "Reach nearby customers. Fill quiet moments.", three photo tiles. Right: centred form card 480 on `bg`; language toggle top-right. Tablet: hero becomes a 160-high band; phone: no hero.
- **Emphasis:** the form card and one primary button; photography carries brand warmth.
- **Components:** segmented tabs (Sign in | Register), inputs, OTP six-box input (48 square boxes, auto-advance), primary button, text links, inline error.
- **States:** loading = button spinner; warning/error = inline field errors, lockout banner with countdown; success = check animation on verified email/mobile, then auto-advance; empty n/a.

### M02. Onboarding wizard
- **Layout:** minimal top bar; three columns (rail 280 | form card ≤ 720 | help 320) over `bg`; sticky footer.
- **Emphasis:** the current step title and the single primary button; progress ring in the rail.
- **Components:** progress ring, stepper rail, bilingual fields, dropzone and document checklist, branch cards with map pin and hours grid, IBAN input, agreement viewer with e-sign, summary cards, "Why we ask" lilac card.
- **States:** empty = fresh form with helper copy; loading = upload progress per file; warning = "Needs a clearer copy" file chip, step ! marker, footer "2 items need attention"; error = inline plus upload retry; success = ✓ steps, toast "Saved", final submit result.

### M03. Application status
- **Layout:** centred 880; status hero card with timeline; variant panel; read-only summary cards below.
- **Emphasis:** big status icon and one next action.
- **Components:** hero card (white), horizontal timeline, result/variant panels, summary cards, Fix buttons, appeal modal.
- **States:** the seven variants in 5.4; loading skeleton hero; error = retry card.

### M04. Dashboard
- **Layout:** four stat cards, then 8/4 split (Needs attention | Recent activity), campaign table, finance hero strip (permissioned).
- **Emphasis:** the Needs attention list (first thing the eye hits after the numbers) and the **+ Create campaign** CTA.
- **Components:** stat cards, attention cards, timeline, compact table, hero card.
- **States:** see section 4.

### M05. Campaigns hub
- **Layout:** header with create menu; segmented tabs with counts; toolbar; table card.
- **Emphasis:** status chips and the "needs attention" filter chip; row hover raises.
- **Components:** segmented tabs, data table (section 8), create menu, status chips, row menus, confirm modals (pause/cancel).
- **States:** empty per tab (icon, one sentence, Create button); loading skeleton rows; warning = amber rows' chips with tooltip notes; error = in-card retry; success = toast after pause/resume.

### M06. Live Deal detail
- **Layout:** detail framework: header, banners, tabs **Overview · Performance · Activity**, main 8 + side 4 (summary, customer preview EN/AR, key dates, "Promote with Watch & Earn" link card).
- **Emphasis:** the status chip and the primary action; the **funnel chart** in Performance.
- **Components:** funnel chart with caption "Discovery signals. They do not prove visits or sales.", stat cards (impressions, detail views, saves, directions, merchant-page visits), timeline, modals, controlled-redemption drawer.
- **States:** empty Performance "Insights appear once the deal is live"; warning banner for Needs changes; suspended banner; success toast; no revenue figures anywhere.

### M07. Exclusive Deal detail & monitor
- **Layout:** header with **live countdown chip**, KPI strip (Reserved, Redeemed, Left, No-shows), tabs **Live monitor · Reservations · Results · Activity**.
- **Emphasis:** **stock bars per branch** (purple fill, amber when low) and the countdown; primary action **Add stock**.
- **Components:** branch stock rows (name, bar, "12 left of 20", reserved/redeemed/no-show text), reservations table, add-stock modal, cancel-reservation modal, flame marker (only orange element, 16 px).
- **States:** sold out (bars full, banner "Sold out"), ended (Results tab becomes default), suspended; empty reservations message; loading skeleton bars; error toast for stock conflict.

### M08. Voucher detail
- **Layout:** header with price pair ("Pay SAR 80 · Get SAR 100") and Pause sales; KPI strip (Sold, Redeemed, Refunded, Left) in units; tabs **Overview · Sales & redemptions · Refunds · Activity**.
- **Emphasis:** the sale-state chip and remaining stock bar.
- **Components:** summary card with locked-field note, customer preview, sales table (statuses), refunds table, modals. **SAR revenue figures appear only for the Owner and Finance-view holders** (F-1, F-2); other roles see units.
- **States:** no sales yet; suspended (existing vouchers noted as "being resolved"); error toast.

### M09. Watch & Earn campaign detail
- **Layout:** header with link-target chip; hero summary card (delivery) at the top; tabs **Monitor · Performance · Prizes · Budget & unused balance · Activity**.
- **Emphasis:** the **hero gradient delivery card** ("620 of 1,000 paid views", spend, remaining) and the progress bar.
- **Components:** hero card, started/qualified/invalid counters with invalid breakdown by category (no identities), prize inventory table, budget accounts table (funded / consumed / **unused shown separately**), fund-budget modal, replace-video drawer.
- **States:** moderation (processing / in review / rejected with reason), awaiting funding, paused, completed, suspended; payment failed in modal; empty Performance until live.

### M10. Live Deal builder
- **Layout:** builder framework (6.2) with slots 1–8 as in 6.1; preview shows the Live card (red "LIVE" badge as the customer sees it) and Detail.
- **Emphasis:** the form card and preview; **controlled redemption** appears as an optional collapsed card with an explanatory note.
- **Components:** bilingual fields, mechanic choice cards, branch multi-select, schedule pickers, eligibility choice cards, structured terms builder, gallery uploader, DealDash check card.
- **States:** per 6.3 and 6.4.

### M11. Exclusive Deal builder
- **Layout:** builder framework; slot 2 uses three large **limit-type choice cards** (Time / Quantity / Time + quantity); slot 3 is an **inventory table** (branch × quantity) with a total; slot 5 includes the reservation hold (default 30 min) and per-customer limit; deposit shown as a disabled "coming soon" row.
- **Emphasis:** the inventory table and the preview countdown/stock bar.
- **Components:** choice cards, quantity steppers, disabled-with-tooltip rows, DealDash check.
- **States:** inline error "Add stock for at least one branch"; guardrail "Exclusive Deals within the usual range can publish instantly".

### M12. Voucher builder
- **Layout:** builder framework; slot 2 shows face value and selling price side by side with a live **"Customers pay SAR 80 · get SAR 100 · save 20%"** summary pill.
- **Emphasis:** the price pair summary and validity explanation.
- **Components:** money inputs, validity segmented control (Days from purchase | Fixed date), read-only platform notes (refund-before-redemption, full redemption in one visit), disabled card-restriction option with "coming soon".
- **States:** warning = discount above range → review; blocked = price above face value.

### M13. Watch & Earn builder
- **Layout:** builder framework; slot 1 includes the link-target picker as choice cards; slot 2 has **paid views** input, **cost estimate card** from the rate card and optional frequency and prizes; slot 6 is a **video uploader** (drag-drop, progress, transcoding, thumbnail picker); slot 8 includes the funding panel.
- **Emphasis:** the cost estimate and the funding action; no reward-amount field exists anywhere.
- **Components:** upload with progress, estimate card, frequency stepper with "minimum set by DealDash" hint, prize rows, PSP payment modal.
- **States:** moderation notice; funding results (6.4); error = payment failed with retry.

### M14. Redemptions
- **Layout:** header; segmented tabs **History · Code lookup**; table card; row opens a **redemption drawer**.
- **Emphasis:** the Result chip and, in the drawer, the **Reverse** action (destructive tonal) with the remaining window shown as "Reversible for 02:14".
- **Components:** data table, drawer (details, audit trail), Reverse modal (reason select + note, consequence summary), code lookup card.
- **States:** empty "No redemptions yet"; window closed = Reverse hidden with "Contact DealDash support"; success toast "Redemption reversed"; error for already reversed.

### M15. Insights
- **Layout:** header with date range and branch; segmented tabs **Overview · Live Deals · Exclusive Deals · Vouchers · Watch & Earn**; each tab = stat cards row, main chart card, breakdown table.
- **Emphasis:** the primary chart; caption rules (Live Deals tab always shows the discovery-signals caption; **no merchant revenue shown**).
- **Components:** stat cards, line/area, bar, funnel (Live), stock/sell-through bars (Hot), voucher units chart (revenue values only for Owner/Finance-view), Watch & Earn spend and qualifying-view charts, chart/table toggle, export.
- **States:** empty "Insights appear after your first campaign goes live"; no-data "Try a wider range"; chart error retry.

### M16. Business profile
- **Layout:** header with merchant name and Verified chip; tabs **Profile & branding · Branches · Documents & agreement**. Profile: left form cards, right sticky merchant-page preview. Branches: table + **branch drawer** (details, map pin, opening-hours grid, exceptions). Documents: two cards.
- **Emphasis:** the preview (what customers see) and the opening-hours grid.
- **Components:** bilingual fields, gallery uploader, branch table, hours grid, map picker, agreement card, document list.
- **States:** edit vs view mode, unsaved-changes modal, deactivate-branch modal with impact, expiring document chip, success toast.

### M17. Team & roles
- **Layout:** tabs **Users · Roles reference**; table with avatar column; invite modal; user drawer.
- **Emphasis:** role and status chips; the Invite CTA.
- **Components:** data table, avatars, role chips (neutral), invite modal with permission summary, drawer with deactivate (destructive tonal), roles matrix (checkmarks), **Finance permissions shown as two separate toggles** (Finance: view / Finance: manage) in the user drawer (F-1).
- **States:** empty "Only you so far"; last-Owner guard tooltip; success toast; error for duplicate user.

### M18. Finance
- **Layout:** header; **hero summary row** (hero card "Next payout" + three stat cards: Settlement-eligible, Held, Carried forward); tabs **Statements · Payouts · Campaign spend · Invoices · Bank details**; table below.
- **Emphasis:** the hero amount; carried-forward card turns amber if negative.
- **Components:** hero card, stat cards, data tables, dispute modal, bank-change modal, payout-hold banner. The whole screen is hidden unless the user has Finance view or manage (or is the Owner); manage-only actions (dispute, export, fund, bank request for Owner) are visible only with manage.
- **States:** empty "No statements yet"; payout hold banner; failed/returned payout rows with reason; error retry.

### M19. Statement detail
- **Layout:** header with period, status chip, Download PDF and Dispute; two-column: calculation card (left) and carried-forward + notes (right); lines table full width.
- **Emphasis:** **Net payable** large on the calculation card; carried-forward negative shown in warning text.
- **Components:** calculation list with dividers and total row, lines table (sticky header, horizontal scroll on tablet), dispute modal.
- **States:** draft preview watermark; disputed banner with case link; paid shows payout reference; not-found error.

### M20. Support
- **Layout:** tabs **Help centre · My cases**; Help: search pill and four category cards, article list; Cases: table + **case drawer** with message thread.
- **Emphasis:** the search field and **Create case** CTA.
- **Components:** category cards (icon in lilac circle), article list, table, drawer thread bubbles (merchant right/ DealDash left; mirrored in RTL), create-case modal.
- **States:** empty "No cases yet, contact us any time"; attachment error; success toast "Case created".

### M21. Settings
- **Layout:** tabs **Account · Language & region · Notifications · Security**; single centred column 720 of cards.
- **Emphasis:** clear sections and one Save per tab.
- **Components:** form cards, language segmented control, notification matrix (type × channel toggles; critical rows locked with a lock icon), MFA card, sessions list.
- **States:** success toast on save; OTP modal states for mobile change; errors inline.

---

## 11. RESPONSIVE BEHAVIOUR

| Pattern | Desktop ≥ 1280 | Laptop 1024–1279 | Tablet 768–1023 | Phone < 768 |
|---|---|---|---|---|
| Shell | Sidebar 248 | Icon rail 72 | Drawer nav | Bottom bar |
| Stat cards | 4 across | 4 across (tighter) | 2×2 | Snap-scroll strip |
| Tables | Full table | Full table | Card list or scroll with sticky first column | Card list |
| Drawers | Right 520 | Right 440 | Full-width sheet | Full-screen sheet |
| Modals | 480/640 centred | Same | 90% width | Bottom sheet |
| Builders | Rail + form + preview | Narrow rail + form + preview 320 | Compact step bar + form; preview in sheet | One group per screen |
| Onboarding | Rail + form + help | Rail + form (help below) | Progress bar + form | One section per screen |
| Charts | Side-by-side | Side-by-side | Stacked | Stacked, simplified |

**Mobile priorities (designed screens):** Dashboard (stat strip + Needs attention), Notifications (full sheet), Redemptions (code lookup and history cards), Campaigns (list with status and pause/resume), Support (cases and create case). **Builders, Finance statement lines and Business hours editing remain optimised for larger screens**; on phones they open with a dismissible "Best on a larger screen" note and stay usable. Touch targets ≥ 44 px on tablet and phone.

---

## 12. RTL APPROACH

| Area | Behaviour |
|---|---|
| Layout mirror | The whole shell mirrors: sidebar on the right, top-bar order reversed, breadcrumbs read right-to-left with mirrored chevrons, drawers open from the left, toasts appear bottom-right, stepper rail on the right, preview panel on the left |
| Navigation | Sidebar items right-aligned with icons on the right; collapsed rail on the right edge; bottom bar order mirrors |
| Tables | Columns reverse order; first column at the right edge; row action menu at the left edge; numeric columns keep **LTR figures** and right alignment; sort carets and pagination arrows mirror; horizontal scroll starts at the right |
| Forms | Labels right-aligned; icons and prefix/suffix tags swap sides (the `SAR` tag moves to the start side of the amount); radio and checkbox sit on the right of labels; focus order follows reading order |
| Builders | Rail on the right; **Back/Next** swap sides (Next on the left); Back arrow `→`, Next arrow `←`; preview panel on the left and switches the phone frame to RTL with the Arabic customer card |
| **Bilingual merchant content** | EN and AR fields stay labelled side by side in both UI languages (EN left, AR right is **not** swapped, so merchants always find the same field in the same place; alternatively follow reading order: decision RTL-01); the AR input is always RTL with Plex Arabic; completeness chips show per language |
| Charts | Time axes keep **left to right** (dates and numerals are read LTR) while axis titles, legends and chart containers mirror; funnel bars grow from the start edge (right in RTL); tooltips follow pointer; numbers LTR islands; a **table toggle** is always available |
| Typography | IBM Plex Sans Arabic; no letter-spacing; larger line height; avoid italic and all-caps; numerals Western in tables and money (token switch for Eastern digits) |
| Truncation | Text truncates at the end edge with an ellipsis; titles may wrap to two lines in cards; Arabic strings 20–30% longer than English in buttons: use min-width and auto-sizing rather than fixed widths |
| Icons | Directional icons mirror (arrows, chevrons, back, forward, progress); non-directional icons (clock, check, lock, pause, map pin) do not; brand wordmark and QR/maps do not mirror |
| Dates | Gregorian default; Hijri toggle later (UXF-12); Riyadh time |
| Testing | Every component is delivered in LTR and RTL; pseudo-localisation with +30% strings and mixed-direction brand names (e.g. "مطعم Nobu") |

---

## 13. ACCESSIBILITY CONSIDERATIONS

| Topic | Design requirement |
|---|---|
| Contrast | **Computed with the WCAG formula** (re-verify in design tooling at mockup stage): navy on white 18.24:1; `ink-2` on white 6.25:1, on `#F8F9FD` 5.94:1 and on `slate-100` 5.50:1; purple on white 7.0:1 and on lilac 5.88:1; white on `purple` 7.0:1, on `purple-600` 8.94:1, on `danger-solid` 5.57:1; chip text pairs: success 4.76, warning 5.31, danger 5.63:1. **Failures found and avoided:** raw `mint` 2.36:1, raw `amber` 2.04:1 and raw `red` 4.04:1 on white (graphics only, never text); white on raw `red` 4.04:1 (use `danger-solid`); `ink-3` on `slate-100` 4.08:1 (use `ink-2`). Placeholder `ink-3` on white 4.64:1 |
| Colour independence | Every status has an icon and label; charts use direct labels and patterns/markers in addition to colour; error states use icon + text |
| Focus | Visible 2px `purple-2` ring with 2px white offset on every interactive element; logical order; focus trapped in modals/drawers and returned on close |
| Keyboard | All actions reachable; tables navigable by arrow keys with Enter to open; shortcuts `/` focus search, `Esc` closes overlays; stepper steps reachable with Tab |
| Screen readers | Landmarks (nav, main, header, complementary); page title announcements on route change; table headers associated; status chips have text; live regions for toasts and autosave ("Saved"); chart summaries as text and tables |
| Forms | Visible labels (no placeholder-only labels), helper text associated, errors announced and linked, required marked with text "required" not only an asterisk; bilingual fields announce language |
| Touch targets | ≥ 40 px desktop, ≥ 44 px tablet/phone; adequate spacing in tables' action menus |
| Motion | Reduced-motion disables shimmer, pulse and transitions; no auto-playing content except user-initiated video preview |
| Zoom/reflow | Layouts reflow at 200% zoom without horizontal scroll (tables excepted with sticky first column); text resizable to 200% |
| Language | `lang` and `dir` set per page and per bilingual field; Arabic uses proper shaping and numerals option |
| Timeouts | Session expiry warns before it ends; builder drafts autosaved so nothing is lost |

---

## 14. UX CONFLICTS DISCOVERED

| # | Conflict | Resolution proposed here | Needs founder confirmation |
|---|---|---|---|
| C-01 | **Builder steps:** wireframes specified 6/6/6/8 steps; the brief asks for a 9-step framework | Normalised to **8 form steps + a Submit/Publish status state**, with slots combined where thin (6.1) | No (structure unchanged) |
| C-02 | **Status names:** wireframes used "Under review" and "Changes requested" and had no "Rejected" for campaigns | Renamed **Pending review** and **Needs changes**; added **Rejected** (9.3) | No |
| C-03 | **Sidebar colour:** wireframes drew a navy sidebar; the brief asks for a white / light-lavender foundation and not a generic admin look | **White sidebar** with lilac active pill; navy kept for text and the hero gradient card | Yes (visual) |
| C-04 | **"Live" colour:** customer app uses a **red LIVE badge**; merchant status "Live" is positive | Merchant chip is **mint "Live"**; the red LIVE badge appears only inside the customer-card preview | No |
| C-05 | **Token contrast:** raw `mint`, `amber`, `red` fail as text; white on raw `red` fails | Derived `*-text` and `danger-solid` tokens (1.3); raw tokens kept for graphics | Confirm derived values in Figma |
| C-06 | **Orange:** the customer Hot gradient and the Create Exclusive Deal banner are orange-heavy; the brief says avoid orange-led design | Portal uses orange only as a 16-px flame marker; builder preview shows the customer's Hot card as designed; no orange headers | No |
| C-07 | **Finance visibility (F-1):** the Dashboard finance strip, the Finance sidebar item, voucher revenue amounts and Watch & Earn funding all depend on finance permissions | Elements are **absent** (not greyed) without permission; W&E funding by non-finance users uses **"Send for funding"** and a new **Awaiting funding** status (new state not in earlier wireframes) | Confirm the new status |
| C-08 | **Voucher revenue vs "actual sales" (F-2):** is SAR revenue "merchant financial information"? | Units visible to all campaign roles; **SAR amounts only to Owner and Finance-view holders** (WD-10) | Yes |
| C-09 | **Bilingual field order in RTL:** keep EN-left/AR-right fixed or follow reading order | Default: fixed positions so fields never move between languages | Yes (RTL-01) |
| C-10 | **Chart time axis in RTL:** LTR vs mirrored | Default: time stays LTR; containers, legends and funnel direction mirror | Yes (RTL-02) |
| C-11 | **Customer tab pattern on desktop:** segmented pill tabs work for ≤ 6 tabs; Watch & Earn detail has 5, Business has 3: fine; any future > 6 needs underline tabs | Underline variant allowed in drawers and overflow cases | No |
| C-12 | **Onboarding left rail vs "simple and progressive":** an 8-step rail can feel regulatory | Progress ring and "Step n of 8" framing, "Why we ask" cards, optional steps visually lighter; collapse the rail to a progress bar on tablet | No |
| C-13 | **Preview fidelity:** the live preview must reuse the customer components; customer screens are not yet rebuilt for the new decisions (no activation, free reservation) | Preview follows the **updated** customer rules (UXD-01..20), not the old frames | Depends on customer UI revisions |
| C-14 | **Redemption "Value" column** shows voucher face value: financial or operational? | Treated as operational; hidden for roles without redemption access | Confirm |

---

## 15. FIRST HIGH-FIDELITY MOCKUPS (recommended order)

High-fidelity mockups should establish the system before covering breadth. Create these first (each in LTR; the first two also in RTL):

| Order | Screen(s) | Why first |
|---|---|---|
| 1 | **M04 Dashboard with the full shell** (sidebar, top bar, banners, stat cards, attention list, finance strip) | Sets the shell, cards, tokens, chips and the whole brand feel; also RTL |
| 2 | **M05 Campaigns hub** (table, toolbar, status chips, drawer) | Defines the data-table, status system and segmented tabs used everywhere; also RTL |
| 3 | **M11 Exclusive Deal builder** (step 3 inventory table + preview + DealDash check + result panels) | The richest builder; validates the framework, bilingual fields and preview |
| 4 | **M07 Exclusive Deal detail & monitor** (stock bars, countdown, reservations) | Defines the detail-page pattern and live data visuals |
| 5 | **M02 Onboarding wizard (documents step) + M03 status variants** | Defines the friendly onboarding tone and the pending/changes/approved states |
| 6 | **M14 Redemptions with drawer and Reverse modal** | Defines drawers, destructive confirmations and permission-sensitive actions |
| 7 | **M18 Finance + M19 Statement** | Defines the hero card and money tables, and finance-permission absence rules |
| 8 | **M13 Watch & Earn builder funding step and M09 monitor** | Validates separate-domain UX, estimate/funding and the hero delivery card |

After these, M10, M12, M06, M08, M15–M17, M20, M21 follow the patterns with little new design work.

---

## 16. SUMMARY (for the approval message)

1. **Design language:** the business side of the customer app: lavender-white, navy, one purple accent, pill buttons/chips, 20-radius cards, segmented tabs, navy-to-purple hero card for headline numbers; orange only as a small Hot marker.
2. **Shell:** white sidebar (8 items) with lilac active pill, 64-px top bar with branch switcher, search, language, notifications and user menu; banner zone and consistent page header.
3. **Frameworks:** one builder (rail + form + live preview + DealDash check, 8 steps + publish status), one detail page (header, KPI strip, tabs, main/side), one data table (toolbar, 56-px rows, drawer on click, no bulk actions in MVP), one status system (9 required statuses plus secondary).
4. **All 21 screens** specified with layout, emphasis, components and states; responsive and RTL behaviour defined; accessibility requirements listed (including two token-contrast problems found).
5. **Conflicts:** 14 listed in section 14; five need founder confirmation (C-03, C-07 new status, C-08, C-09/C-10, C-14).

*End of Merchant Portal visual design specification v0.1. No production code and no high-fidelity mockups created yet. Partner and Admin portals not designed.*


## 17. DELIVERY STATUS (after Batch 01 and Batch 02)

All 21 MVP core screens now have high-fidelity design mockups: **Batch 01** (M04, M05, M07, M11) and **Batch 02** (M01, M02, M03, M06, M08, M09, M10, M12, M13, M14, M15, M16, M17, M18, M19, M20, M21). See DEALDASH_MERCHANT_HIFI_BATCH_01.md, DEALDASH_MERCHANT_HIFI_BATCH_02.md and the files in docs/mockups/. Navigation is the approved seven-plus-footer structure.
