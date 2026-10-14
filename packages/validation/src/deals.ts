import { z } from 'zod';
import {
  DEAL_EVENT_TYPES,
  ELIGIBILITY_ATTRIBUTE_TYPES,
  ELIGIBILITY_KINDS,
  ELIGIBILITY_LEVELS,
  ELIGIBILITY_RESULTS,
  LIVE_DEAL_ACTIONS,
  LIVE_DEAL_MATERIAL_FIELDS,
  LIVE_DEAL_MECHANICS,
  LIVE_DEAL_REVISION_STATUSES,
  LIVE_DEAL_STATUSES,
  REDEMPTION_MODES,
  UNLOCK_ACTIONS,
  WEEKDAYS,
  type EligibilityExpression,
} from '@dealdash/types';

const uuid = z.string().uuid();
const isoDate = z.string().datetime({ offset: true });

/** One row, two languages. Drafts may be partly empty; publication requires both (see liveDealIssues). */
const bi = (max: number) =>
  z
    .object({
      en: z.string().trim().max(max).default(''),
      ar: z.string().trim().max(max).default(''),
    })
    .default({ en: '', ar: '' });
export type BilingualField = { en: string; ar: string };

// ------------------------------------------------------------------ Live Deal content (the reviewable, versioned part)
export const dealMediaItemSchema = z.object({
  fileId: uuid,
  altEn: z.string().trim().max(200).default(''),
  altAr: z.string().trim().max(200).default(''),
});

export const dealTermsBlocksSchema = z.object({
  fullPriceItemsOnly: z.boolean().default(false),
  notCombinable: z.boolean().default(false),
  /** Integer halalas. */
  minimumSpendHalalas: z.number().int().min(0).max(100_000_00).nullable().default(null),
  validDays: z.array(z.enum(WEEKDAYS)).max(7).default([]),
  validFrom: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .default(null),
  validTo: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .default(null),
});

/** Limits keep a rule readable and cheap to evaluate. */
export const ELIGIBILITY_EXPRESSION_LIMITS = { maxDepth: 5, maxNodes: 40, maxValues: 50 } as const;
export const eligibilityExpressionSchema: z.ZodType<EligibilityExpression> = z.lazy(() =>
  z.union([
    z.object({
      op: z.enum(['AND', 'OR']),
      children: z.array(eligibilityExpressionSchema).min(1).max(20),
    }),
    z.object({ op: z.literal('NOT'), child: eligibilityExpressionSchema }),
    z.object({
      op: z.literal('ATTR'),
      attr: z.enum(ELIGIBILITY_ATTRIBUTE_TYPES),
      values: z
        .array(z.string().trim().min(1).max(100))
        .min(1)
        .max(ELIGIBILITY_EXPRESSION_LIMITS.maxValues),
      level: z.enum(ELIGIBILITY_LEVELS).optional(),
    }),
  ]),
);
/** Depth and size of an expression (used to refuse rules that are too deep or too big). */
export function eligibilityExpressionShape(e: EligibilityExpression): {
  depth: number;
  nodes: number;
} {
  if (e.op === 'ATTR') return { depth: 1, nodes: 1 };
  const kids = e.op === 'NOT' ? [e.child] : e.children;
  const shapes = kids.map(eligibilityExpressionShape);
  return {
    depth: 1 + Math.max(0, ...shapes.map((s) => s.depth)),
    nodes: 1 + shapes.reduce((n, s) => n + s.nodes, 0),
  };
}

export const dealEligibilitySchema = z.object({
  kind: z.enum(ELIGIBILITY_KINDS).default('PUBLIC'),
  /** Only for kind COMPOSITE: the nested rule. */
  expression: eligibilityExpressionSchema.nullable().optional(),
  /**
   * PUBLIC: empty. GEOGRAPHY: city names. EMPLOYER / BANK_CARD / SCHEME: partner organisation ids
   * (issuer/product/tier granularity arrives with the Partner stage; never card numbers).
   */
  valueRefs: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
});

