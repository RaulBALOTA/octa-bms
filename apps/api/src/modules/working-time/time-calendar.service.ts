import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  AbsenceKind,
  DayPlan,
  PeriodSummary,
  ScheduleAssignment,
  WorkBlock,
  addDays,
  daysBetween,
  formatDay,
  parseDay,
  patternFromWeeklyHours,
  patternOn,
  planDay,
  summarizePeriod,
  toZoned,
} from './time-domain';

export interface EmployeeRef {
  id: string;
  firstName: string;
  lastName: string;
  weeklyHours: unknown;
  hireDate: Date | null;
  exitDate: Date | null;
}

export const EMPLOYEE_REF_SELECT = {
  id: true, firstName: true, lastName: true, weeklyHours: true, hireDate: true, exitDate: true,
} as const;

export function today(): string {
  return toZoned(new Date()).day;
}

/**
 * Loads everything that defines an employee's target time (work schedules,
 * public holidays from the company calendar, approved leave) and the actuals
 * (attendance and project hours), batched for many employees.
 */
@Injectable()
export class TimeCalendarService {
  constructor(private readonly prisma: PrismaService) {}

  async holidays(companyId: string, from: string, to: string): Promise<Map<string, string>> {
    const events = await this.prisma.companyCalendarEvent.findMany({
      where: {
        type: 'HOLIDAY',
        OR: [{ companyId }, { companyId: null }],
        startDate: { lte: new Date(parseDay(addDays(to, 1)).getTime()) },
      },
      select: { title: true, startDate: true, endDate: true },
    });
    const map = new Map<string, string>();
    for (const event of events) {
      const first = toZoned(event.startDate).day;
      const last = event.endDate ? toZoned(event.endDate).day : first;
      if (last < from || first > to) continue;
      for (const day of daysBetween(first < from ? from : first, last > to ? to : last)) map.set(day, event.title);
    }
    return map;
  }

  async absences(employeeIds: string[], from: string, to: string): Promise<Map<string, Map<string, AbsenceKind>>> {
    const leave = await this.prisma.leaveRequest.findMany({
      where: {
        employeeId: { in: employeeIds },
        status: 'APPROVED',
        startDate: { lte: parseDay(addDays(to, 1)) },
        endDate: { gte: parseDay(addDays(from, -1)) },
      },
      select: { employeeId: true, type: true, startDate: true, endDate: true },
    });
    const result = new Map<string, Map<string, AbsenceKind>>();
    for (const request of leave) {
      const first = toZoned(request.startDate).day;
      const last = toZoned(request.endDate).day;
      const map = result.get(request.employeeId) ?? new Map<string, AbsenceKind>();
      for (const day of daysBetween(first < from ? from : first, last > to ? to : last)) {
        // Home office never displaces a credited absence on the same day.
        if (request.type === 'HOME_OFFICE' && map.has(day)) continue;
        map.set(day, request.type as AbsenceKind);
      }
      result.set(request.employeeId, map);
    }
    return result;
  }

  async assignments(employeeIds: string[]): Promise<Map<string, ScheduleAssignment[]>> {
    const rows = await this.prisma.employeeWorkSchedule.findMany({
      where: { employeeId: { in: employeeIds } },
      select: { employeeId: true, validFrom: true, validTo: true, schedule: { select: { dailyMinutes: true } } },
    });
    const map = new Map<string, ScheduleAssignment[]>();
    for (const row of rows) {
      map.set(row.employeeId, [...(map.get(row.employeeId) ?? []), {
        validFrom: formatDay(row.validFrom), validTo: row.validTo ? formatDay(row.validTo) : null, dailyMinutes: row.schedule.dailyMinutes,
      }]);
    }
    return map;
  }

  async defaultPattern(companyId: string): Promise<number[] | null> {
    const schedule = await this.prisma.workSchedule.findFirst({ where: { companyId, isDefault: true, isActive: true }, select: { dailyMinutes: true } });
    return schedule?.dailyMinutes ?? null;
  }

