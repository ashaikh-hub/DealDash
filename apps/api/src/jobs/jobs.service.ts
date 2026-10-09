import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { hostname } from 'node:os';
import type { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

export type JobHandler = (
  payload: Record<string, unknown>,
  ctx: { jobId: string; attempt: number },
) => Promise<unknown>;

export interface EnqueueOptions {
  idempotencyKey?: string;
  runAt?: Date;
  maxAttempts?: number;
}

const BASE_BACKOFF_MS = 1_000;

/**
 * Minimal background-job framework on PostgreSQL (no extra infrastructure):
 * enqueue with idempotency key, claim with FOR UPDATE SKIP LOCKED, retry with exponential backoff,
 * DEAD-letter after max attempts, structured logging. Product jobs (reservation expiry, etc.) register handlers later.
 * The queue sits behind this service, so it can be swapped for BullMQ/pg-boss without touching callers.
 */
@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly logger = new Logger('Jobs');
  private readonly handlers = new Map<string, JobHandler>();
  private readonly workerId = `${hostname()}-${process.pid}`;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  register(type: string, handler: JobHandler) {
    this.handlers.set(type, handler);
  }

  async enqueue(type: string, payload: Record<string, unknown>, opts: EnqueueOptions = {}) {
    if (opts.idempotencyKey) {
      const existing = await this.prisma.job.findUnique({
        where: { idempotencyKey: opts.idempotencyKey },
      });
      if (existing) return existing; // idempotent: same key never creates a second job
    }
    try {
      const job = await this.prisma.job.create({
        data: {
          type,
          payload: payload as Prisma.InputJsonValue,
          idempotencyKey: opts.idempotencyKey,
          runAt: opts.runAt ?? new Date(),
          maxAttempts: opts.maxAttempts ?? 3,
        },
      });
      await this.audit.record({
        action: 'job.enqueued',
        entityType: 'Job',
        entityId: job.id,
        reason: type,
      });
      return job;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002' && opts.idempotencyKey) {
        return this.prisma.job.findUniqueOrThrow({
          where: { idempotencyKey: opts.idempotencyKey },
        });
      }
      throw e;
    }
  }

  /** Atomically claims one due job. Safe with several workers. */
  private async claim() {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "Job" SET "status" = 'RUNNING', "lockedAt" = (now() AT TIME ZONE 'UTC'), "lockedBy" = ${this.workerId},
             "attempts" = "attempts" + 1, "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE "id" = (
        SELECT "id" FROM "Job"
        WHERE "status" IN ('QUEUED', 'FAILED') AND "runAt" <= (now() AT TIME ZONE 'UTC')
        ORDER BY "runAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING "id"`;
    const id = rows[0]?.id;
    return id ? this.prisma.job.findUniqueOrThrow({ where: { id } }) : null;
  }

  /** Processes at most `max` due jobs; returns how many were handled. */
  async runDue(max = 10): Promise<number> {
    let handled = 0;
    for (let i = 0; i < max; i++) {
      const job = await this.claim();
      if (!job) break;
      handled++;
      const handler = this.handlers.get(job.type);
      try {
        if (!handler) throw new Error(`No handler registered for job type "${job.type}"`);
        const result = await handler(job.payload as Record<string, unknown>, {
          jobId: job.id,
          attempt: job.attempts,
        });
        await this.prisma.job.update({
          where: { id: job.id },
          data: {
            status: 'SUCCEEDED',
            result: (result ?? null) as Prisma.InputJsonValue,
            finishedAt: new Date(),
            lockedAt: null,
            lockedBy: null,
            lastError: null,
          },
        });
        this.logger.log(`Job ${job.type} ${job.id} succeeded (attempt ${job.attempts})`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const dead = job.attempts >= job.maxAttempts;
        await this.prisma.job.update({
          where: { id: job.id },
          data: {
            status: dead ? 'DEAD' : 'FAILED',
            lastError: message.slice(0, 1000),
            runAt: dead
              ? job.runAt
              : new Date(Date.now() + BASE_BACKOFF_MS * 2 ** (job.attempts - 1)),
            lockedAt: null,
            lockedBy: null,
            finishedAt: dead ? new Date() : null,
          },
        });
        this.logger.warn(
          `Job ${job.type} ${job.id} failed (attempt ${job.attempts}/${job.maxAttempts}): ${message}`,
        );
        if (dead)
          await this.audit.record({
            action: 'job.failed',
            entityType: 'Job',
            entityId: job.id,
            reason: message.slice(0, 300),
          });
      }
    }
    return handled;
  }

  /** Starts the polling worker (development and production worker process). Disabled in tests. */
  start(intervalMs = 2000) {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.runDue()
        .catch((e) => this.logger.error(String(e)))
        .finally(() => (this.running = false));
    }, intervalMs);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  list(take = 50) {
    return this.prisma.job.findMany({ orderBy: { createdAt: 'desc' }, take });
  }

  get(id: string) {
    return this.prisma.job.findUnique({ where: { id } });
  }
}
