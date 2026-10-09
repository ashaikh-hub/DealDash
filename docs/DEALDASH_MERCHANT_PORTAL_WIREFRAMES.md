# DEALDASH MERCHANT PORTAL: WIREFRAME SPECIFICATION

Version 0.2 (approved with clarifications F-1, F-2) · 2026-10-07
Scope: **Merchant Portal only**: the 21 rationalised MVP core screens (M01–M21) from `DEALDASH_UX_ARCHITECTURE.md` section L.4. Partner Portal, Admin Portal and the Staff app are not wireframed here.
Inputs: Master Blueprint v0.2.2, Business Rules v0.2.x, UX Architecture v0.3, and the design tokens in `Figma Files\design-tokens.json`.
Output type: **low-fidelity structural wireframes in text** (layout, hierarchy, content, states, permissions). Not visual design, not code.

> **Live Deal editing (final, v0.2.4):** For an active Live Deal, **minor non-commercial edits** (typo, formatting and translation corrections and other non-material descriptive corrections) **may publish immediately with a full audit trail**. **Material edits require review or a revised version.** Material = discount/value, core proposition, eligibility, participating branches, campaign dates where material, important terms and conditions, and anything that materially changes what the customer receives. **DealDash may tighten this rule for merchants or content flagged by risk controls.** (Exclusive Deals remain stricter per D6.) Merchant Portal is structurally frozen for MVP; remaining work is visual QA only (7 screens not yet inspected in-browser, tablet/phone states, Arabic/RTL drawn review, final photography/icons, alignment of customer screens S20, S26, S31).

---

> **Clarifications recorded (v0.2):** (F-1) Finance access is permissioned and separable into view and manage; Owner by default; Admin not automatic. (F-2) Insights shows only revenue DealDash can reliably measure: voucher sales and revenue; Live Deals show discovery and engagement only (impressions, detail views, saves, directions, merchant-page visits) with no unverified merchant sales revenue; Exclusive Deals show reservations and confirmed redemptions; Watch & Earn shows spend, qualifying views, engagement and campaign performance. No merchant revenue attribution is invented where DealDash cannot prove it.

## 0. Conventions

### 0.1 How to read the wireframes

- ASCII boxes show **layout and hierarchy only**; proportions are indicative.
- `[Button]` = button; `[Primary]` = primary (purple) button; `( )` = radio; `[x]` = checkbox; `▾` = dropdown; `⋯` = row actions menu; `{...}` = dynamic value; `…` = more content of the same kind.
- Chips: `‹Live›` style shows a status chip.
- **Role codes:** OWN Owner · ADM Admin · MKT Marketing Manager · FIN Finance · BRM Branch Manager. (Redemption staff use the Staff app only.) "Merchant Manager" for reversal = OWN, ADM or BRM by permission (to confirm, UXD-19). **Finance access is a separable permission, not a role privilege (clarification F-1):** two explicit permissions, **Finance: view** (read-only) and **Finance: manage** (statements disputes, bank change requests, funding, exports). The Owner holds both by default. The FIN role holds the permissions an Owner grants; **Admin has no finance access unless explicitly granted**. Any role can be granted one or both.
- **Phase:** MVP unless marked P2.
- Rules referenced: LD-, HD-, VC-, WE-, RS-, RD-, MR-, LG-, AP- (Business Rules).

### 0.2 Design system usage (from the approved tokens and customer baseline)

| Aspect | Merchant Portal usage |
|---|---|
| Colours | Page background `#F8F9FD` (light lavender-white); cards `#FFFFFF`; text navy `#0F0C42`; secondary text `#5B5E80`; lines `#E3E1F0`; primary DealDash purple `#5B1AFC` (hover `#7E4DFF`); tint `#EEE8FF` for selected rows/tabs; sidebar navy `#0F0C42` / `#0A0830` with white text and purple active marker |
| Semantic colours | Success/verified mint `#1FBF8F`; warning amber `#F5A524`; danger/live red `#E93A52`. Orange gradient is used **only** on the Exclusive Deal type badge |
| Type | Plus Jakarta Sans (English), IBM Plex Sans Arabic (Arabic). Page title 28/800, section title 18/800, body 14/500, caption 12/500, button 15/700; table cells 13/500 |
| Shape | Cards radius 20; inputs 14; chips pill; modals/sheets 26; shadow `0 1px 2px / 0 6px 18px`; tables sit inside rounded cards |
| Wordmark | "Deal" navy + "Dash" purple (white "Deal" on the navy sidebar), caption "for Business" |
| Spacing | 8-pt grid; desktop page gutters 32; card gap 16; section gap 24 |

### 0.3 Global behaviours

| Topic | Rule |
|---|---|
| Breakpoints | **Desktop ≥ 1280** (primary); **Laptop 1024–1279** (sidebar collapses to icons); **Tablet 768–1023** (drawer navigation, tables become cards or horizontally scroll, side panels become full-width sheets); **Phone < 768** supported for read-only monitoring, Redemptions, Support and Notifications; builders and onboarding show a "Continue on a larger screen for the best experience" note but remain usable |
| Language | AR/EN toggle in the top bar; full RTL mirror; merchant-entered fields shown in **side-by-side AR | EN columns** on desktop, tabbed AR/EN on tablet |
| Confirmations | Destructive or status-changing actions open a **confirm modal** with an impact line and (where required) a mandatory reason |
| Drawers | Row details open in a right **drawer** (width 480–560) so list context is kept; on tablet the drawer becomes a full-width sheet |
| Unsaved changes | Builders autosave drafts every 30 s; leaving with unsaved edits triggers a "Save draft / Discard" modal |
| Permissions | Navigation items and tabs the role cannot use are **hidden**, not greyed (read-only tabs show a "View only" tag) |
| Status chips | One vocabulary across the portal (section 0.4) |
| Banners | Page-level banners stack under the header: Suspended (red), Changes requested (amber), Translation incomplete (amber), Review pending (blue-lilac), Payout hold (amber) |
| Empty states | Illustration-light: icon, one-sentence explanation, one primary action |
| Errors | Inline field errors (below field); form-level summary at top of the stepper footer; toast for transient success/failure; full-page error for 403/404/500 |

### 0.4 Status chip vocabulary

| Group | Chips |
|---|---|
| Application | Draft · Submitted · In review · Enhanced review · Changes requested · Approved · Rejected · Activated · Suspended |
| Campaign (all products) | Draft · Under review · Changes requested · Scheduled · Live · Paused · Sold out / Completed · Expired · Suspended · Cancelled · Archived |
| Voucher instance (sales tables) | Active · Redeemed · Expired · Refunded · Voided |
| Reservation | Reserved · Redeemed · Expired / No-show · Cancelled |
| Money | Draft · Issued · Paid · Disputed · Pending · Failed · Returned |
| Translation | Complete · Missing AR · Missing EN · Help requested |
| Verification | **Verified** is used only for the merchant itself (approved merchant) and verified employer on the customer side; never for cards |

### 0.5 Portal-wide permission matrix (visibility)

| Area | OWN | ADM | MKT | FIN | BRM |
|---|---|---|---|---|---|
| Home (dashboard) | all widgets | all | campaign widgets | finance widgets | own-branch widgets |
| Campaigns: view | ✓ | ✓ | ✓ | read (vouchers, W&E spend) | view (own branches) |
| Campaigns: create / edit / pause | ✓ | ✓ | ✓ | – | – |
| W&E: fund budget (needs **Finance: manage**) | ✓ | only if granted | – | ✓ if granted | – |
| Redemptions: view | ✓ | ✓ | – | read | own branches |
| Redemptions: **reverse** | ✓ | ✓ | – | – | ✓ (own branches) |
| Insights | ✓ | ✓ | ✓ | – | own branches |
| Business profile / branches | ✓ edit | ✓ edit | – | – | view own branch |
| Team & roles | ✓ | ✓ (cannot remove last Owner) | – | – | – |
| Finance: view (statements, payouts, spend, invoices) | ✓ | only if granted | – | ✓ if granted | – |
| Finance: manage (dispute, export, fund) | ✓ | only if granted | – | ✓ if granted | – |
| Finance: bank details view / change request | view + change (**Owner only to change**) | only if granted (view) | – | view if granted | – |
| Support | ✓ | ✓ | ✓ | ✓ | ✓ |
| Settings (own account) | ✓ | ✓ | ✓ | ✓ | ✓ |

---

## 1. PORTAL SHELL AND NAVIGATION (desktop-first)

