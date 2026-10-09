# DEALDASH PARTNER PORTAL: HI-FI BATCH 01

Version 0.2 · 2026-10-07 (approved; D-P1..D-P3 applied to the mockup) · Mockup: `docs/mockups/partner-hifi-batch-01.html` (static, design review only; use the top bar to switch page, partner type, role, RTL; builder has a "Very small audience" toggle; campaign detail has a status preview row).
Direct URL hash form: `#page:type:role[:rtl[:status[:1]]]`, e.g. `#camp:employer:pad:rtl:live`.

Note on numbering: the brief calls the rule builder P06 and the proposal detail P07; the approved wireframes numbering is P08 (builder), P05 (detail), P07 (type module). This batch follows the **wireframe numbering** and lists the mapping below.

| Brief | Wireframe ID | Screen |
|---|---|---|
| Shell | all | Shared shell and type-aware navigation |
| P03 | P03 | Dashboard |
| "P06" | **P08** | Eligibility Rule Builder |
| P10 | P10 | Reports with suppression |
| "P07" | **P05** | Campaign Proposal Detail (three variants) |

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

## 1. Shared shell
Built: sidebar, organisation card with type chip, type-aware item (Cards / Issuers / Employee verification), counts on Campaigns, Settings and user card in footer, top bar with status chip, bell and language switch. Role switcher hides items per role. RTL mirrors all of it.

## 2. Dashboard (P03)
Built for all three types (wording changes: "Cardholders matched" / "Network cardholders matched" / "Verified employees"; attention items differ: card wording, issuer response, domain proof, reverification). Finance and campaign roles see the Budget card; others do not. Privacy line, KPI grid, campaigns list with status chips, trend, attention list, reports available.

## 3. Eligibility Rule Builder (P08)
Built for all three types with visual IF / AND / THEN blocks, fixed organisation block, value pills, live plain-words summary, reach estimate with suppressed state, customer preview with honest card wording, checks with overlap, DealDash review footer. View-only roles see a banner and no controls. Type differences are content only.

## 4. Reports (P10)
Built: tabs, filters, privacy line, KPIs, campaign funnel, area bars with hidden row (hatched), segment table with suppressed row ("Not shown to protect customer privacy"), export modal (aggregates only, Partner Admin and Analyst only). Segment label changes per type.

## 5. Campaign Proposal Detail (P05)
Built: header, prominent DealDash review banner, review progress, status preview row (Draft to Rejected), seven tabs, edit-lock behaviour (Draft and Needs changes editable; approved / scheduled / live locked with "Request a change"; Submitted offers Withdraw), three variants in Eligibility, Content (AR/EN), Merchants, Budget (role-gated), Performance (suppression), Activity (partner-visible only).

## 6. QA performed (headless browser screenshots)
Dashboard (Bank, EN and RTL), builder (Bank EN and RTL, Employer EN), reports (Scheme analyst EN, Bank RTL with suppression), campaign detail (Bank Needs changes EN, Employer Live RTL). Verified: no gradients except image placeholders, no horizontal scroll at 1440px, RTL connector and panel mirroring, bidi isolation of numbers and dates.
**Defect found and fixed:** role switcher label read "Partner" instead of "Partner Admin".
**Known and accepted:** English sentences inside RTL show trailing-punctuation drift until Arabic copy exists; tablet layout not tested.

## 7. Not in this batch
P01, P02, P04, P06, P07 (type modules), P09, P11, P12, P13, P14 and notification drawer.

*No production code written; mockup is a design artefact.*

## 8. Update (v0.2): Batch 02
All remaining MVP pages are specified in `DEALDASH_PARTNER_PORTAL_VISUAL_DESIGN.md` section 13 and `docs/mockups/partner-hifi-batch-02.html`. QA results are in `DEALDASH_PARTNER_PORTAL_VISUAL_QA.md`. Batch 01 mockup now shows ranged reach, "Other / suppressed" with no totals, and the full change-request form.