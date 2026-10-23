import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../src/core/prisma/prisma.service';
import type { AuthUser } from '../src/core/auth/decorators';
import { TimeCalendarService, today } from '../src/modules/working-time/time-calendar.service';
import { WorkingTimeService } from '../src/modules/working-time/working-time.service';
import { PlanningService } from '../src/modules/working-time/planning.service';
import { PmoSyncService } from '../src/modules/working-time/pmo-sync.service';
import { PmoClient, type PmoConfig } from '../src/modules/working-time/pmo-client';
import { addDays, weekStartOf } from '../src/modules/working-time/time-domain';

/**
 * pnpm exec tsx --env-file=.env test/working-time.postgres.ts
 *
 * Applies prisma/sql/add_working_time.sql on top of the previous schema in a
 * uniquely named PostgreSQL schema, then exercises attendance, ArbZG checks,
 * timesheet approval, planning and the PMO connector (against an in-process
 * fake of the PMO API). Only that schema is dropped afterwards.
 */
const TIME_MODELS = 'WorkSchedule|EmployeeWorkSchedule|TimeRecord|ProjectTimeEntry|Timesheet|TimeAllocation|PmoProject|PmoSyncRun';

class FakePmo {
  rows: { id: number; userId: number; resourceName: string; projectCode: string | null; projectName: string | null; taskTitle: string | null; discipline: null; activity: string; hours: number; date: string; billable: boolean }[] = [];
  users = [{ id: 7, email: 'ANA@octa.test', name: 'Ana Engineer' }, { id: 8, email: 'ghost@pmo.test', name: 'Ghost' }];
  projects = [{ id: 11, code: 'P-100', name: 'Refinery Revamp', status: 'active', archivedAt: null }, { id: 12, code: null, name: 'Tank Farm', status: 'completed', archivedAt: null }];
  fetch = async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === '/api/auth/login') {
      const body = JSON.parse(String(init?.body)) as { password: string };
      return body.password === 'pmo-secret' ? Response.json({ token: 'pmo-jwt' }) : Response.json({ error: 'invalid creds' }, { status: 401 });
    }
    if ((init?.headers as Record<string, string>).Authorization !== 'Bearer pmo-jwt') return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (path === '/api/workforce/timesheets') return Response.json({ rows: this.rows, totals: {} });
    if (path === '/api/users') return Response.json(this.users);
    if (path === '/api/projects') return Response.json(this.projects);
    return Response.json({ error: 'not found' }, { status: 404 });
  };
}

