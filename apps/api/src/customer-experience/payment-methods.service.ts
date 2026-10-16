import { Inject, Injectable } from '@nestjs/common';
import { isAllowedBrowserOrigin, type ApiEnv } from '@dealdash/config';
import type { CardSetupResult, SavedCard, SavedCardList } from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { APP_ENV } from '../common/env';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import {
  PAYMENT_PROVIDER,
  supportsCardVault,
  type CardVaultProvider,
  type PaymentProvider,
} from '../providers/interfaces';

type MethodRow = Prisma.CustomerPaymentMethodGetPayload<object>;
const SETUP_MINUTES = 30;
const MAX_CARDS = 10;

const expiredAt = (m: { expMonth: number; expYear: number }, now: Date) =>
  m.expYear < now.getUTCFullYear() ||
  (m.expYear === now.getUTCFullYear() && m.expMonth < now.getUTCMonth() + 1);

/**
 * Saved cards (customer experience, 2026-10-16). A card is added on the PAYMENT PROVIDER's hosted page; DealDash keeps the provider's
 * token and what the provider reports for display (brand, last 4 digits, expiry). No card number or CVV ever reaches DealDash. The
 * outcome of an "add a card" visit is read from the provider server-side (never trusted from the browser). One default card at a time.
 * Real tokenisation needs a contracted provider (EXTERNAL dependency); the development provider stands in until then.
 */
