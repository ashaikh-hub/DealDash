# DEALDASH PARTNER PORTAL: VISUAL DESIGN

Version 0.2 (visual direction APPROVED; D-P1..D-P3 applied; propagated to all MVP pages in Batch 02) · 2026-10-07
Applies to: banks / issuers, card schemes / networks, employers / corporates (one portal).
Inputs: Partner Portal Wireframes v0.2 (FDP-01 closed), Merchant and Admin visual languages, Figma tokens.
Mockup: `docs/mockups/partner-hifi-batch-01.html` (static design-review file, not production code; type, role, status, suppression and RTL switchers on the top bar).
Companion: `DEALDASH_PARTNER_HIFI_BATCH_01.md`.

> **Partner Portal status (approved):** structurally and visually **frozen for MVP**. FDP-02 to FDP-11 remain configurable / default-driven decisions unless later specifically approved; none blocks MVP architecture or development. Remaining VALIDATE-KSA items stay open for external validation. Partner Portal QA items (tablet, keyboard/screen-reader, real-data, native Arabic, contrast, unchecked drawers/modals and RTL pages) may be completed later and do not block the next stage.

## DECISIONS APPLIED (v0.3, visual direction approved)

### D-P1. Small-cohort privacy: merged-remainder rule (approved)
When one or more report cells fall below the configurable cohort threshold (**initial pilot product setting: 10 customers**), totals and surrounding values must **not allow the hidden value to be reconstructed by subtraction**. Where necessary:
1. merge small cohorts into an **"Other / suppressed"** group (itself suppressed if the merged group is still below the threshold);
2. **suppress related totals** ("Total not shown because a related group is hidden");
3. **suppress adjacent breakdowns** (e.g. a percentage-of-total that would reveal the hidden remainder; use counts without a total, or hide the breakdown);
4. never rank or sort by a hidden value; never show a hidden value as "<10" next to a visible total.
Uses the existing configurable setting. This is a **privacy / product control, not a final legal conclusion**; **VK-12 remains open**.

### D-P2. Eligible reach shown as rounded range (approved)
Reach is shown as a **rounded range or approximation** (e.g. "1,000–1,250 eligible customers", "~5,000 eligible customers"), never an unnecessarily precise count. Exact small populations are never revealed; below the threshold the value is replaced by "Not shown to protect customer privacy".

### D-P3. Approved / live campaign changes: "Request a change" (approved)
Partners **must not directly alter material campaign terms after DealDash approval**. The partner action is **Request a change**, capturing: **requested change · reason · affected fields · supporting information · submitter · timestamp**. DealDash reviews and responds: **approve · request clarification · reject**. Approved changes are applied by DealDash and versioned; until then the live campaign is unchanged. **Non-material internal notes** do not trigger campaign review. **Emergency pause / suspension remains a DealDash Admin function** unless explicitly delegated later.

## 1. Visual direction: "DealDash for institutions"

| Quality | How it shows |
|---|---|
| Premium, trusted | White and light-lavender surfaces, deep navy text, one purple action, generous space |
| Simple | Fewer elements per screen than Admin; larger type and spacing; one primary action per page |
| Data-led, calm | Four KPI patterns, two chart types (line, horizontal bar), no decorative charts |
| Not a bank back office | No grey form walls, no dense grids, no dark chrome, no CRM-style filters stack |
| Not a card-scheme console | No network logos in chrome; the organisation is shown as a neutral monogram plus type chip |
| Restrained colour | Purple for action and selection only; green, amber and red only for status; **no gradients** (thumbnails excepted) |

### 1.1 Differences from Admin and Merchant
| | Admin | Merchant | **Partner** |
|---|---|---|---|
| Density | high | medium | **low** (body 14px, table rows 48px+, card radius 20px, page padding 32px) |
| Dashboard | queues | monitoring hero | **calm KPI cards, campaigns, attention list** |
| Decisions | approve / reject | publish | **propose and request change; DealDash decides** |
| Special surfaces | decision panel | builder rail | **visual rule builder, privacy banner, suppressed-data state** |

Tokens are unchanged: navy `#0F0C42`, purple `#5B1AFC`, lilac `#EEE8FF`, background `#F8F9FD`, ink2 `#5B5E80`, line `#E3E1F0`, derived tints. Plus Jakarta Sans (EN), IBM Plex Sans Arabic (AR), Western digits.