### 1.1 Desktop shell (≥ 1280)

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ TOP BAR (64)                                                                              │
│  ☰(tablet)   Branch: [ All branches ▾ ]      🔍 Search campaigns, codes…    EN | عربي  🔔 3  (AK)▾ │
├────────────────┬─────────────────────────────────────────────────────────────────────────┤
│ SIDEBAR (240)  │  BANNER ZONE (suspended / changes requested / translation / payout hold) │
│ Deal|Dash      │ ─────────────────────────────────────────────────────────────────────── │
│ for Business   │  PAGE HEADER                                                             │
│                │   Breadcrumb  ›  Page title (28)                         [Primary CTA]   │
│ ⌂ Home         │   Sub-text / status chip                      [Secondary ▾] [⋯]          │
│ ◈ Campaigns    │ ─────────────────────────────────────────────────────────────────────── │
│ ✓ Redemptions  │  TABS (when present)  Overview | Analytics | Activity                    │
│ ▥ Insights     │ ─────────────────────────────────────────────────────────────────────── │
│ ▤ Business     │  FILTER BAR (search · filters · date range · view toggle)                │
│ ₪ Finance      │  CONTENT (cards / table / form)                                          │
│ ? Support      │                                                                          │
│ ⚙ Settings     │                                                    ┌───── DRAWER (520) ─┐│
│                │                                                    │ record detail      ││
│ ─ merchant ─   │                                                    └────────────────────┘│
│ Harbour Grill  │                                                                          │
│ ‹Verified›     │                                                                          │
└────────────────┴─────────────────────────────────────────────────────────────────────────┘
```

| Element | Spec |
|---|---|
| Sidebar items (8) | **Home · Campaigns · Redemptions · Insights · Business · Finance · Support · Settings** (hidden per role). Active item: purple left marker + tint. Merchant name + ‹Verified› chip at the bottom |
| Campaigns | Opens the Campaigns hub; sub-tabs (Live Deals · Exclusive Deals · Vouchers · Watch & Earn) live inside the page, not in the sidebar |
| Business | Opens Business profile (tabs Profile · Branches · Documents & agreement); **Team & roles** is a second item shown as a child link under Business (the only two-level entry) |
| Branch switcher | Dropdown "All branches / {branch}". Filters Dashboard, Campaigns (by assigned branch), Redemptions, Insights. BRM sees only own branches |
| Global search | Searches campaign titles and redemption/reservation codes; results dropdown grouped by type; Enter opens the record |
| Notification bell | Opens the **notification drawer** (section 15); badge = unread count |
| User menu | Name, role, merchant, Language, Settings link, Sign out |
| Page header | Breadcrumb, title, status chip, primary CTA at far right, secondary actions in a "⋯" menu |
| Suspended mode | Red banner on every page; create/edit actions disabled with tooltip; read access and Support remain |

### 1.2 Responsive behaviour of the shell

| Breakpoint | Behaviour |
|---|---|
| Laptop 1024–1279 | Sidebar collapses to icon rail (72) with tooltips; expands on hover/click; drawers 440 |
| Tablet 768–1023 | Sidebar hidden behind ☰ (slide-in drawer); top bar condenses (branch switcher and language in an overflow menu); tables → card list or horizontal scroll with sticky first column; side drawers → full-width bottom/right sheets; builder preview panel → "Preview" button opening a sheet |
| Phone < 768 | Bottom bar (Home, Campaigns, Redemptions, Support, More); single column; tables → cards; builders: stepper becomes a top progress bar, one field group per screen |

---

## 2. A. MERCHANT ONBOARDING (M01, M02, M03)

### 2.1 Journey

```
M01 Register → verify email → verify mobile
   → M02 Onboarding wizard (8 steps, draft saved between sessions)
        1 Business details → 2 Documents → 3 Authorised representative → 4 Category & branding
        → 5 Branches & hours → 6 Settlement / IBAN → 7 Agreement (e-sign) → 8 Review & submit
   → M03 Application status
        In review → [Enhanced review] → Changes requested ↔ Resubmit (deep-links into M02 steps)
        → Approved / Activated → M04 Dashboard   |   Rejected (appeal)   |   Suspended (blocked, resolution status)
```

### 2.2 M01: Sign in & registration (public)

| Item | Spec |
|---|---|
| Purpose | Create a merchant account, verify contact details, sign in |
| Layout | Centered card (480) on lavender background; wordmark on top; language toggle top-right |
| Tabs/steps | Tabs **Sign in · Register**. Register is 3 steps: (1) email + password + business trade name, (2) email code, (3) mobile number + OTP |
| Fields | Email, password (rules shown), trade name; email code (6 digits); mobile (+966), OTP (6 digits) |
| Primary CTA | Create account / Sign in |
| Secondary | Forgot password, Resend code, Switch language, link to Terms/Privacy |
| Validation | Duplicate email, weak password, wrong/expired code (message + resend after cooldown), too many attempts (lockout message) |
| Errors | Inline field errors; OTP lockout banner with retry time; network error toast |
| Permissions | Public |
| Tablet/phone | Same card, full width on phone |
| Post-login routing | No application → M02; application not activated → M03; activated → M04 |

### 2.3 M02: Onboarding wizard

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ Deal|Dash for Business                                      Save & exit   EN | عربي  (AK) │
├───────────────────┬───────────────────────────────────────────────────┬─────────────────┤
│ Your application  │  Step 2 of 8 · Documents                            │ Need help?      │
│ ● 1 Business ✓    │  Upload the documents DealDash needs to verify      │ Accepted files  │
│ ● 2 Documents     │  your business.                                     │ PDF/JPG ≤ 10 MB │
│ ○ 3 Representative│                                                     │ Contact support │
│ ○ 4 Category      │  ┌─ Commercial Registration / trade licence * ───┐ │                 │
│ ○ 5 Branches      │  │ [ Upload file ]   cr_harbour.pdf  ✓ uploaded   │ │                 │
│ ○ 6 Settlement    │  │ Expiry date [ 12/2027 ]                       │ │                 │
│ ○ 7 Agreement     │  └───────────────────────────────────────────────┘ │                 │
│ ○ 8 Review        │  ┌─ Other relevant business documents ───────────┐ │                 │
│                   │  │ [ + Add document ]  (type ▾) (file)           │ │                 │
│ Saved 2 min ago   │  └───────────────────────────────────────────────┘ │                 │
├───────────────────┴───────────────────────────────────────────────────┴─────────────────┤
│  [ ← Back ]                                         [ Save draft ]       [ Save & continue ] │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

| Step | Fields (required *) | Validation and states |
|---|---|---|
| 1 Business details | Legal business name* (AR/EN), trade name* (AR/EN), Commercial Registration number*, tax registration number (as required), business type, registered address*, business phone/email | Duplicate CR number warning; mandatory AR/EN |
| 2 Documents | CR / trade licence* (with expiry), other relevant business documents (list driven by configuration; **exact Saudi requirements VALIDATE-KSA**) | Upload progress, rejected file type/size, missing-required checklist, replace file |
| 3 Authorised representative | Full name*, role*, national ID/Iqama reference*, mobile*, email*; "this person will sign the agreement" toggle | ID format check |
| 4 Category & branding | Business category*, sub-category, logo*, cover image*, gallery (≤ 8), description* (AR/EN) | Image size/ratio guidance with crop; AR/EN completeness chip |
| 5 Branches & hours | Add branch(es): name (AR/EN)*, address*, **map pin***, phone, opening hours per day*, holiday overrides; at least one branch | Hours overlap validation; "copy hours to all days/branches" |
| 6 Settlement / IBAN | Bank name, **IBAN***, account holder name* (must match legal entity) | IBAN format check; name-mismatch warning; note "changes later trigger re-review and a payout hold" |
| 7 Agreement | Agreement text (AR/EN tabs), version shown; signatory name; **e-sign** (accept + signature field); download PDF | Only the authorised signatory can sign; superseded-version notice; records version, signatory, entity, timestamp, status |
| 8 Review & submit | Section summary cards with Edit links; missing-items checklist; declaration checkbox | Submit disabled until complete; submit → M03 |

| Aspect | Spec |
|---|---|
| Navigation | Left step list (clickable once visited); steps show ✓ / ● / ○ and warning dots for errors; autosave; **Save & exit** returns later to the same step |
| Header | Wordmark, Save & exit, language, user |
| Primary CTA | Save & continue (Submit on step 8) |
| Secondary | Back, Save draft, Edit links on step 8 |
| Right panel | Contextual help, accepted formats, contact support (collapses on tablet) |
| Permissions | Applicant account holder (becomes OWN on approval); signatory step restricted to the named signatory |
| Tablet/phone | Step list becomes a progress bar with "Step n of 8" and a steps sheet; right panel becomes a "Help" button |
| Errors | Inline + summary count at the footer ("2 items need attention"); upload failures keep the form state |

### 2.4 M03: Application status (one page, status variants)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ Your application                                    {status chip}                │
│ Submitted 12 Oct · Reference DD-M-1042                                           │
│ ┌──────────────────────────── timeline ──────────────────────────────────┐    │
│ │ ● Submitted ─ ● In review ─ ○ Decision ─ ○ Agreement ─ ○ Activated       │    │
│ └─────────────────────────────────────────────────────────────────────────┘    │
│ ┌────────── variant panel (changes per status, below) ─────────────────────┐    │
│ └─────────────────────────────────────────────────────────────────────────┘    │
│ Application summary (read-only cards)                       [ Contact support ] │
└───────────────────────────────────────────────────────────────────────────────┘
```