@Injectable()
export class PaymentMethodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(APP_ENV) private readonly env: ApiEnv,
  ) {}

  private vault(): (PaymentProvider & CardVaultProvider) | null {
    return supportsCardVault(this.provider) ? this.provider : null;
  }

  view(m: MethodRow, now = new Date()): SavedCard {
    return {
      id: m.id,
      brand: m.brand as SavedCard['brand'],
      last4: m.last4,
      expMonth: m.expMonth,
      expYear: m.expYear,
      expired: expiredAt(m, now),
      isDefault: m.isDefault,
      addedAt: m.createdAt.toISOString(),
    };
  }

  async list(userId: string): Promise<SavedCardList> {
    const rows = await this.prisma.customerPaymentMethod.findMany({
      where: { userId, status: 'ACTIVE', provider: this.provider.name },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    const now = new Date();
    return { items: rows.map((r) => this.view(r, now)), canSave: !!this.vault() };
  }

  async startSetup(
    actor: Actor,
    input: { returnUrl: string; makeDefault: boolean },
    meta: RequestMeta,
  ) {
    const vault = this.vault();
    if (!vault)
      throw new AppError('CARD_SAVING_UNAVAILABLE', 'Saving cards is not available yet.', 503);
    let origin: string;
    try {
      origin = new URL(input.returnUrl).origin;
    } catch {
      throw AppError.validation('Invalid return address', 'returnUrl');
    }
    if (!isAllowedBrowserOrigin(this.env, origin))
      throw AppError.validation('Invalid return address', 'returnUrl');
    const count = await this.prisma.customerPaymentMethod.count({
      where: { userId: actor.userId, status: 'ACTIVE' },
    });
    if (count >= MAX_CARDS)
      throw new AppError(
        'CARD_SAVING_UNAVAILABLE',
        `You can save up to ${MAX_CARDS} cards. Remove one first.`,
        422,
      );
    const setup = await this.prisma.paymentMethodSetup.create({
      data: {
        userId: actor.userId,
        provider: this.provider.name,
        makeDefault: input.makeDefault,
        expiresAt: new Date(Date.now() + SETUP_MINUTES * 60_000),
      },
    });
    const returnUrl = new URL(input.returnUrl);
    returnUrl.searchParams.set('setup', setup.id);
    const res = await vault.startCardSetup({ setupId: setup.id, returnUrl: returnUrl.toString() });
    await this.prisma.paymentMethodSetup.update({
      where: { id: setup.id },
      data: { providerSetupRef: res.providerSetupRef },
    });
    await this.audit.record({
      action: 'payment_method.setup_started',
      entityType: 'PaymentMethodSetup',
      entityId: setup.id,
      actor,
      meta,
    });
    return { setupId: setup.id, redirectUrl: res.redirectUrl };
  }

  /** The customer is back from the hosted card page: ask the provider what happened and keep the card (once). */
  async finishSetup(actor: Actor, setupId: string, meta: RequestMeta): Promise<CardSetupResult> {
    const setup = await this.prisma.paymentMethodSetup.findFirst({
      where: { id: setupId, userId: actor.userId },
    });
    if (!setup) throw AppError.notFound();
    const done = async (duplicate = false): Promise<CardSetupResult> => {
      const card = setup.paymentMethodId
        ? await this.prisma.customerPaymentMethod.findUnique({
            where: { id: setup.paymentMethodId },
          })
        : null;
      return {
        status: setup.status as CardSetupResult['status'],
        failureCode: setup.failureCode,
        card: card ? this.view(card) : null,
        duplicate,
      };
    };
    if (setup.status !== 'STARTED') return done();
    const vault = this.vault();
    if (!vault || !setup.providerSetupRef)
      throw new AppError('CARD_SAVING_UNAVAILABLE', 'Saving cards is not available yet.', 503);
    const out = await vault.getCardSetup(setup.providerSetupRef);
    if (out.status === 'PENDING') {
      if (setup.expiresAt > new Date())
        return { status: 'PENDING', failureCode: null, card: null, duplicate: false };
      out.status = 'FAILED';
      out.failureCode = 'EXPIRED';
    }
    if (out.status !== 'SUCCEEDED' || !out.card) {
      const status = out.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
      const moved = await this.prisma.paymentMethodSetup.updateMany({
        where: { id: setup.id, status: 'STARTED' },
        data: { status, failureCode: out.failureCode ?? null, completedAt: new Date() },
      });
      if (moved.count)
        await this.audit.record({
          action: `payment_method.setup_${status.toLowerCase()}`,
          entityType: 'PaymentMethodSetup',
          entityId: setup.id,
          actor,
          reason: out.failureCode ?? null,
          meta,
        });
      setup.status = status;
      setup.failureCode = out.failureCode ?? null;
      return done();
    }
    const card = out.card;
    if (!/^\d{4}$/.test(card.last4)) throw new Error('provider returned invalid card details');
    let duplicate = false;
    const methodId = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pm:${actor.userId}`}, 0))`;
      const fresh = await tx.paymentMethodSetup.findUniqueOrThrow({ where: { id: setup.id } });
      if (fresh.status !== 'STARTED') return fresh.paymentMethodId;
      // the same card saved again: keep the one already there (no duplicates)
      const same = await tx.customerPaymentMethod.findFirst({
        where: {
          userId: actor.userId,
          status: 'ACTIVE',
          provider: this.provider.name,
          fingerprint: card.fingerprint,
        },
      });
      let id: string;
      if (same) {
        duplicate = true;
        id = same.id;
      } else {
        const hasDefault = await tx.customerPaymentMethod.count({
          where: { userId: actor.userId, status: 'ACTIVE', isDefault: true },
        });
        const makeDefault = setup.makeDefault || !hasDefault;
        if (makeDefault && hasDefault)
          await tx.customerPaymentMethod.updateMany({
            where: { userId: actor.userId, status: 'ACTIVE', isDefault: true },
            data: { isDefault: false },
          });
        const created = await tx.customerPaymentMethod.create({
          data: {
            userId: actor.userId,
            provider: this.provider.name,
            providerToken: card.token,
            fingerprint: card.fingerprint,
            brand: card.brand,
            last4: card.last4,
            expMonth: card.expMonth,
            expYear: card.expYear,
            isDefault: makeDefault,
          },
        });
        id = created.id;
      }
      await tx.paymentMethodSetup.update({
        where: { id: setup.id },
        data: { status: 'COMPLETED', paymentMethodId: id, completedAt: new Date() },
      });
      await this.audit.record(
        {
          action: duplicate ? 'payment_method.duplicate' : 'payment_method.added',
          entityType: 'CustomerPaymentMethod',
          entityId: id,
          actor,
          newState: { brand: card.brand, last4: card.last4 },
          meta,
        },
        tx,
      );
      return id;
    });
    // a duplicate token the provider created is not needed
    if (duplicate) await vault.deleteCard(card.token).catch(() => undefined);
    setup.status = 'COMPLETED';
    setup.paymentMethodId = methodId;
    return done(duplicate);
  }

  async setDefault(actor: Actor, id: string, meta: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pm:${actor.userId}`}, 0))`;
      const m = await tx.customerPaymentMethod.findFirst({
        where: { id, userId: actor.userId, status: 'ACTIVE' },
      });
      if (!m) throw AppError.notFound();
      if (m.isDefault) return;
      await tx.customerPaymentMethod.updateMany({
        where: { userId: actor.userId, status: 'ACTIVE', isDefault: true },
        data: { isDefault: false },
      });
      await tx.customerPaymentMethod.update({ where: { id }, data: { isDefault: true } });
      await this.audit.record(
        {
          action: 'payment_method.default_set',
          entityType: 'CustomerPaymentMethod',
          entityId: id,
          actor,
          meta,
        },
        tx,
      );
    });
    return this.list(actor.userId);
  }

  /** Removes a card (the provider deletes the token); the newest remaining card becomes the default. */
  async remove(actor: Actor, id: string, meta: RequestMeta) {
    const token = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pm:${actor.userId}`}, 0))`;
      const m = await tx.customerPaymentMethod.findFirst({
        where: { id, userId: actor.userId, status: 'ACTIVE' },
      });
      if (!m) throw AppError.notFound();
      await tx.customerPaymentMethod.update({
        where: { id },
        data: { status: 'REMOVED', isDefault: false, removedAt: new Date() },
      });
      if (m.isDefault) {
        const next = await tx.customerPaymentMethod.findFirst({
          where: { userId: actor.userId, status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
        });
        if (next)
          await tx.customerPaymentMethod.update({
            where: { id: next.id },
            data: { isDefault: true },
          });
      }
      await this.audit.record(
        {
          action: 'payment_method.removed',
          entityType: 'CustomerPaymentMethod',
          entityId: id,
          actor,
          meta,
        },
        tx,
      );
      return m.providerToken;
    });
    await this.vault()
      ?.deleteCard(token)
      .catch(() => undefined);
    return this.list(actor.userId);
  }
}
