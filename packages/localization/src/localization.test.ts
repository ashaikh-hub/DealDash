import { describe, expect, it } from 'vitest';
import { enStage2 } from './dictionaries.stage2';
import { enStage3 } from './dictionaries.stage3';
import { arStage4, enStage4 } from './dictionaries.stage4';
import { arStage5, enStage5 } from './dictionaries.stage5';
import { arCommercial, enCommercial } from './dictionaries.commercial';
import { arStage6, enStage6 } from './dictionaries.stage6';
import { arPlatform, enPlatform } from './dictionaries.platform';
import { arSubscription, enSubscription } from './dictionaries.subscription';
import { arPhase45, enPhase45 } from './dictionaries.phase45';
import { arMarkets, enMarkets } from './dictionaries.markets';
import {
  INVOICE_CONFIG_KINDS,
  MARKET_POLICY_KEYS,
  MARKET_PRODUCTS,
  MARKET_PRODUCT_STATUSES,
  MARKET_STATUSES,
  MARKET_VALIDATION_STATUSES,
  PROVIDER_CAPABILITIES,
  READINESS_CHECKS,
  READINESS_STATES,
  TAXABLE_ITEMS,
  TAX_TYPES,
  AI_AGENTS,
  AI_EVAL_CASES,
  AI_STATEMENT_KINDS,
  ALERT_ACTIONS,
  ALERT_CATEGORIES,
  ALERT_CHANNELS,
  ALERT_CODE_KEYS,
  ALERT_FREQUENCIES,
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  BILLING_ACCOUNT_STATUSES,
  BILLING_COLLECTIONS,
  BILLING_FREQUENCIES,
  BILLING_METHODS,
  FINANCE_DOCUMENT_KINDS,
  FINANCE_DOCUMENT_STATUSES,
  HEALTH_STATES,
  INTEGRATION_FAMILIES,
  METRIC_KEYS,
  REPORT_DIMENSIONS,
  TARGET_METRIC_KEYS,
  TARGET_STATUSES,
  TIMELINE_KINDS,
  ALL_LIMIT_KEYS,
  AMENDMENT_STATUSES,
  AMENDMENT_TYPES,
  BILLING_CADENCES,
  BILLING_CATEGORIES,
  BILLING_EVENT_TYPES,
  COMMERCIAL_SIGNALS,
  CONTRACT_KINDS,
  CONTRACT_LIFECYCLE,
  EFFECTIVE_MODES,
  FINANCIAL_STATUSES,
  NEW_EXPOSURE_ACTIONS,
  POST_PROMOTION,
  PROMOTION_KINDS,
  RENEWAL_STATES,
  SUBSCRIPTION_FEATURES,
  SUBSCRIPTION_PRODUCTS,
} from '@dealdash/types';
import {
  ar,
  containsArabic,
  createTranslator,
  dirOf,
  en,
  formatAmount,
  formatMoney,
  formatNumber,
  isRtl,
  negotiateLocale,
  normalizeArabic,
  pickLocalized,
  stripLocale,
  withLocale,
} from './index';

describe('localization', () => {
  it('has identical keys in English and Arabic', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it('has no empty translations', () => {
    for (const [key, value] of Object.entries(ar)) expect(value.trim(), key).not.toBe('');
    for (const [key, value] of Object.entries(en)) expect(value.trim(), key).not.toBe('');
  });

  it('reports direction per locale', () => {
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('en')).toBe(false);
    expect(dirOf('ar')).toBe('rtl');
    expect(dirOf('en')).toBe('ltr');
  });

  it('translates and interpolates', () => {
    expect(createTranslator('en')('auth.signIn')).toBe('Sign in');
    expect(createTranslator('ar')('auth.signIn')).toBe('تسجيل الدخول');
  });

  it('builds localized routes', () => {
    expect(withLocale('/branches', 'ar')).toBe('/ar/branches');
    expect(withLocale('/en/branches', 'ar')).toBe('/ar/branches');
    expect(withLocale('/', 'en')).toBe('/en');
    expect(stripLocale('/ar/branches/1')).toBe('/branches/1');
  });

  it('negotiates locale from Accept-Language', () => {
    expect(negotiateLocale('ar-SA,ar;q=0.9,en;q=0.8')).toBe('ar');
    expect(negotiateLocale('en-GB,en;q=0.9')).toBe('en');
    expect(negotiateLocale('fr-FR,fr;q=0.9')).toBe('en');
    expect(negotiateLocale(undefined)).toBe('en');
  });

  it('formats numbers and money with Western digits in both locales', () => {
    expect(formatNumber('ar', 1234567)).toMatch(/^[0-9,.٬٫\s]+$/);
    expect(formatNumber('ar', 1234567)).not.toMatch(/[٠-٩]/);
    expect(formatMoney('en', 8000)).toBe('SAR 80.00');
    expect(formatMoney('ar', 8000)).toContain('80.00');
    expect(formatMoney('ar', 8000)).not.toMatch(/[٠-٩]/);
  });

  it('picks bilingual text with fallback', () => {
    expect(pickLocalized({ en: 'Dinner', ar: 'عشاء' }, 'ar')).toBe('عشاء');
    expect(pickLocalized({ en: 'Dinner', ar: '' }, 'ar')).toBe('Dinner');
  });

  it('detects and normalises Arabic text for search', () => {
    expect(containsArabic('مطعم Nobu')).toBe(true);
    expect(containsArabic('Nobu')).toBe(false);
    expect(normalizeArabic('أَهْلاً')).toBe(normalizeArabic('اهلا'));
  });
});

