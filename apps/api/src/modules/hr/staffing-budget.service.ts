import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { StaffingBudgetInput } from '../../../../../packages/shared/src/staffing-budget';
import { PrismaService } from '../../core/prisma/prisma.service';
import { OrgChartService } from './org-chart.service';
import { calculateStaffingBudget } from './staffing-budget.calculation';
import { StaffingBudgetDto } from './staffing-budget.dto';

@Injectable()
export class StaffingBudgetService {
  constructor(private readonly prisma: PrismaService, private readonly chart: OrgChartService) {}

  async context(companyId: string, tx: Prisma.TransactionClient = this.prisma) {
    const [company, positions, departments, offices] = await Promise.all([
      tx.company.findFirst({ where: { id: companyId, deletedAt: null, isActive: true }, select: { name: true, defaultCurrency: true, fiscalYearStart: true } }),
      this.chart.positions(companyId, tx),
      tx.department.findMany({ where: { companyId, deletedAt: null, isActive: true }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
      tx.office.findMany({ where: { companyId, deletedAt: null, isActive: true }, select: { id: true, code: true, name: true, city: true }, orderBy: { name: 'asc' } }),
    ]);
    if (!company) throw new NotFoundException('Company not found');
    return { company: { name: company.name, currency: company.defaultCurrency, fiscalYearStart: company.fiscalYearStart },
      positions: positions.filter((position) => position.status !== 'FILLED').map((position) => ({ ...position, status: position.status as 'OPEN' | 'BUDGETED' })), departments, offices };
  }

  async calculate(companyId: string, dto: StaffingBudgetDto, tx: Prisma.TransactionClient = this.prisma) {
    if (!dto.includeOpen && !dto.includeBudgeted) throw new BadRequestException('Select Open positions, Budgeted positions, or both');
    const context = await this.context(companyId, tx);
    const positions = new Map(context.positions.map((position) => [position.id, position]));
    const offices = new Map(context.offices.map((office) => [office.id, office]));
    const seen = new Set<string>();
    const rows = dto.lines.map((line) => {
      if (seen.has(line.positionId)) throw new BadRequestException('A position can occur only once; use headcount for multiple hires');
      seen.add(line.positionId);
      const position = positions.get(line.positionId);
      if (!position) throw new BadRequestException('A position is unavailable or already filled. Refresh positions before calculating.');
      if (position.status === 'OPEN' && !dto.includeOpen || position.status === 'BUDGETED' && !dto.includeBudgeted) throw new BadRequestException('A position does not match the selected staffing states');
      const office = line.officeId ? offices.get(line.officeId) : null;
      if (line.officeId && !office) throw new BadRequestException('Office not found in this company');
      return { ...line, name: position.name, code: position.code, status: position.status,
        department: position.department, office: office ? { id: office.id, name: office.name } : null };
    });
    const plan: StaffingBudgetInput = { title: dto.title.trim(), year: dto.year, includeOpen: dto.includeOpen, includeBudgeted: dto.includeBudgeted,
      lines: dto.lines.map((line) => ({ ...line })) };
    const result = calculateStaffingBudget(dto.year, context.company.fiscalYearStart, context.company.currency, rows);
    return { plan, result };
  }

  list(companyId: string) {
    return this.prisma.staffingBudgetScenario.findMany({ where: { companyId }, orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, year: true, currency: true, version: true, updatedAt: true } });
  }

  async get(companyId: string, id: string) {
    const scenario = await this.prisma.staffingBudgetScenario.findFirst({ where: { companyId, id }, include: {
      revisions: { orderBy: { version: 'desc' }, select: { version: true, createdAt: true, note: true, createdBy: { select: { firstName: true, lastName: true } } } },
    } });
    if (!scenario) throw new NotFoundException('Staffing budget not found in this company');
    return scenario;
  }

  async revision(companyId: string, id: string, version: number) {
    const revision = await this.prisma.staffingBudgetRevision.findFirst({ where: { scenarioId: id, version, scenario: { companyId } },
      select: { version: true, plan: true, result: true, createdAt: true, note: true } });
    if (!revision) throw new NotFoundException('Staffing budget revision not found in this company');
    return revision;
  }

  async save(companyId: string, userId: string, dto: StaffingBudgetDto, id?: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = id ? await tx.staffingBudgetScenario.findFirst({ where: { id, companyId } }) : null;
        if (id && !current) throw new NotFoundException('Staffing budget not found in this company');
        if (current && dto.expectedVersion !== current.version) throw new ConflictException('This staffing budget has changed. Reload the latest version before saving.');
        const { plan, result } = await this.calculate(companyId, dto, tx);
        const data = { title: plan.title, year: plan.year, currency: result.currency, fiscalYearStart: result.fiscalYearStart,
          plan: plan as unknown as Prisma.InputJsonValue, result: result as unknown as Prisma.InputJsonValue };
        const version = (current?.version ?? 0) + 1;
        const scenario = current ? await tx.staffingBudgetScenario.update({ where: { id: current.id }, data: { ...data, version } })
          : await tx.staffingBudgetScenario.create({ data: { ...data, companyId, createdById: userId, version } });
        await tx.staffingBudgetRevision.create({ data: { scenarioId: scenario.id, version, plan: data.plan, result: data.result,
          createdById: userId, note: dto.note?.trim() || null } });
        return scenario;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) throw new ConflictException('The staffing plan changed while saving. Reload and try again.');
      throw error;
    }
  }
}
