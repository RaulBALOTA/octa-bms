import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

/** Run with tsx --env-file=.env prisma/setup-company-calendar.ts --apply [--enable-local]. */
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  const db = new PrismaClient();
  try {
    const schema = url.searchParams.get('schema') ?? 'public';
    const tables = await db.$queryRaw<{ name: string }[]>`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ${schema} AND table_name LIKE 'business_calendar_%'`;
    const expected = ['business_calendar_items', 'business_calendar_checklist_items', 'business_calendar_evidence', 'business_calendar_access_grants', 'business_calendar_history'];
    const installed = expected.filter((name) => tables.some((t) => t.name === name));
    if (installed.length && installed.length !== expected.length) throw new Error('Partial calendar schema detected; reconcile the migration before proceeding');
    console.log(`Calendar schema: ${installed.length === 5 ? 'installed' : 'not installed'}`);
    if (!process.argv.includes('--apply')) return;
    const backupDirectory = resolve(process.cwd(), '../../backups'); mkdirSync(backupDirectory, { recursive: true });
    const backup = join(backupDirectory, `before-company-calendar-${Date.now()}.dump`);
    execFileSync(process.env.PG_DUMP_PATH ?? 'pg_dump', ['--format=custom', '--file', backup], { env: {
      ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: url.pathname.slice(1), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    const require = createRequire(import.meta.url); const cli = require.resolve('prisma/build/index.js');
    if (!installed.length) execFileSync(process.execPath, [cli, 'db', 'execute', '--file', 'prisma/sql/add_business_calendar.sql', '--schema', 'prisma/schema.prisma'], { stdio: ['ignore', 'pipe', 'pipe'] });
    execFileSync(process.execPath, [cli, 'db', 'execute', '--file', 'prisma/sql/grant_business_calendar_permissions.sql', '--schema', 'prisma/schema.prisma'], { stdio: ['ignore', 'pipe', 'pipe'] });
    console.log('Calendar schema and existing-role permissions installed. Database backup saved under backups/.');
    if (process.argv.includes('--enable-local')) {
      if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error('Automatic enabling is restricted to a local database');
      const envPath = resolve(process.cwd(), '.env');
      if (!existsSync(envPath)) throw new Error('Local .env missing');
      let content = readFileSync(envPath, 'utf8');
      content = /^COMPANY_CALENDAR_ENABLED=.*$/m.test(content) ? content.replace(/^COMPANY_CALENDAR_ENABLED=.*$/m, 'COMPANY_CALENDAR_ENABLED=true') : `${content}\nCOMPANY_CALENDAR_ENABLED=true\n`;
      writeFileSync(envPath, content); console.log('Local feature flag enabled. Restart the API to reload configuration.');
    }
  } finally { await db.$disconnect(); }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Calendar setup failed'); process.exitCode = 1; });
