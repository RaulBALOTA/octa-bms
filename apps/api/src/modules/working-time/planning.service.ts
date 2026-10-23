import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AllocationDto, AssignScheduleDto, CapacityQueryDto, WorkScheduleDto } from './time.dto';
import { EMPLOYEE_REF_SELECT, TimeCalendarService, today } from './time-calendar.service';
import { addDays, formatDay, hoursToMinutes, isoWeek, parseDay, weekStartOf } from './time-domain';

const MAX_ALLOCATION_WEEKS = 52;

@Injectable()
export class PlanningService {
  constructor(private readonly prisma: PrismaService, private readonly calendar: TimeCalendarService) {}

  // ------------------------------------------------------------ schedules

  async schedules(companyId: string) {
    const schedules = await this.prisma.workSchedule.findMany({
      where: { companyId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { assignments: { where: { validTo: null } } } } },
    });
    return schedules.map(({ _count, ...s }) => ({ ...s, weeklyMinutes: s.dailyMinutes.reduce((a, b) => a + b, 0), activeAssignments: _count.assignments }));
  }

  async saveSchedule(companyId: string, dto: WorkScheduleDto, id?: string) {
    if (dto.coreStart && dto.coreEnd && dto.coreStart >= dto.coreEnd) throw new BadRequestException('Core time must end after it starts');
    if (dto.dailyMinutes.reduce((a, b) => a + b, 0) > 48 * 60) throw new BadRequestException('A schedule cannot exceed 48 hours per week (ArbZG)');
    const data = {
      code: dto.code.trim().toUpperCase(), name: dto.name.trim(), dailyMinutes: dto.dailyMinutes,
      coreStart: dto.coreStart ?? null, coreEnd: dto.coreEnd ?? null, isDefault: dto.isDefault ?? false, isActive: dto.isActive ?? true,
    };
    if (data.isDefault && !data.isActive) throw new BadRequestException('The default schedule must be active');
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (id && !(await tx.workSchedule.findFirst({ where: { id, companyId } }))) throw new NotFoundException('Work schedule not found');
        if (data.isDefault) await tx.workSchedule.updateMany({ where: { companyId, isDefault: true, id: id ? { not: id } : undefined }, data: { isDefault: false } });
        return id ? tx.workSchedule.update({ where: { id }, data }) : tx.workSchedule.create({ data: { ...data, companyId } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('A schedule with this code already exists');
      throw error;
    }
  }

  async assignments(companyId: string, employeeId?: string) {
    const rows = await this.prisma.employeeWorkSchedule.findMany({
      where: { employee: { companyId }, employeeId },
      orderBy: [{ validFrom: 'desc' }],
      take: 500,
      include: {
        schedule: { select: { id: true, code: true, name: true } },
        employee: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    return rows.map((r) => ({ ...r, validFrom: formatDay(r.validFrom), validTo: r.validTo ? formatDay(r.validTo) : null }));
  }

  /** Assigns a schedule from a day on, closing the assignment that was valid then. */
  async assign(companyId: string, dto: AssignScheduleDto) {
    const [employee, schedule] = await Promise.all([
      this.prisma.employee.findFirst({ where: { id: dto.employeeId, companyId, deletedAt: null }, select: { id: true } }),
      this.prisma.workSchedule.findFirst({ where: { id: dto.scheduleId, companyId, isActive: true }, select: { id: true } }),
    ]);
    if (!employee) throw new NotFoundException('Employee not found in this company');
    if (!schedule) throw new NotFoundException('Active work schedule not found in this company');
    const from = parseDay(dto.validFrom);
    return this.prisma.$transaction(async (tx) => {
      // Later assignments are superseded by the new one.
      await tx.employeeWorkSchedule.deleteMany({ where: { employeeId: employee.id, validFrom: { gte: from } } });
      await tx.employeeWorkSchedule.updateMany({
        where: { employeeId: employee.id, validFrom: { lt: from }, OR: [{ validTo: null }, { validTo: { gte: from } }] },
        data: { validTo: parseDay(addDays(dto.validFrom, -1)) },
      });
      const created = await tx.employeeWorkSchedule.create({ data: { employeeId: employee.id, scheduleId: schedule.id, validFrom: from } });
      return { ...created, validFrom: dto.validFrom, validTo: null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  // ----------------------------------------------------------- allocations

  async allocate(companyId: string, userId: string, dto: AllocationDto) {
    const first = weekStartOf(dto.fromWeek);
    const last = weekStartOf(dto.toWeek);
    if (last < first) throw new BadRequestException('toWeek must not be before fromWeek');
    const weeks: string[] = [];
    for (let w = first; w <= last; w = addDays(w, 7)) weeks.push(w);
    if (weeks.length > MAX_ALLOCATION_WEEKS) throw new BadRequestException(`At most ${MAX_ALLOCATION_WEEKS} weeks per allocation`);
    const employee = await this.prisma.employee.findFirst({ where: { id: dto.employeeId, companyId, deletedAt: null }, select: { id: true } });
    if (!employee) throw new NotFoundException('Employee not found in this company');
    const projectCode = dto.projectCode.trim();
    const known = await this.prisma.pmoProject.findFirst({ where: { companyId, code: projectCode }, select: { name: true } });
    const projectName = dto.projectName?.trim() || known?.name || null;
    const plannedMinutes = hoursToMinutes(dto.hoursPerWeek);
    await this.prisma.$transaction(async (tx) => {
      for (const week of weeks) {
        const key = { employeeId_projectCode_weekStart: { employeeId: employee.id, projectCode, weekStart: parseDay(week) } };
        if (plannedMinutes === 0) {
          await tx.timeAllocation.deleteMany({ where: { employeeId: employee.id, projectCode, weekStart: parseDay(week) } });
          continue;
        }
        await tx.timeAllocation.upsert({
          where: key,
          update: { plannedMinutes, projectName, note: dto.note?.trim() || null },
          create: { companyId, employeeId: employee.id, projectCode, projectName, weekStart: parseDay(week), plannedMinutes, note: dto.note?.trim() || null, createdById: userId },
        });
      }
    });
    return { employeeId: employee.id, projectCode, weeks, plannedMinutes };
  }

  async removeAllocation(companyId: string, id: string) {
    const allocation = await this.prisma.timeAllocation.findFirst({ where: { id, companyId } });
    if (!allocation) throw new NotFoundException('Allocation not found');
    await this.prisma.timeAllocation.delete({ where: { id } });
    return { id };
  }

  /**
   * Capacity board: per employee and week the available time (target after
   * holidays and approved leave), planned project allocations and the hours
   * actually booked on projects (BMS + PMO).
   */
  async capacity(companyId: string, query: CapacityQueryDto) {
    const weeksCount = query.weeks ?? 8;
    const firstWeek = weekStartOf(query.from ?? today());
    const weeks = Array.from({ length: weeksCount }, (_, i) => addDays(firstWeek, i * 7));
    const lastDay = addDays(weeks[weeks.length - 1], 6);
    const range = { gte: parseDay(firstWeek), lte: parseDay(lastDay) };
    const projectCode = query.projectCode?.trim() || undefined;

    const employees = await this.prisma.employee.findMany({
      where: {
        companyId, deletedAt: null, departmentId: query.departmentId || undefined, status: { not: 'TERMINATED' },
        OR: [{ exitDate: null }, { exitDate: { gte: parseDay(firstWeek) } }],
        ...(projectCode ? { timeAllocations: { some: { projectCode, weekStart: range } } } : {}),
      },
      select: { ...EMPLOYEE_REF_SELECT, department: { select: { name: true } } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const ids = employees.map((e) => e.id);
    const [plans, allocations, booked] = await Promise.all([
      this.calendar.plans(companyId, employees, firstWeek, lastDay),
      this.prisma.timeAllocation.findMany({ where: { companyId, employeeId: { in: ids }, weekStart: range }, orderBy: { projectCode: 'asc' } }),
      this.prisma.projectTimeEntry.findMany({ where: { companyId, employeeId: { in: ids }, date: range }, select: { employeeId: true, date: true, minutes: true, projectCode: true, projectName: true } }),
    ]);

    const bookedByWeek = new Map<string, number>();
    for (const b of booked) {
      const key = `${b.employeeId}:${weekStartOf(formatDay(b.date))}`;
      bookedByWeek.set(key, (bookedByWeek.get(key) ?? 0) + b.minutes);
    }
    const projectNames = new Map<string, string | null>();
    const rows = employees.map((employee) => {
      const dayPlans = plans.get(employee.id)!;
      const cells = weeks.map((week) => {
        let capacityMinutes = 0;
        for (let i = 0; i < 7; i += 1) capacityMinutes += dayPlans.get(addDays(week, i))?.targetMinutes ?? 0;
        const own = allocations.filter((a) => a.employeeId === employee.id && formatDay(a.weekStart) === week);
        for (const a of own) if (!projectNames.get(a.projectCode)) projectNames.set(a.projectCode, a.projectName);
        const plannedMinutes = own.reduce((s, a) => s + a.plannedMinutes, 0);
        const actualMinutes = bookedByWeek.get(`${employee.id}:${week}`) ?? 0;
        return {
          weekStart: week,
          capacityMinutes,
          plannedMinutes,
          actualMinutes,
          utilization: capacityMinutes ? Math.round((plannedMinutes / capacityMinutes) * 100) : null,
          allocations: own.map((a) => ({ id: a.id, projectCode: a.projectCode, projectName: a.projectName, plannedMinutes: a.plannedMinutes, note: a.note })),
        };
      });
      return { employee: { id: employee.id, firstName: employee.firstName, lastName: employee.lastName, department: employee.department?.name ?? null }, cells };
    });

    const byProject = new Map<string, { projectCode: string; projectName: string | null; plannedMinutes: number; actualMinutes: number; employees: Set<string> }>();
    const bucket = (code: string) => {
      const existing = byProject.get(code);
      if (existing) return existing;
      const created = { projectCode: code, projectName: projectNames.get(code) ?? null, plannedMinutes: 0, actualMinutes: 0, employees: new Set<string>() };
      byProject.set(code, created);
      return created;
    };
    for (const a of allocations) { const b = bucket(a.projectCode); b.plannedMinutes += a.plannedMinutes; b.employees.add(a.employeeId); }
    for (const e of booked) {
      const b = bucket(e.projectCode);
      b.actualMinutes += e.minutes;
      b.projectName ??= e.projectName;
    }

    return {
      weeks: weeks.map((w) => ({ weekStart: w, isoWeek: isoWeek(w) })),
      rows,
      projects: [...byProject.values()]
        .filter((p) => !projectCode || p.projectCode === projectCode)
        .map(({ employees: people, ...p }) => ({ ...p, employees: people.size }))
        .sort((a, b) => b.plannedMinutes - a.plannedMinutes),
    };
  }

  /** Projects available for booking and planning: PMO register plus codes already in use. */
  async projects(companyId: string) {
    const [pmo, used] = await Promise.all([
      this.prisma.pmoProject.findMany({ where: { companyId }, orderBy: [{ isActive: 'desc' }, { code: 'asc' }] }),
      this.prisma.projectTimeEntry.groupBy({ by: ['projectCode'], where: { companyId }, _max: { projectName: true } }),
    ]);
    const codes = new Set(pmo.map((p) => p.code));
    return [
      ...pmo.map((p) => ({ code: p.code, name: p.name, status: p.status, isActive: p.isActive, source: 'PMO' as const })),
      ...used.filter((u) => !codes.has(u.projectCode)).map((u) => ({ code: u.projectCode, name: u._max.projectName, status: null, isActive: true, source: 'BMS' as const })),
    ];
  }
}