## 2. Shared shell

- White sidebar 240px, DealDash wordmark with "Partners" label, **organisation card** (monogram, name, type chip), nav, Settings and user card in the footer.
- Top bar 64px: pilot-city chip, global search, **Organisation status chip**, notifications bell, EN/AR switch. Suspended organisation replaces the chip with an amber banner.
- **One shell for all types.** Navigation: Dashboard · Campaigns · Eligibility · *[type item]* · Merchants · Reports · Organization · Users · Support.

| Type | Type item | Icon |
|---|---|---|
| Bank / issuer | **Cards** | card |
| Card scheme / network | **Issuers** | link |
| Employer | **Employee verification** (Domains) | store |

Rules: hidden, not greyed, when the role does not need an item (Users: Partner Admin only; Organization: Partner Admin and Read-only view; Eligibility and type item: Partner Admin, Eligibility Manager, Campaign Manager view). Only Campaigns and Support show count dots. Sticky sidebar; mobile/tablet turns it into a drawer.

## 3. Dashboard (P03)
Question answered: **"What is active for my organisation, and what needs attention?"**
1. Header with period selector and primary action **Propose a campaign** (Partner Admin, Campaign Manager only).
2. **Privacy line** (lilac): "All figures are aggregated. Groups smaller than 10 customers are not shown…"
3. **KPI grid (3 × 2):** Active campaigns (+ pending proposals), Participating merchants, **Eligible reach** (type wording; shows "Aggregate, above threshold"), Engagement, Confirmed redemptions, Budget (Finance/Admin/Campaign roles only).
4. **Left:** Your campaigns (status chips; DealDash review shown on each row), Engagement trend.
5. **Right:** **Needs attention** (approval changes requested, budget alerts, expiries, eligibility or domain issues) with one action each; **Reports available**.
6. States: empty (onboarding checklist), suppressed, loading, suspended.

## 4. Eligibility Rule Builder (P08), the signature screen
Principle: *a banker or HR manager can build a rule in a minute with no explanation.*

- **Layout:** left work area (name AR/EN, the rule, dates and limits), right **live panel** (plain-words summary, who will see it, customer preview, checks). Panel is sticky.
- **Rule as visual blocks:** purple **IF** pill, then **condition blocks** (icon, label, value pills with ×, "+ Add"), joined by an **AND / OR** switch on a vertical connector, then a green **THEN: Customer is eligible**, then a grey **OTHERWISE** block showing the locked state ("Add your eligible bank card to unlock").
- **Fixed blocks:** the partner's own issuer / employer is **Fixed** (grey pill with explanation). Partners cannot choose other organisations.
- **Type content:**

| Type | Blocks offered |
|---|---|
| Bank | Issuer (fixed), Card product, Card tier, City (approved BIN/IIN metadata is handled by DealDash and appears only as a note) |
| Scheme | Network, Issuer, Card tier, Geography |
| Employer | Employer (fixed), Official email domain (verified only), Employee status (verified work email), City |
| Common | Geography, approved segment, dates, limits ("Add another condition") |

- **No syntax:** no field names, operators or code. "Except…" is an advanced link, not shown by default.
- **In plain words:** a generated sentence with values emphasised. This is the single source for the customer wording.
- **Who will see it:** rounded estimate range ("8,000 – 9,000 customers today") or the suppressed state when under the threshold; toggle in the mockup to show both.
- **What customers see:** phone preview with the requirement line ("Pay with a Riyad Bank Visa Platinum card"), the lock line, and the honest card disclaimer ("DealDash cannot check which card you use at the till"). Employer variant: "Verified status unlocks this offer in the app".
- **Checks:** supported combination, no personal data used, wording included, **overlap warning** (amber, informative). Footer line: DealDash reviews every rule and can narrow or pause it.
- **Actions:** Save draft, **Submit for DealDash review** (modal explains outcomes). View-only roles see a banner and no editing controls.