export const liveDealContentSchema = z.object({
  categoryId: uuid.nullable().default(null),
  mechanic: z.enum(LIVE_DEAL_MECHANICS).nullable().default(null),
  /** Percent (1 to 100) for PERCENTAGE_OFF, whole SAR for AMOUNT_OFF; empty for other mechanics. */
  valueNumber: z.number().min(0).max(1_000_000).nullable().default(null),
  offerLabel: bi(40),
  title: bi(80),
  shortDescription: bi(140),
  description: bi(1500),
  media: z.array(dealMediaItemSchema).max(5).default([]),
  branchIds: z.array(uuid).max(50).default([]),
  startAt: isoDate.nullable().default(null),
  endAt: isoDate.nullable().default(null),
  eligibility: dealEligibilitySchema.default({ kind: 'PUBLIC', valueRefs: [], expression: null }),
  terms: z
    .object({
      blocks: dealTermsBlocksSchema.default(() => dealTermsBlocksSchema.parse({})),
      textEn: z.string().trim().max(1500).default(''),
      textAr: z.string().trim().max(1500).default(''),
    })
    .default(() => ({
      blocks: dealTermsBlocksSchema.parse({}),
      textEn: '',
      textAr: '',
    })),
  redemptionMode: z.enum(REDEMPTION_MODES).default('GENERAL'),
});
export type LiveDealContent = z.infer<typeof liveDealContentSchema>;
export type LiveDealContentInput = z.input<typeof liveDealContentSchema>;

export const emptyLiveDealContent = (): LiveDealContent => liveDealContentSchema.parse({});

// ------------------------------------------------------------------ completeness (publication gate, FDR-01: both languages)
export interface DealIssue {
  field: string;
  code:
    | 'REQUIRED'
    | 'REQUIRED_EN'
    | 'REQUIRED_AR'
    | 'INVALID'
    | 'END_BEFORE_START'
    | 'IN_PAST'
    | 'VALUE_RANGE';
}

export function liveDealIssues(c: LiveDealContent, opts: { now?: Date } = {}): DealIssue[] {
  const out: DealIssue[] = [];
  const bilingual = (field: string, v: BilingualField) => {
    if (!v.en.trim()) out.push({ field, code: 'REQUIRED_EN' });
    if (!v.ar.trim()) out.push({ field, code: 'REQUIRED_AR' });
  };
  if (!c.categoryId) out.push({ field: 'categoryId', code: 'REQUIRED' });
  if (!c.mechanic) out.push({ field: 'mechanic', code: 'REQUIRED' });
  if (c.mechanic === 'PERCENTAGE_OFF') {
    if (c.valueNumber === null) out.push({ field: 'valueNumber', code: 'REQUIRED' });
    else if (c.valueNumber < 1 || c.valueNumber > 100)
      out.push({ field: 'valueNumber', code: 'VALUE_RANGE' });
  }
  if (c.mechanic === 'AMOUNT_OFF') {
    if (c.valueNumber === null) out.push({ field: 'valueNumber', code: 'REQUIRED' });
    else if (c.valueNumber <= 0) out.push({ field: 'valueNumber', code: 'VALUE_RANGE' });
  }
  bilingual('offerLabel', c.offerLabel);
  bilingual('title', c.title);
  bilingual('shortDescription', c.shortDescription);
  bilingual('description', c.description);
  if (c.media.length < 1) out.push({ field: 'media', code: 'REQUIRED' });
  if (c.branchIds.length < 1) out.push({ field: 'branchIds', code: 'REQUIRED' });
  if (!c.startAt) out.push({ field: 'startAt', code: 'REQUIRED' });
  if (c.startAt && c.endAt) {
    if (new Date(c.endAt).getTime() <= new Date(c.startAt).getTime())
      out.push({ field: 'endAt', code: 'END_BEFORE_START' });
  }
  if (c.endAt && opts.now && new Date(c.endAt).getTime() <= opts.now.getTime())
    out.push({ field: 'endAt', code: 'IN_PAST' });
  if (!c.terms.textEn.trim()) out.push({ field: 'terms.textEn', code: 'REQUIRED_EN' });
  if (!c.terms.textAr.trim()) out.push({ field: 'terms.textAr', code: 'REQUIRED_AR' });
  const missing =
    c.eligibility.kind === 'COMPOSITE'
      ? !c.eligibility.expression
      : c.eligibility.kind !== 'PUBLIC' && c.eligibility.valueRefs.length < 1;
  if (missing) out.push({ field: 'eligibility', code: 'REQUIRED' });
  return out;
}

