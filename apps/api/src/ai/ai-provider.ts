import { AI_SUPPORTED_LOCALES, type AiAgent } from '@dealdash/types';

/** en / ar are answered natively; anything else (for example Urdu) is answered in English and says so. */
export function resolveLocale(requested?: string | null) {
  const r = (requested ?? 'en').toLowerCase();
  const locale: 'en' | 'ar' = r === 'ar' ? 'ar' : 'en';
  const localeNote = (AI_SUPPORTED_LOCALES as readonly string[]).includes(r)
    ? null
    : { requested: r, answeredIn: locale, reason: 'LOCALE_NOT_SUPPORTED_YET' as const };
  return { locale, localeNote };
}

/**
 * An offer is recommended only when the product service says the customer is ELIGIBLE and it is AVAILABLE now (not scheduled,
 * paused, ended or sold out). Locked offers appear only as unlock hints; hidden ones never.
 */
export function usableOffer(x: {
  eligibility?: { result: string } | null;
  availability?: string;
  soldOut?: boolean;
}) {
  return (
    (!x.eligibility || x.eligibility.result === 'ELIGIBLE') &&
    (!x.availability || x.availability === 'AVAILABLE') &&
    !x.soldOut
  );
}

/**
 * The model behind the agents. The provider only CLASSIFIES what the person asks; it never sees raw data it could leak and it never
 * writes figures: every number in an answer comes from an authorised tool result (grounding check). A hosted model can implement this
 * interface later without changing governance, tools, audit or metering.
 */
export interface AiProvider {
  readonly name: string;
  readonly model: string;
  classify(agent: AiAgent, text: string): { intent: string; confidence: number };
}
export const AI_PROVIDER = Symbol('AI_PROVIDER');

/** Intent vocabulary per agent with EN / AR keywords. The first match wins; otherwise the agent's default intent. */
const RULES: Record<AiAgent, Array<{ intent: string; words: string[] }>> = {
  CUSTOMER_BEST_DEAL: [
    {
      intent: 'TRANSACT',
      words: [
        'buy',
        'purchase',
        'pay',
        'reserve',
        'book',
        'redeem',
        'spend',
        'use my points',
        'اشتر',
        'شراء',
        'ادفع',
        'احجز',
        'حجز',
        'استبدل',
        'اصرف',
      ],
    },
    {
      intent: 'MY_POINTS',
      words: ['point', 'loyalty', 'reward', 'balance', 'نقاط', 'نقطة', 'رصيد', 'مكافأ'],
    },
    { intent: 'MY_VOUCHERS', words: ['my voucher', 'wallet', 'expir', 'قسائمي', 'محفظ', 'تنتهي'] },
    { intent: 'MY_RESERVATIONS', words: ['my reservation', 'reservation', 'حجوزاتي', 'حجزي'] },
    { intent: 'BEST_DEALS', words: [] },
  ],
  MERCHANT_GROWTH: [
    { intent: 'DRAFT_TARGETS', words: ['target', 'goal', 'هدف', 'أهداف', 'اهداف'] },
    {
      intent: 'DRAFT_ALERTS',
      words: ['alert rule', 'notify me', 'warn me', 'قاعدة تنبيه', 'نبهني'],
    },
    {
      intent: 'CAMPAIGN_PLAN',
      words: [
        'plan',
        'grow',
        'increase',
        'objective',
        'campaign idea',
        'خطة',
        'زيادة',
        'نمو',
        'حملة',
      ],
    },
    { intent: 'ALERTS', words: ['alert', 'warning', 'problem', 'تنبيه', 'تنبيهات', 'مشكلة'] },
    { intent: 'PERFORMANCE_SUMMARY', words: [] },
  ],
  PARTNER_CAMPAIGN: [
    {
      intent: 'CAMPAIGN_PORTFOLIO',
      words: ['portfolio', 'plan', 'program', 'programme', 'خطة', 'برنامج'],
    },
    { intent: 'PERFORMANCE_SUMMARY', words: [] },
  ],
  OPERATIONS_SUPPORT: [
    // Stage 8: case work, reconciliation variance and queue priority (the case id comes from the screen context)
    {
      intent: 'CASE_SUMMARY',
      words: [
        'summar',
        'missing evidence',
        'next step',
        'draft a reply',
        'draft reply',
        'لخص',
        'ملخص',
        'الخطوة التالية',
      ],
    },
    { intent: 'RECON_VARIANCE', words: ['reconcil', 'variance', 'mismatch', 'مطابق', 'فرق'] },
    {
      intent: 'QUEUE_PRIORITY',
      words: ['priorit', 'queue', 'backlog', 'overdue', 'أولوي', 'متأخر'],
    },
    {
      intent: 'CUSTOMER_CASE',
      words: ['customer', 'case', 'complaint', 'refund', 'عميل', 'شكوى', 'استرداد'],
    },
    { intent: 'OPS_HEALTH', words: [] },
  ],
  ADMIN_FINANCE: [{ intent: 'FINANCE_SUMMARY', words: [] }],
};

/** Deterministic rules provider: no external service, no data leaves the platform, same answer for the same question. */
export class BuiltinAiProvider implements AiProvider {
  readonly name = 'BUILTIN';
  constructor(readonly model = 'dealdash-rules-v1') {}

  classify(agent: AiAgent, text: string) {
    const t = text.toLowerCase();
    for (const r of RULES[agent])
      if (r.words.some((w) => t.includes(w)))
        return { intent: r.intent, confidence: r.words.length ? 0.8 : 0.5 };
    const last = RULES[agent][RULES[agent].length - 1]!;
    return { intent: last.intent, confidence: 0.5 };
  }
}

/** Numbers that appear in a text (Western and Arabic-Indic digits), normalised. */
export function numbersIn(text: string): string[] {
  const western = text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  return (western.match(/\d[\d,]*(\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ''));
}

/**
 * Grounding check: every number in a rendered statement must come from an authorised tool result (or be a plain ordinal / a
 * configured constant passed in `allowed`). An invented price, saving, balance or date fails here and the statement is dropped.
 */
export function grounded(text: string, allowed: Set<string>): boolean {
  return numbersIn(text).every((n) => allowed.has(n) || allowed.has(String(Number(n))));
}
