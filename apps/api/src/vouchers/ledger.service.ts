import { Injectable } from '@nestjs/common';
import type { LedgerAccountFamily, LedgerJournalType } from '@dealdash/types';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface JournalLine {
  family: LedgerAccountFamily;
  /** Merchant accounts carry the organization; platform accounts (PSP clearing, revenue, expired value, adjustments) do not. */
  organizationId?: string | null;
  /** Signed halalas: debit-positive for assets, credit-negative for liabilities. All lines of a journal sum to zero. */
  amountHalalas: number;
  memo?: string;
}

export interface PostJournalInput {
  type: LedgerJournalType;
  sourceType: string;
  sourceId: string;
  /** One journal per business event: posting the same key again is a no-op that returns the first journal. */
  idempotencyKey: string;
  memo?: string;
  reasonCode?: string;
  feeRuleVersion?: number;
  reversesJournalId?: string;
  actor?: { userId: string | null; role: string | null } | null;
  lines: JournalLine[];
}

/**
 * Financial ledger foundation (Business Rules section 11A). Append-only: a journal is never edited or deleted (database
 * trigger); corrections are new reversing or adjusting journals. Every journal balances (checked here and again by a
 * deferred constraint trigger when the transaction commits). Account families keep concepts separate: PSP clearing,
 * merchant amounts held, merchant settlement-eligible, platform revenue, expired value, adjustments.
 *
 * The ledger is model-neutral: it records WHAT happened; who holds the funds and the legal/accounting treatment are open
 * (VALIDATE-KSA VK-05, VK-16) and can change without a schema change.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Finds or creates an account. Safe under concurrency (the partial unique indexes decide a race). */
  async account(
    tx: Prisma.TransactionClient,
    family: LedgerAccountFamily,
    organizationId: string | null,
  ): Promise<string> {
    const found = await tx.ledgerAccount.findFirst({
      where: { family, organizationId: organizationId ?? null },
      select: { id: true },
    });
    if (found) return found.id;
    // ON CONFLICT DO NOTHING keeps a concurrent creation from aborting the surrounding transaction
    if (organizationId)
      await tx.$executeRaw`INSERT INTO "LedgerAccount" ("id", "family", "organizationId", "currency")
        VALUES (gen_random_uuid(), ${family}::"LedgerAccountFamily", ${organizationId}::uuid, 'SAR')
        ON CONFLICT ("family", "organizationId") WHERE "organizationId" IS NOT NULL DO NOTHING`;
    else
      await tx.$executeRaw`INSERT INTO "LedgerAccount" ("id", "family", "currency")
        VALUES (gen_random_uuid(), ${family}::"LedgerAccountFamily", 'SAR')
        ON CONFLICT ("family") WHERE "organizationId" IS NULL DO NOTHING`;
    const row = await tx.ledgerAccount.findFirstOrThrow({
      where: { family, organizationId: organizationId ?? null },
      select: { id: true },
    });
    return row.id;
  }

  /**
   * Posts one balanced journal inside the caller's transaction. Returns `{ journalId, created }`; `created` is false when
   * the idempotency key already exists (a retry or a duplicate callback), in which case nothing is written.
   */
  async post(
    tx: Prisma.TransactionClient,
    input: PostJournalInput,
  ): Promise<{ journalId: string; created: boolean }> {
    const sum = input.lines.reduce((n, l) => n + l.amountHalalas, 0);
    if (sum !== 0)
      throw new Error(`Ledger journal ${input.idempotencyKey} does not balance (sum ${sum})`);
    if (input.lines.some((l) => !Number.isInteger(l.amountHalalas)))
      throw new Error('Ledger amounts are integer halalas');
    const existing = await tx.ledgerJournal.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true },
    });
    if (existing) return { journalId: existing.id, created: false };
    const journal = await tx.ledgerJournal.create({
      data: {
        type: input.type,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        idempotencyKey: input.idempotencyKey,
        memo: input.memo ?? null,
        reasonCode: input.reasonCode ?? null,
        feeRuleVersion: input.feeRuleVersion ?? null,
        reversesJournalId: input.reversesJournalId ?? null,
        postedByUserId: input.actor?.userId ?? null,
        postedByRole: input.actor?.role ?? (input.actor ? null : 'SYSTEM'),
      },
    });
    for (const l of input.lines.filter((x) => x.amountHalalas !== 0)) {
      const accountId = await this.account(tx, l.family, l.organizationId ?? null);
      await tx.ledgerEntry.create({
        data: {
          journalId: journal.id,
          accountId,
          amountHalalas: l.amountHalalas,
          memo: l.memo ?? null,
        },
      });
    }
    return { journalId: journal.id, created: true };
  }

  /** The exact opposite of a journal, as a new journal (corrections never edit history). */
  async reverse(
    tx: Prisma.TransactionClient,
    journalId: string,
    input: Omit<PostJournalInput, 'lines' | 'type' | 'reversesJournalId'> & {
      type?: LedgerJournalType;
    },
  ) {
    const entries = await tx.ledgerEntry.findMany({
      where: { journalId },
      include: { account: true },
    });
    return this.post(tx, {
      ...input,
      type: input.type ?? 'REVERSAL',
      reversesJournalId: journalId,
      lines: entries.map((e) => ({
        family: e.account.family as LedgerAccountFamily,
        organizationId: e.account.organizationId,
        amountHalalas: -e.amountHalalas,
        memo: `Reversal: ${e.memo ?? ''}`.trim(),
      })),
    });
  }

  // ---------------------------------------------------------------- balances (always computed from the entries)
  async balance(family: LedgerAccountFamily, organizationId: string | null): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ total: bigint | null }>>(Prisma.sql`
      SELECT COALESCE(SUM(e."amountHalalas"), 0)::bigint AS total
      FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a."id" = e."accountId"
      WHERE a."family" = ${family}::"LedgerAccountFamily"
        AND ${organizationId ? Prisma.sql`a."organizationId" = ${organizationId}::uuid` : Prisma.sql`a."organizationId" IS NULL`}`);
    return Number(rows[0]?.total ?? 0);
  }

  /** Balances of the accounts of one family, per organization (null key = platform account). */
  async balancesByOrganization(family: LedgerAccountFamily) {
    const rows = await this.prisma.$queryRaw<
      Array<{ organizationId: string | null; total: bigint }>
    >(
      Prisma.sql`
        SELECT a."organizationId", COALESCE(SUM(e."amountHalalas"), 0)::bigint AS total
        FROM "LedgerAccount" a LEFT JOIN "LedgerEntry" e ON e."accountId" = a."id"
        WHERE a."family" = ${family}::"LedgerAccountFamily"
        GROUP BY a."organizationId"`,
    );
    return new Map(rows.map((r) => [r.organizationId, Number(r.total)]));
  }

  /** Trial balance: every journal sums to zero and so does the whole ledger. */
  async trialBalance() {
    const rows = await this.prisma.$queryRaw<
      Array<{ journals: bigint; unbalanced: bigint; total: bigint }>
    >(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS journals,
               COUNT(*) FILTER (WHERE s.total <> 0)::bigint AS unbalanced,
               COALESCE(SUM(s.total), 0)::bigint AS total
        FROM (SELECT j."id", COALESCE(SUM(e."amountHalalas"), 0) AS total
              FROM "LedgerJournal" j LEFT JOIN "LedgerEntry" e ON e."journalId" = j."id"
              GROUP BY j."id") s`,
    );
    const r = rows[0];
    return {
      journals: Number(r?.journals ?? 0),
      balanced: Number(r?.unbalanced ?? 0) === 0 && Number(r?.total ?? 0) === 0,
    };
  }

  /** Merchant payable view, from the ledger: customer money held vs settlement-eligible (net of fee). */
  async merchantPosition(organizationId: string) {
    const [held, eligible, expired] = await Promise.all([
      this.balance('MERCHANT_HELD', organizationId),
      this.balance('MERCHANT_SETTLEMENT_ELIGIBLE', organizationId),
      this.balance('EXPIRED_VALUE', organizationId),
    ]);
    // liabilities are stored credit-negative; the position is shown as positive amounts the platform owes / holds
    return {
      heldHalalas: -held,
      settlementEligibleHalalas: -eligible,
      expiredValueHalalas: -expired,
    };
  }
}
