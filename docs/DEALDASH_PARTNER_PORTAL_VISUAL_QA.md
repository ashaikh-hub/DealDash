# DEALDASH PARTNER PORTAL: VISUAL QA

Version 0.1 · 2026-10-07
Scope: Batch 01 (shell, P03, P08, P10, P05) and Batch 02 (all remaining MVP pages) of the Partner Portal.
Method: headless-browser screenshots at 1440 px of `docs/mockups/partner-hifi-batch-01.html` and `partner-hifi-batch-02.html` (static design-review mockups, not production code), reviewed visually. Shared components were corrected first, then every page that uses them was re-rendered.

> **Partner Portal status (approved):** structurally and visually **frozen for MVP**. FDP-02 to FDP-11 remain configurable / default-driven decisions unless later specifically approved; none blocks MVP architecture or development. Remaining VALIDATE-KSA items stay open for external validation. Partner Portal QA items (tablet, keyboard/screen-reader, real-data, native Arabic, contrast, unchecked drawers/modals and RTL pages) may be completed later and do not block the next stage.

## 1. Decisions applied before QA
- **D-P1** merged-remainder suppression, **D-P2** rounded or ranged reach, **D-P3** "Request a change" for approved and live campaigns (see Wireframes v0.3 and Visual Design v0.2).
- Cohort threshold stays the configurable pilot setting of **10 customers**. It is a product control, not a legal conclusion. **VK-12 remains open.**

## 2. Required scenarios

| # | Scenario | Where checked | Result |
|---|---|---|---|
| 1 | Bank account | Dashboard, builder, Cards, campaigns, org (Riyad Bank) | Pass |
| 2 | Scheme account | Dashboard, Issuers, reports (Visa), merchants | Pass after fixes (type chip, number format) |
| 3 | Employer account | Builder, Email domains, onboarding step 5, activation | Pass |
| 4 | Arabic / RTL | Dashboard, builder, reports, campaign detail (Batch 01); Employer Email domains and Employer rule builder (Batch 02) | Pass. Shell, tabs, tables, connectors and panels mirror. English strings inside RTL show punctuation drift until Arabic copy exists |
| 5 | Small-cohort suppressed report | Reports (Batch 01 and scheme in Batch 02): hatched "Other / suppressed" bar, dashed suppressed rows, "Total not shown because a related group is hidden", counts instead of percentages | Pass after D-P1 |
| 6 | Large data table | Organization → Activity history (12 rows with pagination, 86 total), campaign list | Pass: fixed columns, long object names truncate with ellipsis, LTR dates |
| 7 | Eligibility rule conflict | Rule builder with "Show conflict": red conflict banner with actions, Submit disabled; Eligibility list row "Needs changes" | Pass after encoding fix |
| 8 | Campaign needing changes | Campaign detail (Needs changes): amber review banner, reviewer note, editable, Submit available | Pass |
| 9 | Approved change request | Change request CR-014 in four states (in review, clarification, approved, rejected) with before and after, timeline and reason | Pass |
| 10 | Restricted role | Read-only and Finance viewer: no edit, propose, export, users or organisation actions; Users page shows the no-access state naming the current role; Budget hidden for roles without access | Pass after fix |

## 3. Material issues found and corrected

| # | Issue | Severity | Fix |
|---|---|---|---|
| 1 | **Table headers rendered as single letters** in every Batch 02 table (shared table-header helper treated a text label as an array) | High (shared component) | Helper normalised; all tables re-rendered |
| 2 | **No-access page named the wrong role** (role read once at load) | Medium | Message built at render time |
| 3 | **Hidden values could be inferred**: area percentages summing to less than 100 and a visible total beside a suppressed row | High (privacy pattern) | Merged "Other / suppressed" group, counts without totals, "Total not shown…" row (D-P1) |
| 4 | **Exact reach counts** (12,400; 86,200; 3,420) | Medium | Ranges (e.g. 12,000–12,500) per D-P2 |
| 5 | **Conflict banner text corrupted** (curly quotes and dashes mis-encoded when assembled) | Medium | Build script re-encoded; no corrupted characters remain in the file |
| 6 | **Proposal stepper wrapped to two lines** | Low | Compact step style |
| 7 | **Scheme type chip wrapped to two lines** in the organisation card | Low | Short chip label (Bank, Card scheme, Employer) |
| 8 | **Large numbers without separators** in the segment table (e.g. 2933) | Low | Thousand separators applied |
| 9 | **Role switcher label** read "Partner" instead of "Partner Admin" (Batch 01) | Low | Corrected |
| 10 | **Change-request form lacked required fields** | Medium | Form now captures requested change, reason, affected fields, supporting information, submitter and timestamp (D-P3) |

No issue required a new component or a second visual language.

## 4. Checks that passed without change
- No gradients except image placeholders; purple used only for actions and selection.
- One shell for all three types; type-specific items appear only for the matching type.
- Permission-aware hiding (not greyed) for Users, Organization, Eligibility edit, export and budget.
- Identifier, date and amount isolation in RTL.
- Customer-facing card wording never says "verified"; honest disclaimer present in previews.
- No customer-level personal data on any page; no employee names or emails; no card numbers.

## 5. Not verified in this pass (honest limits)
- Drawers and modals (notifications, product, merchant, case; invite, add domain, data-sharing, user, role, new case) are built in the mockup but were **not individually screenshot-checked**; they reuse the approved drawer and modal patterns.
- Several Batch 02 pages were not screenshot-checked in RTL (Users, Support, Settings, Onboarding); they use the same components that passed in RTL elsewhere.
- Tablet layouts, keyboard and screen-reader behaviour, real-data stress, native Arabic copy review and final contrast verification in Figma remain **QA and validation items** that do not block freezing (same treatment as Admin).

## 6. Freeze recommendation
Structurally and visually ready to freeze for MVP, subject to the open founder decisions and VALIDATE-KSA items listed in the Partner documents. QA items in section 5 do not block the next stage.
