import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AssignmentEconomics } from '../../../../../packages/shared/src/business-engine';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/audit/audit.service';
import type { AuthUser } from '../../core/auth/decorators';
import { PageQueryDto, paged } from '../../common/pagination';
import { canSeeCosts, engineCall, toDate, today } from './access';
import { ActualsDto, AdjustmentDto, AssignmentDto, AssignmentStatusDto, DemandDto, ForecastVersionDto, MilestoneDto, PmoProgressDto } from './dto';
import { SnapshotService } from './snapshot.service';
import { computePortfolio } from './domain/portfolio';
import { ENGINE_VERSION } from './domain/config';

const TRANSITIONS: Record<string, string[]> = {
  PLANNED: ['ACTIVE', 'ON_HOLD', 'CANCELLED'], ACTIVE: ['ON_HOLD', 'COMPLETED', 'CANCELLED'], ON_HOLD: ['ACTIVE', 'CANCELLED'], COMPLETED: [], CANCELLED: [],
};
const FEE_REQUIREMENTS: Record<string, (keyof AssignmentDto)[]> = {
  FIXED_FEE: ['fixedFee'], TIME_AND_MATERIALS: ['hourlyRate'], DAILY_RATE: ['dailyRate'], RETAINER: ['monthlyRetainer'], MILESTONE: [],
  CAPEX_PERCENT: ['capexBasis', 'capexPercent', 'capexBasisDefinition'], HYBRID: [],
};
const COST_FIELDS = ['costRate', 'externalRate'] as const;

const detailInclude = {
  service: { select: { id: true, code: true, name: true, lifecycle: true } }, package: { select: { id: true, code: true, name: true } },
  client: { select: { id: true, name: true } }, contract: { select: { id: true, contractNumber: true, title: true, status: true } },
  opportunity: { select: { id: true, opportunityNumber: true, title: true, stage: true, probability: true } },
  responsible: { select: { id: true, firstName: true, lastName: true } },
  demands: { orderBy: { sortOrder: 'asc' as const }, include: { skill: { select: { id: true, name: true } }, resource: { select: { id: true, displayName: true, kind: true } } } },
  milestones: { orderBy: { dueDate: 'asc' as const } }, adjustments: { orderBy: { effectiveDate: 'asc' as const } },
  forecasts: { orderBy: { version: 'desc' as const }, select: { id: true, kind: true, version: true, snapshot: true, note: true, createdAt: true, engineVersion: true } },
} satisfies Prisma.EngineAssignmentInclude;
type Detail = Prisma.EngineAssignmentGetPayload<{ include: typeof detailInclude }>;

