import { Controller, Get, Inject, Param, Put, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { ApiEnv } from '@dealdash/config';
import { Public } from '../common/decorators';
import { APP_ENV } from '../common/env';
import { AppError } from '../common/errors';
import { STORAGE_PROVIDER, type StorageProvider } from '../providers/interfaces';
import { LocalStorageProvider, sniffMime, verifyToken } from '../providers/local-storage';

/**
 * Serves the DEVELOPMENT storage adapter's signed URLs. Authorization is the signed, expiring token itself
 * (bound to key, operation and size limit); there is no session on these routes by design (like a cloud pre-signed URL).
 */
@ApiExcludeController()
@Controller('storage')
export class StorageController {
  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(APP_ENV) private readonly env: ApiEnv,
  ) {}

  private local(): LocalStorageProvider {
    if (!(this.storage instanceof LocalStorageProvider)) throw AppError.notFound();
    return this.storage;
  }

  @Put('upload/:token')
  @Public()
  async upload(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    const local = this.local();
    const payload = verifyToken(token, this.env.SESSION_SECRET);
    if (!payload || payload.op !== 'put')
      throw AppError.forbidden('The upload link is invalid or has expired');
    if (req.get('content-type')?.split(';')[0] !== payload.ct)
      throw new AppError('FILE_INVALID', 'Unexpected content type', 400);
    const max = payload.max ?? 0;
    const chunks: Buffer[] = [];
    let size = 0;
    await new Promise<void>((resolve, reject) => {
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > max) {
          reject(new AppError('FILE_INVALID', 'The file is larger than declared', 413));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', resolve);
      req.on('error', reject);
    });
    await local.write(payload.key, Buffer.concat(chunks));
    res.status(200).json({ data: { stored: true, sizeBytes: size }, meta: {} });
  }

  @Get('download/:token')
  @Public()
  async download(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    const local = this.local();
    const payload = verifyToken(token, this.env.SESSION_SECRET);
    if (!payload || payload.op !== 'get')
      throw AppError.forbidden('The link is invalid or has expired');
    const data = await local.read(payload.key, 50 * 1024 * 1024);
    if (!data) throw AppError.notFound();
    const sniffed = sniffMime(data) ?? 'image/jpeg';
    res.setHeader('Content-Type', sniffed);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // The merchant/admin apps display these images from another origin.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${(payload.name ?? 'file').replace(/[^A-Za-z0-9._ -]/g, '_')}"`,
    );
    // Video players seek with Range requests (the development adapter reads the whole object; production uses the CDN).
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.get('range') ?? '');
    if (range && sniffed.startsWith('video/')) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
      if (start > end || start >= data.length) {
        res.setHeader('Content-Range', `bytes */${data.length}`);
        res.status(416).end();
        return;
      }
      res.setHeader('Content-Range', `bytes ${start}-${end}/${data.length}`);
      res.setHeader('Content-Length', String(end - start + 1));
      res.status(206).send(data.subarray(start, end + 1));
      return;
    }
    res.status(200).send(data);
  }
}
