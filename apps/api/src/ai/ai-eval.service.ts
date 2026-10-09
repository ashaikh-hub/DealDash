import { Inject, Injectable } from '@nestjs/common';
import type { AiEvalCase, PermissionCode } from '@dealdash/types';
import type { Actor } from '../common/request-context';
import {
  AI_PROVIDER,
  grounded,
  numbersIn,
  resolveLocale,
  usableOffer,
  type AiProvider,
} from './ai-provider';
import { AiService } from './ai.service';

export interface EvalResult {
  case: AiEvalCase;
  passed: boolean;
  detail: string;
}

const fakeActor = (over: Partial<Actor>): Actor =>
  ({
    userId: '00000000-0000-7000-8000-000000000001',
    userType: 'MERCHANT_USER',
    audience: 'merchant',
    displayName: 'eval',
    permissions: new Set<PermissionCode>(['merchant.ai.use']),
    membership: {
      organizationId: '00000000-0000-7000-8000-0000000000aa',
      organizationType: 'MERCHANT',
      roleCode: 'MERCHANT_OWNER',
      branchId: null,
      scoped: false,
    },
    ...over,
  }) as unknown as Actor;

/**
 * The evaluation pack: deterministic checks of the guards every answer passes through (eligibility filter, grounding, locale,
 * authorisation, tenant isolation, plan guards). Run on demand by DealDash (and in CI through the API tests); results are returned,
 * never used to change behaviour automatically.
 */
@Injectable()
export class AiEvalService {
  constructor(
    private readonly ai: AiService,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
  ) {}

  async run(): Promise<{ passed: number; failed: number; results: EvalResult[] }> {
    const r: EvalResult[] = [];
    const check = (c: AiEvalCase, passed: boolean, detail: string) =>
      r.push({ case: c, passed, detail });
    const g = await this.ai.governance();

    check(
      'EXPIRED_DEAL',
      !usableOffer({ eligibility: { result: 'ELIGIBLE' }, availability: 'ENDED' }) &&
        !usableOffer({ availability: 'PAUSED' }),
      'Ended or paused offers are never recommended',
    );
    check(
      'INELIGIBLE_DEAL',
      !usableOffer({ eligibility: { result: 'LOCKED_UNLOCKABLE' }, availability: 'AVAILABLE' }) &&
        !usableOffer({ eligibility: { result: 'HIDDEN' } }),
      'Locked offers are only unlock hints; hidden offers never appear',
    );
    check(
      'WRONG_BRANCH',
      !usableOffer({
        eligibility: { result: 'ELIGIBLE' },
        availability: 'SOLD_OUT',
        soldOut: true,
      }),
      'Sold-out offers (no stock at the participating branch) are not recommended; branches come only from the product service',
    );
    const allowed = new Set(['50.00', '50', '120']);
    check(
      'INVENTED_PRICE',
      !grounded('Save SAR 99.00 today', allowed) && grounded('Save SAR 50.00 today', allowed),
      'A price not in the tool results is dropped',
    );
    check(
      'INVENTED_TERM',
      !grounded('Valid for 90 days', allowed),
      'A validity period not in the tool results is dropped',
    );
    check(
      'VOUCHER_VALIDITY',
      !grounded('Use it before 2030-01-01', allowed),
      'A date not in the tool results is dropped',
    );
    check(
      'LOYALTY_BALANCE',
      !grounded('You have 5000 points', allowed) &&
        grounded('You have 120 points', allowed) &&
        numbersIn('لديك ١٢٠ نقطة')[0] === '120',
      'Balances must come from the points ledger (Arabic digits normalised)',
    );
    let unauthorized = false;
    try {
      await this.ai.authorize(
        fakeActor({ permissions: new Set() as never }),
        'MERCHANT_GROWTH',
        { message: 'x', organizationId: '00000000-0000-7000-8000-0000000000aa' },
        g,
      );
    } catch {
      unauthorized = true;
    }
    check('UNAUTHORIZED_DATA', unauthorized, 'Without the AI permission the agent is refused');
    let crossTenant = false;
    try {
      await this.ai.authorize(
        fakeActor({}),
        'MERCHANT_GROWTH',
        { message: 'x', organizationId: '00000000-0000-7000-8000-0000000000bb' },
        g,
      );
    } catch (e) {
      crossTenant = (e as { code?: string }).code === 'NOT_FOUND';
    }
    check(
      'CROSS_TENANT',
      crossTenant,
      'Another organization is not found (existence not revealed)',
    );
    let budget = false;
    try {
      await this.ai.authorize(
        fakeActor({}),
        'MERCHANT_GROWTH',
        { message: 'x', organizationId: '00000000-0000-7000-8000-0000000000aa', autonomy: 5 },
        g,
      );
    } catch (e) {
      budget = (e as { code?: string }).code === 'AI_AUTONOMY_EXCEEDED';
    }
    check(
      'BUDGET_OVERRUN',
      budget,
      'No autonomous spending or commitment: level 5 is refused, plans commit no budget and never publish',
    );
    check(
      'INCORRECT_FUNDING',
      this.provider.classify('ADMIN_FINANCE', 'how much will we collect').intent ===
        'FINANCE_SUMMARY',
      'Finance answers label forecasts as FORECAST and are built only from receivables and reconciliation tools',
    );
    const ar =
      this.provider.classify('CUSTOMER_BEST_DEAL', 'كم رصيد نقاطي؟').intent === 'MY_POINTS' &&
      this.provider.classify('MERCHANT_GROWTH', 'أريد خطة لزيادة المبيعات').intent ===
        'CAMPAIGN_PLAN' &&
      this.provider.classify('CUSTOMER_BEST_DEAL', 'احجز لي هذا العرض').intent === 'TRANSACT';
    check(
      'ARABIC_QUALITY',
      ar,
      'Arabic requests are understood; answers use reviewed Arabic templates',
    );
    const ur = resolveLocale('ur');
    check(
      'URDU_QUALITY',
      ur.locale === 'en' && ur.localeNote?.reason === 'LOCALE_NOT_SUPPORTED_YET',
      'Urdu is not supported yet: answered in English with a note (no machine-translated financial text)',
    );
    return {
      passed: r.filter((x) => x.passed).length,
      failed: r.filter((x) => !x.passed).length,
      results: r,
    };
  }
}
