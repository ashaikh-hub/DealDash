/**
 * Phase 5: governed AI agent vocabulary. An agent is never a generic chatbot: it calls authorised tools, which call the existing
 * services as the requesting user (RBAC, scope, entitlement, business rules and audit all apply). It explains, recommends and drafts;
 * a person approves before anything is executed. Full autonomy over money or commitments is not part of the MVP.
 */

export const AI_AGENTS = [
  'CUSTOMER_BEST_DEAL',
  'MERCHANT_GROWTH',
  'PARTNER_CAMPAIGN',
  'OPERATIONS_SUPPORT',
  'ADMIN_FINANCE',
] as const;
export type AiAgent = (typeof AI_AGENTS)[number];

/**
 * 0 Explain, 1 Recommend, 2 Draft, 3 Execute after human approval, 4 Bounded autonomy (architecture ready, disabled),
 * 5 Full autonomous financial / commercial authority (refused: not MVP).
 */
export const AI_AUTONOMY_LEVELS = [0, 1, 2, 3, 4, 5] as const;
export type AiAutonomyLevel = (typeof AI_AUTONOMY_LEVELS)[number];
export const AI_MVP_MAX_AUTONOMY: AiAutonomyLevel = 3;

/** Tool tiers: READ answers questions, DRAFT prepares something a person reviews, EXECUTE runs only after a recorded human approval. */
export const AI_TOOL_TIERS = ['READ', 'DRAFT', 'EXECUTE'] as const;
export type AiToolTier = (typeof AI_TOOL_TIERS)[number];

/** Every statement in an answer is labelled, so a forecast is never mistaken for a fact. */
export const AI_STATEMENT_KINDS = [
  'OBSERVED_FACT',
  'CALCULATED_TREND',
  'FORECAST',
  'HYPOTHESIS',
  'RECOMMENDATION',
] as const;
export type AiStatementKind = (typeof AI_STATEMENT_KINDS)[number];

/** What happened to an AI step, in the audit. */
export const AI_ACTION_STATES = [
  'SUGGESTED',
  'DRAFTED',
  'HUMAN_APPROVED',
  'SYSTEM_EXECUTED',
  'REJECTED',
  'DENIED',
] as const;
export type AiActionState = (typeof AI_ACTION_STATES)[number];

export const AI_DRAFT_KINDS = [
  'CAMPAIGN_PLAN',
  'CAMPAIGN_TARGETS',
  'ALERT_RULES',
  'SUPPORT_HANDOFF',
  'CAMPAIGN_PORTFOLIO',
] as const;
export type AiDraftKind = (typeof AI_DRAFT_KINDS)[number];

/** Future commercial treatment of AI is configuration only; nothing is priced now. */
export const AI_COMMERCIAL_TREATMENTS = [
  'INCLUDED_FEATURE',
  'ADD_ON',
  'ENTERPRISE_AI_LICENCE',
  'USAGE_CHARGE',
  'PREMIUM_SERVICE',
] as const;

/** Locales the agents answer in. Anything else (for example Urdu) is answered in a supported language and says so. */
export const AI_SUPPORTED_LOCALES = ['en', 'ar'] as const;

export const AI_EVAL_CASES = [
  'EXPIRED_DEAL',
  'INELIGIBLE_DEAL',
  'WRONG_BRANCH',
  'INVENTED_PRICE',
  'INVENTED_TERM',
  'VOUCHER_VALIDITY',
  'LOYALTY_BALANCE',
  'UNAUTHORIZED_DATA',
  'CROSS_TENANT',
  'BUDGET_OVERRUN',
  'INCORRECT_FUNDING',
  'ARABIC_QUALITY',
  'URDU_QUALITY',
] as const;
export type AiEvalCase = (typeof AI_EVAL_CASES)[number];