## 5. Reports (P10)
- Header filters (period, campaign), **Export aggregates** (Partner Admin, Analyst only), the **privacy line**, and six segmented tabs (Overview, Campaigns, Engagement, Merchants & places, Segments (type-specific), Exports).
- **Overview:** four KPI cards (eligible reach, offer views, confirmed redemptions, voucher units), **Campaign performance** (horizontal funnel bars), **By area** (bars), **Performance by card tier / issuer / employee group** (table).
- **Small-cohort suppression (setting: 10 customers):**
  - In a bar list: the row is shown with a **hatched bar** and a "Hidden" pill, with a footnote ("Al Nakheel has fewer than 10 customers, so it is not shown").
  - In a table: the whole row's numbers are replaced by a dashed card: **"Not shown to protect customer privacy"**.
  - In KPI cards: a dashed card with a lock.
  - No value, range or rank leaks (hidden rows are never sorted by hidden values; totals and adjacent breakdowns are suppressed or merged into "Other / suppressed" per D-P1).
- No customer lists, no row-level data, no personal fields anywhere. Live Deals show discovery signals only; redemptions only where measurable.

## 6. Campaign Proposal Detail (P05)
One pattern, three variants.
- **Header card:** name, **status chip**, partner-type chip, dates, actions.
- **DealDash review banner (prominent, full width):** colour and icon by status with a sentence on what happens next. Draft (grey), Submitted (lilac), **Needs changes (amber, reviewer note)**, Approved, Scheduled and Live (green), Paused (grey), Expired (grey), **Rejected (red, reason)**.
- **Review progress:** Draft → Submitted → Needs changes → Approved → Live.
- **Tabs:** Overview · Eligibility · Merchants · Content · Budget · Performance · Activity. Budget is hidden for roles without budget access.
- **Edit rules:** editable in **Draft** and **Needs changes** by Partner Admin and Campaign Manager; **Approved / Scheduled / Live** show "Editing locked" and a **Request a change** action that goes back to DealDash review and leaves the live campaign unchanged; Paused / Expired / Rejected are read-only (Rejected can start a new proposal).
- **Variants** (inside the Eligibility tab and the Overview audience line):

| | Bank | Scheme | Employer |
|---|---|---|---|
| Eligibility tab | Issuer, card products, tiers, city | Network, participating issuers, tiers, geography | Employer, official domain (verified), employee eligibility |
| Merchants tab | Same table | Same table | Same table (participating merchants emphasised) |
| Customer wording | "Pay with a …card" | "Pay with a Visa card from a participating bank" | "Open to verified … employees" |
| Reach card | Cardholders matched | Network cardholders matched | Verified employees |

- Merchants tab: merchant response chips (Accepted / Requested / Declined); "Request more merchants" only while editable.
- Activity: only organisation-visible events and DealDash decisions with partner-facing text; never internal notes.

## 7. Permission-aware UI (mockup role switcher)
Roles shown: Partner Admin, Campaign Manager, Eligibility Manager (renamed Card Product Manager / Network Programme Manager / Benefits Manager by type), Analyst, Finance Viewer, Read-only. Controls that a role cannot use are **removed**: Propose, Edit, Submit, Request a change, Export, Users, Organization. Budget cards and tab hidden except Partner Admin, Campaign Manager and Finance Viewer. No DealDash internal admin control appears anywhere.

## 8. RTL / Arabic
- Whole shell mirrors: sidebar to the right, breadcrumb and chevrons flipped, tabs and segmented controls reversed, tables right-aligned with column order reversed, KPI numerals left-to-right inside right-aligned cards.
- **Rule builder:** IF/THEN connector line moves to the right edge; AND/OR switch, value pills, ×, "+ Add" all mirror; the live panel moves to the left; bilingual name fields keep EN and AR side by side with the AR field set RTL.
- Identifiers, amounts and dates are isolated LTR (`bdi`). Arabic text uses IBM Plex Sans Arabic at 15px / 26px.
- Strings are **not translated** in this batch; only navigation labels and a few headings are Arabic to prove behaviour. English sentences placed inside RTL layout show punctuation drift; real Arabic copy will be reviewed natively (QA item).

