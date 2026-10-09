/** Cursor (keyset) pagination convention: `?limit=25&cursor=...&sort=-createdAt`. */
export class Page<T> {
  constructor(
    readonly items: T[],
    readonly nextCursor: string | null,
  ) {}
}

export interface SortSpec {
  field: string;
  dir: 'asc' | 'desc';
}

export function parseSort(sort: string | undefined, fallback: SortSpec): SortSpec {
  if (!sort) return fallback;
  return sort.startsWith('-') ? { field: sort.slice(1), dir: 'desc' } : { field: sort, dir: 'asc' };
}

interface CursorPayload {
  v: string | number;
  id: string;
}

export const encodeCursor = (payload: CursorPayload): string =>
  Buffer.from(JSON.stringify(payload)).toString('base64url');

export function decodeCursor(cursor: string | undefined): CursorPayload | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as CursorPayload;
    return typeof parsed.id === 'string' && parsed.v !== undefined ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Generic keyset pagination over a Prisma delegate. Orders by (sortField, id) so ordering is stable.
 * `baseWhere` must already contain the tenant scope. Date fields (names ending in "At") are encoded as ISO strings.
 */
export async function keysetPage<Row extends { id: string }>(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findMany: (query: { where: any; orderBy: any; take: number }) => PromiseLike<Row[]>;
  baseWhere: Record<string, unknown>;
  sort: SortSpec;
  limit: number;
  cursor?: string;
}): Promise<Page<Row>> {
  const { sort, limit } = args;
  const decoded = decodeCursor(args.cursor);
  const op = sort.dir === 'asc' ? 'gt' : 'lt';
  const toScalar = (row: Row): string | number => {
    const v = (row as unknown as Record<string, unknown>)[sort.field];
    return v instanceof Date ? v.toISOString() : (v as string | number);
  };
  const fromScalar = (value: string | number): unknown =>
    sort.field.endsWith('At') && typeof value === 'string' ? new Date(value) : value;

  const where: Record<string, unknown> = decoded
    ? {
        AND: [
          args.baseWhere,
          {
            OR: [
              { [sort.field]: { [op]: fromScalar(decoded.v) } },
              { [sort.field]: fromScalar(decoded.v), id: { [op]: decoded.id } },
            ],
          },
        ],
      }
    : args.baseWhere;

  const rows = await args.findMany({
    where,
    orderBy: [{ [sort.field]: sort.dir }, { id: sort.dir }],
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return new Page(items, hasMore && last ? encodeCursor({ v: toScalar(last), id: last.id }) : null);
}
