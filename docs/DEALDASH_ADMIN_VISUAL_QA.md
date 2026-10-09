# DEALDASH ADMIN PORTAL: VISUAL QA REPORT

Date: 2026-10-07 · Scope: Admin Hi-fi Batch 01 (7 experiences) before propagation to the remaining pages.
Method: each item below was opened in a browser (Microsoft Edge, headless render at 1440 px, English and RTL) and inspected in the rendered output. Where a defect was found the **shared component or pattern** was corrected, then re-rendered. Limits: desktop only; real long data sets, real devices, keyboard and screen-reader behaviour, and a native Arabic reading were **not** tested.

## 1. What was inspected

| Screen / state | Rendered as | Result |
|---|---|---|
| Campaign Review Workbench | Operations, Exclusive Deal (adaptive) | Pass after table-width fix |
| Customer Detail | Support; **Reveal modal** open | Pass |
| Merchant Application Workbench | Merchant Mgmt; **evidence drawer** open | Pass |
| Refund Workbench | Finance (checker), Support (maker, restricted) | Pass |
| Risk / Fraud Workbench | Risk, **RTL** | Pass after identifier-isolation and high-impact fixes |
| Settlement / Finance Detail | Finance; Support (no-access) | Pass after flattening the summary card |
| Components sheet | LTR and RTL, with a **QA stress test** (14-row dense table, long Arabic strings) | Pass after truncation fix |

## 2. Shared-pattern verification

| Pattern | Verified | Notes |
|---|---|---|
| Workbench layout (header · rail · main · decision panel · audit strip) | ✓ | Consistent across Merchant application, Campaign review, Refund, Risk, Settlement. Rail absent on Customer detail (tabs) by design |
| Decision panel | ✓ | Sticky; blockers banner; consequence notes; reason field. Became view-only per permission |
| Audit/activity strip | ✓ | Horizontal strip plus vertical timeline both legible; times stay LTR |
| Dense operational table | ✓ | 14 rows at 40-px density; mono IDs; truncation with full text on hover |
| Status chips | ✓ | Shared vocabulary plus Admin-specific chips; every status has a word and icon |
| Maker/checker states | ✓ | Maker sees "cannot approve"; checker sees "You are the checker" |
| Confirmation modals | ✓ | Reveal, Suspend, Block, Reject, Pause: reason, consequence, audit note |
| Drawers | ✓ | Evidence viewer opens over the workbench; closes with Esc / scrim |
| Evidence/document viewer | ✓ | Logs viewing; accept/reject only for permitted roles |
| Permission-aware actions | ✓ | See section 3 |

## 3. Specific tests

| Test | How | Outcome |
|---|---|---|
| **One dense data table** | Components sheet stress table (14 rows, long names, mono IDs, status chips, amounts, times) in LTR and RTL | Readable; **issue 3 fixed** (long text overflow, wrong truncation side) |
| **One long Arabic/RTL string** | Two ~100-character Arabic merchant/note strings in table cells | Truncates with ellipsis, full text on hover; **issue 3 fixed** |
| **One decision panel in RTL** | Risk workbench, RTL | Panel moves to the start side; icons and hints mirror; **issue 1 and 2 fixed** |
| **One maker/checker workflow** | Refund workbench as Support (maker) and as Finance (checker) | Correct: maker blocked with explanation, checker offered Approve |
| **One permission-restricted action** | Merchant application as Operations (view-only) and Settlement as Support (no-access page) | Decision area replaced by a view-only note; page replaced by named-role no-access state |
| **One sensitive-data reveal workflow** | Customer detail, Reveal modal | Reason required, 5-minute visibility, audit note |
| **One modal** | Reveal, Block, Reject, Suspend | Consistent structure; destructive confirm solid red only inside the modal |
| **One drawer** | Evidence viewer | Consistent; sticky footer actions permissioned |

## 4. Confirmations