## 9. Reusable Partner Portal components (17)
1. Partner shell (sidebar, top bar, organisation card, type chip)
2. Type-aware navigation item set
3. Privacy / aggregation banner
4. KPI card (value, label, delta or note)
5. Needs-attention card (icon, text, one action)
6. Campaign row (thumbnail, name, dates, status chip, chevron)
7. Status chip set (Draft, Submitted, Needs changes, Approved, Scheduled, Live, Paused, Expired, Rejected)
8. DealDash review banner
9. Review progress line
10. Rule block (icon, label, value pills, add / remove, fixed state)
11. Rule connector with AND/OR switch; IF / THEN / OTHERWISE labels
12. Plain-language summary panel
13. Reach estimate with suppressed state
14. Customer preview phone (requirement + lock + disclaimer)
15. Suppressed-data patterns (hatched bar, dashed card, "Hidden" pill)
16. Horizontal funnel / bar chart and line chart
17. Role-aware action group (permission hidden, "Editing locked", "Request a change")

Shared from Merchant/Admin unchanged: segmented tabs, tables, drawers, modals, banners, bilingual field pair, timeline, buttons.

## 10. Accessibility and QA notes
Contrast uses existing token pairs (final Figma verification remains a QA item). Status never relies on colour alone (icon + label). Hatched bars carry a text pill. Focus rings and keyboard order, tablet layouts, screen-reader labels and native Arabic copy remain **QA items** and do not block propagation.

## 11. Founder decisions and risks
No new blocking decision. For confirmation: **Closed (D-P1..D-P3):** merged-remainder suppression, rounded reach ranges, and Request a change on approved campaigns. Other open items: FDP-02..FDP-11 (see wireframes), VK-12 cohort validation, VK-21 logos.

## 12. Propagation to remaining pages
Yes. Remaining pages (P01, P02, P04, P06, P07, P09, P11 to P14) reuse the same shell, KPI card, table, tabs, stepper, modals and status chips; only the **P07 type modules** and the **P02 wizard** need new compositions, both built from existing components. Next batch suggestion: P07 (three variants), P04, P09, P11, P02, then the rest.

## 13. BATCH 02: ALL REMAINING MVP PAGES (propagation)
Mockup: `docs/mockups/partner-hifi-batch-02.html` (superset of Batch 01; every page reachable from the top bar; type, role, RTL and conflict switchers; URL hash `#page:type:role[:rtl[:status[:small[:sub]]]]`). No new visual language: all pages reuse the shell, KPI cards, tables, segmented tabs, chips, drawers, modals, stepper, privacy and suppression patterns, and permission-aware controls.

| Page | Specified as | Notes |
|---|---|---|
| P01 Sign in & invitation | Centred card (pre-shell): sign in, code, accept invitation, expired invitation | Lockout and timeout states described in wireframes |
| P02 Onboarding & status | 8-step wizard (vertical stepper + form card) and one status page with 8 variants (Submitted, In review, Changes requested, Rejected, Approved, Configured, Activated, Suspended) | Step 5 changes by type; Saudi requirements flagged VALIDATE-KSA |
| P04 Campaigns | Tabs Active, Proposals & review, Upcoming, Ended; table with status chips; Propose a campaign | Footnote on Request a change and DealDash-only pause |
| P05 Campaign detail | Batch 01 pattern | Links to change request |
| P06 Proposal builder | 7-step stepper, right panel with customer preview and DealDash checks; submit modal states DealDash decides | Role-gated |
| Change request | Full page for CR (states: in review, clarification, approved, rejected), before and after, timeline; request modal captures required fields | D-P3 |
| P07 Type module | Bank: Card portfolio + Rules; Scheme: Network profile + Issuers + Rules; Employer: Company + Email domains + Verification + Rules; drawers (product ranges, merchant), modals (propose product, invite issuer, add domain) | Modular: only tabs differ |
| P08 Eligibility list and builder | Batch 01 builder, plus Eligibility list, conflict state (error banner, Submit disabled) | |
| P09 Merchants | Participating and Requests & invitations tabs; merchant drawer; invite modal | Discovery of non-participating merchants is Phase 2 |
| P10 Reports | Batch 01 with D-P1 and D-P2 | |
| P11 Organization | Profile, Agreement & documents, Data sharing & privacy (request-a-review modal), Funding & statements (employer shows empty state), Activity history (large table with pagination) | |
| P12 Users | Users table, Roles reference matrix, Invitations, Access history; invite and manage modals | PAD only |
| P13 Support | Help centre categories and My cases; case drawer; new case modal | Same case model as Admin |
| P14 Settings | Account, Notifications matrix, Language & region, Security | |
| Notifications | Drawer from bell | Not a page |

**Core page count: 14.** All MVP pages are now visually specified.

*No production code was written.*
