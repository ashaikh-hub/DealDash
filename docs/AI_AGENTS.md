# Governed AI agents (Phase 5 foundation)

Status: built and verified 2026-10-09; FOUNDER APPROVED AND FROZEN 2026-10-09. Decisions: `docs/PHASE4_PHASE5_IMPACT.md` (D-AI-1 .. D-AI-7).

## 1. Architecture

**Agent → authorised tool → existing service → RBAC / scope / entitlement → business rules → audit.** No agent reads business data around a service's rules, and nothing is executed without a person.

- `apps/api/src/ai/ai.service.ts`: governance, the five agents, drafts, approval and execution, audit and usage views.
- `ai-provider.ts`: `AiProvider` interface. The built-in provider (`BUILTIN`, `dealdash-rules-v1`) classifies requests with EN / AR keyword rules; it never writes figures. A hosted model can implement the same interface later without changing governance, tools, audit or metering.
- Tools run **as the requesting person** (the same actor object the HTTP API uses). Product services are resolved through the module graph (`ModuleRef`).
- **Grounding check**: every number in a statement must come from a tool result (titles and names returned by tools count); otherwise the statement is dropped and counted in `grounding.dropped`.
- Every statement is labelled: OBSERVED_FACT, CALCULATED_TREND, FORECAST, HYPOTHESIS, RECOMMENDATION. Answers carry `AI_SUGGESTED`; drafts `AI_DRAFTED`; approvals `HUMAN_APPROVED`; executions `SYSTEM_EXECUTED`.

## 2. Governance

| Control | Rule |
|---|---|
| Switch | `ai.governance.enabled`; customer agent `customerAgentEnabled` |
| Audience → agent | customer → CUSTOMER_BEST_DEAL; merchant → MERCHANT_GROWTH; partner → PARTNER_CAMPAIGN; admin → OPERATIONS_SUPPORT, ADMIN_FINANCE |
| Permission | `customer.ai.use`, `merchant.ai.use`, `partner.ai.use`, `admin.ai.use`; approval `merchant.ai.approve`, `partner.ai.approve`, `admin.ai.manage` plus the draft's own permission (e.g. `merchant.targets.manage`) |
| Entitlement | business agents need the `AI_COPILOT` feature (`ai.governance.businessFeature`) → `AI_NOT_ENTITLED` |
| Tenant / scope | own organization only (404 otherwise); data filtered by the person's scope (branch, legal entity …) |
| Autonomy | L0 explain, L1 recommend (default), L2 draft, L3 execute after human approval (MVP maximum), L4 bounded autonomy architecture-ready but disabled (`boundedAutonomyEnabled: false`), L5 always refused (`AI_AUTONOMY_EXCEEDED`) |
| Privacy | customer agent sees only the customer's own data; support timeline masks mobile and never returns codes |

## 3. The five agents

1. **Customer Best-Deal** (`POST /v1/app/ai/ask`): offers the customer is ELIGIBLE for and that are AVAILABLE now (live, exclusive, vouchers), ranked, each with why; locked offers only as unlock hints; savings only as stated by the merchant; wallet expiry, points balance and expiring points, reservations. It never reserves, buys, pays, spends points or redeems: those open the normal screen for the customer to confirm.
2. **Merchant Growth** (`POST /v1/orgs/:orgId/ai/ask`): performance summary (facts, 7-day trend, hypotheses, recommendations), open alerts with actions, target suggestions (draft → `CampaignTarget` on approval), alert-rule suggestions (draft → `AlertRule`), campaign plan for an objective (draft only: objective is a target, not a guarantee; publishes nothing; commits no budget).
3. **Bank / Scheme / Partner Campaign** (same endpoint for a partner): performance summary and a campaign-portfolio draft. API foundation only; the partner UI is Stage 7.
4. **Operations & Support** (`POST /v1/admin/ai/ask`, agent OPERATIONS_SUPPORT): customer journey summary from the support timeline, likely causes, a handoff draft (approval opens a dispute case owned by a person), and Command Centre attention items. Human handoff is always available.
5. **Admin / Finance** (agent ADMIN_FINANCE): receivables per currency (fact), invoicing trend (trend), expected collections if paid on time (forecast, labelled an estimate), concentration of overdue amounts (hypothesis), reconciliation differences (fact), recommendations that leave holds and write-offs to Finance.

## 4. Audit and metering

Append-only (database triggers): `AiInteraction` (user, organization, role, scope, locale, request, intent, autonomy, status ANSWERED / DENIED / ERROR, answer, provider, model, units, tool calls, estimated cost), `AiAction` (tool, tier READ / DRAFT / EXECUTE, state SUGGESTED / DRAFTED / HUMAN_APPROVED / SYSTEM_EXECUTED / REJECTED / DENIED), `AiUsageRecord` (REQUEST, SUPPORT_ASSIST, TOOL_CALL, DRAFT, ACTION). `AiDraft` holds drafts and decisions. Approvals and executions are also in the main audit log. Refusals are recorded too.
Usage is measured but **not priced**: `commercialTreatment` is configuration (INCLUDED_FEATURE now; ADD_ON, ENTERPRISE_AI_LICENCE, USAGE_CHARGE, PREMIUM_SERVICE later).

## 5. Languages

English and Arabic answers (reviewed templates; Arabic needs native review before launch). Any other locale (e.g. Urdu) is answered in English with `localeNote` (`LOCALE_NOT_SUPPORTED_YET`); no machine-translated financial text.

## 6. Evaluation pack

`POST /v1/admin/ai/evaluations` (`AiEvalService`): EXPIRED_DEAL, INELIGIBLE_DEAL, WRONG_BRANCH, INVENTED_PRICE, INVENTED_TERM, VOUCHER_VALIDITY, LOYALTY_BALANCE, UNAUTHORIZED_DATA, CROSS_TENANT, BUDGET_OVERRUN, INCORRECT_FUNDING, ARABIC_QUALITY, URDU_QUALITY. All pass. End-to-end behaviour is covered by `apps/api/test/ai.e2e.test.ts` (13 tests).

## 7. Screens

Customer `/assistant` (link on the profile screen; the five-tab bar is unchanged); merchant `/assistant` (assistant + drafts list); admin `/ai` (assistant, drafts, audit, usage, evaluations).

## 8. Development fixture

No plan includes AI_COPILOT (how AI is sold is a later commercial decision). The dev seed (`seedAiFixtures`) adds it as an OVERRIDE entitlement on development-fixture agreements only.

<!-- stage7-addendum -->
## Stage 7 (Oct 2026)

The Partner Campaign copilot is exposed in the partner portal (explain, recommend, draft; execution only after a person approves;
AI_COPILOT contract feature; same RBAC and tenant isolation, verified by the Stage 7 isolation test).

<!-- stage7-founder-decisions -->
## Stage 7 founder approval and decisions (2026-10-10): APPROVED AND FROZEN

No AI change: the partner copilot keeps its governed scope; it cannot create, fund or publish a partner-owned Watch & Earn budget or a
partner Live Deal without the same human approvals.

## Stage 8 (Oct 2026)
OPERATIONS_SUPPORT gains intents CASE_SUMMARY, RECON_VARIANCE, QUEUE_PRIORITY and drafts CUSTOMER_RESPONSE (shared case note) and
MERCHANT_REQUEST (case moved to AWAITING_MERCHANT / PARTNER). Drafts execute only after a human approves, as the approver. The copilot
never resolves cases, moves money, restricts anyone or decides fraud.