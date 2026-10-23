import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { CalendarService } from '../src/modules/business-calendar/calendar.service';
import type { AuthUser } from '../src/core/auth/decorators';

/** Destructive cleanup is restricted to the uniquely named schemas created by this test. */
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  const artifacts = mkdtempSync(join(tmpdir(), 'octa-calendar-test-'));
  const schemaFile = join(process.cwd(), 'prisma/schema.prisma');
  const baselineSchema = readFileSync(schemaFile, 'utf8')
    .replace(/^(?:enum Calendar\w+|model BusinessCalendar\w+) \{[\s\S]*?^\}\r?\n/gm, '')
    .replace(/^.*ownedCalendarItems BusinessCalendarItem\[\].*\r?\n/gm, '')
    .replace(/^.*calendarItems\s+BusinessCalendarItem\[\].*\r?\n/gm, '');
  const baselineFile = join(artifacts, 'baseline.prisma'); writeFileSync(baselineFile, baselineSchema);
  const require = createRequire(import.meta.url);
  const baselineSql = execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', baselineFile, '--script'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const baselineSqlFile = join(artifacts, 'baseline.sql'); writeFileSync(baselineSqlFile, baselineSql);
  const root = new PrismaClient();
  const schemas: string[] = []; let checks = 0;
  const psql = process.env.PSQL_PATH ?? 'psql';
  const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: url.pathname.slice(1), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password) };
  const runSql = (schema: string, file: string) => execFileSync(psql, ['-X', '-v', 'ON_ERROR_STOP=1', '-q', '-f', file], { env: { ...env, PGOPTIONS: `-c search_path=${schema}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    for (const fixture of ['clean', 'existing']) {
      const schema = `calendar_test_${randomUUID().replaceAll('-', '')}`; schemas.push(schema);
      await root.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      runSql(schema, baselineSqlFile);
      const testUrl = new URL(url); testUrl.searchParams.set('schema', schema);
      const db = new PrismaService({ datasources: { db: { url: testUrl.toString() } } });
      try {
        if (fixture === 'existing') await db.company.create({ data: { code: 'KEEP', name: 'Existing company fixture' } });
        runSql(schema, join(process.cwd(), 'prisma/sql/add_business_calendar.sql'));
        if (fixture === 'existing') { assert.equal(await db.company.count({ where: { code: 'KEEP' } }), 1); checks++; }
        const a = await db.company.create({ data: { code: 'A', name: 'Test A' } }); const b = await db.company.create({ data: { code: 'B', name: 'Test B' } });
        const people = await Promise.all(['owner', 'employee', 'finance', 'outsider', 'admin'].map((name) => db.user.create({ data: { email: `${name}@calendar.test`, firstName: name, lastName: 'Test', memberships: { create: { companyId: name === 'outsider' ? b.id : a.id } } } })));
        const auth = (index: number, permissions = ['calendar.items.read', 'calendar.items.create', 'calendar.items.update']): AuthUser => ({ id: people[index].id, email: people[index].email, isSystemAdmin: index === 4, companyId: index === 3 ? b.id : a.id, permissions });
        const service = new CalendarService(db, new ConfigService({ COMPANY_CALENDAR_ENABLED: 'true' }));
        const owner = auth(0); const employee = auth(1); const finance = auth(2, [...owner.permissions, 'finance.invoices.read']);
        const input = { title: 'Obligation', domain: 'OPERATIONS' as const, kind: 'OBLIGATION' as const, dateOnly: '2026-01-31', ownerUserId: owner.id };
        const item = await service.create(a.id, owner, input); checks++;
        await assert.rejects(service.get(b.id, auth(3), item.id)); checks++;
        const privateItem = await service.create(a.id, owner, { ...input, sensitivity: 'PRIVATE' });
        await assert.rejects(service.get(a.id, employee, privateItem.id)); await assert.rejects(service.get(a.id, auth(4), privateItem.id)); checks += 2;
        const privateList = await service.list(a.id, employee, { page: 1, pageSize: 100 }); assert(!privateList.data.some((x) => x.id === privateItem.id)); checks++;
        await service.update(a.id, owner, privateItem.id, { version: 1, grants: [{ userId: employee.id, canEdit: false }] });
        assert.equal((await service.get(a.id, employee, privateItem.id)).canEdit, false);
        await assert.rejects(service.update(a.id, employee, privateItem.id, { version: 2, title: 'Forbidden' })); checks += 2;
        await assert.rejects(service.create(a.id, owner, { ...input, ownerUserId: people[3].id })); checks++;
        await assert.rejects(service.create(a.id, owner, { ...input, domain: 'HR' })); checks++;
        const secret = await service.create(a.id, finance, { ...input, domain: 'FINANCE' });
        await assert.rejects(service.get(a.id, employee, secret.id)); checks++;
        const strict = await service.create(a.id, owner, { ...input, completionEvidenceRequired: true, checklist: [{ title: 'Prepare documents', done: false }] });
        await assert.rejects(service.transition(a.id, owner, strict.id, 1, 'COMPLETED')); checks++;
        await service.update(a.id, owner, strict.id, { version: 1, checklist: [{ title: 'Prepare documents', done: true }] });
        await assert.rejects(service.transition(a.id, owner, strict.id, 2, 'COMPLETED')); checks++;
        await service.evidence(a.id, owner, strict.id, { version: 2, title: 'Evidence', url: 'https://example.com/evidence' });
        assert.equal((await service.transition(a.id, owner, strict.id, 3, 'COMPLETED')).status, 'COMPLETED'); checks++;
        assert.equal((await service.history(a.id, owner, strict.id)).length, 4); checks++;
        await assert.rejects(service.update(a.id, owner, item.id, { version: 99, title: 'Stale' })); checks++;
        const race = await Promise.allSettled([service.update(a.id, owner, item.id, { version: 1, title: 'One' }), service.update(a.id, owner, item.id, { version: 1, title: 'Two' })]);
        assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1); checks++;
        const series = await service.create(a.id, owner, { ...input, recurrenceFrequency: 'MONTHLY', recurrenceUntil: '2026-03-31', hardDueDate: '2026-02-02', internalTargetDate: '2026-01-29' });
        const completion = await Promise.allSettled([service.transition(a.id, owner, series.id, 1, 'COMPLETED'), service.transition(a.id, owner, series.id, 1, 'COMPLETED')]);
        assert.equal(completion.filter((r) => r.status === 'fulfilled').length, 1); checks++;
        const occurrences = await db.businessCalendarItem.findMany({ where: { companyId: a.id, recurrenceSeriesId: series.recurrenceSeriesId }, orderBy: { occurrenceNumber: 'asc' } });
        assert.equal(occurrences.length, 2); assert.equal(occurrences[1].dateOnly, '2026-02-28'); assert.equal(occurrences[1].internalTargetDate, '2026-02-26'); checks++;
        await service.transition(a.id, owner, occurrences[1].id, 1, 'COMPLETED');
        const third = await db.businessCalendarItem.findFirstOrThrow({ where: { recurrenceSeriesId: series.recurrenceSeriesId, occurrenceNumber: 2 } });
        assert.equal(third.dateOnly, '2026-03-31'); await service.transition(a.id, owner, third.id, 1, 'COMPLETED');
        assert.equal(await db.businessCalendarItem.count({ where: { recurrenceSeriesId: series.recurrenceSeriesId } }), 3); checks++;
        const mirror = await db.businessCalendarItem.create({ data: { ...input, companyId: a.id, createdById: owner.id, sourceKind: 'MS_GRAPH' } });
        await assert.rejects(service.get(a.id, employee, mirror.id)); checks++;
        await assert.rejects(service.archive(a.id, owner, mirror.id, 1));
        await db.businessCalendarItem.update({ where: { id: mirror.id }, data: { deletedAt: new Date() } });
        assert.equal((await service.get(a.id, owner, item.id)).id, item.id); checks++;
        const originalDeadline = (await service.get(a.id, owner, item.id)).dateOnly;
        await assert.rejects(service.update(a.id, owner, item.id, { version: 2, dateOnly: '2026-02-30' }));
        assert.equal((await service.get(a.id, owner, item.id)).dateOnly, originalDeadline); checks++;
        const leak = await service.horizon(a.id, employee, { page: 1, pageSize: 100 });
        assert(!leak.items.some((x) => x.id === secret.id)); checks++;
        const crmOwner = auth(0, [...owner.permissions, 'crm.partners.read']);
        const partner = await db.businessPartner.create({ data: { companyId: a.id, partnerNumber: 'A-1', type: 'CLIENT', name: 'Real company reference' } });
        const foreignPartner = await db.businessPartner.create({ data: { companyId: b.id, partnerNumber: 'B-1', type: 'CLIENT', name: 'Other company reference' } });
        const options = await service.entities(a.id, crmOwner, { type: 'partner', search: 'reference' });
        assert.deepEqual(options, [{ id: partner.id, label: partner.name }]); checks++;
        await assert.rejects(service.entities(a.id, employee, { type: 'partner' })); checks++;
        await assert.rejects(service.create(a.id, crmOwner, { ...input, businessEntityType: 'partner', businessEntityId: foreignPartner.id })); checks++;
        const linked = await service.create(a.id, crmOwner, { ...input, businessEntityType: 'partner', businessEntityId: partner.id });
        assert.equal(linked.businessEntityId, partner.id); checks++;
        const history = await service.history(a.id, owner, item.id); assert.equal(history.length, 2); checks++;
        console.log(`${fixture} fixture: migration and calendar service checks passed`);
      } finally { await db.$disconnect(); }
    }
    console.log(`${checks} database-backed calendar checks passed`);
  } finally {
    for (const schema of schemas) {
      assert(/^calendar_test_[a-f0-9]{32}$/.test(schema));
      await root.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    }
    await root.$disconnect();
    rmSync(artifacts, { recursive: true, force: true });
  }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Integration test failed'); process.exitCode = 1; });