/** Translation status shown in the builder header. */
export function translationStatus(c: LiveDealContent): {
  complete: boolean;
  missing: Array<'en' | 'ar'>;
} {
  const missing = new Set<'en' | 'ar'>();
  for (const i of liveDealIssues(c)) {
    if (i.code === 'REQUIRED_EN') missing.add('en');
    if (i.code === 'REQUIRED_AR') missing.add('ar');
  }
  return { complete: missing.size === 0, missing: [...missing] };
}

// ------------------------------------------------------------------ material vs minor edits (LD-41)
const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
/** Lower-case, unify Arabic letter forms, remove diacritics, convert Arabic-Indic digits, collapse spaces. */
export function normalizeText(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/ـ/g, '')
    .replace(/[آأإ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length]!;
}

const digitsOf = (s: string) => (s.match(/\d+(?:\.\d+)?/g) ?? []).sort().join('|');

/**
 * A text edit is MINOR when it is only formatting, a typo or a translation touch-up: the numbers did not change and
 * the wording stayed close (edit distance within 15 percent, at least 3 characters). Anything else is material.
 */
export function isMinorTextEdit(before: string, after: string): boolean {
  const a = normalizeText(before);
  const b = normalizeText(after);
  if (a === b) return true;
  if (digitsOf(a) !== digitsOf(b)) return false;
  const longest = Math.max(a.length, b.length);
  if (longest > 3000) return false;
  return levenshtein(a, b) <= Math.max(3, Math.floor(longest * 0.15));
}

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, val: unknown) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(
          Object.entries(val as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : 1)),
        )
      : val,
  );
const sortedIds = (ids: string[]) => [...ids].sort();
const instant = (v: string | null) => (v ? new Date(v).getTime() : null);

export interface ContentDiff {
  /** Every field that differs. */
  changed: string[];
  /** The subset that changes what the customer receives (needs DealDash review or a new version). */
  material: string[];
}

/** Default list of fields treated as material. Operations can change it through `live_deals.material_fields`. */
export const DEFAULT_MATERIAL_FIELDS: readonly string[] = [
  ...LIVE_DEAL_MATERIAL_FIELDS,
  'title',
  'shortDescription',
  'description',
  'redemptionMode',
];

export function diffLiveDealContent(
  before: LiveDealContent,
  after: LiveDealContent,
  materialFields: readonly string[] = DEFAULT_MATERIAL_FIELDS,
): ContentDiff {
  const changed: string[] = [];
  const material = new Set<string>();
  const mark = (field: string, isMaterial: boolean) => {
    changed.push(field);
    if (isMaterial && materialFields.includes(field)) material.add(field);
  };

  if (before.categoryId !== after.categoryId) mark('categoryId', true);
  if (before.mechanic !== after.mechanic) mark('mechanic', true);
  if (before.valueNumber !== after.valueNumber) mark('valueNumber', true);
  if (before.redemptionMode !== after.redemptionMode) mark('redemptionMode', true);
  if (stable(sortedIds(before.branchIds)) !== stable(sortedIds(after.branchIds)))
    mark('branchIds', true);
  if (instant(before.startAt) !== instant(after.startAt)) mark('startAt', true);
  if (instant(before.endAt) !== instant(after.endAt)) mark('endAt', true);
  if (
    before.eligibility.kind !== after.eligibility.kind ||
    stable([...before.eligibility.valueRefs].sort()) !==
      stable([...after.eligibility.valueRefs].sort()) ||
    stable(before.eligibility.expression ?? null) !== stable(after.eligibility.expression ?? null)
  )
    mark('eligibility', true);
  if (stable(before.terms.blocks) !== stable(after.terms.blocks)) mark('terms', true);

  const textField = (field: 'offerLabel' | 'title' | 'shortDescription' | 'description') => {
    for (const lang of ['en', 'ar'] as const) {
      if (before[field][lang] !== after[field][lang]) {
        // The headline offer label is the proposition itself: only whitespace/case changes are minor.
        const minor =
          field === 'offerLabel'
            ? normalizeText(before[field][lang]) === normalizeText(after[field][lang])
            : isMinorTextEdit(before[field][lang], after[field][lang]);
        changed.push(`${field}.${lang}`);
        if (!minor && materialFields.includes(field)) material.add(field);
      }
    }
  };
  textField('offerLabel');
  textField('title');
  textField('shortDescription');
  textField('description');

  for (const lang of ['textEn', 'textAr'] as const) {
    if (before.terms[lang] !== after.terms[lang]) {
      changed.push(`terms.${lang}`);
      if (!isMinorTextEdit(before.terms[lang], after.terms[lang])) material.add('terms');
    }
  }
  if (stable(before.media) !== stable(after.media)) changed.push('media');
  return { changed, material: [...material] };
}

