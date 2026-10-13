import { describe, expect, it } from 'vitest';
import { presignUrl, S3StorageProvider, signHeaders, uriEncode } from './s3-storage';

// AWS's published Signature V4 examples (S3 developer guide, "examplebucket", 2013-05-24)
const AWS = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  date: new Date('2013-05-24T00:00:00Z'),
};

describe('S3-compatible storage (SigV4, no vendor SDK)', () => {
  it('pre-signed URL matches the AWS reference example', () => {
    const url = presignUrl({
      ...AWS,
      method: 'GET',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      expiresSeconds: 86400,
    });
    expect(url).toContain(
      'X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request',
    );
    expect(
      url.endsWith(
        'X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
      ),
    ).toBe(true);
  });

  it('header signature matches the AWS reference example (GET with Range)', () => {
    const h = signHeaders({
      ...AWS,
      method: 'GET',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      headers: { Range: 'bytes=0-9' },
    });
    expect(h.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('encodes keys per RFC 3986 and refuses keys that could escape the bucket', async () => {
    expect(uriEncode('a b/ü+.pdf', true)).toBe('a%20b/%C3%BC%2B.pdf');
    const s = new S3StorageProvider({
      endpoint: 'https://storage.googleapis.com',
      bucket: 'dd-stg',
      region: 'auto',
      accessKeyId: 'k',
      secretAccessKey: 's',
    });
    await expect(s.createReadUrl({ key: '../x', expiresInSeconds: 60 })).rejects.toThrow(
      'Invalid storage key',
    );
    await expect(s.createReadUrl({ key: '/abs', expiresInSeconds: 60 })).rejects.toThrow(
      'Invalid storage key',
    );
    expect(
      () =>
        new S3StorageProvider({
          endpoint: 'http://insecure',
          bucket: 'b',
          region: 'auto',
          accessKeyId: 'k',
          secretAccessKey: 's',
        }),
    ).toThrow('https');
  });

  it('upload URL signs the content type (path style, GCS endpoint); download URL carries a safe file name', async () => {
    const now = new Date('2026-10-11T10:00:00Z');
    const s = new S3StorageProvider(
      {
        endpoint: 'https://storage.googleapis.com',
        bucket: 'dd-stg',
        region: 'auto',
        accessKeyId: 'GOOGTEST',
        secretAccessKey: 'secret',
      },
      fetch,
      () => now,
    );
    const up = await s.createUploadUrl({
      key: 'evidence/2026/a.pdf',
      contentType: 'application/pdf',
      maxBytes: 1000,
    });
    expect(up.url.startsWith('https://storage.googleapis.com/dd-stg/evidence/2026/a.pdf?')).toBe(
      true,
    );
    expect(up.url).toContain('X-Amz-SignedHeaders=content-type%3Bhost');
    expect(up.url).toContain('X-Amz-Expires=600');
    expect(up.headers).toEqual({ 'Content-Type': 'application/pdf' });
    expect(up.expiresAt).toBe('2026-10-11T10:10:00.000Z');
    const read = await s.createReadUrl({
      key: 'evidence/2026/a.pdf',
      expiresInSeconds: 300,
      fileName: 'رسید "1".pdf',
    });
    expect(read).toContain('response-content-disposition=attachment');
    expect(decodeURIComponent(read)).toContain(`filename*=UTF-8''`);
    expect(decodeURIComponent(read)).not.toContain('"1"');
  });

  it('head / read / delete are signed server requests; oversized or missing objects return null', async () => {
    const calls: Array<{ url: string; method: string; auth: string }> = [];
    const objects: Record<string, Buffer> = {
      '/dd-stg/small.png': Buffer.from('12345'),
      '/dd-stg/big.png': Buffer.alloc(50),
    };
    const fake = (async (url: string, init: RequestInit) => {
      const h = init.headers as Record<string, string>;
      calls.push({ url, method: init.method!, auth: h.Authorization! });
      const path = new URL(url).pathname;
      const obj = objects[path];
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      if (!obj) return new Response(null, { status: 404 });
      return init.method === 'HEAD'
        ? new Response(null, { status: 200, headers: { 'content-length': String(obj.length) } })
        : new Response(obj, { status: 200 });
    }) as unknown as typeof fetch;
    const s = new S3StorageProvider(
      {
        endpoint: 'https://storage.googleapis.com',
        bucket: 'dd-stg',
        region: 'auto',
        accessKeyId: 'k',
        secretAccessKey: 's',
      },
      fake,
    );
    expect(await s.head('small.png')).toEqual({ sizeBytes: 5 });
    expect(await s.head('none.png')).toBeNull();
    expect((await s.read('small.png', 10))?.toString()).toBe('12345');
    expect(await s.read('big.png', 10)).toBeNull(); // over the limit: never downloaded
    await s.delete('small.png');
    expect(
      calls.every(
        (c) =>
          c.auth.startsWith('AWS4-HMAC-SHA256 Credential=k/') &&
          c.auth.includes('/auto/s3/aws4_request'),
      ),
    ).toBe(true);
    expect(calls.filter((c) => c.url.endsWith('/big.png')).map((c) => c.method)).toEqual(['HEAD']);
  });
});