| Status variant | Panel content | Actions |
|---|---|---|
| In review | "We're reviewing your documents", expected review time, what happens next | Contact support |
| Enhanced review | Same plus "Additional checks may take longer" (neutral wording) | Contact support |
| **Changes requested** | List per section with reviewer notes and **Fix** deep links into the matching M02 step; rejected documents flagged | Fix & resubmit (primary) |
| Rejected | Reason, whether you can reapply | Appeal (modal: message + attachments), Contact support |
| Approved | Confirmation; if agreement pending → "Sign agreement" CTA to M02 step 7 | Sign agreement |
| **Activated** | Welcome card, next steps checklist (Add branches/staff, create first campaign) | Go to dashboard (primary) |
| **Suspended** | Red panel: what is blocked (new campaigns, sales, reservations), what continues (existing redemptions per resolution workflow), obligations status, support contact | Contact support, Appeal |

Permissions: applicant/OWN (full); ADM view. Tablet/phone: single column. Errors: load failure with retry.

---

## 3. B. DASHBOARD (M04)

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Home                                                       [ + Create campaign ▾ ]         │
│ Good morning, Akif · {Branch filter shown in top bar}                                      │
├───────────────┬───────────────┬───────────────┬──────────────────────────────────────────┤
│ Live campaigns│ Reservations  │ Redemptions   │ Watch & Earn budget                       │
│      6        │ today  14     │ today  27     │ SAR 1,240 left · 62% delivered            │
│ 2 ending soon │ 3 expiring    │ vs last wk +8%│ [ View campaign ]                         │
├───────────────┴───────────────┴───────────────┴──────────────────────────────────────────┤
│ Needs attention (4)                                                                       │
│  ⚠ Exclusive Deal "Dinner for Two" Riyadh Park: 6 left            [ Add stock ]                  │
│  ⚠ Live Deal "30% off" needs changes                         [ Fix ]                       │
│  ⚠ Campaign "Lunch reel": Arabic text missing                [ Complete ]                  │
│  ⚠ Voucher "Pay 80, get 100" ends in 2 days                  [ View ]                      │
├──────────────────────────────────────────────┬───────────────────────────────────────────┤
│ Live campaigns (top 5)                        │ Recent activity                            │
│  type  title      branches  status  signal    │  Redemption · Voucher · Olaya · 10:41     │
│  …table rows…                    [ View all ] │  Reservation · Hot · Riyadh Park · 10:32  │
├──────────────────────────────────────────────┴───────────────────────────────────────────┤
│ Finance (OWN/FIN only): Next payout  SAR 8,420 · Settlement-eligible  SAR 9,100            │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

| Aspect | Spec |
|---|---|
| Purpose | Daily operations snapshot and routing to work |
| Header | Greeting, **primary CTA "+ Create campaign ▾"** (menu: Live Deal · Exclusive Deal · Voucher · Watch & Earn), branch context from top bar |
| Cards | KPI cards: Live campaigns, Reservations today, Redemptions today, W&E budget remaining (or Voucher sales today for merchants without W&E); each card is clickable to its list |
| Lists | **Needs attention** (low stock, ending soon, changes requested, translation missing, review pending, payout hold), **Live campaigns top 5** (type chip, title, branches, status, one signal), **Recent activity** (redemptions, reservations, sales) |
| Finance strip | Visible to the **Owner and users with Finance: view**: next payout, settlement-eligible balance, any negative carry-forward warning. Hidden for everyone else (no empty placeholder) |
| Filters | Branch switcher (global); date comparison fixed (today / last 7 days) |
| Secondary | "View all" links; refresh |
| States | **Empty (new merchant):** checklist card "Get started": add branches, invite team, create first campaign (shows only after activation); **Suspended:** red banner, widgets read-only; loading skeletons; widget-level error with retry |
| Approval states | Needs-attention items for "Under review" and "Changes requested" campaigns |
| Permissions | MKT: no finance strip; FIN: finance strip and spend only; BRM: own-branch data only |
| Tablet | KPI cards 2×2, lists stacked; phone: single column |

---

## 4. C. BUSINESS PROFILE, D. BRANCHES (M16)

### 4.1 M16 layout and tabs

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Business                                                          [ Edit profile ]        │
│ Harbour Grill ‹Verified›   Branches: 3 · Category: Restaurants                           │
│ ┌────────────┬──────────────┬─────────────────────────────┐                              │
│ │ Profile    │ Branches (3) │ Documents & agreement        │                              │
│ └────────────┴──────────────┴─────────────────────────────┘                              │
```

#### Tab: Profile & branding

| Item | Spec |
|---|---|
| Layout | Two columns: left form cards (Identity, Contact, About), right **customer preview card** (how the merchant page looks, AR/EN toggle) |
| Cards | Identity (legal name read-only, trade name AR/EN editable, category), Branding (logo, cover, gallery), About (description AR/EN), Contact (phone, WhatsApp, website, social) |
| Primary CTA | Save changes (sticky footer on edit) |
| Secondary | Cancel, Preview |
| Rules | Legal name, CR number and bank details are **read-only here**; "Request a change" opens a support-assisted modal. Changes to material fields (category, branding policy) show "This change may need review" banner; translation completeness chip |
| States | View mode vs edit mode; unsaved-changes modal; image upload error; AR/EN missing |
| Permissions | OWN/ADM edit; BRM view-only |

#### Tab: Branches (D)

```
 Branches                                   [ Search branch ]   Status: All ▾      [ + Add branch ]
 ┌──────────────────────────────────────────────────────────────────────────────────────┐
 │ Branch            Address            Today's hours     Status     Campaigns   Staff  ⋯ │
 │ Olaya             Olaya St           12 pm – 12 am     ‹Active›       4        5     ⋯ │
 │ Riyadh Park       Riyadh Park Mall   10 am – 11 pm     ‹Active›       3        4     ⋯ │
 │ KAFD              KAFD Metro         –                  ‹Inactive›     0        0     ⋯ │
 └──────────────────────────────────────────────────────────────────────────────────────┘
```

| Item | Spec |
|---|---|
| Table columns | Name (AR/EN), address, today's hours + "Open now", status, campaigns assigned, staff assigned |
| Filters/search | Search by name/address; status filter |
| Row actions (⋯) | Edit, Deactivate/Activate, View assigned campaigns |
| **Branch drawer** (click row / Add branch) | Sections: Details (name AR/EN, address, **map pin**, phone) · **Opening hours editor** (weekly grid with open/close times, "closed" toggle, copy-to-days) · Holiday/exception hours (date range + hours) · Assigned staff (read-only list with link to Team) · Campaigns assigned (read-only) |
| Primary CTA | + Add branch (opens drawer in create mode) |
| **Deactivate modal** | Lists impact: "N Live Deals and N Exclusive Deals only assigned to this branch will pause; N reservations remain until resolved" + reason; Confirm |
| Empty state | "No branches yet. Add your first branch" (not reachable after activation; at least one branch required) |
| Errors | Hours overlap, missing pin, last active branch cannot be deactivated |
| Permissions | OWN/ADM manage; BRM view own branch hours (edit hours optional: assumption) |
| Tablet | Table → cards; drawer → full-width sheet |

#### Tab: Documents & agreement

| Item | Spec |
|---|---|
| Layout | Two cards: **Documents** (list: type, file, expiry, status ‹Accepted›/‹Needs update›, Replace) and **Agreement** (current version, signatory, entity, date/time, status; list of earlier versions; Download executed copy) |
| Primary CTA | Upload new document (when a document is expiring / needs update) |
| Secondary | Download executed agreement; "Review new agreement version" banner → re-accept modal (authorised signatory) |
| States | Expiring-soon amber chip; new-version banner |
| Permissions | OWN/ADM view; OWN (or named signatory) re-accepts agreement |

---

## 5. E. TEAM / STAFF / ROLES (M17)

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Team & roles                                                          [ + Invite user ]   │
│ ┌────────┬────────────────┐                                                              │
│ │ Users  │ Roles reference │       🔍 Search   Role ▾   Branch ▾   Status ▾               │
│ └────────┴────────────────┘                                                              │
│ ┌──────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ Name          Role               Branches        Status        Last active        ⋯   │ │
│ │ Akif K.       ‹Owner›            All             ‹Active›      Today 09:12        ⋯   │ │
│ │ Sara M.       Marketing Manager  All             ‹Active›      Yesterday          ⋯   │ │
│ │ Omar T.       Redemption Staff   Olaya           ‹Invited›     –                  ⋯   │ │
│ └──────────────────────────────────────────────────────────────────────────────────────┘ │
```

