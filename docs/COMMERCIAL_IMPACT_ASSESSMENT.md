# Commercial update: impact assessment (closed)

Status: the gap assessments for the Voucher and Exclusive Deal commercial disclosure, acknowledgement and finance rules were answered and the founder decisions were approved. This document records what each affected area needed and how it was resolved. `docs/COMMERCIAL_FINANCE.md` is the source of truth for the result.

## Completed stages: what changed

| Area | Impact | Resolution |
|---|---|---|
| Stage 3 Live Deals | none to the Live Deal model (no money, no member benefit entity yet) | `LIVE_BENEFIT` product value reserved for a future member benefit |
| Stage 4 Exclusive Deals | submit, approve, auto-publish, stock increase, redemption, reversal | adapter, gates and hooks added; commercial inputs added to the Exclusive Deal content (`commercial`); builder and detail pages show the panel |
| Stage 5 Vouchers | submit, approve, quantity increase, redemption, reversal | same; the platform commission is shown as a netted charge; Stage 5 fee rule and settlement figures unchanged |
| Stage 6 Watch & Earn | submit, approve | media spend as the charge; the funded budget stays in Watch & Earn; acceptance, approvals and the unused-budget agreement gate going live |
| Ledger (Stage 5) | new account families and journal types | additive enum values; same `LedgerService` |
| Roles and permissions | new merchant and admin permissions | additive; existing role tests updated through the shared matrix |
| Test fixtures, seeds, browser scripts | every publish path now needs acceptance and funding | fixtures walk the real flow through `devComplete` and mark the case as a development fixture; the seed completes non-draft campaigns the same way; Stage 4 to 6 browser scripts accept the terms in the UI |

## Decisions that changed the plan

* Real finance MVP rather than a stub: quotation to reconciliation, with statutory formats left configurable.
* Prepaid by default, credit only by approval.
* No default for unused sponsor funding.
* Admin can never stand in for a fulfilment merchant.
* No grandfathering: fixtures are regenerated and marked, real campaigns are not trusted without a case.

## Not changed on purpose

* Partner Portal functionality and Stage 7.
* Play & Win.
* The Live and Exclusive product redefinition (channels, member benefit entity, credentials, filters, reports, rename) and the revised Watch & Earn sponsored-reward model: these were assessed separately and are **not** part of this implementation.
