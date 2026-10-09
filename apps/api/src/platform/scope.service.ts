import { Injectable } from '@nestjs/common';
import type { PermissionCode, RoleCode, ScopeSpec } from '@dealdash/types';
import { AppError } from '../common/errors';
import type { Actor } from '../common/request-context';
import { ActorService } from '../identity/actor.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * What a scope covers, resolved against the organization's structure. A scope is a set of dimensions (units, branches, legal
 * entities, countries) plus optional restrictions (products, campaigns). Restrictions can only narrow.
 */
export interface ScopeSet {
  orgWide: boolean;
  unitIds: Set<string>;
  branchIds: Set<string>;
  legalEntityIds: Set<string>;
  countries: Set<string>;
  products: Set<string> | null;
  campaigns: Set<string> | null;
}

/** The thing being accessed. Missing facts are filled in from the structure (a branch knows its unit, country, legal entity). */
export interface ScopeTarget {
  organizationId: string;
  legalEntityId?: string | null;
  unitId?: string | null;
  branchId?: string | null;
  country?: string | null;
  product?: string | null;
  campaignId?: string | null;
}

export interface Grant {
  roleCode: string;
  permissions: Set<PermissionCode>;
  spec: ScopeSpec;
  set: ScopeSet;
  origin: 'MEMBERSHIP' | 'ASSIGNMENT';
  assignmentId?: string;
}

interface UnitRow {
  id: string;
  parentId: string | null;
  path: string;
  legalEntityId: string | null;
  country: string | null;
  branchId: string | null;
}
interface Structure {
  at: number;
  units: UnitRow[];
  byId: Map<string, UnitRow>;
  /** unit id -> effective legal entity / country (own value or nearest ancestor's) */
  effLegal: Map<string, string | null>;
  effCountry: Map<string, string | null>;
  branchUnit: Map<string, string>;
  branchCountry: Map<string, string>;
}

const TTL_MS = 3000;

/**
 * THE ONE place that answers "may this actor do this permission HERE?". Effective access is the intersection of the actor's
 * organization, the role's permissions, the assignment's scope, product entitlement (checked by EntitlementService at the
 * commercial gate) and, for narrowing scopes, the envelope. Controllers call the coarse permission guard; services call this.
 * Nothing else may implement its own scope logic.
 */
