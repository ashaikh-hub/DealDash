# Stage 7 — Partner Portal Figma handoff

The build is the reference (`apps/partner/features/*`, admin `apps/admin/features/partners.tsx`, merchant
`apps/merchant/features/partner-benefits.tsx`, customer `apps/customer/features/screens.tsx` → `PartnerBenefits`). Components are the
shared `@dealdash/ui` set (Card, KeyValue, StatusChip, Alert, Tabs, Field / Input / Select / Checkbox / Textarea, tables,
EmptyState, LoadingState) and shared app-shell workspaces (CommercialPanel, BillingWorkspace, OperationsWorkspace, LoyaltyWorkspace,
AiAssistantPanel, PreferencesPanel, PlanUsageWorkspace, IntegrationsPanel). Copy: `packages/localization/src/dictionaries.partners.ts`
(English + working Arabic; native review required). Screenshots: `docs/screenshots/stage7/` from `tooling/e2e/stage7-browser.mjs`.

Visual direction (existing DealDash system): white / light lavender surfaces, deep navy text, DealDash purple accents, rounded cards,
restrained shadows, strong hierarchy, desktop-first enterprise layout, responsive down to 390 px, Arabic right-to-left with Western
digits. Data-rich but restrained: never a consumer discount look.

## States every frame shows
English · Arabic / RTL · loading · empty ("Nothing here yet.") · permission denied ("You do not have access to this page.") ·
financial hold (commercial panel blocker) · approval required ("A different administrator must approve." / acceptance pending) ·
integration failure (stale / failed-records chip, inbox INTEGRATION_ISSUE) · market disabled ("This market is not open for this
product yet.") · product not entitled ("This is not included in your contract…") · not offered to the partner type · account not
active yet.

## Frames
1. **Login / onboarding** — shared sign-in panel; invitation acceptance (`/accept-invite`); Organization page: onboarding checklist
   (check, state chip, detail), lifecycle + readiness chips, Submit for DealDash review; profile form (legal identity locked after
   review), contacts, signatory, requested markets.
2. **Home dashboard** — partner header (name, type, lifecycle chip, readiness alert with missing items), KPI cards (open markets,
   active / total campaigns, network, Live Deal benefits), 30-day verified outcomes (5 KPIs, "as of", ROI note), funding / invoices /
   PO / credit cards, alerts + tasks, integration health, modules (not-in-contract chips).
3. **Merchant network** — tabs: list (search; merchant, country, state chip REFERENCED / REGISTERED_ACTIVE, branches, source + your
   ID, last sync, duplicates hint), detail (capabilities chips with ✕ for unavailable, outlets, provenance table, conflicts alert),
   **Manual merchant** form + **Add a registered DealDash merchant** search, **Duplicate review** (yours / possible match / % /
   high-risk chip / Not a duplicate · Suggest merge / your view), **Bulk import** (records kind, source name, CSV file, template link,
   column mapping, Validate → preview counts alert, files table with status chip, error report link, Send for approval).
4. **Import errors** — the error report CSV (row, status, reasons) and the preview alert (rows / valid / warnings / errors /
   duplicates).
5. **Integration workspace** — new connection (name, source, type), key-once warning alert, connections table, integration health
   panel (shared).
6. **Eligibility builder** — tabs Rules / Card programmes / Employer programmes; nested groups (All of these / Any of these / Not)
   with condition rows (criterion select, values with suggestions), add condition / group / remove; sample customer facts; test
   result chip (Qualifies / Could qualify / Does not qualify); save; saved rules list. Card programme form + table with the privacy
   alert (BIN prefixes only). Employer programmes (domains, verified members count).
7. **Campaign list** — tabs Campaigns / Live Deal benefits; table (title + reference + market, product, merchant, your role, status,
   commercial status, maximum commitment); New campaign.
8. **Campaign builder** — 1 product (Exclusive Deal / Voucher), 2 merchant (registered network merchants only) + outlets + merchant
   image, 3 offer (bilingual title / label / description, prices, units, dates), 4 your funding (per redemption, help text), 5 who
   qualifies; Create draft.
9. **Exclusive Deal / Voucher detail** — title, product + status chip, roles note, Submit for review; the shared commercial panel
   (summary lines, parties with acceptance chips, acknowledgements, funding table with Pay, approvals, blockers / clear).
10. **Live Deal benefit** — proposal form (deal, type, value, bilingual label / terms, my card holders only), table with status
    chips (Waiting for the merchant / Waiting for DealDash / Active / Suspended / Ended / Rejected / Withdrawn); merchant decision page;
    customer "Extra with partners" box (You qualify / Add your card or membership to unlock).
11. **Watch & Earn** — **Budgets you own** (FD-S7-1: table — campaign + merchant, status chip, paid views, budget, funded, spent;
    Fund budget (finance role) / Send for review; create form — registered network merchant, merchant video, bilingual title and
    description, city, paid views, video length, start / end; note that DealDash sets points and the partner cannot), then campaigns you
    fund (paid views, budget, spent, points funded) and the points sponsor form. Screenshot `partner-watch-owned.png`.
11a. **Offers (partner Live Deals)** — FD-S7-4: "Add a Live Deal" (network merchant, publication authority reference, your offer ID,
    bilingual title / benefit, start / end; note that no controlled capability follows), table (merchant, offer, valid, source and
    authority: offer ID / agreement reference / method, status chip Published / Awaiting DealDash confirmation / Feed out of date).
    Screenshot `partner-offers.png`.
12. **Loyalty** — shared loyalty workspace with partner funding options.
13. **Performance** — break down by (market, legal entity, merchant, city, branch, campaign), days, CSV download; table with the
    verified metrics, expected-to-date and forecast marked "Estimate", ROI note.
14. **Alerts** — shared alert rows (acknowledge / resolve) + notification preferences.
15. **Tasks** — shared inbox (translated task sentences, priority, due), cases, activity.
16. **Finance / Invoices / PO / Credit / Reconciliation** — shared billing workspace tabs; Commercial and funding tab (cases list).
17. **Reports** — aggregate drill-down + CSV (no individual customer data).
18. **AI copilot** — shared assistant panel (labelled statements, drafts for approval).
19. **Users / Access** — invite (name, e-mail, partner role), users table (role select, scoped / organization-wide, status, last
    active, deactivate / reactivate), pending invitations (revoke), scope a user to a market.
20. **Legal entities / Markets** — markets table (market, open / not open, currency, legal entities); history list.
21. **Settings** — agreement and licence (shared plan / usage workspace), notification preferences.
22. **Admin → Partners** — list (name, type, markets, lifecycle chip + pending activation, readiness chip), new partner + first
    administrator invitation, detail (lifecycle move with reason, pending activation with Approve disabled for the requester, readiness
    table, history), Partner benefits waiting for DealDash (approve / reject / suspend / reinstate), **Partner Live Deals to confirm**
    (FD-S7-4: offer, partner + merchant + market, agreement reference + offer ID, dates, Confirm publication right — approvers only).
    Screenshot `admin-partner-offers.png`.

## Phone
Tables scroll inside their card; tabs scroll horizontally; no page-level horizontal scroll (verified at 390 px).