| Item | Spec |
|---|---|
| Tabs | **Users** (table) · **Roles reference** (read-only permission matrix: Owner, Admin, Marketing Manager, Finance, Branch Manager, Redemption Staff) |
| Columns | Name, role, branches, status (Invited / Active / Deactivated), last active |
| Filters/search | Search name/phone/email; role, branch, status |
| Primary CTA | + Invite user |
| **Invite modal** | Name, email **or** mobile, role (dropdown with one-line permission summary), branches (multi-select; required for BRM and Redemption Staff), Send invite; duplicates blocked; shows staff login note ("Staff sign in with OTP on the Staff app link") |
| **User drawer** | Profile, role and branch editors, recent activity, **Deactivate** (revokes sessions immediately), Resend invite, Reset access |
| Modals | Deactivate confirm (impact + reason), Change role confirm |
| Guards | Cannot remove or demote the **last Owner**; ADM cannot create Owners; role changes audit-logged |
| Empty state | "Only you so far. Invite your team" |
| Errors | Duplicate user, invalid email/mobile, branch required |
| Permissions | OWN/ADM only; others no access |
| Tablet | Table → cards; modal full width |

---

## 6. CAMPAIGNS HUB (M05) and shared builder pattern

### 6.1 M05: Campaigns hub

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Campaigns                                                         [ + Create campaign ▾ ] │
│ ┌────────────────┬───────────────┬──────────────┬────────────────────┐                   │
│ │ Live Deals (5) │ Exclusive Deals (2) │ Vouchers (3) │ Watch & Earn (2)   │                   │
│ └────────────────┴───────────────┴──────────────┴────────────────────┘                   │
│ 🔍 Search title   Status ▾   Branch ▾   Date ▾                      [ Columns ⚙ ]         │
│ ┌──────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ Title (AR/EN)        Branches   Dates          Status         Signal           ⋯      │ │
│ │ 30% off tasting menu  All (3)   4 Oct – 11 Oct ‹Live›         322 directions   ⋯      │ │
│ │ Free dessert          Olaya     5 Oct – open   ‹Under review› –                ⋯      │ │
│ └──────────────────────────────────────────────────────────────────────────────────────┘ │
│  1–25 of 5                                                        ‹ 1 2 3 ›              │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

| Item | Spec |
|---|---|
| Header | Title; **primary CTA "+ Create campaign ▾"** with menu items Live Deal, Exclusive Deal, Voucher, Watch & Earn (opens the matching builder); BRM does not see the CTA |
| Tabs | **Live Deals · Exclusive Deals · Vouchers · Watch & Earn** with counts; the active tab remembers filters |
| Search/filters | Search by title (AR or EN), status, branch, date range; Needs-attention quick filter chip (changes requested, translation missing, ending soon) |
| Columns by tab | **Live:** title, branches, dates, status, directions clicks (signal). **Hot:** title, branches, time left, stock left (per branch summary), reservations, status. **Voucher:** title, price / face value, stock left, sold, redeemed, status. **W&E:** campaign, link target, paid views delivered / total, budget left, status |
| Row click | Opens the matching **detail page** (M06–M09) |
| Row actions ⋯ | View, Edit (if allowed by status), Pause/Resume, End/Cancel, Duplicate (P2) |
| Modals | Pause (reason optional), Resume, Cancel (impact + reason), "Edit live campaign" notice listing which edits trigger review |
| Status chips | Campaign vocabulary (0.4); Under review rows show reviewer wait note |
| Empty state per tab | Live: "Create a Live Deal to be found by nearby customers" · Hot: "Fill quiet moments with an Exclusive Deal" · Voucher: "Sell vouchers customers pay for now and use later" · W&E: "Reach customers with a paid video campaign" (each with a Create button) |
| Approval states | Chips ‹Under review›, ‹Changes requested› (amber, tooltip with reviewer note), ‹Suspended› (red, row actions disabled) |
| Errors | List load failure with retry; action conflicts (stock changed) as toast |
| Permissions | OWN/ADM/MKT full; FIN read for Vouchers and W&E tabs only; BRM view (own branches), no create/edit |
| Tablet | Table → card list; filters in a collapsible bar |

### 6.2 Shared campaign builder layout (M10–M13)

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ ← Campaigns / New Live Deal           ‹Draft›  Saved 1 min ago      Translation: ‹Missing AR› │
├───────────────────┬────────────────────────────────────────────────────┬─────────────────┤
│ STEPS             │  Step title + one-line helper                        │ LIVE PREVIEW    │
│ ✓ 1 Basics        │  ┌ form card ─────────────────────────────────────┐ │ ┌─────────────┐ │
│ ● 2 Branches &    │  │ Field            [AR]            [EN]          │ │ │ customer    │ │
│   schedule        │  │ …                                              │ │ │ deal card   │ │
│ ○ 3 Eligibility   │  └────────────────────────────────────────────────┘ │ └─────────────┘ │
│   & terms         │  ┌ Guardrail messages (if any) ───────────────────┐ │ [AR | EN]       │
│ ○ 4 Media         │  │ ⚠ Discount above allowed range → review        │ │ [Phone ▾]       │
│ ○ 5 Controlled…   │  └────────────────────────────────────────────────┘ │                 │
│ ○ 6 Preview &     │                                                      │                 │
│   submit          │                                                      │                 │
├───────────────────┴────────────────────────────────────────────────────┴─────────────────┤
│ [ ← Back ]                                   [ Save draft ]                  [ Next → ]      │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

| Aspect | Spec |
|---|---|
| Header | Back to Campaigns, title, status chip (Draft), autosave time, **Translation status chip** (Complete / Missing AR / Missing EN), "Ask DealDash to help translate" link |
| Steps | Vertical stepper, clickable once visited; ✓ complete, ● current, ○ upcoming, ⚠ has errors |
| Form | AR | EN side by side for every customer-facing text field; character counters; required marked * |
| Preview panel | Live customer-card and detail preview from the approved customer design; AR/EN and phone/tablet toggles; shows exactly what customers will see, including locked/eligibility labels |
| Guardrail panel | Real-time messages from the approval guardrails (AP-03): ranges, price sanity, prohibited terms; marks whether the campaign is likely to **auto-publish** or go to **review** ("Pre-approved rules" green note vs "Will be reviewed" amber note) |
| Footer | Back, Save draft, Next (primary); final step primary = Submit |
| Final step result | **Result modal/page variant:** *Published* (✓, "Your campaign is live" or "Scheduled for {date}"), *Sent for review* (clock, expected time, campaign locked until the decision), *Changes requested* (list with Fix links); plus a "**Promote with Watch & Earn**" secondary CTA (opens the W&E builder with the target pre-linked) |
| Autosave | Every 30 s and on step change; leaving prompts Save draft/Discard |
| Permissions | OWN/ADM/MKT; FIN can only fund W&E budgets (step 8 payment) |
| Tablet | Stepper → horizontal compact bar (step n of N) with steps sheet; preview → "Preview" button/sheet; form single column with AR/EN tabs |
| Errors | Inline errors; footer summary "2 items need attention"; blocked Next until required fields valid; draft conflict (edited elsewhere) modal |

---

## 7. F. LIVE DEALS (M06 detail, M10 builder)

### 7.1 M10: Live Deal builder, step sequence