// ------------------------------------------------------------------ requests
export const liveDealListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
  status: z.enum(LIVE_DEAL_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  branchId: uuid.optional(),
  attention: z.coerce.boolean().optional(),
});

/** Creating a deal needs nothing: an empty draft is valid and is completed step by step in the builder. */
export const liveDealCreateSchema = z.object({
  content: liveDealContentSchema.default(() => liveDealContentSchema.parse({})),
});

export const liveDealSaveSchema = z.object({
  content: liveDealContentSchema,
  /** Optimistic concurrency: the version the editor started from. */
  expectedVersion: z.number().int().min(0).optional(),
});

export const reasonSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
});
export const requiredReasonSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const liveDealPauseSchema = reasonSchema;
export const liveDealEndSchema = requiredReasonSchema;

/** Admin decisions: reason is mandatory; the Arabic text is optional but recommended (shown to Arabic-speaking merchants). */
export const dealDecisionSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
  reasonAr: z.string().trim().max(1000).optional(),
  /** Fields the reviewer wants corrected (request changes). */
  fields: z.array(z.string().max(60)).max(30).optional(),
});

export const adminDealListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
  status: z.enum(LIVE_DEAL_STATUSES).optional(),
  queue: z.coerce.boolean().optional(),
  merchantId: uuid.optional(),
  q: z.string().trim().max(100).optional(),
});

export const performanceQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const categoryInputSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,40}$/),
  nameEn: z.string().trim().min(1).max(60),
  nameAr: z.string().trim().min(1).max(60),
  icon: z.string().trim().max(40).optional(),
  sortOrder: z.number().int().min(0).max(1000).default(100),
  active: z.boolean().default(true),
});
export const categoryUpdateSchema = categoryInputSchema.partial().omit({ code: true });

// ---- customer discovery requests
const latSchema = z.coerce.number().min(-90).max(90);
const lngSchema = z.coerce.number().min(-180).max(180);

export const discoveryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(300).optional(),
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(41).optional(),
  city: z.string().trim().max(40).optional(),
  lat: latSchema.optional(),
  lng: lngSchema.optional(),
  radiusMeters: z.coerce.number().int().min(100).max(100_000).optional(),
  sort: z.enum(['nearest', 'newest', 'ending_soon', 'relevance']).optional(),
  /** `unlocked` shows only deals the customer can use right now; `all` also shows locked deals with an unlock action. */
  eligibility: z.enum(['all', 'unlocked']).default('all'),
});

export const nearbyDealsQuerySchema = discoveryQuerySchema.extend({
  lat: latSchema,
  lng: lngSchema,
  radiusMeters: z.coerce.number().int().min(100).max(100_000).default(5000),
});

export const homeQuerySchema = z.object({
  city: z.string().trim().max(40).optional(),
  lat: latSchema.optional(),
  lng: lngSchema.optional(),
});

