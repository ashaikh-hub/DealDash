import { CommercialService } from '../src/finance/commercial.service';
import { randomBytes } from 'node:crypto';
import {
  createBusinessUser,
  createDealDashOrg,
  idem,
  passwordSession,
  type Session,
} from './helpers';
import { SystemConfigService } from '../src/system-config/system-config.service';
import { RewardsLedgerService } from '../src/watch/rewards-ledger.service';
import { WatchLifecycleService } from '../src/watch/watch-lifecycle.service';
import { WatchQualificationService } from '../src/watch/watch-qualification.service';
import { buildVoucherWorld } from './voucher-fixtures';

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
/** Fixed per test file so repeated content() calls describe the SAME schedule. */
const START = hoursFromNow(-1);
const END = hoursFromNow(24 * 14);

/** Complete, valid Watch & Earn content (bilingual): an 8 s video, 10 paid views (budget 1,000 halalas at the mock rate card). */
export function validWatchContent(args: {
  videoFileId: string;
  thumbnailFileId: string;
  overrides?: Record<string, unknown>;
}) {
  return {
    title: { en: 'Meet our chef', ar: 'تعرّف على الشيف' },
    description: {
      en: 'A quick look at how we prepare our signature dish.',
      ar: 'نظرة سريعة على كيفية تحضير طبقنا المميز.',
    },
    ctaLabel: { en: 'See offers', ar: 'شاهد العروض' },
    link: { type: 'MERCHANT', id: null },
    videoFileId: args.videoFileId,
    thumbnailFileId: args.thumbnailFileId,
    durationSec: 8,
    startAt: START,
    endAt: END,
    targeting: {
      cities: ['Riyadh'],
      eligibility: { kind: 'PUBLIC', valueRefs: [] },
      timeWindow: null,
      branchIds: [],
    },
    frequency: { repeatWindowHours: null },
    paidViews: 10,
    ...(args.overrides ?? {}),
  };
}

export interface WatchOpts {
  device?: string;
  secs?: number;
  t0?: Date;
  /** skip ahead instead of playing (a cheater) */
  skip?: boolean;
  /** answer the still-watching prompt: 'now' (default), 'never', 'late', 'instant' (too fast to be human) */
  prompt?: 'now' | 'never' | 'late' | 'instant';
  background?: boolean;
  city?: string;
}