@Injectable()
export class AssignmentsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly snapshots: SnapshotService) {}

  private redact<T extends Partial<Detail>>(row: T, user: AuthUser): T {
    if (canSeeCosts(user)) return row;
    return { ...row, actualCost: null, demands: row.demands?.map((d) => ({ ...d, costRate: null, externalRate: null })),
      forecasts: row.forecasts?.map((f) => ({ ...f, snapshot: null })) } as T;
  }

  async list(companyId: string, user: AuthUser, query: PageQueryDto & { status?: string; serviceId?: string; clientId?: string; contractId?: string; opportunityId?: string }) {
    const where: Prisma.EngineAssignmentWhereInput = { companyId, deletedAt: null, ...(query.status ? { status: query.status } : {}), ...(query.serviceId ? { serviceId: query.serviceId } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}), ...(query.contractId ? { contractId: query.contractId } : {}), ...(query.opportunityId ? { opportunityId: query.opportunityId } : {}),
      ...(query.q ? { OR: [{ title: { contains: query.q, mode: 'insensitive' } }, { externalProjectRef: { contains: query.q, mode: 'insensitive' } }] } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.engineAssignment.findMany({ where, skip: query.skip, take: query.pageSize, orderBy: query.orderBy(['startDate', 'endDate', 'title', 'updatedAt']).length ? query.orderBy(['startDate', 'endDate', 'title', 'updatedAt']) : [{ startDate: 'asc' }],
        include: { service: detailInclude.service, client: detailInclude.client, contract: detailInclude.contract, opportunity: detailInclude.opportunity, responsible: detailInclude.responsible,
          _count: { select: { demands: true, milestones: true } } } }),
      this.prisma.engineAssignment.count({ where }),
    ]);
    return paged(rows.map((r) => (canSeeCosts(user) ? r : { ...r, actualCost: null })), total, query);
  }

  /** Minimal pick-lists for assignment forms (no financial or personal detail beyond names). */
  async references(companyId: string) {
    const [clients, contracts, opportunities, employees, departments] = await Promise.all([
      this.prisma.businessPartner.findMany({ where: { companyId, deletedAt: null, type: 'CLIENT' }, select: { id: true, name: true, partnerNumber: true }, orderBy: { name: 'asc' } }),
      this.prisma.contract.findMany({ where: { companyId, deletedAt: null, status: { notIn: ['EXPIRED', 'TERMINATED'] } }, select: { id: true, contractNumber: true, title: true, partnerId: true, status: true }, orderBy: { contractNumber: 'desc' } }),
      this.prisma.opportunity.findMany({ where: { companyId, deletedAt: null, stage: { notIn: ['LOST', 'CANCELLED'] } }, select: { id: true, opportunityNumber: true, title: true, partnerId: true, stage: true, probability: true }, orderBy: { opportunityNumber: 'desc' } }),
      this.prisma.employee.findMany({ where: { companyId, deletedAt: null, status: { in: ['ACTIVE', 'ON_LEAVE', 'NOTICE_PERIOD'] } }, select: { id: true, firstName: true, lastName: true, departmentId: true }, orderBy: { lastName: 'asc' } }),
      this.prisma.department.findMany({ where: { companyId, deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    return { clients, contracts, opportunities, employees: employees.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`, departmentId: e.departmentId })), departments };
  }

  async get(companyId: string, id: string, user: AuthUser) {
    const row = await this.prisma.engineAssignment.findFirst({ where: { id, companyId, deletedAt: null }, include: detailInclude });
    if (!row) throw new NotFoundException('Assignment not found in this company');
    return this.redact(row, user);
  }

  private async validate(companyId: string, dto: AssignmentDto, isNew: boolean) {
    if (dto.endDate < dto.startDate) throw new BadRequestException('End date precedes start date');
    if (!dto.contractId && !dto.opportunityId) throw new BadRequestException('Link the assignment to a contract (contracted work) or an opportunity (pipeline)');
    const [client, service] = await Promise.all([
      this.prisma.businessPartner.findFirst({ where: { id: dto.clientId, companyId, deletedAt: null, type: 'CLIENT' }, select: { id: true } }),
      this.prisma.engineService.findFirst({ where: { id: dto.serviceId, companyId, deletedAt: null }, select: { id: true, lifecycle: true } }),
    ]);
    if (!client) throw new BadRequestException('Client must be a client of this company (CRM)');
    if (!service) throw new BadRequestException('Service not found in this company');
    if (isNew && service.lifecycle === 'RETIRED') throw new BadRequestException('Retired services cannot be sold');
    if (dto.contractId) {
      const contract = await this.prisma.contract.findFirst({ where: { id: dto.contractId, companyId, deletedAt: null }, select: { partnerId: true } });
      if (!contract) throw new BadRequestException('Contract not found in this company');
      if (contract.partnerId && contract.partnerId !== dto.clientId) throw new BadRequestException('The contract belongs to a different client');
    }
    if (dto.opportunityId) {
      const opp = await this.prisma.opportunity.findFirst({ where: { id: dto.opportunityId, companyId, deletedAt: null }, select: { partnerId: true } });
      if (!opp) throw new BadRequestException('Opportunity not found in this company');
      if (opp.partnerId !== dto.clientId) throw new BadRequestException('The opportunity belongs to a different client');
    }
    if (dto.packageId && !(await this.prisma.enginePackageItem.findFirst({ where: { packageId: dto.packageId, serviceId: dto.serviceId, package: { companyId, deletedAt: null } }, select: { id: true } }))) {
      throw new BadRequestException('The package does not contain this service');
    }
    if (dto.responsibleEmployeeId && !(await this.prisma.employee.findFirst({ where: { id: dto.responsibleEmployeeId, companyId, deletedAt: null }, select: { id: true } }))) {
      throw new BadRequestException('Responsible manager must be an employee of this company');
    }
    const missing = FEE_REQUIREMENTS[dto.feeModel].filter((key) => dto[key] === undefined || dto[key] === null || dto[key] === '');
    if (missing.length) throw new BadRequestException(`Fee model ${dto.feeModel} requires: ${missing.join(', ')}`);
    if (dto.feeModel === 'HYBRID' && !dto.fixedFee && !dto.hourlyRate) throw new BadRequestException('Hybrid fees require a fixed part and/or an hourly rate');
  }
  private data(dto: AssignmentDto) {
    return {
      clientId: dto.clientId, contractId: dto.contractId ?? null, opportunityId: dto.opportunityId ?? null, externalProjectRef: dto.externalProjectRef?.trim() || null, serviceId: dto.serviceId,
      packageId: dto.packageId ?? null, title: dto.title.trim(), scope: dto.scope ?? null, deliverables: dto.deliverables ?? null, responsibleEmployeeId: dto.responsibleEmployeeId ?? null,
      startDate: toDate(dto.startDate), endDate: toDate(dto.endDate), feeModel: dto.feeModel, fixedFee: dto.fixedFee ?? null, hourlyRate: dto.hourlyRate ?? null, dailyRate: dto.dailyRate ?? null,
      hoursPerDay: dto.hoursPerDay ?? null, monthlyRetainer: dto.monthlyRetainer ?? null, capexBasis: dto.capexBasis ?? null, capexBasisDefinition: dto.capexBasisDefinition ?? null,
      capexPercent: dto.capexPercent ?? null, billing: dto.billing, paymentTermDays: dto.paymentTermDays ?? null, vatRatePct: dto.vatRatePct ?? null, currencyCode: dto.currencyCode ?? 'EUR',
      travelCost: dto.travelCost ?? '0', softwareCost: dto.softwareCost ?? '0', otherCost: dto.otherCost ?? '0', subcontractFixedCost: dto.subcontractFixedCost ?? '0',
      probabilityOverride: dto.probabilityOverride ?? null, probabilityNote: dto.probabilityNote ?? null, exclusiveGroup: dto.exclusiveGroup?.trim() || null, shiftableWeeks: dto.shiftableWeeks ?? 0,
      risks: dto.risks ?? null, assumptions: dto.assumptions ?? null,
    };
  }

  /** Demand from the service template (resource mix → internal/external lines), scaled by the package factor. */
  private async templateDemand(serviceId: string, packageId: string | null) {
    const [service, item] = await Promise.all([
      this.prisma.engineService.findUnique({ where: { id: serviceId }, include: { requirements: { orderBy: { sortOrder: 'asc' } } } }),
      packageId ? this.prisma.enginePackageItem.findFirst({ where: { packageId, serviceId } }) : null,
    ]);
    const factor = item ? Number(item.hoursFactor) : 1;
    const lines: Prisma.EngineDemandCreateManyAssignmentInput[] = [];
    for (const r of service?.requirements ?? []) {
      const hours = Number(r.typicalHours) * factor; const internal = Number(r.internalSharePct) / 100;
      const source = packageId ? 'PACKAGE' : 'TEMPLATE';
      if (hours * internal > 0) lines.push({ skillId: r.skillId, role: r.role, seniority: r.seniority, hours: Math.round(hours * internal * 100) / 100, sourcing: 'INTERNAL', costRate: r.costRate, source, sortOrder: lines.length });
      if (hours * (1 - internal) > 0) lines.push({ skillId: r.skillId, role: `${r.role} (external)`, seniority: r.seniority, hours: Math.round(hours * (1 - internal) * 100) / 100, sourcing: 'EXTERNAL', externalRate: r.externalRate, source, sortOrder: lines.length });
    }
    return lines;
  }

  async create(companyId: string, user: AuthUser, dto: AssignmentDto) {
    await this.validate(companyId, dto, true);
    const demands = dto.generateDemand === 'NONE' ? [] : await this.templateDemand(dto.serviceId, dto.packageId ?? null);
    const row = await this.prisma.engineAssignment.create({ data: { ...this.data(dto), companyId, createdById: user.id, updatedById: user.id, demands: { createMany: { data: demands } } } });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_assignment', entityId: row.id, action: 'CREATE' });
    await this.snapshotForecast(companyId, row.id, user, 'ESTIMATE', 'Initial commercial estimate');
    return this.get(companyId, row.id, user);
  }

  /** One assignment per service of a package; fees from package overrides where defined. */
  async createFromPackage(companyId: string, user: AuthUser, packageId: string, dto: AssignmentDto) {
    const pkg = await this.prisma.enginePackage.findFirst({ where: { id: packageId, companyId, deletedAt: null }, include: { items: { orderBy: { sortOrder: 'asc' }, include: { service: { select: { name: true, revenueModel: true } } } } } });
    if (!pkg) throw new NotFoundException('Package not found in this company');
    const created: string[] = [];
    for (const item of pkg.items) {
      const row = await this.create(companyId, user, { ...dto, serviceId: item.serviceId, packageId, title: `${dto.title} — ${item.service.name}`,
        feeModel: item.feeOverride ? 'FIXED_FEE' : dto.feeModel, fixedFee: item.feeOverride ? item.feeOverride.toString() : dto.fixedFee, generateDemand: 'PACKAGE' });
      created.push(row.id);
    }
    return { created };
  }

  async update(companyId: string, id: string, user: AuthUser, dto: AssignmentDto) {
    const current = await this.prisma.engineAssignment.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!current) throw new NotFoundException('Assignment not found in this company');
    if (dto.expectedVersion !== undefined && dto.expectedVersion !== current.version) throw new ConflictException('The assignment changed in the meantime. Reload before saving.');
    if (['COMPLETED', 'CANCELLED'].includes(current.status)) throw new BadRequestException('Completed or cancelled assignments are read-only');
    await this.validate(companyId, dto, false);
    const data = this.data(dto);
    await this.prisma.engineAssignment.update({ where: { id }, data: { ...data, version: current.version + 1, updatedById: user.id } });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_assignment', entityId: id, action: 'UPDATE',
      changes: this.audit.diff(current as unknown as Record<string, unknown>, { ...current, ...data } as unknown as Record<string, unknown>) });
    return this.get(companyId, id, user);
  }

  async transition(companyId: string, id: string, user: AuthUser, dto: AssignmentStatusDto) {
    const current = await this.prisma.engineAssignment.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!current) throw new NotFoundException('Assignment not found in this company');
    if (!TRANSITIONS[current.status]?.includes(dto.status)) throw new BadRequestException(`Transition ${current.status} → ${dto.status} is not allowed`);
    await this.prisma.engineAssignment.update({ where: { id }, data: { status: dto.status, updatedById: user.id, version: current.version + 1 } });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_assignment', entityId: id, action: 'TRANSITION', changes: { status: { old: current.status, new: dto.status }, ...(dto.note ? { note: { old: null, new: dto.note } } : {}) } });
    if (dto.status === 'COMPLETED') await this.snapshotForecast(companyId, id, user, 'ACTUAL', dto.note ?? 'Completion snapshot');
    return this.get(companyId, id, user);
  }

  async archive(companyId: string, id: string, user: AuthUser) {
    const current = await this.prisma.engineAssignment.findFirst({ where: { id, companyId, deletedAt: null }, select: { status: true } });
    if (!current) throw new NotFoundException('Assignment not found in this company');
    if (current.status === 'ACTIVE') throw new ConflictException('Active assignments must be completed or cancelled first');
    await this.prisma.engineAssignment.update({ where: { id }, data: { deletedAt: new Date(), updatedById: user.id } });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_assignment', entityId: id, action: 'DELETE' });
  }

  /* ---------------------------------------------------------------- demand lines */
  private async editable(companyId: string, id: string) {
    const row = await this.prisma.engineAssignment.findFirst({ where: { id, companyId, deletedAt: null }, select: { id: true, status: true, startDate: true, endDate: true } });
    if (!row) throw new NotFoundException('Assignment not found in this company');
    if (['COMPLETED', 'CANCELLED'].includes(row.status)) throw new BadRequestException('Completed or cancelled assignments are read-only');
    return row;
  }
  private async demandData(companyId: string, dto: DemandDto, user: AuthUser, existing?: { costRate: Prisma.Decimal | null; externalRate: Prisma.Decimal | null }) {
    if (dto.startDate && dto.endDate && dto.endDate < dto.startDate) throw new BadRequestException('End date precedes start date');
    if (dto.skillId && !(await this.prisma.skill.findUnique({ where: { id: dto.skillId }, select: { id: true } }))) throw new BadRequestException('Unknown skill');
    if (dto.resourceId) {
      const res = await this.prisma.engineResource.findFirst({ where: { id: dto.resourceId, companyId, deletedAt: null }, select: { kind: true } });
      if (!res) throw new BadRequestException('Resource not found in this company');
    }
    const costs = canSeeCosts(user);
    if (!costs && (dto.costRate || dto.externalRate)) throw new ForbiddenException('Setting cost rates requires engine.economics permissions');
    return { skillId: dto.skillId ?? null, role: dto.role.trim(), seniority: dto.seniority, hours: dto.hours, startDate: dto.startDate ? toDate(dto.startDate) : null, endDate: dto.endDate ? toDate(dto.endDate) : null,
      resourceId: dto.resourceId ?? null, sourcing: dto.sourcing, billable: dto.billable ?? true, location: dto.location ?? null,
      costRate: costs ? dto.costRate ?? null : existing?.costRate ?? null, externalRate: costs ? dto.externalRate ?? null : existing?.externalRate ?? null };
  }
  async addDemand(companyId: string, id: string, user: AuthUser, dto: DemandDto) {
    await this.editable(companyId, id);
    const count = await this.prisma.engineDemand.count({ where: { assignmentId: id } });
    const row = await this.prisma.engineDemand.create({ data: { ...(await this.demandData(companyId, dto, user)), assignmentId: id, source: 'MANUAL', overrideNote: dto.overrideNote ?? null, sortOrder: count } });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_demand', entityId: row.id, action: 'CREATE' });
    return row;
  }
  /** Manual changes to template-generated lines are kept traceable (source → MANUAL with note). */
  async updateDemand(companyId: string, id: string, demandId: string, user: AuthUser, dto: DemandDto) {
    await this.editable(companyId, id);
    const current = await this.prisma.engineDemand.findFirst({ where: { id: demandId, assignmentId: id } });
    if (!current) throw new NotFoundException('Demand line not found');
    const data = await this.demandData(companyId, dto, user, current);
    const overridden = current.source !== 'MANUAL' && (Number(current.hours) !== dto.hours || current.skillId !== data.skillId || current.sourcing !== data.sourcing);
    const row = await this.prisma.engineDemand.update({ where: { id: demandId }, data: { ...data, ...(overridden ? { source: 'MANUAL', overrideNote: dto.overrideNote ?? `Overrides ${current.source.toLowerCase()} estimate of ${current.hours} h` } : { overrideNote: dto.overrideNote ?? current.overrideNote }) } });
    const before = Object.fromEntries(Object.entries(current).filter(([k]) => canSeeCosts(user) || !COST_FIELDS.includes(k as (typeof COST_FIELDS)[number])));
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_demand', entityId: demandId, action: 'UPDATE', changes: this.audit.diff(before, { ...before, ...data }) });
    return row;
  }
  async removeDemand(companyId: string, id: string, demandId: string, user: AuthUser) {
    await this.editable(companyId, id);
    const current = await this.prisma.engineDemand.findFirst({ where: { id: demandId, assignmentId: id } });
    if (!current) throw new NotFoundException('Demand line not found');
    if (Number(current.actualHours) > 0) throw new ConflictException('Demand with recorded actual hours cannot be removed; set remaining hours to 0');
    await this.prisma.engineDemand.delete({ where: { id: demandId } });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_demand', entityId: demandId, action: 'DELETE', changes: { hours: { old: current.hours.toString(), new: null } } });
  }
  async regenerateDemand(companyId: string, id: string, user: AuthUser) {
    await this.editable(companyId, id);
    const a = await this.prisma.engineAssignment.findUniqueOrThrow({ where: { id }, select: { serviceId: true, packageId: true } });
    const lines = await this.templateDemand(a.serviceId, a.packageId);
    const removable = await this.prisma.engineDemand.findMany({ where: { assignmentId: id, source: { in: ['TEMPLATE', 'PACKAGE'] }, actualHours: 0 }, select: { id: true } });
    await this.prisma.$transaction([
      this.prisma.engineDemand.deleteMany({ where: { id: { in: removable.map((r) => r.id) } } }),
      this.prisma.engineDemand.createMany({ data: lines.map((l) => ({ ...l, assignmentId: id })) }),
    ]);
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_assignment', entityId: id, action: 'REGENERATE_DEMAND', changes: { lines: { old: removable.length, new: lines.length } } });
    return this.get(companyId, id, user);
  }

  /* ---------------------------------------------------------------- milestones, adjustments, actuals */
  async addMilestone(companyId: string, id: string, user: AuthUser, dto: MilestoneDto) {
    await this.editable(companyId, id);
    const row = await this.prisma.engineMilestone.create({ data: { assignmentId: id, title: dto.title.trim(), dueDate: toDate(dto.dueDate), amount: dto.amount, isInvoiced: dto.isInvoiced ?? false } });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_milestone', entityId: row.id, action: 'CREATE' });
    return row;
  }
  async removeMilestone(companyId: string, id: string, milestoneId: string, user: AuthUser) {
    await this.editable(companyId, id);
    const row = await this.prisma.engineMilestone.findFirst({ where: { id: milestoneId, assignmentId: id } });
    if (!row) throw new NotFoundException('Milestone not found');
    if (row.isInvoiced) throw new ConflictException('Invoiced milestones cannot be removed');
    await this.prisma.engineMilestone.delete({ where: { id: milestoneId } });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_milestone', entityId: milestoneId, action: 'DELETE' });
  }
  /** Approved scope changes / amendments are append-only. */
  async addAdjustment(companyId: string, id: string, user: AuthUser, dto: AdjustmentDto) {
    await this.editable(companyId, id);
    const row = await this.prisma.engineAdjustment.create({ data: { assignmentId: id, effectiveDate: toDate(dto.effectiveDate), amount: dto.amount, kind: dto.kind, note: dto.note ?? null, createdById: user.id } });
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_adjustment', entityId: row.id, action: 'CREATE', changes: { amount: { old: null, new: dto.amount } } });
    return row;
  }
  async recordActuals(companyId: string, id: string, user: AuthUser, dto: ActualsDto) {
    const current = await this.prisma.engineAssignment.findFirst({ where: { id, companyId, deletedAt: null }, include: { demands: true } });
    if (!current) throw new NotFoundException('Assignment not found in this company');
    if (!canSeeCosts(user) && dto.actualCost !== undefined) throw new ForbiddenException('Recording actual cost requires engine.economics permissions');
    const lines = new Map(current.demands.map((d) => [d.id, d]));
    for (const d of dto.demand ?? []) if (!lines.has(d.id)) throw new BadRequestException('Demand line does not belong to this assignment');
    const totalHours = (dto.demand ?? []).reduce((s, d) => s + d.actualHours, 0) + current.demands.filter((d) => !(dto.demand ?? []).some((x) => x.id === d.id)).reduce((s, d) => s + Number(d.actualHours), 0);
    await this.prisma.$transaction([
      ...(dto.demand ?? []).map((d) => this.prisma.engineDemand.update({ where: { id: d.id }, data: { actualHours: d.actualHours, ...(d.remainingHours !== undefined ? { remainingHours: d.remainingHours } : {}) } })),
      this.prisma.engineAssignment.update({ where: { id }, data: { actualHours: totalHours, ...(dto.actualCost !== undefined ? { actualCost: dto.actualCost } : {}),
        ...(dto.actualRevenue !== undefined ? { actualRevenue: dto.actualRevenue } : {}), ...(dto.percentComplete !== undefined ? { percentComplete: dto.percentComplete } : {}),
        actualsAsOf: toDate(dto.actualsAsOf), updatedById: user.id } }),
    ]);
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_assignment', entityId: id, action: 'ACTUALS', changes: { actualHours: { old: current.actualHours.toString(), new: totalHours }, actualsAsOf: { old: current.actualsAsOf, new: dto.actualsAsOf } } });
    return this.get(companyId, id, user);
  }

  /* ---------------------------------------------------------------- economics & forecast versions */
  async economics(companyId: string, id: string): Promise<{ economics: AssignmentEconomics; calculatedAt: string; illustrativeConfig: boolean }> {
    const { snapshot } = await this.snapshots.build(companyId);
    const result = engineCall(() => computePortfolio(snapshot, 'EXPECTED'));
    const economics = result.assignments.find((a) => a.id === id);
    if (!economics) throw new NotFoundException('Assignment is not part of the forecast (cancelled, lost or missing probability)');
    return { economics, calculatedAt: result.calculatedAt, illustrativeConfig: result.illustrativeConfig };
  }
  /** Immutable economics snapshot (estimate, contract baseline, approved budget, forecast, actual). Never rewrites history. */
  async snapshotForecast(companyId: string, id: string, user: AuthUser, kind: string, note?: string) {
    let economics: AssignmentEconomics;
    try { economics = (await this.economics(companyId, id)).economics; } catch (error) {
      if (kind === 'ESTIMATE' && error instanceof NotFoundException) return null; // e.g. pipeline without probability yet
      throw error;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const last = await this.prisma.engineForecastVersion.findFirst({ where: { assignmentId: id }, orderBy: { version: 'desc' }, select: { version: true } });
      try {
        const row = await this.prisma.engineForecastVersion.create({ data: { assignmentId: id, kind, version: (last?.version ?? 0) + 1, engineVersion: ENGINE_VERSION, note: note ?? null, createdById: user.id,
          snapshot: { asOf: today(), revenue: economics.revenue, directCost: economics.costAtCompletion, contribution: economics.contribution, marginPct: economics.marginPct,
            hours: economics.hoursAtCompletion, plannedHours: economics.plannedHours, actualHours: economics.actualHours, actualCost: economics.actualCost, plannedCost: economics.plannedCost } } });
        await this.audit.log({ userId: user.id, companyId, entityType: 'engine_forecast_version', entityId: row.id, action: 'CREATE', changes: { kind: { old: null, new: kind } } });
        return row;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      }
    }
    throw new ConflictException('Concurrent forecast versions; try again');
  }
  async addForecastVersion(companyId: string, id: string, user: AuthUser, dto: ForecastVersionDto) {
    if (!(await this.prisma.engineAssignment.findFirst({ where: { id, companyId, deletedAt: null }, select: { id: true } }))) throw new NotFoundException('Assignment not found in this company');
    if (['CONTRACT_BASELINE', 'APPROVED_BUDGET'].includes(dto.kind) && !canSeeCosts(user)) throw new ForbiddenException('Approving baselines requires engine.economics permissions');
    return this.snapshotForecast(companyId, id, user, dto.kind, dto.note);
  }

  /* ---------------------------------------------------------------- PMO integration */
  /**
   * Idempotent progress sync from the PMO keyed by (externalProjectRef, service code).
   * Unknown references are rejected — no project data is fabricated. Older updates than the stored
   * actualsAsOf are ignored so replays and out-of-order deliveries cannot roll data back.
   */
  async pmoProgress(companyId: string, user: AuthUser, dto: PmoProgressDto) {
    const a = await this.prisma.engineAssignment.findFirst({ where: { companyId, deletedAt: null, externalProjectRef: dto.externalProjectRef, service: { code: dto.serviceCode } }, include: { demands: true } });
    if (!a) throw new NotFoundException('No assignment matches this PMO project reference and service code');
    if (a.actualsAsOf && a.actualsAsOf > toDate(dto.asOf)) return { applied: false, reason: 'Stale update (older than stored actuals)', assignmentId: a.id };
    if (dto.status && dto.status !== a.status && !TRANSITIONS[a.status]?.includes(dto.status)) throw new BadRequestException(`Transition ${a.status} → ${dto.status} is not allowed`);
    const data: Prisma.EngineAssignmentUpdateInput = { actualsAsOf: toDate(dto.asOf), updatedById: user.id,
      ...(dto.status ? { status: dto.status } : {}), ...(dto.percentComplete !== undefined ? { percentComplete: dto.percentComplete } : {}),
      ...(dto.actualHours !== undefined ? { actualHours: dto.actualHours } : {}), ...(dto.actualCost !== undefined && canSeeCosts(user) ? { actualCost: dto.actualCost } : {}),
      ...(dto.startDate ? { startDate: toDate(dto.startDate) } : {}), ...(dto.endDate ? { endDate: toDate(dto.endDate) } : {}) };
    const ops: Prisma.PrismaPromise<unknown>[] = [this.prisma.engineAssignment.update({ where: { id: a.id }, data })];
    // PMO reports totals; distribute actual/remaining hours over demand lines proportionally to planned hours.
    const planned = a.demands.reduce((s, d) => s + Number(d.hours), 0);
    if (planned > 0 && (dto.actualHours !== undefined || dto.remainingHours !== undefined)) for (const d of a.demands) {
      const share = Number(d.hours) / planned;
      ops.push(this.prisma.engineDemand.update({ where: { id: d.id }, data: { ...(dto.actualHours !== undefined ? { actualHours: Math.round(dto.actualHours * share * 100) / 100 } : {}),
        ...(dto.remainingHours !== undefined ? { remainingHours: Math.round(dto.remainingHours * share * 100) / 100 } : {}) } }));
    }
    await this.prisma.$transaction(ops);
    await this.audit.log({ userId: user.id, companyId, entityType: 'engine_assignment', entityId: a.id, action: 'PMO_SYNC', changes: { asOf: { old: a.actualsAsOf, new: dto.asOf } } });
    if (dto.status === 'COMPLETED' && a.status !== 'COMPLETED') await this.snapshotForecast(companyId, a.id, user, 'ACTUAL', 'Completed (PMO)');
    return { applied: true, assignmentId: a.id };
  }
}