export const dealEventSchema = z.object({
  type: z.enum(DEAL_EVENT_TYPES).refine((t) => t !== 'SAVE' && t !== 'UNSAVE', {
    message: 'Save events are recorded by the save endpoint',
  }),
  dealId: uuid.optional(),
  merchantId: uuid.optional(),
  branchId: uuid.optional(),
  /** The deal the customer came from when opening a merchant page. */
  sourceDealId: uuid.optional(),
  /** Random per-device id kept by the app (never a personal identifier). */
  anonymousId: z.string().min(8).max(64),
  /** Which product dealId refers to. Live Deals stay the default so existing clients keep working. */
  product: z.enum(['LIVE', 'HOT', 'VOUCHER', 'WATCH']).default('LIVE'),
});
export const dealEventBatchSchema = z.object({
  events: z.array(dealEventSchema).min(1).max(50),
});

// ------------------------------------------------------------------ responses (documented in OpenAPI)
const biText = z.object({ en: z.string(), ar: z.string() });
const biNullable = z.object({ en: z.string().nullable(), ar: z.string().nullable() });

export const dealCategoryViewSchema = z.object({
  id: uuid,
  code: z.string(),
  nameEn: z.string(),
  nameAr: z.string(),
  icon: z.string().nullable(),
  sortOrder: z.number().int(),
  active: z.boolean(),
});

export const eligibilityViewSchema = z.object({
  result: z.enum(ELIGIBILITY_RESULTS),
  kind: z.enum(ELIGIBILITY_KINDS),
  /** Bilingual explanation, for example "Verify your employer to unlock". */
  message: biText.nullable(),
  unlockAction: z.enum(UNLOCK_ACTIONS).nullable(),
});

export const dealCardSchema = z.object({
  id: uuid,
  merchantId: uuid,
  merchantName: biText,
  merchantLogoUrl: z.string().nullable(),
  title: biText,
  offerLabel: biText,
  shortDescription: biText,
  category: z.object({ code: z.string(), name: biText }).nullable(),
  mechanic: z.enum(LIVE_DEAL_MECHANICS).nullable(),
  imageUrl: z.string().nullable(),
  imageAlt: biText,
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  distanceMeters: z.number().nullable(),
  nearestBranch: z
    .object({ id: uuid, name: biText, area: biText, latitude: z.number(), longitude: z.number() })
    .nullable(),
  branchCount: z.number().int(),
  eligibility: eligibilityViewSchema,
  saved: z.boolean(),
  /** Saved items can outlive the offer: shown as paused or ended instead of disappearing. */
  availability: z
    .enum(['AVAILABLE', 'SCHEDULED', 'PAUSED', 'ENDED', 'UNAVAILABLE'])
    .default('AVAILABLE'),
});
export type DealCard = z.infer<typeof dealCardSchema>;

export const openingHoursSchema = z.record(
  z.string(),
  z.object({
    closed: z.boolean().optional(),
    intervals: z.array(z.object({ open: z.string(), close: z.string() })).optional(),
  }),
);

export const publicBranchSchema = z.object({
  id: uuid,
  name: biText,
  address: biText,
  city: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  phone: z.string().nullable(),
  hours: z.unknown().nullable(),
  distanceMeters: z.number().nullable(),
});
export type PublicBranch = z.infer<typeof publicBranchSchema>;

export const dealDetailSchema = dealCardSchema.extend({
  description: biText,
  terms: z.object({ blocks: dealTermsBlocksSchema, text: biText }),
  media: z.array(z.object({ url: z.string(), alt: biText })),
  branches: z.array(publicBranchSchema),
  redemption: z.object({ mode: z.enum(REDEMPTION_MODES) }),
});
export type DealDetail = z.infer<typeof dealDetailSchema>;

export const merchantPageSchema = z.object({
  id: uuid,
  name: biText,
  logoUrl: z.string().nullable(),
  coverUrl: z.string().nullable(),
  description: biNullable,
  category: z.object({ code: z.string(), name: biText }).nullable(),
  phone: z.string().nullable(),
  branches: z.array(publicBranchSchema),
  deals: z.array(dealCardSchema),
});
export type MerchantPage = z.infer<typeof merchantPageSchema>;

