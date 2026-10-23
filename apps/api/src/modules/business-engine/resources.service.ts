import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/audit/audit.service';
import type { AuthUser } from '../../core/auth/decorators';
import { canSeeCosts, toDate } from './access';
import { AbsenceDto, INTERNAL_KINDS, RateDto, ResourceDto, ResourceSkillDto } from './dto';
import { EngineSettingsService } from './settings.service';

const include = {
  rates: { orderBy: { effectiveFrom: 'desc' as const } },
  skills: { include: { skill: { select: { id: true, name: true } } } },
  absences: { orderBy: { startDate: 'desc' as const }, take: 50 },
  employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true, status: true, departmentId: true, skills: { include: { skill: { select: { id: true, name: true } } } } } },
  partner: { select: { id: true, name: true, type: true } },
} satisfies Prisma.EngineResourceInclude;
type Row = Prisma.EngineResourceGetPayload<{ include: typeof include }>;

@Injectable()
export class ResourcesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly settings: EngineSettingsService) {}

  /** Personnel cost data is visible only with engine.economics.read (GDPR data minimisation). */
  private present(row: Row, user: AuthUser) {
    const skills = row.employee ? row.employee.skills.map((s) => ({ skillId: s.skillId, name: s.skill.name, level: s.level, source: 'HR' as const }))
      : row.skills.map((s) => ({ skillId: s.skillId, name: s.skill.name, level: s.level, source: 'ENGINE' as const }));
    const { employee, ...rest } = row;
    return { ...rest, internal: INTERNAL_KINDS.has(row.kind), employee: employee ? { id: employee.id, name: `${employee.firstName} ${employee.lastName}`, employeeNumber: employee.employeeNumber, status: employee.status } : null,
      skills, rates: canSeeCosts(user) ? row.rates : [], ratesRedacted: !canSeeCosts(user) };
  }

  async list(companyId: string, user: AuthUser, query: { kind?: string; status?: string }) {
    const rows = await this.prisma.engineResource.findMany({ where: { companyId, deletedAt: null, ...(query.kind ? { kind: query.kind } : {}), ...(query.status ? { status: query.status } : {}) },
      include, orderBy: [{ kind: 'asc' }, { displayName: 'asc' }] });
    return rows.map((r) => this.present(r, user));
  }
  async get(companyId: string, id: string, user: AuthUser) {
    const row = await this.prisma.engineResource.findFirst({ where: { id, companyId, deletedAt: null }, include });
    if (!row) throw new NotFoundException('Resource not found in this company');
    return this.present(row, user);
  }

  private async validate(companyId: string, dto: ResourceDto, id?: string) {
    if (dto.employeeId) {
      if (!INTERNAL_KINDS.has(dto.kind) || dto.kind === 'AUTOMATION') throw new BadRequestException('Only employee-type resources can reference an employee');
      if (!(await this.prisma.employee.findFirst({ where: { id: dto.employeeId, companyId, deletedAt: null }, select: { id: true } }))) throw new BadRequestException('Employee not found in this company');
      const dup = await this.prisma.engineResource.findFirst({ where: { companyId, employeeId: dto.employeeId, deletedAt: null, ...(id ? { NOT: { id } } : {}) }, select: { id: true } });
      if (dup) throw new ConflictException('This employee already has a resource record');
    }
    if (dto.partnerId) {
      if (INTERNAL_KINDS.has(dto.kind)) throw new BadRequestException('Internal resources cannot reference a business partner');
      if (!(await this.prisma.businessPartner.findFirst({ where: { id: dto.partnerId, companyId, deletedAt: null, type: { in: ['SUPPLIER', 'PARTNER'] } }, select: { id: true } }))) {
        throw new BadRequestException('Partner must be a supplier or partner of this company');
      }
    }
    if (dto.activeFrom && dto.activeTo && dto.activeTo < dto.activeFrom) throw new BadRequestException('Active-to date precedes active-from date');
  }
  private data(dto: ResourceDto, defaults: { nonProject: number; maxAlloc: number }) {
    return { kind: dto.kind, status: dto.status ?? 'ACTIVE', employeeId: dto.employeeId ?? null, partnerId: dto.partnerId ?? null, displayName: dto.displayName.trim(),
      weeklyHours: dto.weeklyHours, maxAllocationPct: dto.maxAllocationPct ?? (INTERNAL_KINDS.has(dto.kind) ? defaults.maxAlloc : 100),
      nonProjectPct: dto.nonProjectPct ?? (INTERNAL_KINDS.has(dto.kind) ? defaults.nonProject : 0), activeFrom: dto.activeFrom ? toDate(dto.activeFrom) : null,
      activeTo: dto.activeTo ? toDate(dto.activeTo) : null, location: dto.location ?? null, remoteEligible: dto.remoteEligible ?? true, languages: dto.languages ?? [], restrictions: dto.restrictions ?? null };
  }

  async create(companyId: string, user: AuthUser, dto: ResourceDto) {
    await this.validate(companyId, dto);
    const config = await this.settings.config(companyId);
    const row = await this.prisma.engineResource.create({ data: { ...this.data(dto, { nonProject: config.capacity.defaultNonProjectPct, maxAlloc: config.capacity.defaultMaxAllocationPct }), companyId, createdById: user.id }, include });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_resource', entityId: row.id, action: 'CREATE' });
    return this.present(row, user);
  }
  async update(companyId: string, id: string, user: AuthUser, dto: ResourceDto) {
    const current = await this.prisma.engineResource.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!current) throw new NotFoundException('Resource not found in this company');
    await this.validate(companyId, dto, id);
    const config = await this.settings.config(companyId);
    const data = this.data(dto, { nonProject: config.capacity.defaultNonProjectPct, maxAlloc: config.capacity.defaultMaxAllocationPct });
    const row = await this.prisma.engineResource.update({ where: { id }, data, include });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_resource', entityId: id, action: 'UPDATE', changes: this.audit.diff(current as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>) });
    return this.present(row, user);
  }
  async archive(companyId: string, id: string, user: AuthUser) {
    const current = await this.prisma.engineResource.findFirst({ where: { id, companyId, deletedAt: null }, select: { id: true } });
    if (!current) throw new NotFoundException('Resource not found in this company');
    await this.prisma.$transaction([
      this.prisma.engineDemand.updateMany({ where: { resourceId: id, assignment: { status: { notIn: ['COMPLETED', 'CANCELLED'] } } }, data: { resourceId: null, overrideNote: 'Resource archived — returned to skill pool' } }),
      this.prisma.engineResource.update({ where: { id }, data: { deletedAt: new Date(), status: 'INACTIVE' } }),
    ]);
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_resource', entityId: id, action: 'DELETE' });
  }

  /** Creates resource records for active employees that have none yet (capacity from Employee.weeklyHours). No cost data is created. */
  async importEmployees(companyId: string, user: AuthUser) {
    const config = await this.settings.config(companyId);
    const employees = await this.prisma.employee.findMany({ where: { companyId, deletedAt: null, status: { in: ['ACTIVE', 'ON_LEAVE', 'NOTICE_PERIOD'] }, engineResources: { none: { deletedAt: null } } },
      select: { id: true, firstName: true, lastName: true, weeklyHours: true, hireDate: true, exitDate: true } });
    for (const e of employees) {
      await this.prisma.engineResource.create({ data: { companyId, kind: 'EMPLOYEE', employeeId: e.id, displayName: `${e.firstName} ${e.lastName}`, weeklyHours: e.weeklyHours ?? 40,
        maxAllocationPct: config.capacity.defaultMaxAllocationPct, nonProjectPct: config.capacity.defaultNonProjectPct, activeFrom: e.hireDate, activeTo: e.exitDate, createdById: user.id } });
    }
    if (employees.length) await this.audit.log({ userId: user.id, companyId, entityType: 'engine_resource', entityId: 'import', action: 'IMPORT', changes: { created: { old: 0, new: employees.length } } });
    return { created: employees.length, missingWeeklyHours: employees.filter((e) => e.weeklyHours === null).length };
  }

  /** Rates are append-only (effective-dated history); a correction adds a new row with the same date only if none exists. */
  async addRate(companyId: string, id: string, user: AuthUser, dto: RateDto) {
    if (!canSeeCosts(user)) throw new ForbiddenException('Maintaining cost rates requires engine.economics permissions');
    const resource = await this.prisma.engineResource.findFirst({ where: { id, companyId, deletedAt: null }, select: { id: true, kind: true } });
    if (!resource) throw new NotFoundException('Resource not found in this company');
    if (dto.monthlyFixedCost && !INTERNAL_KINDS.has(resource.kind)) throw new BadRequestException('Monthly fixed costs apply to internal resources only');
    try {
      const row = await this.prisma.engineResourceRate.create({ data: { resourceId: id, effectiveFrom: toDate(dto.effectiveFrom), costRate: dto.costRate, billRate: dto.billRate ?? null,
        monthlyFixedCost: dto.monthlyFixedCost ?? null, note: dto.note ?? null, createdById: user.id } });
      await this.audit.log({ userId: user.id, companyId, entityType: 'engine_resource_rate', entityId: row.id, action: 'CREATE',
        changes: { effectiveFrom: { old: null, new: dto.effectiveFrom }, costRate: { old: null, new: dto.costRate }, monthlyFixedCost: { old: null, new: dto.monthlyFixedCost ?? null } } });
      return row;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('A rate with this effective date exists; use a new effective date');
      throw error;
    }
  }

  async setSkills(companyId: string, id: string, user: AuthUser, skills: ResourceSkillDto[]) {
    const resource = await this.prisma.engineResource.findFirst({ where: { id, companyId, deletedAt: null }, select: { employeeId: true } });
    if (!resource) throw new NotFoundException('Resource not found in this company');
    if (resource.employeeId) throw new BadRequestException('Employee skills are maintained in HR (employee profile)');
    const ids = skills.map((s) => s.skillId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Duplicate skill');
    if ((await this.prisma.skill.count({ where: { id: { in: ids } } })) !== ids.length) throw new BadRequestException('Unknown skill');
    await this.prisma.$transaction([this.prisma.engineResourceSkill.deleteMany({ where: { resourceId: id } }),
      this.prisma.engineResourceSkill.createMany({ data: skills.map((s) => ({ resourceId: id, skillId: s.skillId, level: s.level })) })]);
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_resource', entityId: id, action: 'UPDATE_SKILLS' });
    return this.get(companyId, id, user);
  }

  async addAbsence(companyId: string, id: string, user: AuthUser, dto: AbsenceDto) {
    if (dto.endDate < dto.startDate) throw new BadRequestException('End date precedes start date');
    if (!(await this.prisma.engineResource.findFirst({ where: { id, companyId, deletedAt: null }, select: { id: true } }))) throw new NotFoundException('Resource not found in this company');
    const row = await this.prisma.engineResourceAbsence.create({ data: { resourceId: id, startDate: toDate(dto.startDate), endDate: toDate(dto.endDate), fraction: dto.fraction ?? 1, reason: dto.reason ?? null } });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_resource', entityId: id, action: 'ADD_ABSENCE' });
    return row;
  }
  async removeAbsence(companyId: string, id: string, absenceId: string, user: AuthUser) {
    const row = await this.prisma.engineResourceAbsence.findFirst({ where: { id: absenceId, resourceId: id, resource: { companyId } } });
    if (!row) throw new NotFoundException('Absence not found');
    await this.prisma.engineResourceAbsence.delete({ where: { id: absenceId } });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_resource', entityId: id, action: 'REMOVE_ABSENCE' });
  }
}