| Question | Finding |
|---|---|
| No generic enterprise/admin-template look | **Confirmed.** Rounded cards, lilac active pill, pill chips, tinted statuses, decision panel and lavender background remain DealDash. Dense tables are the only enterprise-like element and they use the brand's chips and spacing. A watchpoint: very long tables can drift toward a template look; keep the queue cards and workbench rhythm on list pages |
| No excessive purple | **Confirmed.** Purple appears on one primary action per area, the active nav pill, links and chips such as "Pending review". Navy carries counts and emphasis |
| No excessive gradients | **Corrected.** The Settlement summary used a soft gradient; it is now a flat lilac surface. No gradients remain in Admin |
| Hierarchy remains clear | **Confirmed.** Queue counts and workbench header facts lead; decision panel is the second focal point; audit strip is quiet |
| High-risk actions visually distinct | **Weak at first; corrected** (issue 2) |
| Hidden/permissioned areas behave correctly | **Confirmed** for navigation, queue cards, KPI sub-values, tabs, buttons and whole pages across Support, Merchant Management, Operations, Finance, Risk and Super Admin |
| Arabic/RTL remains usable | **Confirmed with fixes** (issues 1 and 3). Shell, tables, decision panels, drawers and charts mirror; operational IDs, times and amounts stay left-to-right |
| Operational IDs/timestamps remain readable | **Corrected** (issue 1) |

## 5. Issues found and corrected (shared fixes, not page patches)

| # | Issue | Where it showed | Shared correction |
|---|---|---|---|
| 1 | In RTL, identifiers inside sentences reordered (`CU-198402 · Omar T.` became `.CU-198402 · Omar T`; "SLA 3 h" jumbled) | Risk case header and key-values | **Identifier isolation rule:** every ID, reference, amount, date and time is rendered as a left-to-right isolate (`bdi`/`.id`/`.ltr`) in all text; applied by a shared utility, not per page |
| 2 | **High-risk actions not distinct enough**: Reject, Suspend, Block, Void and Cancel looked like other secondary buttons | All decision panels | **High-impact group:** a labelled divider "High-impact · audited", red-tinted background and 1.5-px rose border on Reject/Suspend/Block/Void/Cancel; solid red appears only in the confirmation modal. Applied to every decision panel automatically |
| 3 | Dense table: long Arabic and English text overflowed or truncated at the wrong end; guardrail columns wrapped awkwardly | Components stress table; campaign guardrails | **Table rules:** fixed layout for dense tables, defined column widths, ellipsis truncation with title tooltip, per-cell text direction (`unicode-bidi: plaintext`) so each cell truncates at its own end |
| 4 | Settlement summary used a gradient | Settlement detail | Replaced by a flat lilac surface; "no gradients in Admin" recorded as a rule |
| 5 | A CSS class name collision made the amber "Request changes" button render its label at the wrong edge | Decision panels | Renamed the button variant so it no longer collides with the card-header class; verified on every panel |
| 6 | Duplicate role chip on the dashboard header | Dashboard | Removed (role shows in the top bar once) |
| 7 | Stray decorative square beside the High-impact label | Decision panels | Removed |
| 8 | Role switcher labels ambiguous ("Customer" for Support) in the review bar | Mockup only | Relabelled |

## 6. Open QA items (not blocking)
- Real data volumes, pagination, sticky headers under scroll, and performance.
- Keyboard-only and screen-reader pass; focus return from drawers and modals.
- Native Arabic proofreading; the Arabic labels in the mockup are illustrative.
- Tablet layouts (specified, not drawn).
- Print/export views.
- Contrast re-verification in design tooling (values were computed, not tool-verified).

*End of Admin visual QA report.*

> **Admin Portal status (approved):** structurally and visually **frozen for MVP**. The following remaining items are **QA / validation only** and do **not** block the next portal: tablet QA; keyboard and screen-reader QA; real-data stress testing; native Arabic review; final contrast verification in Figma; remaining VALIDATE-KSA items.