class TestPmoSync extends PmoSyncService {
  constructor(db: PrismaService, calendar: TimeCalendarService, private readonly fake: FakePmo) { super(db, calendar); }
  protected override config(): PmoConfig { return { baseUrl: 'http://pmo.test', email: 'svc@pmo.test', password: 'pmo-secret', days: 35, timeoutMs: 1000 }; }
  protected override client(config: PmoConfig) { return new PmoClient(config, this.fake.fetch); }
}

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  const artifacts = mkdtempSync(join(tmpdir(), 'octa-time-test-'));
  const baseline = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
    .replace(new RegExp(`^(?:enum (?:TimeRecordKind|TimeEntrySource|TimesheetStatus)|model (?:${TIME_MODELS})) \\{[\\s\\S]*?^\\}\\r?\\n`, 'gm'), '')
    .replace(new RegExp(`^\\s+\\w+\\s+(?:${TIME_MODELS})\\[\\]\\r?\\n`, 'gm'), '');
  const baselineFile = join(artifacts, 'baseline.prisma'); writeFileSync(baselineFile, baseline);
  const require = createRequire(import.meta.url);
  const baselineSql = execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', baselineFile, '--script'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const baselineSqlFile = join(artifacts, 'baseline.sql'); writeFileSync(baselineSqlFile, baselineSql);
  const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: url.pathname.slice(1), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password) };
  const runSql = (schema: string, file: string) => execFileSync(process.env.PSQL_PATH ?? 'psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-q', '-f', file], { env: { ...env, PGOPTIONS: `-c search_path=${schema}` }, stdio: ['ignore', 'pipe', 'pipe'] });

  const root = new PrismaClient();
  const schema = `time_test_${randomUUID().replaceAll('-', '')}`;
  let checks = 0;
  const check = async (label: string, fn: () => unknown | Promise<unknown>) => { await fn(); checks += 1; console.log(`  ✔ ${label}`); };
  try {
    await root.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    runSql(schema, baselineSqlFile);
    const testUrl = new URL(url); testUrl.searchParams.set('schema', schema);
    const db = new PrismaService({ datasources: { db: { url: testUrl.toString() } } });
    try {
      const company = await db.company.create({ data: { code: 'A', name: 'EPCM A' } });
      const other = await db.company.create({ data: { code: 'B', name: 'EPCM B' } });
      runSql(schema, join(process.cwd(), 'prisma/sql/add_working_time.sql'));
      await check('migration applies on top of existing data', async () => assert.equal(await db.company.count(), 2));

      const [anaUser, maxUser, leadUser] = await Promise.all(['ana', 'max', 'lead'].map((n) => db.user.create({ data: { email: `${n}@octa.test`, firstName: n, lastName: 'Test' } })));
      const ana = await db.employee.create({ data: { companyId: company.id, employeeNumber: 'E1', firstName: 'Ana', lastName: 'Engineer', userId: anaUser.id, workEmail: 'ana@octa.test', weeklyHours: '40' } });
      const max = await db.employee.create({ data: { companyId: company.id, employeeNumber: 'E2', firstName: 'Max', lastName: 'Planner', userId: maxUser.id } });
      await db.employee.create({ data: { companyId: company.id, employeeNumber: 'E3', firstName: 'Lea', lastName: 'Lead', userId: leadUser.id } });
      const self = (u: { id: string; email: string }): AuthUser => ({ id: u.id, email: u.email, isSystemAdmin: false, companyId: company.id, permissions: ['time.records.read', 'time.records.create'] });
      const lead: AuthUser = { ...self(leadUser), permissions: ['time.timesheets.approve'] };

      const calendar = new TimeCalendarService(db);
      const time = new WorkingTimeService(db, calendar, new EventEmitter2());
      const planning = new PlanningService(db, calendar);
      const fake = new FakePmo();
      const pmo = new TestPmoSync(db, calendar, fake);

      // A completed week in the past: Monday..Sunday
      const monday = addDays(weekStartOf(today()), -14);
      const day = (i: number) => addDays(monday, i);
      await db.companyCalendarEvent.create({ data: { companyId: company.id, title: 'Holiday', type: 'HOLIDAY', startDate: new Date(`${day(2)}T00:00:00Z`) } });
      await db.leaveRequest.create({ data: { employeeId: ana.id, type: 'VACATION', status: 'APPROVED', startDate: new Date(`${day(3)}T00:00:00Z`), endDate: new Date(`${day(3)}T00:00:00Z`), days: '1' } });

      await check('records attendance and rejects overlaps', async () => {
        await time.createRecord(self(anaUser), company.id, { date: day(0), startTime: '08:00', endTime: '17:00', breakMinutes: 45 });
        await time.createRecord(self(anaUser), company.id, { date: day(1), startTime: '07:00', endTime: '12:00' });
        await time.createRecord(self(anaUser), company.id, { date: day(1), startTime: '12:10', endTime: '19:30' });
        await assert.rejects(time.createRecord(self(anaUser), company.id, { date: day(0), startTime: '16:00', endTime: '18:00' }), /overlaps/);
      });
      await check('employees cannot touch colleagues; managers can', async () => {
        await assert.rejects(time.week(self(anaUser), company.id, max.id, day(0)), /own working time/);
        const view = await time.week(lead, company.id, ana.id, day(0));
        assert.equal(view.records.length, 3);
      });
      await check('cross-company access is refused', async () => {
        await assert.rejects(time.week({ ...lead, companyId: other.id }, other.id, ana.id, day(0)), /not found/);
      });
      await check('week summary applies holidays, leave and ArbZG', async () => {
        const view = await time.week(self(anaUser), company.id, undefined, day(0));
        const summary = view.summary!;
        assert.deepEqual(summary.days.map((d) => d.targetMinutes), [480, 480, 0, 0, 480, 0, 0]);
        assert.equal(summary.totals.workedMinutes, 495 + 300 + 440);
        const codes = summary.violations.map((v) => `${v.day}:${v.code}`);
        assert.deepEqual(codes, [`${day(1)}:MAX_DAILY_EXCEEDED`, `${day(1)}:BREAK_TOO_SHORT`]);
      });
      await check('clock in/out keeps one open record', async () => {
        await time.clockIn(self(maxUser), company.id, { kind: 'HOME_OFFICE' });
        await assert.rejects(time.clockIn(self(maxUser), company.id, {}), /already clocked in/);
        const closed = await time.clockOut(self(maxUser), company.id, {});
        assert.ok(closed.endAt);
      });

      await check('PMO pull mirrors projects and matched entries', async () => {
        fake.rows = [
          { id: 501, userId: 7, resourceName: 'Ana Engineer', projectCode: 'P-100', projectName: 'Refinery Revamp', taskTitle: 'Piping ISOs', discipline: null, activity: 'Isometrics', hours: 6, date: day(0), billable: true },
          { id: 502, userId: 7, resourceName: 'Ana Engineer', projectCode: 'P-100', projectName: 'Refinery Revamp', taskTitle: null, discipline: null, activity: 'Non-billable', hours: 2.5, date: day(1), billable: false },
          { id: 503, userId: 8, resourceName: 'Ghost', projectCode: 'P-100', projectName: 'Refinery Revamp', taskTitle: null, discipline: null, activity: 'Billable work', hours: 4, date: day(1), billable: true },
        ];
        const result = await pmo.sync(company.id, 'MANUAL', leadUser.id);
        assert.deepEqual([result.created, result.updated, result.removed, result.unmatched.length], [2, 0, 0, 1]);
        assert.equal(await db.pmoProject.count({ where: { companyId: company.id } }), 2);
        assert.equal((await db.pmoProject.findFirstOrThrow({ where: { externalId: '12' } })).code, 'PMO-12');
        const entries = await db.projectTimeEntry.findMany({ where: { employeeId: ana.id }, orderBy: { date: 'asc' } });
        assert.deepEqual(entries.map((e) => [e.minutes, e.billable, e.description]), [[360, true, 'Isometrics'], [150, false, null]]);
      });
      await check('PMO entries are read-only in BMS', async () => {
        const entry = await db.projectTimeEntry.findFirstOrThrow({ where: { externalId: '501' } });
        await assert.rejects(time.deleteEntry(self(anaUser), company.id, entry.id), /PMO app/);
      });
      await check('re-sync is idempotent, updates and prunes', async () => {
        assert.equal((await pmo.sync(company.id, 'MANUAL', null)).created, 0);
        fake.rows = [{ ...fake.rows[0], hours: 7 }];
        const result = await pmo.sync(company.id, 'MANUAL', null);
        assert.deepEqual([result.updated, result.removed], [1, 1]);
      });
      await check('timesheet submit locks the week, approval enforces four eyes', async () => {
        await time.createEntry(self(anaUser), company.id, { date: day(4), projectCode: 'P-100', hours: 1 });
        const sheet = await time.submit(self(anaUser), company.id, undefined, day(0));
        assert.equal(sheet.status, 'SUBMITTED');
        assert.equal(sheet.projectMinutes, 420 + 60);
        await assert.rejects(time.createRecord(self(anaUser), company.id, { date: day(4), startTime: '08:00', endTime: '09:00' }), /submitted/);
        await assert.rejects(time.decide({ ...lead, id: anaUser.id }, company.id, sheet.id, { decision: 'APPROVED' }), /own timesheet/);
        await assert.rejects(time.decide(lead, company.id, sheet.id, { decision: 'REJECTED' }), /reason/);
        assert.equal((await time.decide(lead, company.id, sheet.id, { decision: 'APPROVED' })).status, 'APPROVED');
      });
      await check('PMO changes in an approved week are skipped, not applied', async () => {
        fake.rows = [{ ...fake.rows[0], hours: 3 }];
        const result = await pmo.sync(company.id, 'MANUAL', null);
        assert.deepEqual([result.updated, result.skipped], [0, 1]);
        assert.equal((await db.projectTimeEntry.findFirstOrThrow({ where: { externalId: '501' } })).minutes, 420);
      });
      await check('PMO push upserts and deletes by id', async () => {
        // Max has no work e-mail; his login e-mail matches.
        const pushed = await pmo.push(company.id, leadUser.id, { entries: [{ id: 'x-1', userEmail: 'MAX@octa.test', date: today(), hours: 2, projectCode: 'P-200' }] });
        assert.deepEqual([pushed.created, pushed.unmatched.length], [1, 0]);
        assert.equal((await db.projectTimeEntry.findFirstOrThrow({ where: { externalId: 'x-1' } })).employeeId, max.id);
        assert.equal((await pmo.push(company.id, leadUser.id, { entries: [], deletedIds: ['x-1'] })).removed, 1);
      });
      await check('planning allocates over weeks and reports capacity', async () => {
        const week0 = weekStartOf(today());
        await planning.allocate(company.id, leadUser.id, { employeeId: ana.id, projectCode: 'P-100', fromWeek: week0, toWeek: addDays(week0, 14), hoursPerWeek: 20 });
        const board = await planning.capacity(company.id, { from: week0, weeks: 3 });
        const row = board.rows.find((r) => r.employee.id === ana.id)!;
        assert.deepEqual(row.cells.map((c) => c.plannedMinutes), [1200, 1200, 1200]);
        assert.equal(board.projects[0].projectName, 'Refinery Revamp');
        await planning.allocate(company.id, leadUser.id, { employeeId: ana.id, projectCode: 'P-100', fromWeek: week0, toWeek: week0, hoursPerWeek: 0 });
        assert.equal(await db.timeAllocation.count({ where: { employeeId: ana.id } }), 2);
      });
      await check('schedules drive targets from their validity date', async () => {
        const part = await planning.saveSchedule(company.id, { code: 'tz30', name: 'Part time 30', dailyMinutes: [360, 360, 360, 360, 360, 0, 0], isDefault: true });
        await planning.assign(company.id, { employeeId: max.id, scheduleId: part.id, validFrom: day(0) });
        const view = await time.week(lead, company.id, max.id, day(0));
        assert.equal(view.summary!.days[0].targetMinutes, 360);
        assert.equal((await planning.schedules(company.id))[0].weeklyMinutes, 1800);
      });
      await check('capacity export for PMO is keyed by e-mail', async () => {
        const out = await pmo.capacityExport(company.id, day(0), day(6));
        const anaRow = out.employees.find((e) => e.email === 'ana@octa.test')!;
        assert.equal(anaRow.weeks[0].availableHours, 24);
        assert.deepEqual(anaRow.weeks[0].absences.map((a) => a.type), ['HOLIDAY', 'VACATION']);
      });
      await check('balance and CSV export', async () => {
        const balance = await time.balance(self(anaUser), company.id, undefined, day(0), day(6));
        assert.equal(balance.balanceMinutes, 495 + 300 + 440 - 1440);
        const csv = await time.exportCsv(lead, company.id, day(0), day(6));
        assert.match(csv, /E1;Engineer, Ana;/);
      });
      const runs = await db.pmoSyncRun.findMany({ where: { companyId: company.id } });
      await check('every sync run is recorded', () => assert.ok(runs.length >= 5 && runs.every((r) => r.status === 'SUCCEEDED')));
    } finally {
      await db.$disconnect();
    }
    console.log(`Working time: ${checks} PostgreSQL checks passed`);
  } finally {
    await root.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await root.$disconnect();
    rmSync(artifacts, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