export const homeFeedSchema = z.object({
  city: z.string(),
  cityEnabled: z.boolean(),
  categories: z.array(dealCategoryViewSchema.extend({ dealCount: z.number().int() })),
  liveNow: z.array(dealCardSchema),
  nearYou: z.array(dealCardSchema),
  endingSoon: z.array(dealCardSchema),
});

export const searchResultSchema = z.object({
  query: z.string(),
  deals: z.array(dealCardSchema),
  merchants: z.array(
    z.object({
      id: uuid,
      name: biText,
      logoUrl: z.string().nullable(),
      category: z.object({ code: z.string(), name: biText }).nullable(),
      dealCount: z.number().int(),
      distanceMeters: z.number().nullable(),
    }),
  ),
});

export const dealPageSchema = z.array(dealCardSchema);

// ---- merchant / admin views
export const dealMediaViewSchema = z.object({
  fileId: uuid,
  url: z.string().nullable(),
  altEn: z.string(),
  altAr: z.string(),
});

export const dealRevisionViewSchema = z.object({
  id: uuid,
  number: z.number().int(),
  status: z.enum(LIVE_DEAL_REVISION_STATUSES),
  content: liveDealContentSchema,
  media: z.array(dealMediaViewSchema),
  materialFields: z.array(z.string()),
  submittedAt: z.string().nullable(),
  decidedAt: z.string().nullable(),
});

export const dealDecisionViewSchema = z.object({
  id: uuid,
  action: z.enum(LIVE_DEAL_ACTIONS),
  fromStatus: z.enum(LIVE_DEAL_STATUSES).nullable(),
  toStatus: z.enum(LIVE_DEAL_STATUSES).nullable(),
  reason: z.string().nullable(),
  reasonAr: z.string().nullable(),
  fields: z.array(z.string()),
  actorRole: z.string().nullable(),
  actorName: z.string().nullable(),
  /** True for DealDash staff actions: merchants see the role only as "DealDash". */
  byDealDash: z.boolean(),
  createdAt: z.string(),
});

export const dealBranchViewSchema = z.object({
  id: uuid,
  nameEn: z.string(),
  nameAr: z.string(),
  status: z.string(),
});

export const liveDealViewSchema = z.object({
  id: uuid,
  organizationId: uuid,
  status: z.enum(LIVE_DEAL_STATUSES),
  version: z.number().int(),
  content: liveDealContentSchema,
  media: z.array(dealMediaViewSchema),
  branches: z.array(dealBranchViewSchema),
  category: dealCategoryViewSchema.nullable(),
  pausedBy: z.enum(['MERCHANT', 'DEALDASH']).nullable(),
  submittedAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  translation: z.object({ complete: z.boolean(), missing: z.array(z.enum(['en', 'ar'])) }),
  issues: z.array(z.object({ field: z.string(), code: z.string() })),
  guardrail: z.object({
    outcome: z.enum(['AUTO_PUBLISH', 'MANUAL_REVIEW']),
    reasons: z.array(z.string()),
  }),
  discoverable: z.object({ visible: z.boolean(), reason: z.string().nullable() }),
  revision: dealRevisionViewSchema.nullable(),
  latestDecision: dealDecisionViewSchema.nullable(),
  allowedActions: z.array(z.string()),
});
export type LiveDealView = z.infer<typeof liveDealViewSchema>;

export const liveDealRowSchema = z.object({
  id: uuid,
  status: z.enum(LIVE_DEAL_STATUSES),
  title: biText,
  offerLabel: biText,
  branchCount: z.number().int(),
  startAt: z.string().nullable(),
  endAt: z.string().nullable(),
  imageUrl: z.string().nullable(),
  hasPendingRevision: z.boolean(),
  needsAttention: z.boolean(),
  directionsClicks: z.number().int(),
  updatedAt: z.string(),
});
export type LiveDealRow = z.infer<typeof liveDealRowSchema>;

export const dealSaveResultSchema = z.object({
  deal: liveDealViewSchema,
  /** APPLIED_MINOR: a minor edit went live with an audit entry. REVISION_SAVED: a material edit waits for review. */
  outcome: z.enum(['SAVED', 'APPLIED_MINOR', 'REVISION_SAVED']),
  material: z.array(z.string()),
});