@Injectable()
export class ScopeService {
  private cache = new Map<string, Structure>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly actors: ActorService,
  ) {}

  invalidate(organizationId?: string) {
    if (organizationId) this.cache.delete(organizationId);
    else this.cache.clear();
  }

  // ---------------------------------------------------------------- structure
  private async structure(organizationId: string): Promise<Structure> {
    const hit = this.cache.get(organizationId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit;
    const [units, branches] = await Promise.all([
      this.prisma.organizationUnit.findMany({
        where: { organizationId, status: 'ACTIVE' },
        select: { id: true, parentId: true, path: true, legalEntityId: true, country: true, branchId: true },
      }),
      this.prisma.merchantBranch.findMany({ where: { organizationId }, select: { id: true, country: true } }),
    ]);
    const byId = new Map(units.map((u) => [u.id, u]));
    const effLegal = new Map<string, string | null>();
    const effCountry = new Map<string, string | null>();
    const walk = (u: UnitRow, pick: (x: UnitRow) => string | null): string | null => {
      for (let cur: UnitRow | undefined = u, guard = 0; cur && guard < 64; guard++, cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
        const v = pick(cur);
        if (v) return v;
      }
      return null;
    };
    for (const u of units) {
      effLegal.set(u.id, walk(u, (x) => x.legalEntityId));
      effCountry.set(u.id, walk(u, (x) => x.country));
    }
    const branchUnit = new Map<string, string>();
    for (const u of units) if (u.branchId) branchUnit.set(u.branchId, u.id);
    const s: Structure = {
      at: Date.now(),
      units,
      byId,
      effLegal,
      effCountry,
      branchUnit,
      branchCountry: new Map(branches.map((b) => [b.id, b.country])),
    };
    this.cache.set(organizationId, s);
    return s;
  }

  private emptySet(): ScopeSet {
    return {
      orgWide: false,
      unitIds: new Set(),
      branchIds: new Set(),
      legalEntityIds: new Set(),
      countries: new Set(),
      products: null,
      campaigns: null,
    };
  }

  /** Resolves one scope into the set of things it covers (envelope first, then the narrowing restrictions). */
  async resolve(organizationId: string, spec: ScopeSpec): Promise<ScopeSet> {
    const st = await this.structure(organizationId);
    const set = this.emptySet();
    const addUnitTree = (rootId: string) => {
      const root = st.byId.get(rootId);
      if (!root) return;
      for (const u of st.units) {
        if (u.path.startsWith(root.path)) {
          set.unitIds.add(u.id);
          if (u.branchId) set.branchIds.add(u.branchId);
        }
      }
    };
    const apply = (kind: ScopeSpec['kind'], ref: string | null) => {
      if (kind === 'ORGANIZATION') set.orgWide = true;
      else if (kind === 'UNIT' && ref) {
        addUnitTree(ref);
      } else if (kind === 'LEGAL_ENTITY' && ref) {
        set.legalEntityIds.add(ref);
        for (const u of st.units)
          if (st.effLegal.get(u.id) === ref) {
            set.unitIds.add(u.id);
            if (u.branchId) set.branchIds.add(u.branchId);
          }
      } else if (kind === 'COUNTRY' && ref) {
        set.countries.add(ref);
        for (const u of st.units)
          if (st.effCountry.get(u.id) === ref) {
            set.unitIds.add(u.id);
            if (u.branchId) set.branchIds.add(u.branchId);
          }
        for (const [b, c] of st.branchCountry) if (c === ref) set.branchIds.add(b);
      } else if (kind === 'BRANCH' && ref) {
        set.branchIds.add(ref);
        const u = st.branchUnit.get(ref);
        if (u) set.unitIds.add(u);
      }
    };
    if (spec.kind === 'PRODUCT' || spec.kind === 'CAMPAIGN') {
      // narrowing scopes: the envelope decides WHERE (default: the whole organization), the scope restricts WHAT
      const env = spec.envelope ?? { kind: 'ORGANIZATION' as const, ref: null };
      apply(env.kind, env.ref);
      if (spec.kind === 'PRODUCT' && spec.ref) set.products = new Set([spec.ref]);
      if (spec.kind === 'CAMPAIGN' && spec.ref) {
        set.campaigns = new Set([spec.ref]);
        if (spec.product) set.products = new Set([spec.product]);
      }
    } else apply(spec.kind, spec.ref);
    return set;
  }

  private async enrich(t: ScopeTarget): Promise<ScopeTarget> {
    const st = await this.structure(t.organizationId);
    const out: ScopeTarget = { ...t };
    if (out.branchId) {
      out.unitId ??= st.branchUnit.get(out.branchId) ?? null;
      out.country ??= st.branchCountry.get(out.branchId) ?? null;
    }
    if (out.unitId) {
      out.legalEntityId ??= st.effLegal.get(out.unitId) ?? null;
      out.country ??= st.effCountry.get(out.unitId) ?? null;
    }
    return out;
  }

  /** Does the set cover the (enriched) target? Restrictions are checked first: a restricted set never matches an unspecified target. */
  matches(set: ScopeSet, t: ScopeTarget): boolean {
    if (set.products && (!t.product || !set.products.has(t.product))) return false;
    if (set.campaigns && (!t.campaignId || !set.campaigns.has(t.campaignId))) return false;
    if (set.orgWide) return true;
    return (
      (!!t.branchId && set.branchIds.has(t.branchId)) ||
      (!!t.unitId && set.unitIds.has(t.unitId)) ||
      (!!t.legalEntityId && set.legalEntityIds.has(t.legalEntityId)) ||
      (!!t.country && set.countries.has(t.country))
    );
  }

  /** Does `outer` contain everything `inner` covers? This is the delegation rule: nobody can hand out more than they hold. */
  covers(outer: ScopeSet, inner: ScopeSet): boolean {
    const sub = (a: Set<string> | null, b: Set<string> | null) => {
      if (b === null) return true; // outer unrestricted
      if (a === null) return false; // inner unrestricted but outer restricted
      for (const x of a) if (!b.has(x)) return false;
      return true;
    };
    if (!sub(inner.products, outer.products)) return false;
    if (!sub(inner.campaigns, outer.campaigns)) return false;
    if (outer.orgWide) return true;
    if (inner.orgWide) return false;
    const all = (a: Set<string>, b: Set<string>) => [...a].every((x) => b.has(x));
    return (
      all(inner.unitIds, outer.unitIds) &&
      all(inner.branchIds, outer.branchIds) &&
      all(inner.legalEntityIds, outer.legalEntityIds) &&
      all(inner.countries, outer.countries)
    );
  }

  // ---------------------------------------------------------------- grants of an actor
  /** Every scoped grant the actor holds in its own organization (membership role plus active, in-date assignments). */
  async grantsOf(actor: Actor): Promise<Grant[]> {
    const m = actor.membership;
    if (!m) return [];
    const out: Grant[] = [];
    if (!m.scoped) {
      const perms = await this.actors.permissionsForRole(m.roleCode);
      const spec: ScopeSpec = m.branchId
        ? { kind: 'BRANCH', ref: m.branchId }
        : { kind: 'ORGANIZATION', ref: null };
      out.push({
        roleCode: m.roleCode,
        permissions: perms,
        spec,
        set: await this.resolve(m.organizationId, spec),
        origin: 'MEMBERSHIP',
      });
      return out;
    }
    const now = new Date();
    const rows = await this.prisma.roleAssignment.findMany({
      where: {
        membershipId: m.id,
        status: 'ACTIVE',
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      },
      include: { role: true },
    });
    for (const r of rows) {
      const spec: ScopeSpec = {
        kind: r.scopeKind as ScopeSpec['kind'],
        ref: r.scopeRef,
        product: r.scopeProduct,
        envelope: r.envelopeKind ? { kind: r.envelopeKind as ScopeSpec['kind'], ref: r.envelopeRef } : null,
      };
      out.push({
        roleCode: r.role.code,
        permissions: await this.actors.permissionsForRole(r.role.code as RoleCode),
        spec,
        set: await this.resolve(m.organizationId, spec),
        origin: 'ASSIGNMENT',
        assignmentId: r.id,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- the checks
  /** True when the actor holds `permission` for the target. DealDash staff are not tenant-scoped here (they have their own audience). */
  async can(actor: Actor, permission: PermissionCode, target: ScopeTarget): Promise<boolean> {
    const m = actor.membership;
    if (!m || m.organizationId !== target.organizationId) return false;
    const t = await this.enrich(target);
    for (const g of await this.grantsOf(actor)) {
      if (g.permissions.has(permission) && this.matches(g.set, t)) return true;
    }
    return false;
  }

  /** Same answer as can, against grants the caller already loaded (lists evaluate many targets against one set of grants). */
  async canWith(grants: Grant[], permission: PermissionCode, target: ScopeTarget): Promise<boolean> {
    const t = await this.enrich(target);
    return grants.some((g) => g.permissions.has(permission) && this.matches(g.set, t));
  }

  /** 404 for another organization (existence is not revealed), 403 for a scope the actor does not hold. */
  async require(actor: Actor, permission: PermissionCode, target: ScopeTarget): Promise<void> {
    const m = actor.membership;
    if (!m || m.organizationId !== target.organizationId) throw AppError.notFound();
    if (!(await this.can(actor, permission, target)))
      throw new AppError('SCOPE_FORBIDDEN', 'You do not have access to this part of the organization', 403);
  }

  /** A campaign touching several branches needs every one of them to be in scope: scope cannot be escaped by adding branches. */
  async requireAll(actor: Actor, permission: PermissionCode, targets: ScopeTarget[]): Promise<void> {
    if (!targets.length) return this.require(actor, permission, { organizationId: actor.membership?.organizationId ?? '' });
    for (const t of targets) await this.require(actor, permission, t);
  }

  /**
   * Branch ids the actor may see for a permission: null = no restriction (organization-wide grant), otherwise the exact set.
   * Services use it to filter lists server-side.
   */
  async visibleBranchIds(actor: Actor, permission: PermissionCode): Promise<Set<string> | null> {
    const grants = (await this.grantsOf(actor)).filter((g) => g.permissions.has(permission));
    if (grants.some((g) => g.set.orgWide && !g.set.products && !g.set.campaigns)) return null;
    const ids = new Set<string>();
    for (const g of grants) for (const b of g.set.branchIds) ids.add(b);
    return ids;
  }

  /**
   * Delegation rule: `grantor` may create `spec` for `roleCode` only if, for EVERY permission of that role, the grantor holds it in a
   * scope that contains `spec`. The grantor must also hold the access-management permission in that scope.
   */
  async assertCanDelegate(
    grantor: Actor,
    accessPermission: PermissionCode,
    roleCode: RoleCode,
    spec: ScopeSpec,
  ): Promise<void> {
    const m = grantor.membership;
    if (!m) throw AppError.forbidden();
    const inner = await this.resolve(m.organizationId, spec);
    const grants = await this.grantsOf(grantor);
    const holds = (perm: PermissionCode) =>
      grants.some((g) => g.permissions.has(perm) && this.covers(g.set, inner));
    if (!holds(accessPermission))
      throw new AppError('SCOPE_FORBIDDEN', 'You cannot manage access in this scope', 403);
    const rolePerms = await this.actors.permissionsForRole(roleCode);
    for (const p of rolePerms)
      if (!holds(p))
        throw new AppError(
          'SCOPE_FORBIDDEN',
          'You cannot grant more than you hold in this scope',
          403,
        );
  }
}
