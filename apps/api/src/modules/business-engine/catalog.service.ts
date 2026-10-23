import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/audit/audit.service';
import type { AuthUser } from '../../core/auth/decorators';
import { canSeeCosts } from './access';
import { LifecycleDto, PackageDto, ServiceDto, SkillDto } from './dto';
import { PACKAGE_TEMPLATES, SERVICE_TEMPLATES, SKILL_TEMPLATES } from './templates';

/** Allowed lifecycle transitions; every change is recorded as a lifecycle event. */
const LIFECYCLE_TRANSITIONS: Record<string, string[]> = {
  PROPOSED: ['EXPERIMENTAL', 'COMMERCIAL', 'RETIRED'], EXPERIMENTAL: ['COMMERCIAL', 'UNDER_REVIEW', 'RETIRED'], COMMERCIAL: ['GROWING', 'CORE', 'UNDER_REVIEW', 'RETIRED'],
  GROWING: ['CORE', 'COMMERCIAL', 'UNDER_REVIEW', 'RETIRED'], CORE: ['GROWING', 'UNDER_REVIEW', 'RETIRED'], UNDER_REVIEW: ['COMMERCIAL', 'GROWING', 'CORE', 'RETIRED'], RETIRED: ['UNDER_REVIEW'],
};

const serviceInclude = {
  requirements: { orderBy: { sortOrder: 'asc' as const }, include: { skill: { select: { id: true, name: true } } } },
  owner: { select: { id: true, firstName: true, lastName: true } },
  parent: { select: { id: true, code: true, name: true } },
} satisfies Prisma.EngineServiceInclude;
type ServiceRow = Prisma.EngineServiceGetPayload<{ include: typeof serviceInclude }>;

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private redact(row: ServiceRow, user: AuthUser) {
    if (canSeeCosts(user)) return row;
    return { ...row, requirements: row.requirements.map((r) => ({ ...r, costRate: null, externalRate: null })) };
  }
  private snapshotOf(row: ServiceRow) {
    const { owner: _owner, parent: _parent, ...rest } = row;
    return JSON.parse(JSON.stringify(rest)) as Prisma.InputJsonValue;
  }

  async listServices(companyId: string, user: AuthUser, query: { category?: string; lifecycle?: string; q?: string }) {
    const rows = await this.prisma.engineService.findMany({ where: { companyId, deletedAt: null, ...(query.category ? { category: query.category } : {}),
      ...(query.lifecycle ? { lifecycle: query.lifecycle } : {}), ...(query.q ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { code: { contains: query.q, mode: 'insensitive' } }] } : {}) },
      include: serviceInclude, orderBy: [{ category: 'asc' }, { code: 'asc' }] });
    return rows.map((row) => this.redact(row, user));
  }

  async getService(companyId: string, id: string, user: AuthUser) {
    const row = await this.prisma.engineService.findFirst({ where: { id, companyId, deletedAt: null }, include: {
      ...serviceInclude, lifecycleEvents: { orderBy: { createdAt: 'desc' } }, versions: { orderBy: { version: 'desc' }, select: { version: true, note: true, createdAt: true, createdById: true } },
      children: { where: { deletedAt: null }, select: { id: true, code: true, name: true } } } });
    if (!row) throw new NotFoundException('Service not found in this company');
    return this.redact(row, user);
  }

  async serviceVersion(companyId: string, id: string, version: number) {
    const row = await this.prisma.engineServiceVersion.findFirst({ where: { serviceId: id, version, service: { companyId } } });
    if (!row) throw new NotFoundException('Service version not found');
    return row;
  }

  private async validateReferences(companyId: string, dto: ServiceDto, id?: string) {
    if (dto.parentId) {
      if (dto.parentId === id) throw new BadRequestException('A service cannot be its own parent');
      let cursor: string | null = dto.parentId; const seen = new Set<string>();
      while (cursor) {
        if (cursor === id || seen.has(cursor)) throw new BadRequestException('The parent would create a cycle in the service hierarchy');
        seen.add(cursor);
        const parent: { parentId: string | null } | null = await this.prisma.engineService.findFirst({ where: { id: cursor, companyId, deletedAt: null }, select: { parentId: true } });
        if (!parent) throw new BadRequestException('Parent service not found in this company');
        cursor = parent.parentId;
      }
    }
    if (dto.ownerEmployeeId && !(await this.prisma.employee.findFirst({ where: { id: dto.ownerEmployeeId, companyId, deletedAt: null }, select: { id: true } }))) {
      throw new BadRequestException('Service owner must be an employee of this company');
    }
    const skillIds = [...new Set((dto.requirements ?? []).map((r) => r.skillId).filter((s): s is string => !!s))];
    if (skillIds.length && (await this.prisma.skill.count({ where: { id: { in: skillIds } } })) !== skillIds.length) throw new BadRequestException('Unknown skill in requirements');
  }

  private data(dto: ServiceDto) {
    return {
      code: dto.code.trim(), name: dto.name.trim(), description: dto.description ?? null, category: dto.category, parentId: dto.parentId ?? null, ownerEmployeeId: dto.ownerEmployeeId ?? null,
      targetSegments: dto.targetSegments ?? [], projectTypes: dto.projectTypes ?? [], contractModel: dto.contractModel ?? null, revenueModel: dto.revenueModel, deliveryModel: dto.deliveryModel,
      externalDeliveryAllowed: dto.externalDeliveryAllowed ?? true, typicalDurationWeeks: dto.typicalDurationWeeks ?? null, currencyCode: dto.currencyCode ?? 'EUR',
      targetHourlyRate: dto.targetHourlyRate ?? null, targetMarginPct: dto.targetMarginPct ?? null, workingCapitalProfile: dto.workingCapitalProfile ?? null,
      commercialRisk: dto.commercialRisk ?? null, technicalRisk: dto.technicalRisk ?? null, contractualRisk: dto.contractualRisk ?? null, strategicImportance: dto.strategicImportance ?? null,
      repeatability: dto.repeatability ?? null, scalability: dto.scalability ?? null, crossSelling: dto.crossSelling ?? null, referenceValue: dto.referenceValue ?? null,
    };
  }
  private requirementRows(dto: ServiceDto, user: AuthUser, existing: { costRate: Prisma.Decimal | null; externalRate: Prisma.Decimal | null }[] = []) {
    const costs = canSeeCosts(user);
    return (dto.requirements ?? []).map((r, index) => ({ skillId: r.skillId ?? null, role: r.role.trim(), seniority: r.seniority, typicalHours: r.typicalHours, internalSharePct: r.internalSharePct ?? 100,
      // Users without cost access cannot see — and therefore cannot change — confidential rate assumptions.
      costRate: costs ? r.costRate ?? null : existing[index]?.costRate ?? null, externalRate: costs ? r.externalRate ?? null : existing[index]?.externalRate ?? null,
      billRate: r.billRate ?? null, sortOrder: index }));
  }

  async createService(companyId: string, user: AuthUser, dto: ServiceDto) {
    await this.validateReferences(companyId, dto);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.engineService.create({ data: { ...this.data(dto), companyId, createdById: user.id, updatedById: user.id,
          requirements: { create: this.requirementRows(dto, user) } }, include: serviceInclude });
        await tx.engineServiceLifecycleEvent.create({ data: { serviceId: created.id, fromState: null, toState: created.lifecycle, reason: 'Created', createdById: user.id } });
        await tx.engineServiceVersion.create({ data: { serviceId: created.id, version: 1, snapshot: this.snapshotOf(created), note: dto.versionNote ?? 'Initial version', createdById: user.id } });
        return created;
      });
      await this.audit.log({ userId: user.id, companyId, entityType: 'engine_service', entityId: row.id, action: 'CREATE' });
      return this.redact(row, user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('A service with this code already exists');
      throw error;
    }
  }

  /** Updates create a new immutable template version; historical versions stay readable. */
  async updateService(companyId: string, id: string, user: AuthUser, dto: ServiceDto) {
    const current = await this.prisma.engineService.findFirst({ where: { id, companyId, deletedAt: null }, include: serviceInclude });
    if (!current) throw new NotFoundException('Service not found in this company');
    if (dto.expectedVersion !== undefined && dto.expectedVersion !== current.version) throw new ConflictException('The service changed in the meantime. Reload before saving.');
    await this.validateReferences(companyId, dto, id);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        await tx.engineServiceRequirement.deleteMany({ where: { serviceId: id } });
        const updated = await tx.engineService.update({ where: { id }, data: { ...this.data(dto), version: current.version + 1, updatedById: user.id,
          requirements: { create: this.requirementRows(dto, user, current.requirements) } }, include: serviceInclude });
        await tx.engineServiceVersion.create({ data: { serviceId: id, version: updated.version, snapshot: this.snapshotOf(updated), note: dto.versionNote ?? null, createdById: user.id } });
        return updated;
      });
      await this.audit.log({ userId: user.id, companyId, entityType: 'engine_service', entityId: id, action: 'UPDATE',
        changes: this.audit.diff(this.snapshotOf(current) as Record<string, unknown>, this.snapshotOf(row) as Record<string, unknown>) });
      return this.redact(row, user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('A service with this code already exists');
      throw error;
    }
  }

  async transition(companyId: string, id: string, user: AuthUser, dto: LifecycleDto) {
    const current = await this.prisma.engineService.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!current) throw new NotFoundException('Service not found in this company');
    if (!LIFECYCLE_TRANSITIONS[current.lifecycle]?.includes(dto.toState)) throw new BadRequestException(`Transition ${current.lifecycle} → ${dto.toState} is not allowed`);
    await this.prisma.$transaction([
      this.prisma.engineService.update({ where: { id }, data: { lifecycle: dto.toState, updatedById: user.id } }),
      this.prisma.engineServiceLifecycleEvent.create({ data: { serviceId: id, fromState: current.lifecycle, toState: dto.toState, reason: dto.reason ?? null, createdById: user.id } }),
    ]);
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_service', entityId: id, action: 'LIFECYCLE', changes: { lifecycle: { old: current.lifecycle, new: dto.toState } } });
    return this.getService(companyId, id, user);
  }

  async archiveService(companyId: string, id: string, user: AuthUser) {
    const current = await this.prisma.engineService.findFirst({ where: { id, companyId, deletedAt: null }, select: { id: true, _count: { select: { assignments: { where: { deletedAt: null, status: { notIn: ['COMPLETED', 'CANCELLED'] } } } } } } });
    if (!current) throw new NotFoundException('Service not found in this company');
    if (current._count.assignments) throw new ConflictException('The service is used by open assignments; retire it instead');
    await this.prisma.engineService.update({ where: { id }, data: { deletedAt: new Date(), updatedById: user.id } });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_service', entityId: id, action: 'DELETE' });
  }

  /* ---------------------------------------------------------------- packages */
  listPackages(companyId: string) {
    return this.prisma.enginePackage.findMany({ where: { companyId, deletedAt: null }, orderBy: { code: 'asc' },
      include: { items: { orderBy: { sortOrder: 'asc' }, include: { service: { select: { id: true, code: true, name: true, lifecycle: true } } } } } });
  }
  private async checkItems(companyId: string, dto: PackageDto) {
    const ids = dto.items.map((i) => i.serviceId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('A service can appear only once in a package');
    if ((await this.prisma.engineService.count({ where: { id: { in: ids }, companyId, deletedAt: null } })) !== ids.length) throw new BadRequestException('Package contains a service from another company or an archived service');
  }
  async savePackage(companyId: string, user: AuthUser, dto: PackageDto, id?: string) {
    await this.checkItems(companyId, dto);
    const items = dto.items.map((i, index) => ({ serviceId: i.serviceId, hoursFactor: i.hoursFactor ?? 1, feeOverride: i.feeOverride ?? null, sortOrder: i.sortOrder ?? index }));
    try {
      if (!id) {
        const row = await this.prisma.enginePackage.create({ data: { companyId, code: dto.code, name: dto.name, description: dto.description ?? null, isActive: dto.isActive ?? true, createdById: user.id, items: { create: items } } });
        await this.audit.log({ userId: user.id, companyId, entityType: 'engine_package', entityId: row.id, action: 'CREATE' });
        return row;
      }
      const current = await this.prisma.enginePackage.findFirst({ where: { id, companyId, deletedAt: null } });
      if (!current) throw new NotFoundException('Package not found in this company');
      if (dto.expectedVersion !== undefined && dto.expectedVersion !== current.version) throw new ConflictException('The package changed in the meantime. Reload before saving.');
      const row = await this.prisma.$transaction(async (tx) => {
        await tx.enginePackageItem.deleteMany({ where: { packageId: id } });
        return tx.enginePackage.update({ where: { id }, data: { code: dto.code, name: dto.name, description: dto.description ?? null, isActive: dto.isActive ?? true, version: current.version + 1, items: { create: items } } });
      });
      await this.audit.log({ userId: user.id, companyId, entityType: 'engine_package', entityId: id, action: 'UPDATE' });
      return row;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('A package with this code already exists');
      throw error;
    }
  }
  async archivePackage(companyId: string, id: string, user: AuthUser) {
    const row = await this.prisma.enginePackage.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!row) throw new NotFoundException('Package not found in this company');
    await this.prisma.enginePackage.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_package', entityId: id, action: 'DELETE' });
  }

  /* ---------------------------------------------------------------- skills (shared HR catalog) */
  listSkills() {
    return this.prisma.skill.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }], select: { id: true, name: true, nameDe: true, category: true, parentId: true,
      _count: { select: { employeeSkills: true, engineResourceSkills: true, engineRequirements: true } } } });
  }
  private async assertNoCycle(id: string | null, parentId: string | null) {
    let cursor = parentId; const seen = new Set<string>();
    while (cursor) {
      if (cursor === id || seen.has(cursor)) throw new BadRequestException('The parent would create a cycle in the skills hierarchy');
      seen.add(cursor);
      const p: { parentId: string | null } | null = await this.prisma.skill.findUnique({ where: { id: cursor }, select: { parentId: true } });
      if (!p) throw new BadRequestException('Parent skill not found');
      cursor = p.parentId;
    }
  }
  async createSkill(user: AuthUser, companyId: string, dto: SkillDto) {
    await this.assertNoCycle(null, dto.parentId ?? null);
    try {
      const row = await this.prisma.skill.create({ data: { name: dto.name.trim(), nameDe: dto.nameDe ?? null, category: dto.category, parentId: dto.parentId ?? null } });
      await this.audit.log({ userId: user.id, companyId, entityType: 'skill', entityId: row.id, action: 'CREATE' });
      return row;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('This skill already exists in the category');
      throw error;
    }
  }
  async setSkillParent(user: AuthUser, companyId: string, id: string, parentId: string | null) {
    if (!(await this.prisma.skill.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('Skill not found');
    await this.assertNoCycle(id, parentId);
    const row = await this.prisma.skill.update({ where: { id }, data: { parentId } });
    await this.audit.log({ userId: user.id, companyId, entityType: 'skill', entityId: id, action: 'UPDATE', changes: { parentId: { old: null, new: parentId } } });
    return row;
  }

  /* ---------------------------------------------------------------- templates */
  templates() { return { skills: SKILL_TEMPLATES, services: SERVICE_TEMPLATES, packages: PACKAGE_TEMPLATES }; }

  /**
   * Idempotent: creates missing skills (shared catalog), missing services (by code) and packages.
   * No rates or prices are seeded; effort profiles are marked illustrative.
   */
  async applyTemplates(companyId: string, user: AuthUser) {
    const created = { skills: 0, services: 0, packages: 0 };
    const skillIds = new Map<string, string>();
    for (const t of SKILL_TEMPLATES) {
      const existing = await this.prisma.skill.findUnique({ where: { category_name: { category: 'DISCIPLINE', name: t.name } } });
      const parentId = t.parent ? skillIds.get(t.parent) ?? null : null;
      const row = existing ?? await this.prisma.skill.create({ data: { category: 'DISCIPLINE', name: t.name, nameDe: t.nameDe, parentId } });
      if (!existing) created.skills++;
      else if (!existing.parentId && parentId) await this.prisma.skill.update({ where: { id: existing.id }, data: { parentId } });
      skillIds.set(t.name, row.id);
    }
    const serviceIds = new Map<string, string>();
    for (const t of SERVICE_TEMPLATES) {
      const existing = await this.prisma.engineService.findUnique({ where: { companyId_code: { companyId, code: t.code } } });
      if (existing) { serviceIds.set(t.code, existing.id); continue; }
      const row = await this.createService(companyId, user, { code: t.code, name: t.name, category: t.category, revenueModel: t.revenueModel, deliveryModel: 'INTERNAL',
        typicalDurationWeeks: t.weeks, description: 'Created from the OCTA taxonomy template. Effort profile is illustrative — calibrate before use.',
        requirements: t.requirements.map(([skill, role, seniority, hours]) => ({ skillId: skillIds.get(skill) ?? null, role, seniority, typicalHours: hours })), versionNote: 'Template' } as ServiceDto);
      serviceIds.set(t.code, row.id); created.services++;
    }
    for (const p of PACKAGE_TEMPLATES) {
      if (await this.prisma.enginePackage.findUnique({ where: { companyId_code: { companyId, code: p.code } } })) continue;
      await this.savePackage(companyId, user, { code: p.code, name: p.name, items: p.services.filter((c) => serviceIds.has(c)).map((c) => ({ serviceId: serviceIds.get(c) as string })) });
      created.packages++;
    }
    return created;
  }
}
