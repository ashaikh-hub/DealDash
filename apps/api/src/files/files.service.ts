import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { CONFIG_KEYS } from '@dealdash/config';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import {
  FILE_SCANNER,
  STORAGE_PROVIDER,
  type FileScanner,
  type StorageProvider,
} from '../providers/interfaces';
import { sniffMime } from '../providers/local-storage';
import { imageDimensions } from './image-info';
import { SystemConfigService } from '../system-config/system-config.service';

const SAFE_NAME = /[^A-Za-z0-9._\- ]+/g;
const VIDEO_MIME = ['video/mp4', 'video/webm'];

/**
 * File flow (identical for every storage vendor):
 *   1. intent   : validates kind, type and size from configuration, creates a PENDING record, returns a signed upload URL
 *   2. upload   : the client sends the bytes straight to storage
 *   3. complete : the API verifies the object exists, size matches, the real type (magic bytes) is allowed, runs the
 *                 scanner hook, stores the hash, and only then marks the file AVAILABLE
 *   4. read     : short-lived signed URL, only to the owning organisation or to authorised DealDash reviewers
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: SystemConfigService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(FILE_SCANNER) private readonly scanner: FileScanner,
  ) {}

  /** Largest accepted campaign video (configuration watch.limits.maxVideoBytes). */
  private async videoMaxBytes(): Promise<number> {
    const l = await this.config.get<{ maxVideoBytes?: number }>('watch.limits');
    return l?.maxVideoBytes ?? 50 * 1024 * 1024;
  }

  async createIntent(
    actor: Actor,
    organizationId: string,
    input: { kind: string; fileName: string; mimeType: string; sizeBytes: number },
  ) {
    // Customer-facing deal images have their own (stricter) type and size rules; Watch & Earn videos have theirs.
    const isDealImage = input.kind === 'DEAL_IMAGE';
    const isVideo = input.kind === 'WATCH_VIDEO';
    const maxBytes = isVideo
      ? await this.videoMaxBytes()
      : isDealImage
        ? await this.config.getNumber(CONFIG_KEYS.DEAL_IMAGE_MAX_BYTES, 5 * 1024 * 1024)
        : await this.config.getNumber(CONFIG_KEYS.FILE_MAX_BYTES, 10 * 1024 * 1024);
    const allowed = isVideo
      ? VIDEO_MIME
      : await this.config.get<string[]>(
          isDealImage ? CONFIG_KEYS.DEAL_IMAGE_ALLOWED_MIME : CONFIG_KEYS.FILE_ALLOWED_MIME,
        );
    if (!allowed.includes(input.mimeType)) {
      throw new AppError(
        'FILE_INVALID',
        `This file type is not accepted (${allowed.join(', ')})`,
        400,
        'mimeType',
      );
    }
    if (input.sizeBytes > maxBytes) {
      throw new AppError(
        'FILE_INVALID',
        `The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`,
        400,
        'sizeBytes',
      );
    }
    if (input.kind !== 'DOCUMENT' && !isVideo && !input.mimeType.startsWith('image/')) {
      throw new AppError('FILE_INVALID', 'Branding files must be images', 400, 'mimeType');
    }
    const id = randomUUID();
    const safeName = input.fileName.replace(SAFE_NAME, '_').slice(0, 120) || 'file';
    const storageKey = `merchants/${organizationId}/${input.kind.toLowerCase()}/${id}`;
    const row = await this.prisma.storedFile.create({
      data: {
        id,
        organizationId,
        ownerUserId: actor.userId,
        kind: input.kind,
        originalName: safeName,
        mimeType: input.mimeType,
        declaredSize: input.sizeBytes,
        storageKey,
      },
    });
    const upload = await this.storage.createUploadUrl({
      key: storageKey,
      contentType: input.mimeType,
      maxBytes: input.sizeBytes,
    });
    return {
      fileId: row.id,
      method: upload.method,
      uploadUrl: upload.url,
      headers: upload.headers,
      expiresAt: upload.expiresAt,
    };
  }

  async complete(actor: Actor, organizationId: string, fileId: string, meta: RequestMeta) {
    const file = await this.prisma.storedFile.findFirst({ where: { id: fileId, organizationId } });
    if (!file) throw AppError.notFound();
    if (file.status === 'AVAILABLE') return this.view(file);
    const info = await this.storage.head(file.storageKey);
    if (!info) throw new AppError('FILE_INVALID', 'The file has not been uploaded yet', 400);
    const reject = async (reason: string) => {
      await this.storage.delete(file.storageKey);
      await this.prisma.storedFile.update({ where: { id: file.id }, data: { status: 'REJECTED' } });
      await this.audit.record({
        action: 'file.rejected',
        entityType: 'StoredFile',
        entityId: file.id,
        reason,
        actor,
        subjectOrganizationId: organizationId,
        meta,
      });
      throw new AppError('FILE_INVALID', reason, 400);
    };
    const isVideo = file.kind === 'WATCH_VIDEO';
    const maxBytes = isVideo
      ? await this.videoMaxBytes()
      : await this.config.getNumber(CONFIG_KEYS.FILE_MAX_BYTES, 10 * 1024 * 1024);
    if (info.sizeBytes > maxBytes || info.sizeBytes > file.declaredSize)
      return reject('The uploaded file is larger than declared');
    const data = await this.storage.read(file.storageKey, maxBytes);
    if (!data) return reject('The uploaded file could not be read');
    const real = sniffMime(data);
    const allowed = isVideo
      ? VIDEO_MIME
      : await this.config.get<string[]>(CONFIG_KEYS.FILE_ALLOWED_MIME);
    if (!real || !allowed.includes(real) || real !== file.mimeType)
      return reject('The file content does not match its declared type');
    if (file.kind === 'DEAL_IMAGE') {
      const dims = imageDimensions(data);
      const minW = await this.config.getNumber(CONFIG_KEYS.DEAL_IMAGE_MIN_WIDTH, 400);
      const minH = await this.config.getNumber(CONFIG_KEYS.DEAL_IMAGE_MIN_HEIGHT, 250);
      if (!dims) return reject('The image could not be read');
      if (dims.width < minW || dims.height < minH)
        return reject(`The image is too small: use at least ${minW} x ${minH} pixels`);
    }
    const scan = await this.scanner.scan({ data, declaredMime: file.mimeType });
    if (!scan.clean) return reject(scan.reason ?? 'The file failed the security check');
    const updated = await this.prisma.storedFile.update({
      where: { id: file.id },
      data: {
        status: 'AVAILABLE',
        sizeBytes: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
        completedAt: new Date(),
      },
    });
    await this.audit.record({
      action: 'file.uploaded',
      entityType: 'StoredFile',
      entityId: file.id,
      reason: file.kind,
      actor,
      subjectOrganizationId: organizationId,
      meta,
    });
    return this.view(updated);
  }

  /** Signed read URL. Callers must already have verified access to the organisation. */
  async readUrl(fileId: string, organizationId: string, expiresInSeconds = 300) {
    const file = await this.prisma.storedFile.findFirst({
      where: { id: fileId, organizationId, status: 'AVAILABLE' },
    });
    if (!file) throw AppError.notFound();
    const url = await this.storage.createReadUrl({
      key: file.storageKey,
      expiresInSeconds,
      fileName: file.originalName,
    });
    return {
      fileId: file.id,
      fileName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes ?? 0,
      url,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    };
  }

  async urlOrNull(
    fileId: string | null | undefined,
    organizationId: string,
  ): Promise<string | null> {
    if (!fileId) return null;
    try {
      return (await this.readUrl(fileId, organizationId, 900)).url;
    } catch {
      return null;
    }
  }

  /**
   * Signed read URLs for customer-facing images (deal photos, logos). Access control happens when the image is attached
   * to a record the customer may see; the URL itself is short-lived and unguessable (same as a cloud pre-signed URL).
   */
  async signedUrls(
    fileIds: ReadonlyArray<string | null | undefined>,
    expiresInSeconds = 6 * 3600,
  ): Promise<Map<string, string>> {
    const ids = [...new Set(fileIds.filter((x): x is string => !!x))];
    const out = new Map<string, string>();
    if (!ids.length) return out;
    const rows = await this.prisma.storedFile.findMany({
      where: { id: { in: ids }, status: 'AVAILABLE' },
    });
    await Promise.all(
      rows.map(async (f) => {
        out.set(
          f.id,
          await this.storage.createReadUrl({
            key: f.storageKey,
            expiresInSeconds,
            fileName: f.originalName,
          }),
        );
      }),
    );
    return out;
  }

  /** Assert the file belongs to the organisation and is available (used when attaching files to records). */
  async requireAvailable(fileId: string, organizationId: string) {
    const f = await this.prisma.storedFile.findFirst({
      where: { id: fileId, organizationId, status: 'AVAILABLE' },
    });
    if (!f)
      throw new AppError(
        'FILE_INVALID',
        'The file is not available. Upload it again.',
        400,
        'fileId',
      );
    return f;
  }

  private view(f: {
    id: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number | null;
  }) {
    return {
      fileId: f.id,
      fileName: f.originalName,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes ?? 0,
    };
  }
}