| # | Step | Content | Key validations |
|---|---|---|---|
| 1 | **Basics** | Mechanic (percentage, fixed amount, BOGO, bundle, meal deal, service offer, everyday promotion), value (e.g. 20%), title AR/EN*, description AR/EN* | Value within guardrail range; "other" mechanic flagged for review |
| 2 | **Branches & schedule** | Branch multi-select* (≥ 1 active), start (Now / scheduled date-time, Riyadh time), end (optional; open-ended allowed), re-confirm notice if open-ended | End after start; reconfirmation days shown |
| 3 | **Eligibility & terms** | Eligibility: **Everyone (default)**, **Bank card** (issuers/products/tiers from partner-enabled list; shows the standard "Pay with…" requirement text), **Employer** (partner-enabled list). Structured terms: valid on full-price items, minimum spend, days/hours, exclusions, not combinable; free text AR/EN | At least one eligibility rule; terms generated into customer text |
| 4 | **Media** | Photos 1–5 (cover first), optional merchant video (**ordinary media with no points**; reward videos are Watch & Earn campaigns) | Image size/ratio; video length limit |
| 5 | **Controlled redemption (optional)** | Toggle **off by default**: "Require a redemption code", "Limit uses per customer" (per day/period/lifetime). Explainer: general Live Deals stay frictionless; turning this on adds a code for customers | Mutually clear copy; not recommended for attribution only |
| 6 | **Preview & submit** | AR/EN preview, translation status, guardrail result (auto-publish vs review), summary of choices | Both languages complete before publish; Submit |

### 7.2 M06: Live Deal detail

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ ← Campaigns › Live Deals                                                                  │
│ 30% off tasting menu   ‹Live›   Olaya · Riyadh Park · KAFD    [ Edit ] [ Pause ] [ ⋯ ]     │
│ ┌──────────┬───────────┬──────────┐                                                       │
│ │ Overview │ Analytics │ Activity │                                                       │
│ └──────────┴───────────┴──────────┘                                                       │
│ Overview:  ┌ Summary card ─────────────────────┐  ┌ Customer preview (AR|EN) ──────────┐  │
│            │ Value · Dates · Branches           │  │ deal card + detail                  │  │
│            │ Eligibility · Controlled: Off      │  └────────────────────────────────────┘  │
│            │ Terms (structured + text)          │                                          │
│            └────────────────────────────────────┘                                          │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

| Aspect | Spec |
|---|---|
| Header | Title (AR/EN toggle), status chip, branches, **primary CTA** Edit, secondary Pause/Resume, "⋯" (End, Duplicate P2, Archive) |
| Tabs | **Overview** (summary, customer preview), **Analytics** (funnel cards: impressions → detail views → saves → directions clicks → merchant page visits; by branch; date range; always captioned "Discovery signals, not proof of visits or sales"), **Activity** (timeline: created, edited with diff, submitted, review decision, paused, suspended, expired) |
| Status variants (same page) | Draft (Edit/Submit), Scheduled (starts on…; can edit), Live, Paused (Resume), Expired (Duplicate P2, Archive), Suspended (red banner, reason, no resume; contact support), Under review (read-only banner), **Changes requested** (amber banner with reviewer notes and **Fix & resubmit**) |
| Modals | Pause (reason), End early (impact + reason), Edit-notice ("These edits will be reviewed before going live": lists material fields), Controlled-redemption drawer (edit toggle/limits; effects explained) |
| Empty (Analytics) | "Insights appear once the deal is live" |
| Errors | Load failure; conflict when edited by another user |
| Permissions | OWN/ADM/MKT edit; BRM view; FIN no access |
| Tablet | Tabs remain; summary and preview stack |

---

## 8. G. EXCLUSIVE DEALS (M07 detail & monitor, M11 builder)

### 8.1 M11: Exclusive Deal builder, step sequence

| # | Step | Content | Key validations |
|---|---|---|---|
| 1 | **Type & value** | Limit type: **Time-limited · Quantity-limited · Time + quantity**; mechanic and value; title AR/EN*, description AR/EN* | At least one limit; guardrail range |
| 2 | **Inventory per branch** | Table: branch × quantity (units), optional "same for all branches"; total shown; pooled inventory is Phase 2 (greyed with "coming soon") | ≥ 1 branch with qty ≥ 1 for quantity-limited; platform max |
| 3 | **Reservation settings** | Reservations **on/off**; **hold time** (default **30 minutes**, adjustable within DealDash limits); **per-customer limit**; no-show note (read-only: "3 missed reservations pause new reservations"); deposit option shown **disabled ("coming soon")** | Hold within min/max; limit ≤ platform max |
| 4 | **Schedule** | Start now / later; for time-limited: duration (30 min … max hours) or exact end; countdown preview | Duration ≤ `hot_deal_max_hours` |
| 5 | **Eligibility, terms & media** | Eligibility (Everyone default / bank card / employer), terms blocks AR/EN, photos 1–5 | Same as Live Deal |
| 6 | **Preview & submit** | AR/EN preview with countdown and stock bar, guardrail result (Exclusive Deals are the first auto-publish candidates), translation status | Both languages; Submit/Launch |

### 8.2 M07: Exclusive Deal detail & live monitor

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Dinner for Two · 40% off   ‹Live›  ⏱ 01:12:40 left          [ Add stock ] [ Pause ] [ ⋯ ]  │
│ ┌──────────────┬──────────────┬─────────┬──────────┐                                     │
│ │ Live monitor │ Reservations │ Results │ Activity │                                     │
│ └──────────────┴──────────────┴─────────┴──────────┘                                     │
│ Stock by branch                                                                           │
│  Olaya        ▓▓▓▓▓▓░░░░  12 left of 20     reserved 5 · redeemed 3 · no-show 0          │
│  Riyadh Park  ▓▓░░░░░░░░   6 left of 20     reserved 9 · redeemed 5                       │
│ Reservations in the next hour: 4 expiring                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

| Aspect | Spec |
|---|---|
| Header | Title, status chip, **live countdown**, primary CTA **Add stock** (while live), Pause, "⋯" (End now, Duplicate P2) |
| Tabs | **Live monitor** (countdown, stock per branch bars, reservations summary, sell-through) · **Reservations** (table below) · **Results** (final stats, no-show rate; after end) · **Activity** |
| Reservations table | Columns: code (masked, last 4), customer first name, qty, branch, status (Reserved / Redeemed / Expired–No-show / Cancelled), time left. Filters: status, branch, search code. Row action: **Cancel reservation** (modal with reason; notifies customer, releases stock) |
| Modals | **Add stock** (branch, +quantity; cannot reduce below reserved/redeemed), Pause, End now (impact: existing reservations remain valid), Cancel reservation |
| Status variants | Live, Paused, Sold out, Ended, Suspended (red, no actions), Under review, Changes requested, Draft |
| Empty | Reservations: "No reservations yet" |
| Errors | Stock conflict ("Stock changed, refresh"), action failure toast |
| Permissions | OWN/ADM/MKT manage; **BRM** can view and cancel reservations for own branches and add stock to own branch (assumption); FIN none |
| Tablet | Branch bars stack; reservations table → cards |

---

## 9. H. VOUCHERS (M08 detail, M12 builder)

### 9.1 M12: Voucher builder, step sequence

| # | Step | Content | Key validations |
|---|---|---|---|
| 1 | **Pricing & face value** | **Face value** (SAR), **selling price** (SAR), auto-calculated saving %, title AR/EN* | Price ≤ face value unless approved; guardrail discount ceiling (high values → review) |
| 2 | **Inventory & limits** | Quantity*, per-customer cap, optional per-day cap; unlimited not allowed | Quantity ≥ 1; large quantity → review |
| 3 | **Validity** | **Days from purchase** or **fixed expiry date**; shows platform minimum; "redeemed in full in one visit" note (partial redemption is Phase 2) | ≥ platform minimum validity |
| 4 | **Branches & terms** | Branches*, terms blocks AR/EN; read-only platform notes: refund-before-redemption rule (window set by DealDash) and expiry handling | Terms mandatory |
| 5 | **Eligibility & media** | Eligibility Everyone (card-restricted vouchers are Phase 2, shown disabled with note); photos 1–5 | – |
| 6 | **Preview & submit** | AR/EN preview, **"what the customer pays / gets"** card, guardrail result, translation status | Both languages; Submit |

### 9.2 M08: Voucher detail

