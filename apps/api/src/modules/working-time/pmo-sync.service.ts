import { ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PmoPushDto } from './time.dto';
import { PMO_TIMESHEET_ROW_CAP, PmoClient, PmoConfig, pmoConfigFromEnv } from './pmo-client';
import { IncomingPmoEntry, planPmoImport, removalBoundary } from './pmo-mapping';
import { EMPLOYEE_REF_SELECT, TimeCalendarService, today } from './time-calendar.service';
import { addDays, formatDay, parseDay, weekStartOf } from './time-domain';

type Trigger = 'MANUAL' | 'SCHEDULED' | 'PUSH';
const STALE_RUN_MS = 15 * 60_000;

/**
 * Connector to the PMO application, which centralises the hours the EPCM
 * teams book on projects.
 *
 * Pull: every sync logs into PMO with a service account, reads the rolling
 * timesheet window, its users (for e-mail matching) and its project register,
 * and mirrors them into BMS (`project_time_entries` with source PMO).
 * Push: PMO (or any middleware) may POST entries to /time/integration/pmo/entries.
 * Read-back: PMO reads capacity, absences and allocations from
 * /time/integration/capacity.
 */
@Injectable()
export class PmoSyncService {
  private readonly logger = new Logger(PmoSyncService.name);
  private readonly running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: TimeCalendarService,
  ) {}

  /** Overridable for tests. */
  protected config(): PmoConfig | null {
    return pmoConfigFromEnv();
  }

  protected client(config: PmoConfig): PmoClient {
    return new PmoClient(config);
  }

  async status(companyId: string) {
    const config = this.config();
    const [runs, projects, mirrored] = await Promise.all([
      this.prisma.pmoSyncRun.findMany({ where: { companyId }, orderBy: { startedAt: 'desc' }, take: 20 }),
      this.prisma.pmoProject.count({ where: { companyId } }),
      this.prisma.projectTimeEntry.count({ where: { companyId, source: 'PMO' } }),
    ]);
    return {
      configured: !!config,
      baseUrl: config?.baseUrl ?? null,
      windowDays: config?.days ?? null,
      scheduled: process.env.PMO_SYNC_ENABLED === 'true',
      projects,
      mirroredEntries: mirrored,
      runs: runs.map((r) => ({ ...r, windowFrom: r.windowFrom ? formatDay(r.windowFrom) : null })),
    };
  }

  private async employeesByEmail(companyId: string): Promise<Map<string, string>> {
    const employees = await this.prisma.employee.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, workEmail: true, user: { select: { email: true } } },
    });
    const map = new Map<string, string>();
    for (const e of employees) {
      for (const email of [e.workEmail, e.user?.email]) if (email) map.set(email.trim().toLowerCase(), e.id);
    }
    return map;
  }

  private async lockedWeeks(companyId: string, from: string): Promise<Set<string>> {
    const sheets = await this.prisma.timesheet.findMany({
      where: { companyId, status: { in: ['SUBMITTED', 'APPROVED'] }, weekStart: { gte: parseDay(weekStartOf(from)) } },
      select: { employeeId: true, weekStart: true },
    });
    return new Set(sheets.map((s) => `${s.employeeId}:${formatDay(s.weekStart)}`));
  }

  private async begin(companyId: string, trigger: Trigger, userId: string | null, windowFrom: string | null) {
    if (this.running.has(companyId)) throw new ConflictException('A PMO synchronisation is already running for this company');
    const active = await this.prisma.pmoSyncRun.findFirst({
      where: { companyId, status: 'RUNNING', startedAt: { gt: new Date(Date.now() - STALE_RUN_MS) } },
    });
    if (active) throw new ConflictException('A PMO synchronisation is already running for this company');
    this.running.add(companyId);
    return this.prisma.pmoSyncRun.create({
      data: { companyId, trigger, status: 'RUNNING', triggeredById: userId, windowFrom: windowFrom ? parseDay(windowFrom) : null },
    });
  }

  /** Applies incoming entries and records the run. */
  private async apply(companyId: string, runId: string, incoming: IncomingPmoEntry[], removeFrom: string | null, deletedIds: string[] = []) {
    const dates = incoming.map((e) => e.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    const from = removeFrom ?? dates[0] ?? today();
    const externalIds = [...new Set([...incoming.map((e) => e.externalId), ...deletedIds])];
    const existingRows = await this.prisma.projectTimeEntry.findMany({
      where: {
        companyId, source: 'PMO',
        OR: [
          ...(removeFrom ? [{ date: { gte: parseDay(removeFrom) } }] : []),
          { externalId: { in: externalIds } },
        ],
      },
    });
    const existing = existingRows.map((e) => ({
      id: e.id, externalId: e.externalId ?? '', employeeId: e.employeeId, date: formatDay(e.date), minutes: e.minutes,
      projectCode: e.projectCode, projectName: e.projectName, taskRef: e.taskRef, billable: e.billable, description: e.description,
    }));
    const lockedFrom = [from, ...existing.map((e) => e.date)].sort()[0];
    const plan = planPmoImport({
      incoming,
      existing,
      employeesByEmail: await this.employeesByEmail(companyId),
      lockedWeeks: await this.lockedWeeks(companyId, lockedFrom),
      removeFrom,
    });
    // Explicit deletions (push mode) behave like entries that disappeared.
    if (deletedIds.length) {
      const locked = await this.lockedWeeks(companyId, lockedFrom);
      for (const e of existing.filter((x) => deletedIds.includes(x.externalId))) {
        if (locked.has(`${e.employeeId}:${weekStartOf(e.date)}`)) plan.skipped.push({ externalId: e.externalId, reason: 'LOCKED_WEEK' });
        else if (!plan.remove.includes(e.id)) plan.remove.push(e.id);
      }
    }

    const syncedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const c of plan.create) {
        await tx.projectTimeEntry.create({
          data: { ...c, date: parseDay(c.date), companyId, source: 'PMO', syncedAt },
        });
      }
      for (const u of plan.update) {
        await tx.projectTimeEntry.update({ where: { id: u.id }, data: { ...u.data, date: parseDay(u.data.date), syncedAt } });
      }
      if (plan.remove.length) await tx.projectTimeEntry.deleteMany({ where: { id: { in: plan.remove }, companyId, source: 'PMO' } });
      await tx.pmoSyncRun.update({
        where: { id: runId },
        data: {
          status: 'SUCCEEDED', finishedAt: new Date(), fetched: incoming.length, created: plan.create.length, updated: plan.update.length,
          removed: plan.remove.length, skipped: plan.skipped.length, unmatched: plan.unmatched as unknown as Prisma.InputJsonValue,
        },
      });
    }, { timeout: 60_000 });
    return { fetched: incoming.length, created: plan.create.length, updated: plan.update.length, removed: plan.remove.length, skipped: plan.skipped.length, unmatched: plan.unmatched };
  }

  private async fail(runId: string, error: unknown) {
    const message = error instanceof Error ? error.message : 'PMO synchronisation failed';
    await this.prisma.pmoSyncRun.update({ where: { id: runId }, data: { status: 'FAILED', finishedAt: new Date(), error: message.slice(0, 1000) } }).catch(() => undefined);
    return message;
  }

  async sync(companyId: string, trigger: Exclude<Trigger, 'PUSH'>, userId: string | null) {
    const config = this.config();
    if (!config) throw new ServiceUnavailableException('PMO connection is not configured (PMO_API_URL, PMO_SERVICE_EMAIL, PMO_SERVICE_PASSWORD)');
    const windowFrom = addDays(today(), -config.days);
    const run = await this.begin(companyId, trigger, userId, windowFrom);
    try {
      const client = this.client(config);
      const [rows, users, projects] = await Promise.all([client.timesheets(config.days), client.users(), client.projects()]);
      const emails = new Map(users.map((u) => [u.id, u.email]));
      await this.mirrorProjects(companyId, projects);
      const incoming: IncomingPmoEntry[] = rows.map((r) => ({
        externalId: String(r.id), email: emails.get(r.userId) ?? null, resourceName: r.resourceName, date: r.date, hours: Number(r.hours),
        projectCode: r.projectCode, projectName: r.projectName, taskRef: r.taskTitle, billable: r.billable !== false,
        description: r.activity === 'Billable work' || r.activity === 'Non-billable' ? null : r.activity,
      }));
      // PMO filters by `date >= now - days`; trim to whole days we fully received.
      const inWindow = incoming.filter((e) => e.date >= windowFrom);
      const result = await this.apply(companyId, run.id, inWindow, removalBoundary(windowFrom, rows, PMO_TIMESHEET_ROW_CAP));
      return { runId: run.id, ...result, truncated: rows.length >= PMO_TIMESHEET_ROW_CAP };
    } catch (error) {
      const message = await this.fail(run.id, error);
      this.logger.warn(`PMO sync failed for company ${companyId}: ${message}`);
      throw new ServiceUnavailableException(message);
    } finally {
      this.running.delete(companyId);
    }
  }

  private async mirrorProjects(companyId: string, projects: { id: number; code: string | null; name: string; status: string | null; archivedAt?: string | null }[]) {
    const syncedAt = new Date();
    for (const p of projects) {
      const data = {
        code: p.code?.trim() || `PMO-${p.id}`, name: p.name, status: p.status ?? null,
        isActive: !p.archivedAt && !['completed', 'closed', 'cancelled'].includes(String(p.status ?? '').toLowerCase()), syncedAt,
      };
      await this.prisma.pmoProject.upsert({
        where: { companyId_externalId: { companyId, externalId: String(p.id) } },
        update: data,
        create: { ...data, companyId, externalId: String(p.id) },
      });
    }
  }

  async push(companyId: string, userId: string, dto: PmoPushDto) {
    const run = await this.begin(companyId, 'PUSH', userId, null);
    try {
      const incoming: IncomingPmoEntry[] = dto.entries.map((e) => ({
        externalId: e.id, email: e.userEmail, resourceName: e.resourceName ?? null, date: e.date, hours: e.hours,
        projectCode: e.projectCode ?? null, projectName: e.projectName ?? null, taskRef: e.taskTitle ?? null,
        billable: e.billable ?? true, description: e.description ?? null,
      }));
      return { runId: run.id, ...(await this.apply(companyId, run.id, incoming, null, dto.deletedIds ?? [])) };
    } catch (error) {
      await this.fail(run.id, error);
      throw error;
    } finally {
      this.running.delete(companyId);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async scheduledSync() {
    if (process.env.PMO_SYNC_ENABLED !== 'true' || !this.config()) return;
    const companies = await this.prisma.company.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true } });
    for (const company of companies) {
      await this.sync(company.id, 'SCHEDULED', null).catch((error: unknown) => {
        this.logger.warn(`Scheduled PMO sync skipped for ${company.id}: ${error instanceof Error ? error.message : error}`);
      });
    }
  }

  /**
   * Read model for the PMO app: per employee (keyed by e-mail) and ISO week the
   * available hours after holidays/leave, the absences and planned allocations.
   */
  async capacityExport(companyId: string, from: string, to: string) {
    const first = weekStartOf(from);
    const last = addDays(weekStartOf(to), 6);
    if (parseDay(last).getTime() - parseDay(first).getTime() > 190 * 86_400_000) throw new ConflictException('Capacity export is limited to 26 weeks');
    const employees = await this.prisma.employee.findMany({
      where: { companyId, deletedAt: null, status: { not: 'TERMINATED' } },
      select: { ...EMPLOYEE_REF_SELECT, employeeNumber: true, workEmail: true, discipline: true, user: { select: { email: true } } },
      orderBy: [{ lastName: 'asc' }],
    });
    const [plans, allocations] = await Promise.all([
      this.calendar.plans(companyId, employees, first, last),
      this.prisma.timeAllocation.findMany({ where: { companyId, weekStart: { gte: parseDay(first), lte: parseDay(last) } } }),
    ]);
    const weeks: string[] = [];
    for (let w = first; w <= last; w = addDays(w, 7)) weeks.push(w);
    return {
      from: first,
      to: last,
      generatedAt: new Date().toISOString(),
      employees: employees.map((e) => {
        const dayPlans = plans.get(e.id)!;
        return {
          employeeNumber: e.employeeNumber,
          email: (e.workEmail ?? e.user?.email ?? '').toLowerCase() || null,
          name: `${e.firstName} ${e.lastName}`,
          discipline: e.discipline,
          weeks: weeks.map((week) => {
            const days = Array.from({ length: 7 }, (_, i) => dayPlans.get(addDays(week, i))!);
            return {
              weekStart: week,
              availableHours: days.reduce((s, d) => s + d.targetMinutes, 0) / 60,
              contractHours: days.reduce((s, d) => s + d.scheduledMinutes, 0) / 60,
              absences: days.filter((d) => d.scheduledMinutes > 0 && (d.holiday || (d.absence && d.absence !== 'HOME_OFFICE')))
                .map((d) => ({ date: d.day, type: d.holiday ? 'HOLIDAY' : d.absence })),
              allocations: allocations.filter((a) => a.employeeId === e.id && formatDay(a.weekStart) === week)
                .map((a) => ({ projectCode: a.projectCode, plannedHours: a.plannedMinutes / 60 })),
            };
          }),
        };
      }),
    };
  }
}