export const dealSubmitResultSchema = z.object({
  deal: liveDealViewSchema,
  outcome: z.enum(['SENT_FOR_REVIEW', 'PUBLISHED', 'SCHEDULED']),
});

export const performanceSchema = z.object({
  range: z.object({ from: z.string(), to: z.string() }),
  totals: z.object({
    impressions: z.number().int(),
    detailViews: z.number().int(),
    merchantPageViews: z.number().int(),
    saves: z.number().int(),
    unsaves: z.number().int(),
    directionsClicks: z.number().int(),
  }),
  byDay: z.array(
    z.object({
      date: z.string(),
      impressions: z.number().int(),
      detailViews: z.number().int(),
      saves: z.number().int(),
      directionsClicks: z.number().int(),
    }),
  ),
  byBranch: z.array(
    z.object({
      branchId: uuid,
      name: biText,
      detailViews: z.number().int(),
      directionsClicks: z.number().int(),
    }),
  ),
  /** Always present: these are discovery signals, never sales or revenue. */
  disclaimerKey: z.literal('discovery_signals_only'),
});
export type DealPerformance = z.infer<typeof performanceSchema>;

export const adminDealRowSchema = z.object({
  id: uuid,
  status: z.enum(LIVE_DEAL_STATUSES),
  kind: z.enum(['NEW', 'REVISION']),
  title: biText,
  merchant: z.object({ id: uuid, nameEn: z.string(), nameAr: z.string(), trustLevel: z.string() }),
  branchCount: z.number().int(),
  submittedAt: z.string().nullable(),
  startAt: z.string().nullable(),
  endAt: z.string().nullable(),
});
export type AdminDealRow = z.infer<typeof adminDealRowSchema>;

export const adminDealDetailSchema = liveDealViewSchema.extend({
  merchant: z.object({
    id: uuid,
    nameEn: z.string(),
    nameAr: z.string(),
    status: z.string(),
    trustLevel: z.string(),
    riskTier: z.string(),
    logoUrl: z.string().nullable(),
  }),
  history: z.array(dealDecisionViewSchema),
  /** What the customer will see (both languages), for the review preview. */
  preview: dealDetailSchema,
  reviewTarget: z.enum(['NONE', 'DEAL', 'REVISION']),
  adminActions: z.array(z.string()),
});
export type AdminDealDetail = z.infer<typeof adminDealDetailSchema>;

export const adminDealAnalyticsSchema = z.object({
  counts: z.object({
    live: z.number().int(),
    scheduled: z.number().int(),
    pendingReview: z.number().int(),
    needsChanges: z.number().int(),
    paused: z.number().int(),
    suspended: z.number().int(),
  }),
  last7Days: z.object({
    impressions: z.number().int(),
    detailViews: z.number().int(),
    merchantPageViews: z.number().int(),
    saves: z.number().int(),
    directionsClicks: z.number().int(),
  }),
  topDeals: z.array(
    z.object({
      id: uuid,
      title: biText,
      merchantName: biText,
      detailViews: z.number().int(),
      directionsClicks: z.number().int(),
    }),
  ),
  disclaimerKey: z.literal('discovery_signals_only'),
});

export const eligibilityOptionsSchema = z.object({
  employers: z.array(z.object({ id: uuid, nameEn: z.string(), nameAr: z.string() })),
  banks: z.array(z.object({ id: uuid, nameEn: z.string(), nameAr: z.string() })),
  schemes: z.array(z.object({ id: uuid, nameEn: z.string(), nameAr: z.string() })),
  cities: z.array(z.string()),
});

export const savedItemsSchema = z.array(dealCardSchema);

export const appConfigSchema = z.object({
  defaultCity: z.string(),
  cities: z.array(
    z.object({
      name: z.string(),
      nameAr: z.string(),
      latitude: z.number().nullable(),
      longitude: z.number().nullable(),
    }),
  ),
  /** Live Deals map base layer (configuration); null template = the app's plain canvas. */
  map: z
    .object({ tileUrlTemplate: z.string().nullable(), attribution: z.string().nullable() })
    .optional(),
});
