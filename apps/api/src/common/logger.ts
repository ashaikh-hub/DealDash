import type { LoggerService } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { AppRequest } from './request-context';

/**
 * Stage 9: structured logging. One JSON object per line (LOG_FORMAT=json) so the log platform can index level, context and the
 * request id that ties a log line to the API response (X-Request-Id) and to the business audit (AuditLog.correlationId).
 * Application logs are operational and short-lived; the immutable business history is the AuditLog table, never these lines.
 *
 * Redaction: values of sensitive keys and anything that looks like a secret, an OTP / card number or a bearer token are masked
 * before writing. Logs carry ids, never names, mobiles, e-mails or message bodies.
 */
const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|cookie|otp|code|pan|cvv|iban|card|session|signature|apikey|api_key|credential/i;
const PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, 'Bearer [REDACTED]'],
  [/postgres(ql)?:\/\/[^\s"']+/g, 'postgresql://[REDACTED]'],
  [/(?:\d[ -]?){13,19}/g, '[REDACTED-NUMBER]'],
  [/\b\d{6}\b/g, '[REDACTED-CODE]'],
  [/\+?\d{9,15}/g, '[REDACTED-PHONE]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED-EMAIL]'],
];

export function redactText(s: string): string {
  let out = s;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[…]';
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    return out;
  }
  return value;
}

type Level = 'error' | 'warn' | 'info' | 'debug';

export class JsonLogger implements LoggerService {
  constructor(
    private readonly write: (line: string) => void = (l) => process.stdout.write(`${l}\n`),
  ) {}

  private emit(level: Level, message: unknown, context?: string, extra?: Record<string, unknown>) {
    const text =
      message instanceof Error
        ? `${message.name}: ${message.message}`
        : typeof message === 'string'
          ? message
          : JSON.stringify(redact(message));
    this.write(
      JSON.stringify({
        time: new Date().toISOString(),
        level,
        context: context ?? 'App',
        msg: redactText(text).slice(0, 4000),
        ...(extra ? (redact(extra) as object) : {}),
      }),
    );
  }

  log(message: unknown, context?: string) {
    this.emit('info', message, context);
  }
  error(message: unknown, trace?: string, context?: string) {
    this.emit(
      'error',
      message,
      context,
      trace ? { trace: redactText(String(trace)).slice(0, 4000) } : undefined,
    );
  }
  warn(message: unknown, context?: string) {
    this.emit('warn', message, context);
  }
  debug(message: unknown, context?: string) {
    this.emit('debug', message, context);
  }
  verbose(message: unknown, context?: string) {
    this.emit('debug', message, context);
  }
  /** One access-log line per request: method, path WITHOUT the query string, status, duration, request id. No bodies, no PII. */
  request(fields: {
    method: string;
    path: string;
    status: number;
    ms: number;
    requestId?: string;
    userId?: string | null;
  }) {
    this.emit(
      fields.status >= 500 ? 'error' : fields.status >= 400 ? 'warn' : 'info',
      `${fields.method} ${fields.path} ${fields.status}`,
      'Http',
      fields,
    );
  }
}

/** Access log middleware (only installed with LOG_FORMAT=json). */
export function accessLog(logger: JsonLogger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const r = req as AppRequest & { actor?: { userId?: string } };
      logger.request({
        method: req.method,
        path: (req.originalUrl ?? req.url)
          .split('?')[0]!
          .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id'),
        status: res.statusCode,
        ms: Number((process.hrtime.bigint() - start) / 1_000_000n),
        requestId: r.meta?.requestId,
        userId: r.actor?.userId ?? null,
      });
    });
    next();
  };
}
