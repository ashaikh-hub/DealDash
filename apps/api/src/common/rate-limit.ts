import type { NextFunction, Request, Response } from 'express';

/**
 * Stage 9: API abuse control. A fixed one-minute window per client IP for the whole API and a stricter window for sign-in, OTP and
 * password routes (on top of the per-account OTP / password limits in the auth service). Health checks and signed provider
 * callbacks are not limited here (they have their own protection).
 *
 * The counters live in this process. One API instance (the MVP topology) needs nothing else; running several instances requires a
 * shared store (Redis) or the edge / WAF rate limit in front of them — see docs/PRODUCTION_RUNBOOK.md.
 */
export interface RateLimitOptions {
  perMinute: number;
  authPerMinute: number;
  now?: () => number;
}

const AUTH_PATH = /^\/v\d+\/(auth|app\/auth|staff\/auth)\//;
const EXEMPT_PATH = /^\/v\d+\/(health|webhooks)(\/|$)/;

export function rateLimiter(opts: RateLimitOptions) {
  const now = opts.now ?? Date.now;
  const windows = new Map<string, { start: number; count: number }>();
  let lastSweep = now();
  return (req: Request, res: Response, next: NextFunction) => {
    const path = (req.originalUrl ?? req.url).split('?')[0]!;
    if (EXEMPT_PATH.test(path)) return next();
    const t = now();
    if (t - lastSweep > 60_000) {
      for (const [k, w] of windows) if (t - w.start >= 60_000) windows.delete(k);
      lastSweep = t;
    }
    const ip = req.ip ?? 'unknown';
    const checks: Array<[string, number]> = [];
    if (opts.perMinute > 0) checks.push([`all:${ip}`, opts.perMinute]);
    if (opts.authPerMinute > 0 && AUTH_PATH.test(path) && req.method !== 'GET')
      checks.push([`auth:${ip}`, opts.authPerMinute]);
    for (const [key, limit] of checks) {
      let w = windows.get(key);
      if (!w || t - w.start >= 60_000) {
        w = { start: t, count: 0 };
        windows.set(key, w);
      }
      w.count++;
      if (w.count > limit) {
        const retry = Math.max(1, Math.ceil((w.start + 60_000 - t) / 1000));
        res.setHeader('Retry-After', String(retry));
        res.status(429).json({
          errors: [
            {
              code: 'RATE_LIMITED',
              message: 'Too many requests. Please wait a moment and try again.',
            },
          ],
          meta: {},
        });
        return;
      }
    }
    next();
  };
}
