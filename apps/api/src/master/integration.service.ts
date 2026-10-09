import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import type { ApiEnv } from '@dealdash/config';
import type { IntegrationHealth } from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { decryptField, encryptField } from '../common/crypto';
import { APP_ENV } from '../common/env';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { IngestService, type IngestContext } from './ingest.service';

interface IngestConfig {
  maxRecordsPerRequest: number;
  maxImportRows: number;
  adminApprovalAboveRows: number;
  webhookMaxAttempts: number;
  webhookBackoffSeconds: number[];
}

export interface IngestOutcome {
  syncJobId: string;
  received: number;
  accepted: number;
  rejected: number;
  conflicts: number;
  failures: Array<{ index: number; sourceRecordId: string | null; error: string }>;
  replayed: boolean;
}

const hashSecret = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Integration framework: API credentials (shown once, stored as a hash), scopes, versions, rate limits, idempotent sync jobs, the
 * failed-record queue, outbound webhooks with retries and a dead-letter state, and health (last sync, staleness, error count).
 * No scheme-specific connector lives here; sources use the same versioned ingest contract.
 */
@Injectable()
export class IntegrationService {
  /** Fixed one-minute windows per connection. A single API process is the MVP; a shared cache replaces it when scaling out. */
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: SystemConfigService,
    private readonly ingest: IngestService,
    @Inject(APP_ENV) private readonly env: ApiEnv,
  ) {}

  async ingestConfig(): Promise<IngestConfig> {
    return this.config.get<IngestConfig>(CONFIG_KEYS.PLATFORM_INGEST);
  }

  // ---------------------------------------------------------------- credentials
  async create(
    actor: Actor,
    organizationId: string | null,
    b: { name: string; sourceSystem: string; kind: 'API_PUSH' | 'FEED_PULL' | 'WEBHOOK'; scopes: string[]; rateLimitPerMinute: number; staleAfterMinutes: number; publicationAuthorized: boolean; publicationRef?: string },
    meta: RequestMeta,
  ) {
    if (b.publicationAuthorized && !b.publicationRef) throw AppError.validation('A contract or authorisation reference is required to authorise publication', 'publicationRef');
    const prefix = randomBytes(5).toString('hex');
    const secret = randomBytes(24).toString('base64url');
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.integrationConnection.create({
        data: {
          organizationId,
          name: b.name,
          sourceSystem: b.sourceSystem,
          kind: b.kind,
          scopes: b.scopes,
          rateLimitPerMinute: b.rateLimitPerMinute,
          staleAfterMinutes: b.staleAfterMinutes,
          publicationAuthorized: b.publicationAuthorized,
          publicationRef: b.publicationRef ?? null,
          keyPrefix: prefix,
          keyHash: hashSecret(secret),
          createdByUserId: actor.userId,
        },
      });
      await this.audit.record(
        { action: 'INTEGRATION_CREATED', entityType: 'IntegrationConnection', entityId: r.id, actor, subjectOrganizationId: organizationId, newState: { name: b.name, sourceSystem: b.sourceSystem, scopes: b.scopes }, scope: organizationId ? 'ORGANIZATION' : 'PLATFORM', source: 'UI', meta },
        tx,
      );
      return r;
    });
    return { row, apiKey: `ddk_${prefix}.${secret}` };
  }

  async setStatus(actor: Actor, id: string, organizationId: string | null, status: 'ACTIVE' | 'PAUSED' | 'REVOKED', meta: RequestMeta) {
    const c = await this.prisma.integrationConnection.findFirst({ where: { id, organizationId } });
    if (!c) throw AppError.notFound();
    if (c.status === 'REVOKED') throw new AppError('INVALID_STATE', 'A revoked connection cannot be changed', 409);
    await this.prisma.$transaction(async (tx) => {
      await tx.integrationConnection.update({ where: { id }, data: { status, revokedAt: status === 'REVOKED' ? new Date() : null } });
      await this.audit.record({ action: `INTEGRATION_${status}`, entityType: 'IntegrationConnection', entityId: id, actor, subjectOrganizationId: organizationId, previousState: { status: c.status }, newState: { status }, scope: organizationId ? 'ORGANIZATION' : 'PLATFORM', meta }, tx);
    });
  }

  /** Verifies `ddk_<prefix>.<secret>`; always compares in constant time and gives one generic failure. */
  async authenticate(header: string | undefined, scope?: string) {
    const fail = () => new AppError('INTEGRATION_AUTH_FAILED', 'The API key is not valid', 401);
    const m = /^ddk_([0-9a-f]{10})\.([A-Za-z0-9_-]{20,})$/.exec(header ?? '');
    if (!m) throw fail();
    const c = await this.prisma.integrationConnection.findUnique({ where: { keyPrefix: m[1]! } });
    const given = Buffer.from(hashSecret(m[2]!));
    const real = Buffer.from(c?.keyHash ?? hashSecret('x'));
    if (!c || given.length !== real.length || !timingSafeEqual(given, real)) throw fail();
    if (c.status !== 'ACTIVE') throw new AppError('INTEGRATION_AUTH_FAILED', 'This connection is not active', 401);
    if (scope && !c.scopes.includes(scope)) throw new AppError('SCOPE_FORBIDDEN', 'This key cannot send this kind of record', 403);
    this.rateLimit(c.id, c.rateLimitPerMinute);
    return c;
  }

  private rateLimit(id: string, perMinute: number) {
    const now = Date.now();
    const w = this.windows.get(id);
    if (!w || now - w.start >= 60_000) {
      this.windows.set(id, { start: now, count: 1 });
      return;
    }
    if (w.count >= perMinute) throw AppError.rateLimited('RATE_LIMITED', 'Too many requests for this connection');
    w.count++;
  }

  // ---------------------------------------------------------------- ingest
  /**
   * Applies a batch from an authenticated source. Idempotent per (connection, Idempotency-Key): a retry returns the first result.
   * A bad record never fails the batch: it lands in the failed-record queue with the reason.
   */
  async ingestBatch(connection: { id: string; sourceSystem: string; organizationId: string | null; publicationAuthorized: boolean; publicationRef: string | null; scopes: string[] }, records: unknown[], idempotencyKey: string | undefined): Promise<IngestOutcome> {
    const cfg = await this.ingestConfig();
    if (records.length > cfg.maxRecordsPerRequest) throw AppError.validation(`At most ${cfg.maxRecordsPerRequest} records per request`, 'records');
    if (idempotencyKey) {
      const prior = await this.prisma.syncJob.findUnique({ where: { connectionId_idempotencyKey: { connectionId: connection.id, idempotencyKey } } });
      if (prior?.result) return { ...(prior.result as unknown as IngestOutcome), replayed: true };
    }
    let job;
    try {
      job = await this.prisma.syncJob.create({ data: { connectionId: connection.id, idempotencyKey: idempotencyKey ?? null, received: records.length } });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new AppError('INVALID_STATE', 'A request with this idempotency key is still running', 409);
      throw e;
    }
    const ctx: IngestContext = {
      sourceSystem: connection.sourceSystem,
      sourceOrganizationId: connection.organizationId,
      connectionId: connection.id,
      importJobId: null,
      method: 'API',
      publicationConfirmed: connection.publicationAuthorized,
      publicationRef: connection.publicationRef,
      actorUserId: null,
    };
    const failures: IngestOutcome['failures'] = [];
    let accepted = 0;
    let conflicts = 0;
    let lastSourceUpdate: Date | null = null;
    // merchants first, then outlets, then offers, so a batch can carry all three in any order
    const order = { MERCHANT: 0, BRANCH: 1, OFFER: 2 } as Record<string, number>;
    const indexed = records.map((raw, index) => ({ raw: raw as Record<string, unknown> | null, index }));
    indexed.sort((a, b) => (order[String(a.raw?.type)] ?? 9) - (order[String(b.raw?.type)] ?? 9) || a.index - b.index);
    for (const { raw, index } of indexed) {
      const type = String(raw?.type ?? '');
      const sid = typeof raw?.sourceRecordId === 'string' ? raw.sourceRecordId : null;
      try {
        if (!connection.scopes.includes(type)) throw new AppError('SCOPE_FORBIDDEN', `This key cannot send ${type || 'unknown'} records`, 403);
        const r = await this.ingest.applyRaw(ctx, raw);
        accepted++;
        conflicts += r.conflicts;
        if (typeof raw?.sourceUpdatedAt === 'string') {
          const d = new Date(raw.sourceUpdatedAt);
          if (!Number.isNaN(d.getTime()) && (!lastSourceUpdate || d > lastSourceUpdate)) lastSourceUpdate = d;
        }
      } catch (e) {
        const msg = e instanceof AppError ? ((e.getResponse() as { message?: string }).message ?? e.message) : 'INTERNAL_ERROR';
        failures.push({ index, sourceRecordId: sid, error: msg });
        await this.prisma.failedRecord.create({
          data: { connectionId: connection.id, syncJobId: job.id, recordType: type || null, sourceRecordId: sid, payload: (raw ?? {}) as Prisma.InputJsonValue, error: msg.slice(0, 500) },
        });
      }
    }
    const outcome: IngestOutcome = { syncJobId: job.id, received: records.length, accepted, rejected: failures.length, conflicts, failures: failures.slice(0, 100), replayed: false };
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.syncJob.update({
        where: { id: job.id },
        data: { status: failures.length === records.length ? 'FAILED' : 'COMPLETED', accepted, rejected: failures.length, conflicts, finishedAt: now, result: outcome as unknown as Prisma.InputJsonValue },
      });
      await tx.integrationConnection.update({
        where: { id: connection.id },
        data: {
          lastSyncAt: now,
          ...(accepted > 0 ? { lastSuccessfulSyncAt: now } : {}),
          ...(lastSourceUpdate ? { lastSourceUpdateAt: lastSourceUpdate } : {}),
          errorCount: failures.length ? { increment: failures.length } : undefined,
        },
      });
    });
    if (failures.length) await this.emit(connection.id, 'records.rejected', { syncJobId: job.id, rejected: failures.length });
    if (conflicts) await this.emit(connection.id, 'conflicts.opened', { syncJobId: job.id, conflicts });
    return outcome;
  }

  // ---------------------------------------------------------------- failed records
  async failedRecords(connectionId: string, status = 'OPEN') {
    return (await this.prisma.failedRecord.findMany({ where: { connectionId, status }, orderBy: { createdAt: 'desc' }, take: 200 })).map((f) => ({
      id: f.id,
      recordType: f.recordType,
      sourceRecordId: f.sourceRecordId,
      error: f.error,
      attempts: f.attempts,
      status: f.status,
      createdAt: f.createdAt.toISOString(),
      payload: f.payload,
    }));
  }

  /** RETRY runs the stored record through the same path again; DISCARD keeps it for the audit trail but closes it. */
  async decideFailed(actor: Actor, connectionId: string, id: string, action: 'RETRY' | 'DISCARD', reason: string | undefined, meta: RequestMeta) {
    const f = await this.prisma.failedRecord.findFirst({ where: { id, connectionId } });
    if (!f) throw AppError.notFound();
    if (f.status !== 'OPEN') throw new AppError('INVALID_STATE', 'This record is already closed', 409);
    const c = await this.prisma.integrationConnection.findUniqueOrThrow({ where: { id: connectionId } });
    let result: { ok: boolean; error?: string } = { ok: true };
    if (action === 'RETRY') {
      try {
        await this.ingest.applyRaw(
          { sourceSystem: c.sourceSystem, sourceOrganizationId: c.organizationId, connectionId: c.id, importJobId: null, method: 'API', publicationConfirmed: c.publicationAuthorized, publicationRef: c.publicationRef, actorUserId: actor.userId },
          f.payload,
        );
      } catch (e) {
        result = { ok: false, error: e instanceof AppError ? ((e.getResponse() as { message?: string }).message ?? e.message) : 'INTERNAL_ERROR' };
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.failedRecord.update({
        where: { id },
        data: result.ok
          ? { status: action === 'RETRY' ? 'RETRIED' : 'DISCARDED', resolvedAt: new Date(), resolvedByUserId: actor.userId, attempts: { increment: action === 'RETRY' ? 1 : 0 } }
          : { attempts: { increment: 1 }, error: (result.error ?? f.error).slice(0, 500) },
      });
      await this.audit.record({ action: `FAILED_RECORD_${action}`, entityType: 'FailedRecord', entityId: id, actor, subjectOrganizationId: c.organizationId, reason: reason ?? null, newState: result, scope: c.organizationId ? 'ORGANIZATION' : 'PLATFORM', meta }, tx);
    });
    if (!result.ok) throw AppError.validation(result.error ?? 'The record is still not valid', 'record');
  }

  // ---------------------------------------------------------------- health
  async health(connectionId: string, organizationId: string | null | undefined): Promise<IntegrationHealth> {
    const c = await this.prisma.integrationConnection.findFirst({ where: { id: connectionId, ...(organizationId !== undefined ? { organizationId } : {}) } });
    if (!c) throw AppError.notFound();
    const open = await this.prisma.failedRecord.count({ where: { connectionId, status: 'OPEN' } });
    const last = c.lastSuccessfulSyncAt ?? c.createdAt;
    return {
      connectionId: c.id,
      name: c.name,
      sourceSystem: c.sourceSystem,
      status: c.status,
      lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
      lastSuccessfulSyncAt: c.lastSuccessfulSyncAt?.toISOString() ?? null,
      lastSourceUpdateAt: c.lastSourceUpdateAt?.toISOString() ?? null,
      errorCount: c.errorCount,
      openFailedRecords: open,
      stale: c.status === 'ACTIVE' && Date.now() - last.getTime() > c.staleAfterMinutes * 60_000,
      staleAfterMinutes: c.staleAfterMinutes,
    };
  }

  async list(organizationId: string | null | undefined) {
    return this.prisma.integrationConnection.findMany({
      where: organizationId === undefined ? {} : { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** Marks active connections whose last successful sync is older than their threshold; the sweep calls it. */
  async markStale(now = new Date()): Promise<number> {
    const rows = await this.prisma.integrationConnection.findMany({ where: { status: 'ACTIVE' } });
    let n = 0;
    for (const c of rows) {
      const last = c.lastSuccessfulSyncAt ?? c.createdAt;
      const stale = now.getTime() - last.getTime() > c.staleAfterMinutes * 60_000;
      const refStatus = stale ? 'STALE' : 'SYNCED';
      const res = await this.prisma.externalEntityReference.updateMany({
        where: { connectionId: c.id, syncStatus: stale ? 'SYNCED' : 'STALE' },
        data: { syncStatus: refStatus },
      });
      n += res.count;
    }
    return n;
  }

  // ---------------------------------------------------------------- webhooks (outbound events)
  async addEndpoint(actor: Actor, connectionId: string, organizationId: string | null, b: { url: string; events: string[] }, meta: RequestMeta) {
    const c = await this.prisma.integrationConnection.findFirst({ where: { id: connectionId, organizationId } });
    if (!c) throw AppError.notFound();
    if (this.env.NODE_ENV === 'production' && !b.url.startsWith('https://')) throw AppError.validation('Use an https address', 'url');
    const secret = randomBytes(24).toString('base64url');
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.webhookEndpoint.create({ data: { connectionId, url: b.url, events: b.events, secretEnc: encryptField(secret, this.env.FIELD_ENCRYPTION_KEY) } });
      await this.audit.record({ action: 'WEBHOOK_ENDPOINT_CREATED', entityType: 'WebhookEndpoint', entityId: r.id, actor, subjectOrganizationId: organizationId, newState: { url: b.url, events: b.events }, scope: organizationId ? 'ORGANIZATION' : 'PLATFORM', meta }, tx);
      return r;
    });
    return { id: row.id, url: row.url, events: row.events, secret };
  }

  /** Queues the event for every subscribed endpoint of the connection (delivery happens in the sweep). */
  async emit(connectionId: string, event: string, payload: Record<string, unknown>) {
    const eps = await this.prisma.webhookEndpoint.findMany({ where: { connectionId, status: 'ACTIVE', events: { has: event } } });
    for (const e of eps)
      await this.prisma.webhookDelivery.create({ data: { endpointId: e.id, event, payload: { event, createdAt: new Date().toISOString(), data: payload } as Prisma.InputJsonValue } });
  }

  /**
   * Sends due deliveries. The sender is injected so tests need no network. A failure schedules the next attempt with the configured
   * back-off; after the last attempt the delivery is DEAD (dead-letter) and waits for a person.
   */
  async deliverDue(
    send: (url: string, body: string, headers: Record<string, string>) => Promise<{ ok: boolean; status: number }>,
    now = new Date(),
  ): Promise<{ delivered: number; failed: number; dead: number }> {
    const cfg = await this.ingestConfig();
    const due = await this.prisma.webhookDelivery.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: now } },
      include: { endpoint: true },
      orderBy: { nextAttemptAt: 'asc' },
      take: 50,
    });
    const out = { delivered: 0, failed: 0, dead: 0 };
    for (const d of due) {
      const body = JSON.stringify(d.payload);
      const secret = decryptField(d.endpoint.secretEnc, this.env.FIELD_ENCRYPTION_KEY);
      const ts = String(Math.floor(now.getTime() / 1000));
      const signature = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
      let ok = false;
      let error: string | null = null;
      try {
        const res = await send(d.endpoint.url, body, { 'Content-Type': 'application/json', 'X-DealDash-Event': d.event, 'X-DealDash-Timestamp': ts, 'X-DealDash-Signature': `v1=${signature}`, 'X-DealDash-Delivery': d.id });
        ok = res.ok;
        if (!ok) error = `HTTP ${res.status}`;
      } catch (e) {
        error = e instanceof Error ? e.message.slice(0, 200) : 'SEND_FAILED';
      }
      const attempts = d.attempts + 1;
      if (ok) {
        await this.prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: 'DELIVERED', attempts, deliveredAt: now, lastError: null } });
        out.delivered++;
      } else if (attempts >= cfg.webhookMaxAttempts) {
        await this.prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: 'DEAD', attempts, lastError: error } });
        out.dead++;
      } else {
        const wait = cfg.webhookBackoffSeconds[Math.min(attempts - 1, cfg.webhookBackoffSeconds.length - 1)] ?? 3600;
        await this.prisma.webhookDelivery.update({ where: { id: d.id }, data: { attempts, lastError: error, nextAttemptAt: new Date(now.getTime() + wait * 1000) } });
        out.failed++;
      }
    }
    return out;
  }
}