/** The Stage 5 world plus Watch & Earn: videos, risk/finance admins, content and flow helpers, and a simulated viewing clock. */
export async function buildWatchWorld(t: Parameters<typeof buildVoucherWorld>[0]) {
  const w = await buildVoucherWorld(t);
  const dd = await createDealDashOrg(t.prisma);
  const adm = async (role: Parameters<typeof createBusinessUser>[1]['role']) =>
    passwordSession(
      t,
      await createBusinessUser(t.prisma, { role, orgId: dd.id, userType: 'ADMIN_USER', mfa: true }),
      'admin',
      { completeMfa: true },
    );
  const risk = await adm('DEALDASH_RISK_COMPLIANCE');
  const risk2 = await adm('DEALDASH_RISK_COMPLIANCE');

  const video = async (orgId: string) => {
    const id = randomBytes(8).toString('hex');
    const f = await t.prisma.storedFile.create({
      data: {
        organizationId: orgId,
        kind: 'WATCH_VIDEO',
        originalName: `${id}.webm`,
        mimeType: 'video/webm',
        declaredSize: 5000,
        sizeBytes: 5000,
        storageKey: `merchants/${orgId}/watch_video/${id}`,
        status: 'AVAILABLE',
        completedAt: new Date(),
      },
    });
    return f.id;
  };
  const videoA = await video(w.A.orgId);
  const videoB = await video(w.B.orgId);

  const wbase = (org: 'A' | 'B') => `/v1/merchants/${org === 'A' ? w.A.orgId : w.B.orgId}`;
  const ownerOf = (org: 'A' | 'B') => (org === 'A' ? w.ownerA : w.ownerB);
  const watchContent = (org: 'A' | 'B' = 'A', overrides: Record<string, unknown> = {}) =>
    validWatchContent({
      videoFileId: org === 'A' ? videoA : videoB,
      thumbnailFileId: org === 'A' ? w.fileA : w.fileB,
      overrides,
    });

  async function createWatch(org: 'A' | 'B', content: Record<string, unknown>) {
    const res = await w
      .api(ownerOf(org))
      .post(`${wbase(org)}/watch`)
      .set('Idempotency-Key', idem())
      .send({ content });
    if (res.status !== 201 && res.status !== 200)
      throw new Error(`watch create failed ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.data as Record<string, any>;
  }
  const fundWatch = (s: Session, org: 'A' | 'B', id: string, amountHalalas: number, key = idem()) =>
    w
      .api(s)
      .post(`${wbase(org)}/watch/${id}/fund`)
      .set('Idempotency-Key', key)
      .send({ amountHalalas });
  const commercialReady = (id: string) => t.app.get(CommercialService).devComplete('WATCH', id);
  const submitWatch = async (
    org: 'A' | 'B',
    id: string,
  ): Promise<{ status: number; body: any }> => {
    await commercialReady(id);
    return w
      .api(ownerOf(org))
      .post(`${wbase(org)}/watch/${id}/submit`)
      .send({});
  };
  const decideWatch = (
    s: Session,
    id: string,
    action: string,
    body: Record<string, unknown> = { reason: 'Reviewed by test' },
  ) => w.api(s).post(`/v1/admin/watch/${id}/${action}`).send(body);

  /** Create, fund fully, submit and approve as DealDash. Returns the admin detail (status LIVE). */
  async function publishWatch(org: 'A' | 'B' = 'A', overrides: Record<string, unknown> = {}) {
    const v = await createWatch(org, watchContent(org, overrides));
    const f = await fundWatch(ownerOf(org), org, v.id, v.budget.requiredHalalas);
    if (f.status !== 200) throw new Error(`fund failed ${f.status} ${JSON.stringify(f.body)}`);
    const sub = await submitWatch(org, v.id);
    if (sub.status !== 200)
      throw new Error(`watch submit failed ${sub.status} ${JSON.stringify(sub.body)}`);
    const ap = await decideWatch(w.ops, v.id, 'approve');
    if (ap.status !== 200)
      throw new Error(`watch approve failed ${ap.status} ${JSON.stringify(ap.body)}`);
    return ap.body.data as Record<string, any>;
  }

  // ---- configuration changes (restored by the caller)
  const cfg = t.app.get(SystemConfigService);
  const actor = { userId: w.superAdmin.me.id, membership: null } as never;
  const meta = { requestId: 'test', ip: '127.0.0.1', userAgent: 'vitest' } as never;
  async function setConfig(key: string, patch: Record<string, unknown>) {
    const before = (await cfg.get(key)) as Record<string, unknown>;
    await cfg.set(key, { ...before, ...patch }, 'test', actor, meta);
    return async () => {
      await cfg.set(key, before, 'test restore', actor, meta);
    };
  }

  // ---- the viewing simulator (service level, with a simulated clock so tests do not wait)
  const qual = t.app.get(WatchQualificationService);
  const rewards = t.app.get(RewardsLedgerService);
  const lifecycle = t.app.get(WatchLifecycleService);
  const userIdOf = (s: Session) => s.me.id as string;
  let dev = 0;
  const newDevice = () => `device-${Date.now()}-${++dev}-${randomBytes(3).toString('hex')}`;

  async function playView(s: Session, campaignId: string, o: WatchOpts = {}) {
    const userId = userIdOf(s);
    const t0 = o.t0 ?? new Date();
    const secs = o.secs ?? 8;
    const device = o.device ?? newDevice();
    const started = await qual.start(userId, { campaignId, deviceId: device, city: o.city }, t0);
    const at = (sec: number) => new Date(t0.getTime() + sec * 1000);
    let promptSeen: { id: string; deadlineSec: number } | null = null;
    let last = 0;
    if (o.skip) {
      await qual.events(
        userId,
        started.viewId,
        started.viewToken,
        [{ type: 'HEARTBEAT', positionSec: 2 }],
        at(2),
      );
      last = secs;
      // a cheater jumps to the end and reports completion at once
      return {
        started,
        outcome: await qual.complete(userId, started.viewId, started.viewToken, secs, at(3)),
        promptSeen,
      };
    } else {
      for (let tick = 2; tick <= secs; tick += 2) {
        if (o.background && tick === 4) {
          await qual.events(
            userId,
            started.viewId,
            started.viewToken,
            [{ type: 'BACKGROUND', positionSec: 4 }],
            at(4),
          );
          await qual.events(
            userId,
            started.viewId,
            started.viewToken,
            [{ type: 'FOREGROUND', positionSec: 4 }],
            at(30),
          );
          return {
            started,
            outcome: await qual.complete(
              userId,
              started.viewId,
              started.viewToken,
              secs,
              at(secs + 30),
            ),
            promptSeen,
          };
        }
        const r = await qual.events(
          userId,
          started.viewId,
          started.viewToken,
          [{ type: 'HEARTBEAT', positionSec: tick }],
          at(tick),
        );
        if (r.state !== 'STARTED') break;
        if (r.prompt && !promptSeen) {
          promptSeen = r.prompt;
          if (o.prompt === 'never') {
            // the player simply keeps going without answering: later heartbeats are not credited
          } else {
            const delay =
              o.prompt === 'instant' ? 0 : o.prompt === 'late' ? r.prompt.deadlineSec + 10 : 1;
            await qual.events(
              userId,
              started.viewId,
              started.viewToken,
              [{ type: 'PROMPT_ANSWERED', positionSec: tick, promptId: r.prompt.id }],
              at(tick + delay),
            );
          }
        }
        last = tick;
      }
      void last;
    }
    const outcome = await qual.complete(
      userId,
      started.viewId,
      started.viewToken,
      secs,
      at(secs + (o.prompt === 'late' ? 12 : 0) + 0.2),
    );
    return { started, outcome, promptSeen };
  }

  const balanceOf = async (s: Session) => {
    const a = await t.prisma.rewardAccount.findUnique({ where: { userId: userIdOf(s) } });
    return { available: a?.availableBalance ?? 0, held: a?.heldBalance ?? 0 };
  };

  return {
    ...w,
    risk,
    risk2,
    videoA,
    videoB,
    wbase,
    watchContent,
    createWatch,
    fundWatch,
    submitWatch,
    commercialReady,
    decideWatch,
    publishWatch,
    setConfig,
    qual,
    rewards,
    lifecycle,
    userIdOf,
    newDevice,
    playView,
    balanceOf,
  };
}
export type WatchWorld = Awaited<ReturnType<typeof buildWatchWorld>>;
