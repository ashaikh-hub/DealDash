import { Injectable } from '@nestjs/common';
import type { MarketStatus, ReadinessCheck, ReadinessState } from '@dealdash/types';
import { AppError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { MarketConfigService } from './market-config.service';
import { MarketService } from './market.service';

export interface ReadinessItem {
  check: ReadinessCheck;
  state: 'OK' | 'MISSING' | 'VALIDATION_REQUIRED' | 'BLOCKED';
  detail: string;
}

/**
 * The market activation gate. Each mandatory launch item is checked against live configuration; the market's state is READY, NOT_READY
 * (something mandatory is missing), VALIDATION_REQUIRED (configured, but blocking validation items are still open) or BLOCKED (the
 * market is suspended or closed). PILOT needs everything configured (validations may still be open); ACTIVE needs READY.
 */
@Injectable()
export class MarketReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly markets: MarketService,
    private readonly cfg: MarketConfigService,
  ) {}

  async readiness(
    code: string,
    at = new Date(),
  ): Promise<{ market: string; state: ReadinessState; items: ReadinessItem[] }> {
    const m = await this.markets.load(code);
    const p = this.prisma;
    const s = await this.markets.settings();
    const items: ReadinessItem[] = [];
    const add = (check: ReadinessCheck, ok: boolean, detail: string, validation = false) =>
      items.push({
        check,
        state: ok ? (validation ? 'VALIDATION_REQUIRED' : 'OK') : 'MISSING',
        detail,
      });
    const now = {
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    };

    // DealDash legal entity responsible for contracting, invoicing, collection, settlement and tax registration
    const le = m.dealdashLegalEntityId
      ? await p.legalEntity.findUnique({ where: { id: m.dealdashLegalEntityId } })
      : null;
    add(
      'LEGAL_ENTITY',
      !!le && le.country === m.code,
      le
        ? `${le.legalName}${le.taxNumber ? '' : ' (no tax registration recorded)'}`
        : 'No DealDash legal entity is assigned to this market',
    );
    add(
      'DEFAULT_CURRENCY',
      !!m.currency && m.supportedCurrencies.includes(m.currency),
      `${m.currency} (${m.supportedCurrencies.join(', ') || 'none'})`,
    );
    add(
      'LANGUAGE_TIMEZONE',
      m.languages.includes(m.defaultLanguage) && m.timezone !== 'UTC',
      `${m.defaultLanguage} · ${m.timezone}`,
    );
    const products = await p.marketProduct.findMany({
      where: { market: m.code, status: { in: ['TESTING', 'PILOT', 'ACTIVE'] } },
    });
    add(
      'PRODUCTS',
      products.length > 0,
      products.length
        ? products.map((x) => `${x.product}:${x.status}`).join(', ')
        : 'No product is switched on',
    );
    // pricing: a published plan / price book for the market, a market-specific pricing agreement, or the approved default market
    const plans = await p.commercialPlanVersion.count({
      where: { market: m.code, status: 'PUBLISHED' },
    });
    const prices = await p.priceItemVersion.count({
      where: { market: m.code, status: 'PUBLISHED' },
    });
    const agreements = await p.pricingAgreement.count({
      where: { market: m.code, status: 'ACTIVE' },
    });
    add(
      'PRICING',
      plans + prices + agreements > 0 || s.defaultPricingMarkets.includes(m.code),
      `${plans} plan versions, ${prices} price versions, ${agreements} market agreements${s.defaultPricingMarkets.includes(m.code) ? ', default campaign pricing approved' : ''}`,
    );
    const tax = await p.taxRule.findMany({ where: { market: m.code, status: 'APPROVED', ...now } });
    add(
      'TAX',
      tax.length > 0,
      tax.length
        ? tax.map((t) => `${t.code} v${t.version}${t.exempt ? ' (exempt)' : ''}`).join(', ')
        : 'No approved tax treatment (a rule or an explicit exemption) is in force',
    );
    const invoice = await p.invoiceConfig.findMany({
      where: {
        market: m.code,
        status: 'APPROVED',
        documentKind: { in: ['TAX_INVOICE', 'INVOICE'] },
        ...now,
      },
    });
    add(
      'INVOICE',
      invoice.length > 0,
      invoice.length
        ? invoice.map((i) => `${i.documentKind} ${i.prefix} (${i.validationStatus})`).join(', ')
        : 'No approved invoice configuration',
      invoice.length > 0 && invoice.every((i) => i.validationStatus === 'VALIDATION_REQUIRED'),
    );
    // mock adapters document what runs in development; they never satisfy launch readiness
    const real = <T extends { environment: string }>(xs: T[]) =>
      xs.filter((x) => x.environment !== 'MOCK');
    const pay = real(await this.cfg.selectProviders(m.code, 'PAYMENT', { at }));
    add(
      'PAYMENT',
      pay.length > 0,
      pay.length
        ? pay.map((x) => `${x.providerCode} (${x.environment})`).join(', ')
        : 'No active (non-mock) payment provider',
    );
    const settle = await p.settlementRule.count({
      where: { market: m.code, status: 'APPROVED', organizationId: null, contractId: null, ...now },
    });
    add(
      'SETTLEMENT',
      settle > 0,
      settle ? `${settle} market settlement rule(s)` : 'No approved market settlement rule',
    );
    const pol = await p.marketPolicy.findMany({ where: { market: m.code, ...now } });
    const approved = (cat: string, keys: string[]) =>
      pol.some((x) => x.category === cat && keys.includes(x.key) && x.status === 'APPROVED');
    add(
      'LEGAL_TERMS',
      approved('LEGAL_TERMS', ['CUSTOMER_TERMS', 'MERCHANT_TERMS']),
      'Customer / merchant terms version',
    );
    add(
      'PRIVACY_CONSENT',
      approved('PRIVACY_CONSENT', ['PRIVACY_NOTICE']) &&
        approved('PRIVACY_CONSENT', ['CUSTOMER_CONSENT']),
      'Privacy notice and customer consent versions',
    );
    const support = (m.supportContact ?? {}) as { email?: string; phone?: string };
    add(
      'SUPPORT',
      !!(support.email || support.phone),
      support.email || support.phone || 'No support contact',
    );
    add(
      'KYB',
      pol.some((x) => x.category === 'KYB' && x.status === 'APPROVED'),
      'Business (KYB / KYC) requirements',
    );
    const required = pol.filter(
      (x) =>
        x.required &&
        x.status !== 'APPROVED' &&
        !pol.some(
          (y) =>
            y.category === x.category &&
            y.key === x.key &&
            y.product === x.product &&
            y.status === 'APPROVED',
        ),
    );
    const otp = real(await this.cfg.selectProviders(m.code, 'SMS_OTP', { at }));
    const email = real(await this.cfg.selectProviders(m.code, 'EMAIL', { at }));
    add(
      'PROVIDERS',
      otp.length > 0 && email.length > 0 && required.length === 0,
      [
        otp.length ? null : 'SMS / OTP provider missing',
        email.length ? null : 'email provider missing',
        ...required.map((r) => `required ${r.category}/${r.key} not approved`),
      ]
        .filter(Boolean)
        .join('; ') || 'OTP and email providers active',
    );
    const open = await p.marketValidationItem.findMany({
      where: { market: m.code, blocksActivation: true, status: { in: ['OPEN', 'IN_REVIEW'] } },
      select: { code: true },
    });
    items.push({
      check: 'VALIDATIONS',
      state: open.length ? 'VALIDATION_REQUIRED' : 'OK',
      detail: open.length
        ? `${open.length} open: ${open
            .slice(0, 6)
            .map((o) => o.code)
            .join(', ')}${open.length > 6 ? ' …' : ''}`
        : 'No blocking validation item is open',
    });

    let state: ReadinessState = items.some((i) => i.state === 'MISSING')
      ? 'NOT_READY'
      : items.some((i) => i.state === 'VALIDATION_REQUIRED')
        ? 'VALIDATION_REQUIRED'
        : 'READY';
    if (m.status === 'SUSPENDED' || m.status === 'CLOSED') state = 'BLOCKED';
    return { market: m.code, state, items };
  }

  /** The activation gate used by the lifecycle: no silent activation with missing mandatory configuration. */
  async gate(code: string, to: MarketStatus) {
    if (to !== 'PILOT' && to !== 'ACTIVE') return;
    const r = await this.readiness(code);
    const missing = r.items.filter((i) => i.state === 'MISSING').map((i) => i.check);
    if (to === 'PILOT' && missing.length)
      throw new AppError(
        'MARKET_NOT_READY',
        `The market cannot start a pilot: missing ${missing.join(', ')}`,
        409,
      );
    if (to === 'ACTIVE' && r.items.some((i) => i.state !== 'OK'))
      throw new AppError(
        'MARKET_NOT_READY',
        `The market cannot become ACTIVE: ${r.items
          .filter((i) => i.state !== 'OK')
          .map((i) => `${i.check} ${i.state.toLowerCase()}`)
          .join(', ')}`,
        409,
      );
  }
}
