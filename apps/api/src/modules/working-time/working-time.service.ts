import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, TimesheetStatus } from '@prisma/client';
import { AuthUser } from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  ClockInDto,
  ClockOutDto,
  DecideTimesheetDto,
  ProjectEntryDto,
  TeamQueryDto,
  TimeRecordDto,
  TimesheetListQueryDto,
} from './time.dto';
import { EMPLOYEE_REF_SELECT, EmployeeRef, TimeCalendarService, today } from './time-calendar.service';
import {
  addDays,
  formatDay,
  fromZoned,
  hasBlockingViolation,
  hoursToMinutes,
  isoWeek,
  overlaps,
  parseDay,
  toZoned,
  weekStartOf,
} from './time-domain';

/** Holders of this permission act on every employee of the company. */
export const TIME_MANAGER_PERMISSION = 'time.timesheets.approve';
const LOCKED: TimesheetStatus[] = ['SUBMITTED', 'APPROVED'];
const MAX_BLOCK_MINUTES = 16 * 60;

export function canManageTime(user: AuthUser): boolean {
  return user.isSystemAdmin || user.permissions.includes(TIME_MANAGER_PERMISSION);
}

@Injectable()
export class WorkingTimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: TimeCalendarService,
    private readonly events: EventEmitter2,
  ) {}

  // ------------------------------------------------------------ scoping

  /** The caller's own employee, or — for time managers — any employee of the company. */
  async resolveEmployee(user: AuthUser, companyId: string, employeeId?: string): Promise<EmployeeRef & { userId: string | null }> {
    const select = { ...EMPLOYEE_REF_SELECT, userId: true } as const;
    if (!employeeId) {
      const own = await this.prisma.employee.findFirst({ where: { companyId, userId: user.id, deletedAt: null }, select });
      if (!own) throw new NotFoundException({ code: 'NO_EMPLOYEE_PROFILE', message: 'No employee profile is linked to your user in this company' });
      return own;
    }
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId, deletedAt: null }, select });
    if (!employee) throw new NotFoundException('Employee not found in this company');
    if (employee.userId !== user.id && !canManageTime(user)) {
      throw new ForbiddenException('You may only access your own working time');
    }
    return employee;
  }

  private async assertWeekOpen(employeeId: string, day: string, tx: Prisma.TransactionClient = this.prisma) {
    const sheet = await tx.timesheet.findUnique({
      where: { employeeId_weekStart: { employeeId, weekStart: parseDay(weekStartOf(day)) } },
      select: { status: true },
    });
    if (sheet && LOCKED.includes(sheet.status)) {
      throw new ConflictException({ code: 'TIMESHEET_LOCKED', message: `The timesheet for this week is ${sheet.status.toLowerCase()}; reopen it to make changes` });
    }
  }

  // ------------------------------------------------------------- week view

  async week(user: AuthUser, companyId: string, employeeId: string | undefined, week: string | undefined) {
    const employee = await this.resolveEmployee(user, companyId, employeeId);
    const weekStart = weekStartOf(week ?? today());
    const weekEnd = addDays(weekStart, 6);
    const [{ summaries, records, entries }, timesheet, openRecord] = await Promise.all([
      this.calendar.summaries(companyId, [employee], weekStart, weekEnd),
      this.prisma.timesheet.findUnique({ where: { employeeId_weekStart: { employeeId: employee.id, weekStart: parseDay(weekStart) } } }),
      this.prisma.timeRecord.findFirst({ where: { employeeId: employee.id, endAt: null }, orderBy: { startAt: 'desc' } }),
    ]);
    return {
      employee: { id: employee.id, firstName: employee.firstName, lastName: employee.lastName },
      weekStart,
      weekEnd,
      isoWeek: isoWeek(weekStart),
      today: today(),
      timesheet: timesheet ?? { status: 'DRAFT' as const },
      summary: summaries.get(employee.id),
      records: records.map((r) => this.presentRecord(r)),
      entries: entries.map((e) => ({ ...e, date: formatDay(e.date), hours: e.minutes / 60 })),
      openRecord: openRecord ? this.presentRecord(openRecord) : null,
      canManage: canManageTime(user),
    };
  }

  private presentRecord(r: { id: string; date: Date; startAt: Date; endAt: Date | null; breakMinutes: number; kind: string; note: string | null }) {
    return {
      id: r.id,
      date: formatDay(r.date),
      startAt: r.startAt,
      endAt: r.endAt,
      startTime: toZoned(r.startAt).time,
      endTime: r.endAt ? toZoned(r.endAt).time : null,
      breakMinutes: r.breakMinutes,
      kind: r.kind,
      note: r.note,
    };
  }

  // ---------------------------------------------------------- attendance

  private interval(dto: TimeRecordDto): { startAt: Date; endAt: Date | null } {
    const startAt = fromZoned(dto.date, dto.startTime);
    if (!dto.endTime) return { startAt, endAt: null };
    let endAt = fromZoned(dto.date, dto.endTime);
    if (endAt <= startAt) endAt = fromZoned(addDays(dto.date, 1), dto.endTime);
    const minutes = (endAt.getTime() - startAt.getTime()) / 60_000;
    if (minutes > MAX_BLOCK_MINUTES) throw new BadRequestException('A single work block cannot exceed 16 hours');
    if ((dto.breakMinutes ?? 0) >= minutes) throw new BadRequestException('Break must be shorter than the work block');
    return { startAt, endAt };
  }

  private async assertNoOverlap(employeeId: string, startAt: Date, endAt: Date | null, ignoreId?: string) {
    const candidates = await this.prisma.timeRecord.findMany({
      where: {
        employeeId,
        id: ignoreId ? { not: ignoreId } : undefined,
        startAt: { lt: endAt ?? new Date(startAt.getTime() + MAX_BLOCK_MINUTES * 60_000) },
        OR: [{ endAt: null }, { endAt: { gt: startAt } }],
      },
      select: { id: true, startAt: true, endAt: true },
    });
    if (candidates.some((c) => overlaps(c, { startAt, endAt }))) {
      throw new UnprocessableEntityException({ code: 'TIME_OVERLAP', message: 'This overlaps another work block of the employee' });
    }
  }

  /** Attendance records actual time: no start ahead of now, no end more than 15 min ahead. */
  private assertNotFuture(startAt: Date, endAt: Date | null) {
    if (startAt.getTime() > Date.now() + 5 * 60_000 || (endAt && endAt.getTime() > Date.now() + 15 * 60_000)) {
      throw new BadRequestException('Working time cannot be recorded in advance');
    }
  }

  async createRecord(user: AuthUser, companyId: string, dto: TimeRecordDto) {
    const employee = await this.resolveEmployee(user, companyId, dto.employeeId);
    const { startAt, endAt } = this.interval(dto);
    this.assertNotFuture(startAt, endAt);
    await this.assertWeekOpen(employee.id, dto.date);
    await this.assertNoOverlap(employee.id, startAt, endAt);
    const record = await this.prisma.timeRecord.create({
      data: {
        companyId, employeeId: employee.id, date: parseDay(dto.date), startAt, endAt,
        breakMinutes: dto.breakMinutes ?? 0, kind: dto.kind ?? 'OFFICE', note: dto.note?.trim() || null, createdById: user.id,
      },
    });
    return this.presentRecord(record);
  }

  private async ownedRecord(user: AuthUser, companyId: string, id: string) {
    const record = await this.prisma.timeRecord.findFirst({ where: { id, companyId } });
    if (!record) throw new NotFoundException('Time record not found');
    await this.resolveEmployee(user, companyId, record.employeeId);
    return record;
  }

  async updateRecord(user: AuthUser, companyId: string, id: string, dto: TimeRecordDto) {
    const record = await this.ownedRecord(user, companyId, id);
    if (dto.employeeId && dto.employeeId !== record.employeeId) throw new BadRequestException('A time record cannot be moved to another employee');
    const { startAt, endAt } = this.interval(dto);
    this.assertNotFuture(startAt, endAt);
    await this.assertWeekOpen(record.employeeId, formatDay(record.date));
    await this.assertWeekOpen(record.employeeId, dto.date);
    await this.assertNoOverlap(record.employeeId, startAt, endAt, id);
    const updated = await this.prisma.timeRecord.update({
      where: { id },
      data: { date: parseDay(dto.date), startAt, endAt, breakMinutes: dto.breakMinutes ?? 0, kind: dto.kind ?? record.kind, note: dto.note?.trim() || null },
    });
    return this.presentRecord(updated);
  }

  async deleteRecord(user: AuthUser, companyId: string, id: string) {
    const record = await this.ownedRecord(user, companyId, id);
    await this.assertWeekOpen(record.employeeId, formatDay(record.date));
    await this.prisma.timeRecord.delete({ where: { id } });
    return { id };
  }

  async clockIn(user: AuthUser, companyId: string, dto: ClockInDto) {
    const employee = await this.resolveEmployee(user, companyId, dto.employeeId);
    const now = new Date();
    now.setSeconds(0, 0);
    const day = toZoned(now).day;
    const open = await this.prisma.timeRecord.findFirst({ where: { employeeId: employee.id, endAt: null } });
    if (open) throw new ConflictException({ code: 'ALREADY_CLOCKED_IN', message: 'You are already clocked in' });
    await this.assertWeekOpen(employee.id, day);
    await this.assertNoOverlap(employee.id, now, null);
    const record = await this.prisma.timeRecord.create({
      data: { companyId, employeeId: employee.id, date: parseDay(day), startAt: now, kind: dto.kind ?? 'OFFICE', note: dto.note?.trim() || null, createdById: user.id },
    });
    return this.presentRecord(record);
  }

  async clockOut(user: AuthUser, companyId: string, dto: ClockOutDto) {
    const employee = await this.resolveEmployee(user, companyId, dto.employeeId);
    const open = await this.prisma.timeRecord.findFirst({ where: { employeeId: employee.id, endAt: null }, orderBy: { startAt: 'desc' } });
    if (!open) throw new ConflictException({ code: 'NOT_CLOCKED_IN', message: 'You are not clocked in' });
    const now = new Date();
    now.setSeconds(0, 0);
    const minutes = Math.round((now.getTime() - open.startAt.getTime()) / 60_000);
    if (minutes > MAX_BLOCK_MINUTES) {
      throw new UnprocessableEntityException({ code: 'CLOCK_OUT_TOO_LATE', message: 'The open record is older than 16 hours; correct it manually' });
    }
    const breakMinutes = dto.breakMinutes ?? open.breakMinutes;
    if (breakMinutes > 0 && breakMinutes >= minutes) throw new BadRequestException('Break must be shorter than the work block');
    await this.assertWeekOpen(employee.id, formatDay(open.date));
    const record = await this.prisma.timeRecord.update({
      where: { id: open.id },
      data: { endAt: now > open.startAt ? now : new Date(open.startAt.getTime() + 60_000), breakMinutes, note: dto.note?.trim() || open.note },
    });
    return this.presentRecord(record);
  }

  // -------------------------------------------------------- project hours

  async createEntry(user: AuthUser, companyId: string, dto: ProjectEntryDto) {
    const employee = await this.resolveEmployee(user, companyId, dto.employeeId);
    if (dto.date > today()) throw new BadRequestException('Project hours cannot be booked in advance');
    await this.assertWeekOpen(employee.id, dto.date);
    const entry = await this.prisma.projectTimeEntry.create({ data: { companyId, employeeId: employee.id, ...(await this.entryData(companyId, dto)) } });
    return { ...entry, date: formatDay(entry.date), hours: entry.minutes / 60 };
  }

  private async entryData(companyId: string, dto: ProjectEntryDto) {
    const projectCode = dto.projectCode.trim();
    const known = dto.projectName ? null : await this.prisma.pmoProject.findFirst({ where: { companyId, code: projectCode }, select: { name: true } });
    return {
      date: parseDay(dto.date),
      projectCode,
      projectName: dto.projectName?.trim() || known?.name || null,
      taskRef: dto.taskRef?.trim() || null,
      minutes: hoursToMinutes(dto.hours),
      billable: dto.billable ?? true,
      description: dto.description?.trim() || null,
      source: 'BMS' as const,
    };
  }

  private async ownedEntry(user: AuthUser, companyId: string, id: string) {
    const entry = await this.prisma.projectTimeEntry.findFirst({ where: { id, companyId } });
    if (!entry) throw new NotFoundException('Project time entry not found');
    await this.resolveEmployee(user, companyId, entry.employeeId);
    if (entry.source === 'PMO') {
      throw new ConflictException({ code: 'PMO_ENTRY_READ_ONLY', message: 'Hours imported from the PMO app can only be changed in the PMO app' });
    }
    return entry;
  }

  async updateEntry(user: AuthUser, companyId: string, id: string, dto: ProjectEntryDto) {
    const entry = await this.ownedEntry(user, companyId, id);
    if (dto.date > today()) throw new BadRequestException('Project hours cannot be booked in advance');
    await this.assertWeekOpen(entry.employeeId, formatDay(entry.date));
    await this.assertWeekOpen(entry.employeeId, dto.date);
    const updated = await this.prisma.projectTimeEntry.update({ where: { id }, data: await this.entryData(companyId, dto) });
    return { ...updated, date: formatDay(updated.date), hours: updated.minutes / 60 };
  }

  async deleteEntry(user: AuthUser, companyId: string, id: string) {
    const entry = await this.ownedEntry(user, companyId, id);
    await this.assertWeekOpen(entry.employeeId, formatDay(entry.date));
    await this.prisma.projectTimeEntry.delete({ where: { id } });
    return { id };
  }

  // ------------------------------------------------------------ timesheets

  async submit(user: AuthUser, companyId: string, employeeId: string | undefined, week: string | undefined) {
    const employee = await this.resolveEmployee(user, companyId, employeeId);
    const weekStart = weekStartOf(week ?? today());
    if (weekStart > today()) throw new BadRequestException('Future weeks cannot be submitted');
    const { summaries } = await this.calendar.summaries(companyId, [employee], weekStart, addDays(weekStart, 6));
    const summary = summaries.get(employee.id)!;
    if (hasBlockingViolation(summary.violations)) {
      throw new UnprocessableEntityException({ code: 'OPEN_TIME_RECORD', message: 'Close all open time records of this week before submitting' });
    }
    const key = { employeeId_weekStart: { employeeId: employee.id, weekStart: parseDay(weekStart) } };
    const current = await this.prisma.timesheet.findUnique({ where: key });
    if (current && LOCKED.includes(current.status)) {
      throw new ConflictException({ code: 'TIMESHEET_ALREADY_SUBMITTED', message: `The timesheet is already ${current.status.toLowerCase()}` });
    }
    const snapshot = {
      status: 'SUBMITTED' as const,
      targetMinutes: summary.totals.targetMinutes,
      workedMinutes: summary.totals.workedMinutes,
      projectMinutes: summary.totals.projectMinutes,
      violations: summary.violations as unknown as Prisma.InputJsonValue,
      submittedAt: new Date(),
      submittedById: user.id,
      decidedAt: null,
      decidedById: null,
      decisionNote: null,
    };
    const sheet = await this.prisma.timesheet.upsert({ where: key, update: snapshot, create: { ...snapshot, companyId, employeeId: employee.id, weekStart: parseDay(weekStart) } });
    this.events.emit('time.timesheet.submitted', { timesheetId: sheet.id, employeeId: employee.id, actorId: user.id });
    return sheet;
  }

  private async sheetForManager(user: AuthUser, companyId: string, id: string) {
    const sheet = await this.prisma.timesheet.findFirst({ where: { id, companyId }, include: { employee: { select: { userId: true } } } });
    if (!sheet) throw new NotFoundException('Timesheet not found');
    if (sheet.employee.userId === user.id && !user.isSystemAdmin) {
      throw new ForbiddenException({ code: 'FOUR_EYES', message: 'You cannot decide on your own timesheet' });
    }
    return sheet;
  }

  async decide(user: AuthUser, companyId: string, id: string, dto: DecideTimesheetDto) {
    const sheet = await this.sheetForManager(user, companyId, id);
    if (sheet.status !== 'SUBMITTED') {
      throw new UnprocessableEntityException({ code: 'TIMESHEET_NOT_SUBMITTED', message: `Timesheet is ${sheet.status.toLowerCase()}` });
    }
    if (dto.decision === 'REJECTED' && !dto.note?.trim()) throw new BadRequestException('Give a reason when rejecting a timesheet');
    const updated = await this.prisma.timesheet.update({
      where: { id },
      data: { status: dto.decision, decidedAt: new Date(), decidedById: user.id, decisionNote: dto.note?.trim() || null },
    });
    this.events.emit('time.timesheet.decided', { timesheetId: id, decision: dto.decision, actorId: user.id });
    return updated;
  }

  async reopen(user: AuthUser, companyId: string, id: string) {
    const sheet = await this.sheetForManager(user, companyId, id);
    if (!LOCKED.includes(sheet.status)) {
      throw new UnprocessableEntityException({ code: 'TIMESHEET_NOT_LOCKED', message: `Timesheet is ${sheet.status.toLowerCase()}` });
    }
    return this.prisma.timesheet.update({ where: { id }, data: { status: 'DRAFT', decidedAt: new Date(), decidedById: user.id, decisionNote: 'Reopened' } });
  }

  /** Employees withdraw their own submitted (not yet approved) timesheet. */
  async withdraw(user: AuthUser, companyId: string, id: string) {
    const sheet = await this.prisma.timesheet.findFirst({ where: { id, companyId } });
    if (!sheet) throw new NotFoundException('Timesheet not found');
    await this.resolveEmployee(user, companyId, sheet.employeeId);
    if (sheet.status !== 'SUBMITTED') {
      throw new UnprocessableEntityException({ code: 'TIMESHEET_NOT_SUBMITTED', message: `Timesheet is ${sheet.status.toLowerCase()}` });
    }
    return this.prisma.timesheet.update({ where: { id }, data: { status: 'DRAFT', submittedAt: null, submittedById: null } });
  }

  async listTimesheets(user: AuthUser, companyId: string, query: TimesheetListQueryDto) {
    const where: Prisma.TimesheetWhereInput = {
      companyId,
      status: query.status,
      weekStart: query.week ? parseDay(weekStartOf(query.week)) : undefined,
    };
    if (!canManageTime(user)) where.employee = { userId: user.id };
    const sheets = await this.prisma.timesheet.findMany({
      where,
      orderBy: [{ weekStart: 'desc' }, { submittedAt: 'asc' }],
      take: 200,
      include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } } },
    });
    return sheets.map((s) => ({ ...s, weekStart: formatDay(s.weekStart), isoWeek: isoWeek(formatDay(s.weekStart)) }));
  }

  // ------------------------------------------------------------- overviews

  async team(user: AuthUser, companyId: string, query: TeamQueryDto) {
    if (!canManageTime(user)) throw new ForbiddenException('Team overview requires time.timesheets.approve');
    const weekStart = weekStartOf(query.week ?? today());
    const weekEnd = addDays(weekStart, 6);
    const employees = await this.prisma.employee.findMany({
      where: {
        companyId, deletedAt: null, departmentId: query.departmentId || undefined,
        OR: [{ exitDate: null }, { exitDate: { gte: parseDay(weekStart) } }],
        status: { not: 'TERMINATED' },
      },
      select: { ...EMPLOYEE_REF_SELECT, employeeNumber: true, department: { select: { name: true } } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const [{ summaries }, sheets] = await Promise.all([
      this.calendar.summaries(companyId, employees, weekStart, weekEnd),
      this.prisma.timesheet.findMany({ where: { companyId, weekStart: parseDay(weekStart) } }),
    ]);
    const sheetBy = new Map(sheets.map((s) => [s.employeeId, s]));
    return {
      weekStart, weekEnd, isoWeek: isoWeek(weekStart),
      rows: employees.map((e) => {
        const summary = summaries.get(e.id)!;
        const sheet = sheetBy.get(e.id);
        return {
          employee: { id: e.id, firstName: e.firstName, lastName: e.lastName, employeeNumber: e.employeeNumber, department: e.department?.name ?? null },
          totals: summary.totals,
          violations: summary.violations.length,
          errors: summary.violations.filter((v) => v.severity === 'error').length,
          absenceDays: summary.days.filter((d) => d.absence && d.absence !== 'HOME_OFFICE').length,
          timesheet: sheet ? { id: sheet.id, status: sheet.status } : { id: null, status: 'DRAFT' },
        };
      }),
    };
  }

  /**
   * Flexitime balance (Gleitzeitsaldo): worked − target over the period. By
   * default it runs from 1 January, the hire date or the first recorded day,
   * whichever is latest, so introducing time recording mid-year starts at zero
   * (and an employee without any record has no balance yet).
   */
  async balance(user: AuthUser, companyId: string, employeeId: string | undefined, from?: string, to?: string) {
    const employee = await this.resolveEmployee(user, companyId, employeeId);
    const end = to ?? today();
    let start = from ?? `${end.slice(0, 4)}-01-01`;
    if (!from) {
      const first = await this.prisma.timeRecord.findFirst({ where: { employeeId: employee.id }, orderBy: { date: 'asc' }, select: { date: true } });
      if (!first) start = addDays(end, 1);
      else if (formatDay(first.date) > start) start = formatDay(first.date);
      if (employee.hireDate && formatDay(employee.hireDate) > start) start = formatDay(employee.hireDate);
    }
    if (start > end) return { from: start, to: end, targetMinutes: 0, workedMinutes: 0, balanceMinutes: 0, projectMinutes: 0, violations: 0 };
    if (parseDay(end).getTime() - parseDay(start).getTime() > 400 * 86_400_000) throw new BadRequestException('Balance period is limited to 400 days');
    const { summaries } = await this.calendar.summaries(companyId, [employee], start, end);
    const summary = summaries.get(employee.id)!;
    return {
      from: start,
      to: end,
      targetMinutes: summary.totals.targetMinutes,
      workedMinutes: summary.totals.workedMinutes,
      projectMinutes: summary.totals.projectMinutes,
      balanceMinutes: summary.totals.deltaMinutes,
      violations: summary.violations.length,
      vacationDays: summary.days.filter((d) => d.absence === 'VACATION' && d.scheduledMinutes > 0).length,
      sickDays: summary.days.filter((d) => d.absence === 'SICK' && d.scheduledMinutes > 0).length,
    };
  }

  /** CSV export of attendance and project hours (payroll / DATEV preparation). */
  async exportCsv(user: AuthUser, companyId: string, from: string, to: string, employeeId?: string) {
    if (from > to) throw new BadRequestException('from must not be after to');
    if (parseDay(to).getTime() - parseDay(from).getTime() > 400 * 86_400_000) throw new BadRequestException('Export period is limited to 400 days');
    const employees = employeeId || !canManageTime(user)
      ? [await this.resolveEmployee(user, companyId, employeeId)]
      : await this.prisma.employee.findMany({ where: { companyId, deletedAt: null }, select: EMPLOYEE_REF_SELECT, orderBy: [{ lastName: 'asc' }] });
    const numbers = new Map((await this.prisma.employee.findMany({ where: { id: { in: employees.map((e) => e.id) } }, select: { id: true, employeeNumber: true } })).map((e) => [e.id, e.employeeNumber]));
    const { summaries } = await this.calendar.summaries(companyId, employees, from, to);
    const quote = (value: string | number | null) => {
      const text = value == null ? '' : String(value);
      const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
      return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const hours = (minutes: number) => (minutes / 60).toFixed(2).replace('.', ',');
    const lines = [['employee_number', 'employee', 'date', 'target_h', 'worked_h', 'break_min', 'project_h', 'delta_h', 'absence', 'holiday', 'violations'].join(';')];
    for (const employee of employees) {
      for (const day of summaries.get(employee.id)!.days) {
        if (!day.targetMinutes && !day.workedMinutes && !day.projectMinutes && !day.absence) continue;
        lines.push([
          quote(numbers.get(employee.id) ?? ''), quote(`${employee.lastName}, ${employee.firstName}`), day.day,
          hours(day.targetMinutes), hours(day.workedMinutes), day.breakMinutes, hours(day.projectMinutes), hours(day.deltaMinutes),
          day.absence ?? '', quote(day.holiday), day.violations.map((v) => v.code).join(' '),
        ].join(';'));
      }
    }
    return `﻿${lines.join('\r\n')}\r\n`;
  }
}
