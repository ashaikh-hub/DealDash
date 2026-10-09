import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/** Development defaults (bilingual). They are data: operations can edit, add or hide categories without a release. */
export const DEFAULT_CATEGORIES = [
  { code: 'dining', nameEn: 'Dining', nameAr: 'المطاعم', icon: 'dining', sortOrder: 10 },
  { code: 'cafes', nameEn: 'Cafes', nameAr: 'المقاهي', icon: 'cafes', sortOrder: 20 },
  { code: 'shopping', nameEn: 'Shopping', nameAr: 'التسوق', icon: 'shopping', sortOrder: 30 },
  {
    code: 'beauty_wellness',
    nameEn: 'Beauty & Wellness',
    nameAr: 'الجمال والعافية',
    icon: 'beauty',
    sortOrder: 40,
  },
  {
    code: 'entertainment',
    nameEn: 'Entertainment',
    nameAr: 'الترفيه',
    icon: 'entertainment',
    sortOrder: 50,
  },
  { code: 'services', nameEn: 'Services', nameAr: 'الخدمات', icon: 'services', sortOrder: 60 },
  { code: 'fitness', nameEn: 'Fitness', nameAr: 'اللياقة', icon: 'fitness', sortOrder: 70 },
  { code: 'other', nameEn: 'Other', nameAr: 'أخرى', icon: 'other', sortOrder: 900 },
] as const;

export async function seedCategories(db: Pick<PrismaService, 'category'>) {
  for (const c of DEFAULT_CATEGORIES) {
    await db.category.upsert({ where: { code: c.code }, update: {}, create: { ...c } });
  }
}

const view = (c: {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  icon: string | null;
  sortOrder: number;
  active: boolean;
}) => ({
  id: c.id,
  code: c.code,
  nameEn: c.nameEn,
  nameAr: c.nameAr,
  icon: c.icon,
  sortOrder: c.sortOrder,
  active: c.active,
});

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(opts: { includeInactive?: boolean } = {}) {
    const rows = await this.prisma.category.findMany({
      where: opts.includeInactive ? {} : { active: true },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
    });
    return rows.map(view);
  }

  async create(
    actor: Actor,
    input: {
      code: string;
      nameEn: string;
      nameAr: string;
      icon?: string;
      sortOrder: number;
      active: boolean;
    },
    meta: RequestMeta,
  ) {
    if (await this.prisma.category.findUnique({ where: { code: input.code } }))
      throw new AppError(
        'VALIDATION_FAILED',
        'A category with this code already exists',
        409,
        'code',
      );
    const row = await this.prisma.category.create({ data: input });
    await this.audit.record({
      action: 'category.created',
      entityType: 'Category',
      entityId: row.id,
      newState: view(row),
      actor,
      meta,
    });
    return view(row);
  }

  async update(
    actor: Actor,
    id: string,
    input: Partial<{
      nameEn: string;
      nameAr: string;
      icon: string;
      sortOrder: number;
      active: boolean;
    }>,
    meta: RequestMeta,
  ) {
    const before = await this.prisma.category.findUnique({ where: { id } });
    if (!before) throw AppError.notFound();
    const row = await this.prisma.category.update({
      where: { id },
      data: input as Prisma.CategoryUpdateInput,
    });
    await this.audit.record({
      action: 'category.updated',
      entityType: 'Category',
      entityId: id,
      previousState: view(before),
      newState: view(row),
      actor,
      meta,
    });
    return view(row);
  }
}
