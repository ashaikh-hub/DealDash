import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { FileScanner, SignedUpload, StorageProvider, StoredObjectInfo } from './interfaces';

export interface SignedTokenPayload {
  /** operation: upload (PUT) or download (GET) */
  op: 'put' | 'get';
  key: string;
  exp: number;
  ct?: string;
  max?: number;
  name?: string;
}

/** Compact HMAC-signed token used in the development storage URLs (expires; bound to key, operation and limits). */
export function signToken(payload: SignedTokenPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(
  token: string,
  secret: string,
  now = Date.now(),
): SignedTokenPayload | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as SignedTokenPayload;
    return payload.exp > now ? payload : null;
  } catch {
    return null;
  }
}

/**
 * DEVELOPMENT storage adapter: stores objects on local disk and hands out short-lived HMAC-signed URLs served by the
 * API (`/v1/storage/...`). Objects are private (no direct disk or public URL). It implements the same contract a
 * cloud/S3 adapter will, so no business code changes when a vendor is selected.
 */
export class LocalStorageProvider implements StorageProvider {
  private readonly root: string;

  constructor(
    dir: string,
    private readonly publicBaseUrl: string,
    private readonly secret: string,
  ) {
    this.root = resolve(dir);
  }

  /** Resolves a key to a path inside the storage root (rejects traversal). */
  pathFor(key: string): string {
    const p = resolve(this.root, key);
    if (p !== this.root && !p.startsWith(this.root + sep)) throw new Error('Invalid storage key');
    return p;
  }

  async createUploadUrl(input: {
    key: string;
    contentType: string;
    maxBytes: number;
  }): Promise<SignedUpload> {
    const exp = Date.now() + 10 * 60_000;
    const token = signToken(
      { op: 'put', key: input.key, exp, ct: input.contentType, max: input.maxBytes },
      this.secret,
    );
    return {
      url: `${this.publicBaseUrl}/v1/storage/upload/${token}`,
      method: 'PUT',
      headers: { 'Content-Type': input.contentType },
      key: input.key,
      expiresAt: new Date(exp).toISOString(),
    };
  }

  async createReadUrl(input: {
    key: string;
    expiresInSeconds: number;
    fileName?: string;
  }): Promise<string> {
    const exp = Date.now() + input.expiresInSeconds * 1000;
    return `${this.publicBaseUrl}/v1/storage/download/${signToken({ op: 'get', key: input.key, exp, name: input.fileName }, this.secret)}`;
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    try {
      const s = await stat(this.pathFor(key));
      return { sizeBytes: s.size };
    } catch {
      return null;
    }
  }

  async read(key: string, maxBytes: number): Promise<Buffer | null> {
    try {
      const p = this.pathFor(key);
      if ((await stat(p)).size > maxBytes) return null;
      return await readFile(p);
    } catch {
      return null;
    }
  }

  async write(key: string, data: Buffer): Promise<void> {
    const p = this.pathFor(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

/** Magic-byte sniffing for the allowed document and image types (never trust the declared type alone). */
export function sniffMime(
  data: Buffer,
): 'application/pdf' | 'image/jpeg' | 'image/png' | 'video/mp4' | 'video/webm' | null {
  // MP4: an "ftyp" box at offset 4. WebM / Matroska: the EBML header.
  if (data.length >= 12 && data.subarray(4, 8).toString('latin1') === 'ftyp') return 'video/mp4';
  if (
    data.length >= 4 &&
    data[0] === 0x1a &&
    data[1] === 0x45 &&
    data[2] === 0xdf &&
    data[3] === 0xa3
  )
    return 'video/webm';
  if (data.length >= 5 && data.subarray(0, 5).toString('latin1') === '%PDF-')
    return 'application/pdf';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
    return 'image/jpeg';
  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  return null;
}

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/**
 * Development scanner: rejects executables (MZ / ELF), the EICAR test string, and files whose real type is not
 * the allowed list. **This is not a malware engine.** A real scanning service plugs in behind FileScanner.
 */
export class DevFileScanner implements FileScanner {
  async scan({ data }: { data: Buffer; declaredMime: string }) {
    const head = data.subarray(0, 4);
    if (
      (head[0] === 0x4d && head[1] === 0x5a) ||
      head.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
    ) {
      return { clean: false, reason: 'Executable content is not allowed' };
    }
    if (data.toString('latin1').includes(EICAR))
      return { clean: false, reason: 'Test malware signature detected' };
    return { clean: true };
  }
}