| Aspect | Spec |
|---|---|
| Header | Title, status chip, sale price / face value, **primary CTA** "Pause sales" (or Resume), secondary Add stock, "⋯" (End sale) |
| Tabs | **Overview** (summary, stock bar, sales/redeemed/refunded counters, customer preview, locked-fields note after first sale: price, face value and validity can't change for existing sales) · **Sales & redemptions** (table: order date, quantity, voucher status Active/Redeemed/Expired/Refunded/Voided, redeemed date/branch, refund state; customer first name only; filters: status, date, branch; export) · **Refunds** (refund cases affecting payable: date, reason, amount, state) · **Activity** |
| Modals | Pause sales (reason), Add stock, End sale (impact: sold vouchers remain valid) |
| Status variants | Draft, Under review, Changes requested, On sale, Paused, Sold out, Ended, Suspended (existing vouchers go to the resolution workflow; banner explains) |
| Empty | Sales: "No sales yet" |
| Errors | Cannot lower price/validity after sales (inline note), conflict toast |
| Permissions | OWN/ADM/MKT manage; FIN read-only (Sales and Refunds tabs); BRM none |
| Tablet | Tables → cards |

---

## 10. I. WATCH & EARN (M09 detail, M13 builder)

Watch & Earn is a **separate paid campaign domain**: its own builder, budget, targeting, qualification rules, rewards and analytics. A campaign may **link** to a merchant page, Live Deal, Exclusive Deal, Voucher or product/service; it is never embedded in a deal's lifecycle. The merchant never sets customer reward amounts.

### 10.1 M13: Watch & Earn builder, step sequence

| # | Step | Content | Key validations |
|---|---|---|---|
| 1 | **Video & content** | Upload video (drag-drop; progress; transcoding), thumbnail, campaign title AR/EN*, call-to-action label | Duration/size/format limits; moderation notice ("Videos are reviewed before going live") |
| 2 | **Link target** | Choose what customers can open after watching: Merchant page / Live Deal / Exclusive Deal / Voucher (pick from your campaigns) / Product or service (free text AR/EN) | Linked campaign must be active at launch |
| 3 | **Audience & geography** | Areas of Riyadh (multi-select) or radius around chosen branches, customer groups (everyone / bank-card holders / employees: partner-enabled), interests; no age/gender targeting in MVP | At least one area |
| 4 | **Schedule** | Start and end dates (Riyadh time) | End after start |
| 5 | **Budget & paid views** | Number of **paid qualifying views** and budget (SAR); **cost estimate from DealDash rate card**; remaining budget display; hard cap note: "The campaign stops when your funded views are delivered" | Minimum/maximum per DealDash rules |
| 6 | **Frequency** (optional) | Repeat-view window: DealDash minimum shown; merchant may set **stricter only** | Cannot be looser than platform minimum |
| 7 | **Prizes** (optional) | Prize name AR/EN, quantity, validity, redeemable branches; prizes are redeemed in store via the standard redemption flow | Prize quantity ≥ 1; branches |
| 8 | **Review & fund** | Summary, AR/EN preview of reel and link, moderation + guardrail result, **Fund via payment provider** (PSP payment modal), translation status | Funding required before going live; no reward-amount field exists |

Result states after submit: *Funded & in moderation* · *Funded & scheduled/live (auto-published within guardrails)* · *Changes requested* · *Payment pending/failed* (retry).

### 10.2 M09: Watch & Earn campaign detail

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Lunch reel · Harbour Grill   ‹Live›  Links to: Exclusive Deal "Dinner for Two"   [ Pause ] [ ⋯ ] │
│ ┌─────────┬─────────────┬────────┬──────────────────────────┬──────────┐                 │
│ │ Monitor │ Performance │ Prizes │ Budget & unused balance  │ Activity │                 │
│ └─────────┴─────────────┴────────┴──────────────────────────┴──────────┘                 │
│ Delivery   ▓▓▓▓▓▓░░░░ 620 of 1,000 paid views    Spend SAR 744 of SAR 1,200               │
│ Started views 1,030 · Qualified 620 · Invalid 410 (not billed)   Prizes left 37/50         │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

| Aspect | Spec |
|---|---|
| Header | Title, status chip, link target chip, **primary CTA** Pause/Resume, secondary "Add budget" (opens fund modal), "⋯" (Cancel campaign, Replace video) |
| Tabs | **Monitor** (delivery progress, pace vs schedule, started / qualified / invalid counts with invalid breakdown **by category, no identities**, spend, remaining) · **Performance** (completion rate, CTA clicks, resulting detail views on the linked item, prizes issued; date range; export) · **Prizes** (prize inventory, allocated, redeemed, remaining; add/adjust) · **Budget & unused balance** (funded, consumed, **unused shown separately**, refund/credit treatment status per policy, funding history, receipts) · **Activity** |
| Modals/drawers | **Fund budget (PSP)**, Pause/Cancel (reason, impact), **Replace video drawer** (re-moderation required), Prize adjust |
| Status variants | Draft, Moderation (video review: Processing / In review / Rejected with reason + replace), Funded/Scheduled, Live, Paused, Completed (delivered), Expired (under-delivered), Suspended (fraud/policy, spend reconciled, invalid views credited), Cancelled; **Close-out** variant after end shows unused balance and its status |
| Empty | Performance before delivery: "Results appear once your campaign is live" |
| Errors | Payment failed/pending; moderation rejected (reason + Replace); budget exhausted notice |
| Permissions | OWN/ADM/MKT manage campaigns; **fund budget requires Finance: manage** (Owner, or a user explicitly granted it); users without it see **"Send for funding"** (campaign saved as *Awaiting funding*, Owner/Finance-manage holders notified); Budget tab visible to Owner and Finance-view holders; BRM none |
| Tablet | Tabs scroll horizontally; counters stack |

---

## 11. J. REDEMPTIONS (M14)

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Redemptions                                                         [ Export CSV ]        │
│ ┌─────────┬─────────────┐                                                                │
│ │ History │ Code lookup │                                                                │
│ └─────────┴─────────────┘                                                                │
│ 🔍 Code / item   Type ▾ (Voucher·Reservation·Prize·Controlled deal)  Branch ▾  Date ▾  Result ▾ │
│ ┌──────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ Time        Branch   Type         Item                 Value   Staff     Result    ⋯   │ │
│ │ 10:41 today Olaya    Voucher      Pay 80, get 100      SAR 100 Omar T.   ‹Redeemed› ⋯  │ │
│ │ 10:32 today Park     Reservation  Dinner for Two       –       Lina S.   ‹Redeemed› ⋯  │ │
│ │ 09:58 today Olaya    Voucher      Pay 80, get 100      SAR 100 Omar T.   ‹Reversed› ⋯  │ │
│ └──────────────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

| Aspect | Spec |
|---|---|
| Tabs | **History** (table) · **Code lookup** (single input: enter a code → shows status card: instrument, item, validity, branches, current state; read-only; used by managers to answer customer questions) |
| Header/CTA | Title; **primary CTA** Export CSV (permissioned); no redeem action here (redemption happens in the Staff app) |
| Columns | Time, branch, instrument type, item/offer, value, staff member, result (Redeemed / Reversed) |
| Filters/search | Code or item search; type; branch (BRM auto-limited); date range; result |
| Row click | **Redemption drawer:** instrument details, customer first name only, staff, device, timestamps, audit trail, linked order/reservation reference |
| **Reverse action** (in drawer) | Visible to **OWN, ADM, BRM** (BRM own branches) within the configurable window (shows "Reversible for 02:14:30 more"). Opens **Reverse modal**: reason (select + note, mandatory), consequence summary ("The voucher/reservation returns to Active if still valid; the merchant amount returns to held"), Confirm. Every reversal is fully audit-logged. **Frontline staff cannot reverse.** Window expired → action hidden with "Contact DealDash support" |
| Status chips | Redeemed, Reversed |
| Empty | "No redemptions yet. They appear here when staff redeem codes" |
| Errors | Reverse not allowed (window closed / already reversed), lookup "code not found" |
| Permissions | OWN/ADM full; BRM own branches; FIN read-only (no drawer actions); MKT none |
| Tablet | Table → cards; drawer → sheet |
| Phase 2 | Reversal-request queue tab (staff-initiated requests) |

---

## 12. K. ANALYTICS / INSIGHTS (M15)

| Aspect | Spec |
|---|---|
| Layout | Header with **date range** (7/30/90 days, custom), **branch** filter, export; tabs; each tab = metric cards on top, charts below, breakdown table at the bottom |
| Tabs | **Overview · Live Deals · Exclusive Deals · Vouchers · Watch & Earn** |
| Overview | Cross-product cards: Live signals (impressions, detail views, directions clicks), Reservations, Voucher sales/redemptions, Qualified views; trend chart; top campaigns table |
| Live Deals | Funnel chart **impressions → detail views → saves → directions clicks → merchant page visits**; by branch and by day; **caption on every chart: "Discovery signals. They do not prove visits or sales."**; **no merchant sales revenue is shown or implied** (clarification F-2) |
| Exclusive Deals | Reservations and **confirmed redemptions** (what DealDash can measure), no-show rate, sell-through, time to sell out, per-branch stock use |
| Vouchers | **Actual voucher sales and revenue** (DealDash can measure these): units sold, redemptions, expiry rate, refund rate, remaining stock for all campaign roles; **SAR revenue amounts shown to the Owner and Finance-view holders** (clarification F-2) |
| Watch & Earn | **Campaign spend, qualifying views**, engagement and related campaign performance (delivered paid views, qualification rate, invalid share by category (no identities), completion, CTA clicks and resulting detail views on the linked item, spend and remaining budget, prize issue |
| Filters | Date, branch, campaign multi-select |
| Primary CTA | Export (CSV) |
| Secondary | Compare to previous period toggle, chart/table toggle |
| Empty | "No data for this period" with suggestion to widen the range; new merchant: "Insights appear after your first campaign goes live" |
| Errors | Chart load failure with retry; export failure toast |
| Permissions | OWN/ADM/MKT all (SAR revenue values only with Finance: view or Owner); BRM own branches (Overview, Live, Hot, Vouchers units only
| Tablet | Cards 2-column; charts full width; breakdown tables scroll |

---

## 13. L. SETTLEMENTS and M. BILLING / CAMPAIGN SPEND (M18 Finance, M19 Statement detail)

### 13.1 M18: Finance hub

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Finance                                                                                    │
│ ┌────────────┬─────────┬────────────────┬──────────┬──────────────┐                       │
│ │ Statements │ Payouts │ Campaign spend │ Invoices │ Bank details │                       │
│ └────────────┴─────────┴────────────────┴──────────┴──────────────┘                       │
│ ┌ Settlement-eligible ┐ ┌ Held (not yet eligible) ┐ ┌ Next payout ┐ ┌ Carried forward ┐    │
│ │ SAR 9,100           │ │ SAR 2,300               │ │ SAR 8,420   │ │ –SAR 0          │    │
│ └─────────────────────┘ └─────────────────────────┘ └─────────────┘ └─────────────────┘    │
│ Statements table …                                                                         │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

| Tab | Content |
|---|---|
| **Statements (settlements)** | Table: period, gross redemptions, platform fees, refunds, adjustments, **net payable**, status (Draft / Issued / Paid / Disputed). Row opens **M19**. Top cards: settlement-eligible, held, next payout, **carried-forward negative balance** (amber if present) |
| **Payouts** | Table: payout date, amount, bank account (masked IBAN), status (Pending / Paid / Failed / Returned), statement reference. Failed/returned shows reason and "Contact support" |
| **Campaign spend** | Watch & Earn ledger view: per campaign **funded / consumed / unused** (unused shown separately), funding payments with receipts, refund/credit status for unused balance per policy |
| **Invoices** | Tax invoices and campaign receipts: number, date, type, amount, download. Format pending VALIDATE-KSA |
| **Bank details** | IBAN (masked), account holder, bank, status; **Request change** (OWN only) opens modal (new IBAN, holder name, document) and warns "Review and a payout hold apply until verified" |

| Aspect | Spec |
|---|---|
| Header/CTA | Title; **primary CTA** per tab: Download statements (Statements), none (Payouts), Fund campaign (Campaign spend, opens W&E picker), Download (Invoices), Request change (Bank details) |
| Filters | Date/period, status; invoice type |
| Modals | Dispute statement (reason + attachments, from M19), Bank change request, Fund budget (PSP) |
| Status chips | Money vocabulary (0.4) |
| Banners | **Payout hold** (amber): "Payouts are on hold while we verify your bank details" |
| Empty | "No statements yet. Your first statement appears after your first settlement" |
| Errors | Dispute window closed; bank change pending; load failures |
| Permissions | **Owner and users explicitly granted Finance: view (read) or Finance: manage (disputes, funding, exports, bank-change request for Owner only)**. Admin has no finance access by default; the Finance sidebar item is hidden when the user has neither permission. Read-only and manage are separately grantable |
| Tablet | Cards 2×2; tables → cards |
| Rules | Exact settlement timing/economics are configuration (not hard-coded); amounts shown in SAR; VAT fields placeholders until validation |

### 13.2 M19: Statement detail

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ ← Finance › Statements      Statement 1–15 Oct       ‹Issued›     [ Download PDF ] [ Dispute ] │
│ Net payable SAR 8,420                                                                       │
│ ┌ Summary ──────────────────────────────┐  ┌ Carried forward ─────────┐                    │
│ │ Settlement-eligible   SAR 10,100      │  │ Previous negative SAR 0   │                    │
│ │ Platform fees         – SAR 1,010     │  └───────────────────────────┘                    │
│ │ Refunds / reversals   – SAR 520       │                                                   │
│ │ Adjustments           – SAR 150       │                                                   │
│ │ Net payable             SAR 8,420     │                                                   │
│ └───────────────────────────────────────┘                                                   │
│ Lines: Date · Type (Redemption / Refund / Reversal / Fee / Adjustment) · Reference · Amount │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

| Aspect | Spec |
|---|---|
| Sections | Header summary, calculation card, carried-forward card, **lines table** (date, type, reference such as voucher/order id, branch, amount, tax fields), notes |
| Primary CTA | Download PDF |
| Secondary | Dispute (modal), Export lines (CSV) |
| Status variants | Draft (preview only), Issued, Paid (payout reference), **Disputed** (case link and status banner), Adjusted |
| Filters/search | Lines: type, branch, search reference |
| Errors | Statement not found, dispute window closed |
| Permissions | OWN/FIN |
| Tablet | Summary cards stack; lines table scrolls |

---

## 14. N. NOTIFICATIONS

Not a separate page: a **drawer** from the bell plus preferences in Settings.

| Aspect | Spec |
|---|---|
| Drawer layout | Right drawer (420): title "Notifications", tabs **All · Needs action**, list grouped by day, "Mark all read", gear link to Settings → Notifications |
| Item | Icon by type, title, one-line detail, time, unread dot; click deep-links to the related record |
| Types | Application decisions, campaign approved / rejected / changes requested / auto-published / paused / suspended, stock low / sold out, reservations (new/cancelled), voucher sold out / low stock, W&E budget low / completed / moderation result, settlement ready / payout paid / failed, support updates, team invitations, translation help status |
| Empty | "You're all caught up" |
| Errors | Load failure with retry |
| Permissions | Items filtered by role (e.g. payout items only for OWN/FIN) |
| Tablet/phone | Full-width sheet |
| Preferences | See Settings (section 16): per type and channel (in-app always on for critical; email optional); transactional items cannot be turned off |

---

## 15. O. SUPPORT (M20)

| Aspect | Spec |
|---|---|
| Tabs | **Help centre** (search + category cards: Campaigns, Redemptions, Settlements, Account & team; article list; AR/EN) · **My cases** (table: case ID, subject, category, status, last update; row opens **case drawer**) |
| Primary CTA | **Create case** (modal) |
| Create-case modal | Category (Campaign, Settlement, Redemption dispute, Technical, Review/report, Account), related object picker (campaign / redemption / statement), subject, message, attachments; response-time note |
| Case drawer | Status chip (New / In progress / Waiting on you / Resolved / Closed), message thread, attachments, "Reopen" within window |
| Filters/search | Status, category, search subject |
| Empty | Help: n/a; My cases: "No cases yet. Contact us any time" |
| Errors | Attachment too large/unsupported; submit failure keeps the draft |
| Permissions | All roles (cases visible to the creator and OWN/ADM; FIN sees finance cases) |
| Tablet/phone | Drawer → full sheet; supported on phone |

---

## 16. P. SETTINGS (M21)

| Tab | Content |
|---|---|
| **Account** | Name, email, mobile (change requires OTP), password, role (read-only), merchant (read-only) |
| **Language & region** | Interface language (AR/EN), date format (Gregorian default; Hijri option pending UXF-12), time zone fixed to Riyadh |
| **Notifications** | Matrix: notification type × channel (In-app, Email); critical ones locked on |
| **Security** | Change password, MFA (recommended for OWN and FIN; MFA-ready), active sessions with "Sign out all", recent sign-in activity |

| Aspect | Spec |
|---|---|
| Primary CTA | Save changes (per tab) |
| Secondary | Cancel, Sign out all sessions |
| Modals | Change mobile (OTP), enrol MFA, confirm sign-out all |
| Errors | Weak password, OTP wrong, session expired |
| Permissions | All roles, own account only; merchant-level settings are in Business |
| Tablet/phone | Tabs → segmented list; single column |

---

## 17. CROSS-CUTTING SPECIFICATIONS

### 17.1 Approval and status states (where they appear)

| State | Where shown | Behaviour |
|---|---|---|
| Application: in review / changes requested / rejected / approved / suspended | M03; banner site-wide when suspended | Changes requested deep-links into M02 steps |
| Campaign: under review | Hub chip, detail banner (read-only), dashboard Needs attention | Locked until decision |
| Campaign: changes requested | Amber chip and banner with reviewer notes; **Fix & resubmit** | Opens the builder at the flagged step |
| Campaign: auto-published | Builder result "Your campaign is live" | Based on guardrails (pre-approved rules) |
| Campaign: suspended | Red chip and banner (reason, contact support) | No merchant resume |
| W&E video: processing / in review / rejected | M09 Monitor + builder step 1 | Replace video drawer |
| Translation: missing AR/EN | Builder header chip, hub/dashboard attention, campaign detail banner | Publish blocked until both exist; "Ask DealDash to help translate" |

### 17.2 Error catalogue

| Error | Presentation |
|---|---|
| Field validation | Inline under field, red text + icon |
| Step validation | Footer summary "N items need attention"; Next disabled |
| Guardrail violation | Guardrail panel message (amber for review-needed, red for blocked) |
| Conflict (stock changed, edited elsewhere) | Modal "This changed while you were editing" with Reload / Keep mine |
| Permission (403) | Full-page "You don't have access to this" with link home; hidden nav prevents most cases |
| Not found (404) | Full-page with search and home links |
| Server (500) | Full-page apology with retry and support link |
| Offline / network | Top banner "You're offline"; actions disabled; drafts keep local copy |
| Session expired | Modal to sign in again, returns to same page |
| Payment failed/pending (W&E funding) | Modal state with retry and receipt link |

### 17.3 Empty and loading states

| Screen | Empty state |
|---|---|
| Dashboard (new) | Get-started checklist |
| Campaigns tabs | Per-product message + Create button |
| Redemptions | "No redemptions yet" |
| Insights | "Insights appear after your first campaign goes live" |
| Team | "Only you so far" |
| Finance | "No statements yet" |
| Support cases | "No cases yet" |
| Notifications | "You're all caught up" |

Loading: skeleton cards/tables (never spinners over blank pages); drawers show a header skeleton; builders show stepper then form skeleton.

### 17.4 Bilingual and RTL

| Topic | Spec |
|---|---|
| Fields | Customer-facing merchant fields always AR | EN side by side (desktop) with completeness chips; publish blocked until both exist |
| Translation help | Header link on builders and profile: "Ask DealDash to help translate"; status chip Help requested → Complete |
| RTL | Full mirror (sidebar right, breadcrumbs, steppers, drawers open from the left); numerals/currency "SAR" as LTR islands; charts keep time left→right |
| Typography | IBM Plex Sans Arabic for Arabic text; larger line height |
| Previews | Builder preview panel shows both languages |

### 17.5 Accessibility and quality

Keyboard navigable tables, drawers and modals; focus return on close; colour never the only status signal (icon + text); minimum contrast per tokens; 44-px touch targets on tablet; all destructive actions confirmable and reversible where possible.

---

## 18. SUMMARY OUTPUTS

### 18.1 Final Merchant Portal navigation

| Sidebar item | Pages inside |
|---|---|
| Home | M04 Dashboard |
| Campaigns | M05 hub (tabs Live Deals · Exclusive Deals · Vouchers · Watch & Earn) → detail pages M06 / M07 / M08 / M09 → builders M10 / M11 / M12 / M13 |
| Redemptions | M14 (tabs History · Code lookup) |
| Insights | M15 (tabs Overview · Live · Hot · Vouchers · Watch & Earn) |
| Business | M16 (tabs Profile & branding · Branches · Documents & agreement); child link **Team & roles** → M17 |
| Finance | M18 (tabs Statements · Payouts · Campaign spend · Invoices · Bank details) → M19 |
| Support | M20 (tabs Help centre · My cases) |
| Settings | M21 (tabs Account · Language & region · Notifications · Security) |
| Outside the sidebar | M01 Sign in/registration, M02 Onboarding wizard, M03 Application status, Notification drawer |

### 18.2 Final core screen count

**21 core screens:** M01 Sign in & registration · M02 Onboarding wizard · M03 Application status · M04 Dashboard · M05 Campaigns hub · M06 Live Deal detail · M07 Exclusive Deal detail & monitor · M08 Voucher detail · M09 Watch & Earn detail · M10 Live Deal builder · M11 Exclusive Deal builder · M12 Voucher builder · M13 Watch & Earn builder · M14 Redemptions · M15 Insights · M16 Business profile · M17 Team & roles · M18 Finance · M19 Statement detail · M20 Support · M21 Settings.
Overlays specified: notification drawer, branch drawer, user drawer, redemption drawer, case drawer, invite modal, reverse modal, add-stock modal, pause/cancel/end modals, fund-budget (PSP) modal, bank-change modal, dispute modal, create-case modal, translation-help panel, result modals (≈ 26).

### 18.3 Campaign creation flows (step sequences)

| Builder | Steps |
|---|---|
| **Live Deal (M10), 6** | 1 Basics → 2 Branches & schedule → 3 Eligibility & terms → 4 Media → 5 Controlled redemption (optional, off by default) → 6 Preview & submit |
| **Exclusive Deal (M11), 6** | 1 Type & value (time / quantity / both) → 2 Inventory per branch → 3 Reservation settings (hold 30 min default, per-customer limit; deposit disabled) → 4 Schedule → 5 Eligibility, terms & media → 6 Preview & submit |
| **Voucher (M12), 6** | 1 Pricing & face value → 2 Inventory & limits → 3 Validity → 4 Branches & terms → 5 Eligibility & media → 6 Preview & submit |
| **Watch & Earn (M13), 8** | 1 Video & content → 2 Link target → 3 Audience & geography → 4 Schedule → 5 Budget & paid views → 6 Frequency (optional, stricter-only) → 7 Prizes (optional) → 8 Review & fund (PSP) |
| Common | Autosaved drafts, AR | EN fields, live customer preview, guardrail panel (auto-publish vs review), translation gate, result states (published / sent for review / changes requested), "Promote with Watch & Earn" link after a deal is submitted |

### 18.4 Onboarding flow

M01 Register (email code → mobile OTP) → M02 wizard (1 Business details, 2 Documents, 3 Authorised representative, 4 Category & branding, 5 Branches & hours, 6 Settlement/IBAN, 7 Agreement e-sign, 8 Review & submit) → M03 Application status (In review → [Enhanced review] → Changes requested ↔ Resubmit → Approved → Agreement → Activated → Dashboard; or Rejected → Appeal; or Suspended). Post-activation checklist on the dashboard: add branches/staff, create first campaign.

### 18.5 UX decisions still requiring founder approval

None of these blocks visual design; each has a default used in this spec.

| # | Item | Default used |
|---|---|---|
| WD-01 | **"Merchant Manager" mapping** for redemption reversal | Owner, Admin and Branch Manager (BRM own branches) |
| WD-02 | Can BRM add stock and cancel reservations for own branch | Yes, own branch only |
| WD-03 | Can Finance fund Watch & Earn budgets | **Decided (F-1):** anyone with Finance: manage (and the Owner); others use "Send for funding" |
| WD-04 | Phone-sized Merchant Portal scope | Read-only monitoring, Redemptions lookup, Support, Notifications; builders usable but "best on larger screens" |
| WD-05 | Do merchants edit translations themselves or only DealDash ops on request | Merchants edit; ops can assist on request |
| WD-06 | Show customer first name in reservation/redemption/sales tables | First name only (RS-14 configurable) |
| WD-07 | Who sees finance | **Decided (F-1):** Owner plus explicitly permissioned users; Finance view and manage separable; Admin not automatic |
| WD-08 | Revenue figures in Insights | **Decided (F-2):** only DealDash-measurable revenue (voucher sales); no unverified merchant revenue anywhere; open sub-question WD-10 below |
| WD-09 | Hijri date option | Deferred (UXF-12) |
| WD-10 | Voucher **unit counts** visible to all campaign roles, **SAR revenue values** only to Owner and Finance-view holders | Default used (confirm) |

### 18.6 Readiness for visual UI design

**Yes**, with these notes:
- The structure, content, states, permissions and flows of all 21 core screens are specified; no business rule or control was dropped.
- Before high-fidelity design: confirm WD-01 to WD-09 (or accept defaults), choose the chart style from the token palette, and design the four dense **adaptive** pieces first as component studies: the **builder shell** (stepper + preview + guardrail panel), the **detail-page tab pattern**, the **data table with drawer**, and the **status chip/banner set**.
- Known dependencies carried from earlier stages (not blockers): exact Saudi document list for onboarding, VAT/invoice format, refund window wording and PSP funding modal, which are placeholders marked VALIDATE-KSA.

*End of Merchant Portal wireframe specification v0.1. No application code written. Partner Portal, Admin Portal and Staff app wireframes are not started.*
