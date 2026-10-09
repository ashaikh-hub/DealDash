import { Injectable } from '@nestjs/common';
import { CONFIG_KEYS, type ConfigKey } from '@dealdash/config';
import type { TrustLevel } from '@dealdash/types';

import { SystemConfigService } from '../system-config/system-config.service';

export type GuardrailOutcome = 'AUTO_PUBLISH' | 'MANUAL_REVIEW';
export interface GuardrailResult {
  outcome: GuardrailOutcome;
  reasons: string[];
}

interface AutoPublishConfig {
  enabled: boolean;
  minTrustLevel: TrustLevel;
}
interface GuardrailConfig {
  maxPercentOff: number;
  reviewMechanics: string[];
  prohibitedTerms: string[];
}

/** The part of any deal content (Live or Hot) the guardrails look at. */
export interface GuardrailSubject {
  mechanic: string | null;
  valueNumber: number | null;
  title: { en: string; ar: string };
  description: { en: string; ar: string };
  terms: { textEn: string; textAr: string };
}

const TRUST_RANK: Record<TrustLevel, number> = { NEW: 0, STANDARD: 1, TRUSTED: 2 };

/**
 * Campaign guardrails (AP-02, simplified). Pilot posture (BP-03): every campaign goes to manual review.
 * Auto-publish exists behind the `live_deals.auto_publish` switch for approved, trusted merchants later.
 * The numeric ranges are MOCK configuration (VALIDATE-KSA VK-01).
 */
@Injectable()
export class GuardrailsService {
  constructor(private readonly config: SystemConfigService) {}

  async evaluate(
    content: GuardrailSubject,
    trustLevel: TrustLevel,
    keys: { auto: ConfigKey; rules: ConfigKey } = {
      auto: CONFIG_KEYS.LIVE_DEAL_AUTO_PUBLISH,
      rules: CONFIG_KEYS.LIVE_DEAL_GUARDRAILS,
    },
  ): Promise<GuardrailResult> {
    const auto = await this.config.get<AutoPublishConfig>(keys.auto);
    const rules = await this.config.get<GuardrailConfig>(keys.rules);
    const reasons: string[] = [];

    if (!auto?.enabled) reasons.push('PILOT_MANUAL_REVIEW');
    else if (TRUST_RANK[trustLevel] < TRUST_RANK[auto.minTrustLevel])
      reasons.push('TRUST_LEVEL_TOO_LOW');

    if (content.mechanic && rules?.reviewMechanics?.includes(content.mechanic))
      reasons.push('MECHANIC_REQUIRES_REVIEW');
    if (
      content.mechanic === 'PERCENTAGE_OFF' &&
      content.valueNumber !== null &&
      rules?.maxPercentOff &&
      content.valueNumber > rules.maxPercentOff
    )
      reasons.push('DISCOUNT_ABOVE_RANGE');

    const text = [
      content.title.en,
      content.title.ar,
      content.description.en,
      content.description.ar,
      content.terms.textEn,
      content.terms.textAr,
    ]
      .join(' ')
      .toLowerCase();
    if ((rules?.prohibitedTerms ?? []).some((t) => t && text.includes(t.toLowerCase())))
      reasons.push('PROHIBITED_TERM');

    return { outcome: reasons.length ? 'MANUAL_REVIEW' : 'AUTO_PUBLISH', reasons };
  }
}