  /** Day plans (target time) per employee for [from, to]. */
  async plans(companyId: string, employees: EmployeeRef[], from: string, to: string): Promise<Map<string, Map<string, DayPlan>>> {
    const ids = employees.map((e) => e.id);
    const [holidays, absences, assignments, companyDefault] = await Promise.all([
      this.holidays(companyId, from, to), this.absences(ids, from, to), this.assignments(ids), this.defaultPattern(companyId),
    ]);
    const days = daysBetween(from, to);
    const result = new Map<string, Map<string, DayPlan>>();
    for (const employee of employees) {
      const weekly = employee.weeklyHours == null ? null : Number(employee.weeklyHours);
      const fallback = weekly ? patternFromWeeklyHours(weekly) : companyDefault ?? patternFromWeeklyHours(null);
      const employment = { from: employee.hireDate ? formatDay(employee.hireDate) : null, to: employee.exitDate ? formatDay(employee.exitDate) : null };
      const own = assignments.get(employee.id) ?? [];
      const leave = absences.get(employee.id) ?? new Map<string, AbsenceKind>();
      result.set(employee.id, new Map(days.map((day) => [day, planDay(day, patternOn(day, own, fallback), holidays, leave, employment)])));
    }
    return result;
  }

  /** Attendance blocks per employee for [from, to], plus the last end before `from`. */
  async blocks(employeeIds: string[], from: string, to: string) {
    const [records, previous] = await Promise.all([
      this.prisma.timeRecord.findMany({
        where: { employeeId: { in: employeeIds }, date: { gte: parseDay(from), lte: parseDay(to) } },
        orderBy: { startAt: 'asc' },
      }),
      this.prisma.timeRecord.groupBy({
        by: ['employeeId'],
        where: { employeeId: { in: employeeIds }, date: { gte: parseDay(addDays(from, -2)), lt: parseDay(from) }, endAt: { not: null } },
        _max: { endAt: true },
      }),
    ]);
    const blocks = new Map<string, WorkBlock[]>();
    for (const r of records) {
      blocks.set(r.employeeId, [...(blocks.get(r.employeeId) ?? []), { day: formatDay(r.date), startAt: r.startAt, endAt: r.endAt, breakMinutes: r.breakMinutes }]);
    }
    const lastEnd = new Map(previous.map((p) => [p.employeeId, p._max.endAt ?? null]));
    return { records, blocks, lastEnd };
  }

  async projectMinutes(employeeIds: string[], from: string, to: string) {
    const entries = await this.prisma.projectTimeEntry.findMany({
      where: { employeeId: { in: employeeIds }, date: { gte: parseDay(from), lte: parseDay(to) } },
      orderBy: [{ date: 'asc' }, { projectCode: 'asc' }],
    });
    const perDay = new Map<string, Map<string, number>>();
    const billable = new Map<string, number>();
    for (const e of entries) {
      const map = perDay.get(e.employeeId) ?? new Map<string, number>();
      const day = formatDay(e.date);
      map.set(day, (map.get(day) ?? 0) + e.minutes);
      perDay.set(e.employeeId, map);
      if (e.billable) billable.set(e.employeeId, (billable.get(e.employeeId) ?? 0) + e.minutes);
    }
    return { entries, perDay, billable };
  }

  /** Full period summary (targets, actuals, ArbZG checks) for each employee. */
  async summaries(companyId: string, employees: EmployeeRef[], from: string, to: string) {
    const ids = employees.map((e) => e.id);
    const [plans, actuals, projects] = await Promise.all([
      this.plans(companyId, employees, from, to), this.blocks(ids, from, to), this.projectMinutes(ids, from, to),
    ]);
    const days = daysBetween(from, to);
    const now = today();
    const summaries = new Map<string, PeriodSummary>();
    for (const employee of employees) {
      summaries.set(employee.id, summarizePeriod({
        days,
        plans: plans.get(employee.id) ?? new Map(),
        blocks: actuals.blocks.get(employee.id) ?? [],
        projectMinutes: projects.perDay.get(employee.id) ?? new Map(),
        billableMinutes: projects.billable.get(employee.id) ?? 0,
        previousLastEnd: actuals.lastEnd.get(employee.id) ?? null,
        today: now,
      }));
    }
    return { summaries, records: actuals.records, entries: projects.entries };
  }
}
