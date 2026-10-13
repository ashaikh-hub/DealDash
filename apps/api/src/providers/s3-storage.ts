import { createHash, createHmac } from 'node:crypto';
import type { SignedUpload, StorageProvider, StoredObjectInfo } from './interfaces';

/**
 * Launch readiness: provider-neutral object storage over the S3-compatible API with AWS Signature V4 (no vendor SDK). The same
 * adapter works with Google Cloud Storage (XML API + HMAC keys, endpoint https://storage.googleapis.com), Amazon S3, Cloudflare R2,
 * MinIO, or an onshore S3-compatible store — so a market can change storage location without code changes (portability rule).
 *
 * Browsers upload and download directly with short-lived pre-signed URLs (bucket CORS must allow the app origins); the API itself
 * only signs, checks (HEAD / bounded GET for content sniffing) and deletes. Objects stay private; nothing is ever public-read.
 */
export interface S3StorageConfig {
  endpoint: string; // e.g. https://storage.googleapis.com
  bucket: string;
  region: string; // GCS accepts "auto"; S3 needs the bucket region
  accessKeyId: string;
  secretAccessKey: string;
  /** path style (https://host/bucket/key) — the default, works everywhere; virtual-hosted otherwise */
  pathStyle?: boolean;
}

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const UPLOAD_SECONDS = 10 * 60;

