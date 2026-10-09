import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export const hmacSha256 = (secret: string, value: string): string =>
  createHmac('sha256', secret).update(value).digest('hex');

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------- password hashing (scrypt, no native deps)
const SCRYPT_PREFIX = 'scrypt$';

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `${SCRYPT_PREFIX}${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  // Always do the work, even for unknown users, to keep timing uniform.
  const fallback = `${SCRYPT_PREFIX}${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(64).toString('base64')}`;
  const value = stored && stored.startsWith(SCRYPT_PREFIX) ? stored : fallback;
  const [, saltB64, keyB64] = value.split('$');
  const salt = Buffer.from(saltB64 ?? '', 'base64');
  const expected = Buffer.from(keyB64 ?? '', 'base64');
  const actual = await scrypt(password, salt, expected.length || 64);
  const ok = expected.length === actual.length && timingSafeEqual(expected, actual);
  return ok && value === stored;
}

// ---------------------------------------------------------------- field encryption (AES-256-GCM)
const deriveKey = (secret: string): Buffer => createHash('sha256').update(secret).digest();

export function encryptField(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptField(payload: string, secret: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64)
    throw new Error('Unsupported encrypted field format');
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