describe('dictionary layering', () => {
  it('a later stage never overrides a key of an earlier stage', () => {
    const overlap = Object.keys(enStage3).filter((k) => k in enStage2);
    expect(overlap).toEqual([]);
  });

  it('Stage 4 never overrides a key of Stage 2 or Stage 3', () => {
    const overlap = Object.keys(enStage4).filter((k) => k in enStage2 || k in enStage3);
    expect(overlap).toEqual([]);
  });

  it('every Stage 4 string is non-empty in both languages, Arabic is really Arabic, and nothing says no-show or penalty', () => {
    for (const key of Object.keys(enStage4)) {
      const e = enStage4[key as keyof typeof enStage4];
      const a = arStage4[key as keyof typeof arStage4];
      expect(e.trim(), key).not.toBe('');
      expect(a.trim(), key).not.toBe('');
      if (!key.startsWith('mhb.en') && !key.startsWith('st.source'))
        expect(a === e && /[A-Za-z]{4,}/.test(e), key).toBe(false);
      expect(`${e} ${a}`, key).not.toMatch(
        /no-show|noshow|penalt|blacklist|banned|\bban\b|deposit/i,
      );
    }
  });

  it('Stage 5 never overrides an earlier key; strings are non-empty, Arabic is Arabic, and no guaranteed-savings or vendor wording', () => {
    const overlap = Object.keys(enStage5).filter(
      (k) => k in enStage2 || k in enStage3 || k in enStage4,
    );
    expect(overlap).toEqual([]);
    expect(Object.keys(arStage5).sort()).toEqual(Object.keys(enStage5).sort());
    for (const key of Object.keys(enStage5)) {
      const e = enStage5[key as keyof typeof enStage5];
      const a = arStage5[key as keyof typeof arStage5];
      expect(e.trim(), key).not.toBe('');
      expect(a.trim(), key).not.toBe('');
      expect(a === e && /[A-Za-z]{4,}/.test(e), key).toBe(false);
      expect(`${e} ${a}`, key).not.toMatch(/guarantee|stripe|moyasar|hyperpay|tap payments/i);
      // MVP shows no Phase 2 concept: no gifting, promo codes or loyalty points in any Stage 5 copy
      expect(e, key).not.toMatch(/\bgift|promo|loyalty/i);
      expect(a, key).not.toMatch(/إهداء|هدية|ترويجي|ولاء/);
    }
  });
  it('Stage 6 never overrides an earlier key; both languages match, keep placeholders, and carry no cash value, Phase 2 concept or vendor wording', () => {
    const overlap = Object.keys(enStage6).filter(
      (k) => k in enStage2 || k in enStage3 || k in enStage4 || k in enStage5,
    );
    expect(overlap).toEqual([]);
    expect(Object.keys(arStage6).sort()).toEqual(Object.keys(enStage6).sort());
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(enStage6)) {
      const e = enStage6[key as keyof typeof enStage6];
      const a = arStage6[key as keyof typeof arStage6];
      expect(e.trim(), key).not.toBe('');
      expect(a.trim(), key).not.toBe('');
      expect(a === e && /[A-Za-z]{4,}/.test(e), key).toBe(false);
      expect(vars(a), key).toEqual(vars(e));
      expect(`${e} ${a}`, key).not.toMatch(/guarantee|stripe|moyasar|hyperpay|tap payments/i);
      // Phase 2 and removed concepts never appear in Stage 6 copy
      expect(e, key).not.toMatch(
        /\bgift|promo|loyalty|streak|milestone|daily goal|play & win|spin|raffle|lottery/i,
      );
      expect(a, key).not.toMatch(/إهداء|هدية|ترويجي|ولاء|سلسلة أيام|عجلة الحظ|يانصيب|سحب عشوائي/);
      // points are not money: nothing the CUSTOMER reads about points or videos shows a currency
      if (/^(rew|wat)\./.test(key))
        expect(`${e} ${a}`, key).not.toMatch(/\bSAR\b|riyal|ريال|halala/i);
    }
    // the status, action, reason and signal vocabularies are complete
    for (const s of [
      'DRAFT',
      'PENDING_REVIEW',
      'NEEDS_CHANGES',
      'REJECTED',
      'SCHEDULED',
      'LIVE',
      'PAUSED',
      'COMPLETED',
      'EXPIRED',
      'CANCELLED',
      'SUSPENDED',
    ])
      expect(enStage6, s).toHaveProperty(`wstatus.${s}`);
    for (const r of [
      'LEFT_APP',
      'SKIPPED',
      'NO_RESPONSE',
      'ALREADY_EARNED',
      'DAILY_CAP',
      'BUDGET_EXHAUSTED',
      'UNAVAILABLE',
      'OTHER',
    ])
      expect(enStage6, r).toHaveProperty(`wat.reason.${r}`);
    for (const r of ['EARN', 'HOLD', 'RELEASE', 'REVERSE', 'REDEEM', 'EXPIRE', 'ADMIN_ADJUSTMENT'])
      expect(enStage6, r).toHaveProperty(`rew.type.${r}`);
  });
  it('Commercial governance copy never overrides an earlier key, matches in both languages and keeps its placeholders; no guarantee or vendor wording', () => {
    const overlap = Object.keys(enCommercial).filter(
      (k) => k in enStage2 || k in enStage3 || k in enStage4 || k in enStage5 || k in enStage6,
    );
    expect(overlap).toEqual([]);
    expect(Object.keys(arCommercial).sort()).toEqual(Object.keys(enCommercial).sort());
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(enCommercial)) {
      const e = enCommercial[key as keyof typeof enCommercial];
      const a = arCommercial[key as keyof typeof arCommercial];
      expect(e.trim(), key).not.toBe('');
      expect(a.trim(), key).not.toBe('');
      expect(a === e && /[A-Za-z]{4,}/.test(e), key).toBe(false);
      expect(vars(a), key).toEqual(vars(e));
      expect(`${e} ${a}`, key).not.toMatch(/guarantee|stripe|moyasar|hyperpay|tap payments/i);
      // tax and statutory documents are never stated as settled facts
      expect(e, key).not.toMatch(/\bVAT\b|ZATCA|15 ?%/i);
    }
    // the vocabularies the screens iterate over are complete
    for (const s of ['PRICING_DRAFT', 'AWAITING_ACCEPTANCE', 'ACCEPTED', 'AWAITING_FUNDING', 'PARTIALLY_FUNDED', 'FULLY_FUNDED', 'CREDIT_APPROVED', 'FINANCIAL_HOLD', 'RECONCILED', 'CLOSED'])
      expect(enCommercial, s).toHaveProperty(`cm.status.${s}`);
    for (const c of ['REVIEWED_TERMS', 'UNDERSTAND_CHARGES', 'CONFIRM_FUNDING', 'CONFIRM_BENEFIT', 'CONFIRM_INVENTORY', 'HONOUR_REDEMPTIONS', 'ACCEPT_TERMS'])
      expect(enCommercial, c).toHaveProperty(`cm.check.${c}`);
    for (const b of ['NO_COMMERCIAL_CASE', 'NO_QUOTATION', 'UNBOUNDED_LIABILITY', 'ACCEPTANCE_MISSING', 'AMENDMENT_NOT_ACCEPTED', 'FULFILMENT_NOT_ONBOARDED', 'APPROVAL_PENDING', 'APPROVAL_REJECTED', 'UNUSED_FUNDING_TREATMENT_NOT_CONFIGURED', 'FUNDING_MISSING', 'CREDIT_NOT_ACTIVE', 'CREDIT_LIMIT_EXCEEDED', 'FINANCIAL_HOLD'])
      expect(enCommercial, b).toHaveProperty(`cm.blocker.${b}`);
  });
  it('Phase 3 platform copy never overrides an earlier key, matches in both languages, keeps placeholders and states no cash value for points', () => {
    const overlap = Object.keys(enPlatform).filter(
      (k) => k in enStage2 || k in enStage3 || k in enStage4 || k in enStage5 || k in enStage6 || k in enCommercial,
    );
    expect(overlap).toEqual([]);
    expect(Object.keys(arPlatform).sort()).toEqual(Object.keys(enPlatform).sort());
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(enPlatform)) {
      const e = enPlatform[key as keyof typeof enPlatform];
      const a = arPlatform[key as keyof typeof arPlatform];
      expect(e.trim(), key).not.toBe('');
      expect(a.trim(), key).not.toBe('');
      expect(a === e && /[A-Za-z]{4,}/.test(e), key).toBe(false);
      expect(vars(a), key).toEqual(vars(e));
      expect(`${e} ${a}`, key).not.toMatch(/guarantee|stripe|moyasar|hyperpay|tap payments/i);
      // points are never given a conversion rate to money
      expect(e, key).not.toMatch(/1 point (is|=|equals)|points? (are|is) worth|per point = /i);
    }
    // the vocabularies the screens iterate over are complete
    for (const s of ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'PAUSED', 'ENDED', 'REJECTED']) expect(enPlatform, s).toHaveProperty(`lo.status.${s}`);
    for (const s of ['DEALDASH', 'MERCHANT', 'BANK', 'SCHEME', 'CORPORATE', 'CAMPAIGN', 'SPONSOR']) expect(enPlatform, s).toHaveProperty(`lo.fund.${s}`);
    for (const s of ['QUALIFIED_VIEW', 'EXCLUSIVE_REDEMPTION', 'VOUCHER_PURCHASE', 'VOUCHER_REDEMPTION']) expect(enPlatform, s).toHaveProperty(`lo.event.${s}`);
    for (const s of ['REWARD_REFUSED', 'REDEMPTION_DISPUTE', 'SPONSOR_CHARGE_DISPUTE', 'DUPLICATE_FUNDING', 'SETTLEMENT_MISMATCH', 'INVALID_VOUCHER_REDEMPTION', 'IMPORT_CONFLICT', 'FEED_DISCREPANCY', 'RECONCILIATION_BREAK', 'OTHER'])
      expect(enPlatform, s).toHaveProperty(`op.dtype.${s}`);
    for (const s of ['OPEN', 'IN_REVIEW', 'WAITING', 'RESOLVED', 'CLOSED']) expect(enPlatform, s).toHaveProperty(`op.dstatus.${s}`);
    for (const s of ['CAMPAIGN_REVIEW', 'LOYALTY_APPROVAL', 'IMPORT_APPROVAL', 'DATA_CONFLICT', 'DUPLICATE_SUGGESTION', 'OFFER_CONFLICT', 'DISPUTE', 'CHANGES_REQUESTED', 'LOYALTY_RULE']) {
      expect(enPlatform, s).toHaveProperty(`op.kind.${s}`);
      if (s !== 'DISPUTE') expect(enPlatform, s).toHaveProperty(`op.task.${s}`);
    }
  });
  it('Subscription copy never overrides an earlier key, matches in both languages, keeps placeholders, states no price and covers every vocabulary', () => {
    const overlap = Object.keys(enSubscription).filter(
      (k) => k in enStage2 || k in enStage3 || k in enStage4 || k in enStage5 || k in enStage6 || k in enCommercial || k in enPlatform,
    );
    expect(overlap).toEqual([]);
    expect(Object.keys(arSubscription).sort()).toEqual(Object.keys(enSubscription).sort());
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(enSubscription)) {
      const e = enSubscription[key as keyof typeof enSubscription];
      const a = arSubscription[key as keyof typeof arSubscription];
      expect(e.trim(), key).not.toBe('');
      expect(a.trim(), key).not.toBe('');
      expect(a === e && /[A-Za-z]{4,}/.test(e), key).toBe(false);
      expect(vars(a), key).toEqual(vars(e));
      expect(`${e} ${a}`, key).not.toMatch(/guarantee|stripe|moyasar|hyperpay|tap payments/i);
      // prices are configuration: no figure in any currency is written into the copy
      expect(e, key).not.toMatch(/(PKR|SAR|Rs\.?)\s?\d/);
    }
    for (const s of CONTRACT_LIFECYCLE) expect(enSubscription, s).toHaveProperty(`sb.status.${s}`);
    for (const s of RENEWAL_STATES) expect(enSubscription, s).toHaveProperty(`sb.renewal.${s}`);
    for (const s of BILLING_CADENCES) expect(enSubscription, s).toHaveProperty(`sb.cadence.${s}`);
    for (const s of CONTRACT_KINDS) expect(enSubscription, s).toHaveProperty(`sb.kind.${s}`);
    for (const s of FINANCIAL_STATUSES) expect(enSubscription, s).toHaveProperty(`sb.fin.${s}`);
    for (const s of SUBSCRIPTION_PRODUCTS) expect(enSubscription, s).toHaveProperty([`sb.product.${s}`]);
    for (const s of SUBSCRIPTION_FEATURES) expect(enSubscription, s).toHaveProperty([`sb.feature.${s}`]);
    for (const s of ALL_LIMIT_KEYS) expect(enSubscription, s).toHaveProperty([`sb.limit.${s}`]);
    for (const s of AMENDMENT_TYPES) expect(enSubscription, s).toHaveProperty(`sb.amend.${s}`);
    for (const s of AMENDMENT_STATUSES) expect(enSubscription, s).toHaveProperty(`sb.astatus.${s}`);
    for (const s of EFFECTIVE_MODES) expect(enSubscription, s).toHaveProperty(`sb.when.${s}`);
    for (const s of Object.keys(BILLING_EVENT_TYPES)) expect(enSubscription, s).toHaveProperty(`sb.event.${s}`);
    for (const s of BILLING_CATEGORIES) expect(enSubscription, s).toHaveProperty(`sb.category.${s}`);
    for (const s of COMMERCIAL_SIGNALS) expect(enSubscription, s).toHaveProperty(`sb.signal.${s}`);
    for (const s of PROMOTION_KINDS) expect(enSubscription, s).toHaveProperty(`sb.pkind.${s}`);
    for (const s of POST_PROMOTION) expect(enSubscription, s).toHaveProperty(`sb.post.${s}`);
    for (const s of NEW_EXPOSURE_ACTIONS) expect(enSubscription, s).toHaveProperty(`sb.action.${s}`);
    for (const s of ['COMMERCIAL_SUSPENDED', 'CONTRACT_ENDED', 'DOWNGRADE_BLOCKED', 'PLAN_NOT_AVAILABLE', 'PRICING_NOT_AVAILABLE', 'AMENDMENT_INVALID'])
      expect(enSubscription, s).toHaveProperty(`error.${s}`);
  });

  it('Phase 4 / 5 copy never overrides an earlier key, matches in both languages, keeps placeholders and covers every vocabulary', () => {
    const earlier = { ...enStage2, ...enStage3, ...enStage4, ...enStage5, ...enStage6, ...enCommercial, ...enPlatform, ...enSubscription };
    expect(Object.keys(enPhase45).filter((k) => k in earlier)).toEqual([]);
    expect(Object.keys(arPhase45).sort()).toEqual(Object.keys(enPhase45).sort());
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(enPhase45)) {
      const e = enPhase45[key as keyof typeof enPhase45];
      const a = arPhase45[key as keyof typeof arPhase45];
      expect(e.trim(), key).not.toBe('');
      expect(a.trim(), key).not.toBe('');
      expect(containsArabic(a), key).toBe(true);
      expect(vars(a), key).toEqual(vars(e));
      // no "Hot Deal" wording, no promised savings or results, no vendor names, points never have a cash value
      expect(`${e} ${a}`, key).not.toMatch(/hot deal|guaranteed (saving|return)|stripe|moyasar|hyperpay|openai|chatgpt/i);
      expect(e, key).not.toMatch(/(PKR|SAR|Rs\.?)\s?\d/);
    }
    const need = (prefix: string, values: readonly string[]) => {
      for (const v of values) expect(enPhase45, `${prefix}.${v}`).toHaveProperty([`${prefix}.${v}`]);
    };
    need('vis.metric', METRIC_KEYS);
    need('vis.alert', ALERT_CODE_KEYS);
    need('vis.targetMetric', TARGET_METRIC_KEYS);
    need('vis.targetStatus', TARGET_STATUSES);
    need('vis.dim', REPORT_DIMENSIONS);
    need('vis.severity', ALERT_SEVERITIES);
    need('vis.alertStatus', ALERT_STATUSES);
    need('vis.category', ALERT_CATEGORIES);
    need('vis.action', ALERT_ACTIONS);
    need('vis.freq', ALERT_FREQUENCIES);
    need('vis.channel', ALERT_CHANNELS);
    need('vis.health', HEALTH_STATES);
    need('cc.family', INTEGRATION_FAMILIES);
    need('cc.kind', TIMELINE_KINDS);
    need('bill.docType', FINANCE_DOCUMENT_KINDS);
    need('bill.docStatus', FINANCE_DOCUMENT_STATUSES);
    need('bill.accountStatus', BILLING_ACCOUNT_STATUSES);
    need('bill.freq', BILLING_FREQUENCIES);
    need('bill.method', BILLING_METHODS);
    need('bill.collect', BILLING_COLLECTIONS);
    need('ai.agentName', AI_AGENTS);
    need('ai.kind', AI_STATEMENT_KINDS);
    need('ai.eval', AI_EVAL_CASES);
    // the forecast label says it is an estimate in both languages
    expect(enPhase45['vis.forecastLabel']).toMatch(/estimate/i);
    expect(arPhase45['vis.forecastLabel']).toContain('تقدير');
  });

  it('Market configuration copy never overrides an earlier key, matches in both languages and covers every market vocabulary', () => {
    const earlier = { ...enStage2, ...enStage3, ...enStage4, ...enStage5, ...enStage6, ...enCommercial, ...enPlatform, ...enSubscription, ...enPhase45 };
    expect(Object.keys(enMarkets).filter((k) => k in earlier)).toEqual([]);
    expect(Object.keys(arMarkets).sort()).toEqual(Object.keys(enMarkets).sort());
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(enMarkets)) {
      const e = enMarkets[key as keyof typeof enMarkets];
      const a = arMarkets[key as keyof typeof arMarkets];
      expect(e.trim(), key).not.toBe('');
      expect(containsArabic(a), key).toBe(true);
      expect(vars(a), key).toEqual(vars(e));
      // no tax rate, statutory claim or "Hot Deal" wording in the copy
      expect(`${e} ${a}`, key).not.toMatch(/hot deal|\d+\s?%|guaranteed/i);
    }
    const need = (prefix: string, values: readonly string[]) => {
      for (const v of values) expect(enMarkets, `${prefix}.${v}`).toHaveProperty([`${prefix}.${v}`]);
    };
    need('mkt.state', MARKET_STATUSES);
    need('mkt.pstate', MARKET_PRODUCT_STATUSES);
    need('mkt.product', MARKET_PRODUCTS);
    need('mkt.item', TAXABLE_ITEMS);
    need('mkt.taxTypeName', TAX_TYPES);
    need('mkt.docKind', INVOICE_CONFIG_KINDS);
    need('mkt.cap', PROVIDER_CAPABILITIES);
    need('mkt.valstate', MARKET_VALIDATION_STATUSES);
    need('mkt.checkName', READINESS_CHECKS);
    need('mkt.ready', READINESS_STATES);
    need('mkt.pcat', Object.keys(MARKET_POLICY_KEYS));
    need('mkt.pkey', Object.values(MARKET_POLICY_KEYS).flat());
  });

  it('formats an amount in any configured currency with Western digits', () => {
    expect(formatAmount('en', 499_900, 'PKR')).toBe('PKR 4,999.00');
    expect(formatAmount('ar', 499_900, 'PKR')).toBe('4,999.00 PKR');
    expect(formatAmount('en', 12_345, 'SAR')).toBe(formatMoney('en', 12_345));
  });

  it('every Stage 3 string exists in both languages and keeps its {placeholders}', () => {
    for (const [key, value] of Object.entries(en)) {
      const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(vars(ar[key as keyof typeof ar]), key).toEqual(vars(value));
    }
  });
});