/** RFC 3986 encoding as SigV4 requires (`/` kept in paths when asked). */
export function uriEncode(value: string, keepSlash = false): string {
  let out = '';
  for (const ch of value) {
    if (/[A-Za-z0-9\-._~]/.test(ch) || (keepSlash && ch === '/')) out += ch;
    else
      for (const b of Buffer.from(ch, 'utf8'))
        out += `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

const sha256 = (data: string) => createHash('sha256').update(data, 'utf8').digest('hex');
const hmac = (key: Buffer | string, data: string) =>
  createHmac('sha256', key).update(data, 'utf8').digest();

/** `20130524T000000Z` */
export const amzDate = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

function signingKey(secret: string, day: string, region: string, service: string) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), service), 'aws4_request');
}

const canonicalQuery = (q: Record<string, string>) =>
  Object.keys(q)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(q[k]!)}`)
    .join('&');

interface SignInput {
  method: string;
  host: string;
  path: string; // already URI-encoded, starting with /
  query?: Record<string, string>;
  headers?: Record<string, string>; // extra headers to sign (lower-case names)
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  date: Date;
  service?: string;
}

/** Pre-signed URL (query-string authentication). */
export function presignUrl(input: SignInput & { expiresSeconds: number }): string {
  const service = input.service ?? 's3';
  const stamp = amzDate(input.date);
  const day = stamp.slice(0, 8);
  const scope = `${day}/${input.region}/${service}/aws4_request`;
  const headers: Record<string, string> = {
    host: input.host,
    ...Object.fromEntries(
      Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    ),
  };
  const names = Object.keys(headers).sort();
  const query: Record<string, string> = {
    ...(input.query ?? {}),
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${input.accessKeyId}/${scope}`,
    'X-Amz-Date': stamp,
    'X-Amz-Expires': String(input.expiresSeconds),
    'X-Amz-SignedHeaders': names.join(';'),
  };
  const canonical = [
    input.method,
    input.path,
    canonicalQuery(query),
    names.map((n) => `${n}:${headers[n]!.trim()}\n`).join(''),
    names.join(';'),
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
  const signature = createHmac(
    'sha256',
    signingKey(input.secretAccessKey, day, input.region, service),
  )
    .update(toSign, 'utf8')
    .digest('hex');
  return `https://${input.host}${input.path}?${canonicalQuery(query)}&X-Amz-Signature=${signature}`;
}

/** Authorization header for a server-side request without a body (HEAD / GET / DELETE). */
export function signHeaders(input: SignInput): Record<string, string> {
  const service = input.service ?? 's3';
  const stamp = amzDate(input.date);
  const day = stamp.slice(0, 8);
  const scope = `${day}/${input.region}/${service}/aws4_request`;
  const headers: Record<string, string> = {
    host: input.host,
    'x-amz-content-sha256': EMPTY_SHA256,
    'x-amz-date': stamp,
    ...Object.fromEntries(
      Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    ),
  };
  const names = Object.keys(headers).sort();
  const canonical = [
    input.method,
    input.path,
    canonicalQuery(input.query ?? {}),
    names.map((n) => `${n}:${headers[n]!.trim()}\n`).join(''),
    names.join(';'),
    headers['x-amz-content-sha256'],
  ].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
  const signature = createHmac(
    'sha256',
    signingKey(input.secretAccessKey, day, input.region, service),
  )
    .update(toSign, 'utf8')
    .digest('hex');
  const { host: _host, ...sent } = headers;
  return {
    ...sent,
    Authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
  };
}

/** Keys are generated by the API; still, refuse anything that could escape the bucket or confuse signing. */
function assertKey(key: string) {
  if (
    !key ||
    key.length > 512 ||
    key.startsWith('/') ||
    key.includes('..') ||
    [...key].some((c) => c.charCodeAt(0) < 0x20 || c === '\\') // control characters or backslash
  )
    throw new Error('Invalid storage key');
}

export class S3StorageProvider implements StorageProvider {
  private readonly host: string;
  private readonly basePath: string;

  constructor(
    private readonly cfg: S3StorageConfig,
    private readonly http: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    const u = new URL(cfg.endpoint);
    if (u.protocol !== 'https:') throw new Error('S3 endpoint must be https');
    const pathStyle = cfg.pathStyle ?? true;
    this.host = pathStyle ? u.host : `${cfg.bucket}.${u.host}`;
    this.basePath = pathStyle ? `/${uriEncode(cfg.bucket)}` : '';
  }

  private pathOf(key: string) {
    assertKey(key);
    return `${this.basePath}/${uriEncode(key, true)}`;
  }

  private base(method: string, key: string) {
    return {
      method,
      host: this.host,
      path: this.pathOf(key),
      region: this.cfg.region,
      accessKeyId: this.cfg.accessKeyId,
      secretAccessKey: this.cfg.secretAccessKey,
      date: this.now(),
    };
  }

  async createUploadUrl(input: {
    key: string;
    contentType: string;
    maxBytes: number;
  }): Promise<SignedUpload> {
    // Content-Type is signed, so the browser must send exactly the declared type. The size limit is enforced after upload by the
    // completion check (HEAD + bounded read), which rejects and deletes oversized objects.
    const url = presignUrl({
      ...this.base('PUT', input.key),
      headers: { 'content-type': input.contentType },
      expiresSeconds: UPLOAD_SECONDS,
    });
    return {
      url,
      method: 'PUT',
      headers: { 'Content-Type': input.contentType },
      key: input.key,
      expiresAt: new Date(this.now().getTime() + UPLOAD_SECONDS * 1000).toISOString(),
    };
  }

  async createReadUrl(input: {
    key: string;
    expiresInSeconds: number;
    fileName?: string;
  }): Promise<string> {
    const query: Record<string, string> = {};
    if (input.fileName)
      query['response-content-disposition'] =
        `attachment; filename="${input.fileName.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${uriEncode(input.fileName)}`;
    return presignUrl({
      ...this.base('GET', input.key),
      query,
      expiresSeconds: Math.max(1, Math.min(input.expiresInSeconds, 7 * 24 * 3600)),
    });
  }

  private async send(method: 'HEAD' | 'GET' | 'DELETE', key: string) {
    const b = this.base(method, key);
    return this.http(`https://${b.host}${b.path}`, { method, headers: signHeaders(b) });
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    const res = await this.send('HEAD', key);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Storage HEAD failed (${res.status})`);
    return { sizeBytes: Number(res.headers.get('content-length') ?? 0) };
  }

  async read(key: string, maxBytes: number): Promise<Buffer | null> {
    const info = await this.head(key);
    if (!info || info.sizeBytes > maxBytes) return null;
    const res = await this.send('GET', key);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Storage GET failed (${res.status})`);
    const data = Buffer.from(await res.arrayBuffer());
    return data.length > maxBytes ? null : data;
  }

  async delete(key: string): Promise<void> {
    const res = await this.send('DELETE', key);
    if (!res.ok && res.status !== 404) throw new Error(`Storage DELETE failed (${res.status})`);
  }
}
