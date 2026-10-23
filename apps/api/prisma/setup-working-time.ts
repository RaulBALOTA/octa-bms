import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

/** pnpm exec tsx --env-file=.env prisma/setup-working-time.ts [--apply] */
async function main() {
  const db = new PrismaClient();
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    const schema = url.searchParams.get('schema') ?? 'public';
    const tables = await db.$queryRaw<{ name: string }[]>`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ${schema} AND table_name IN ('work_schedules', 'employee_work_schedules', 'time_records', 'project_time_entries', 'timesheets', 'time_allocations', 'pmo_projects', 'pmo_sync_runs')`;
    if (tables.length > 0 && tables.length < 8) throw new Error('Partial working-time schema detected');
    console.log(`Working time: ${tables.length === 8 ? 'installed' : 'not installed'}`);
    if (tables.length === 8 || !process.argv.includes('--apply')) return;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Automatic setup is restricted to a local database');
    const directory = resolve(process.cwd(), '../../backups'); mkdirSync(directory, { recursive: true });
    execFileSync(process.env.PG_DUMP_PATH ?? 'pg_dump', ['--format=custom', '--file', join(directory, `before-working-time-${Date.now()}.dump`)], { env: {
      ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: url.pathname.slice(1),
      PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    execFileSync(process.execPath, [createRequire(import.meta.url).resolve('prisma/build/index.js'), 'db', 'execute', '--file', 'prisma/sql/add_working_time.sql', '--schema', 'prisma/schema.prisma'], { stdio: ['ignore', 'pipe', 'pipe'] });
    console.log('Working-time tables installed. Database backup saved under backups/.');
  } finally { await db.$disconnect(); }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Working-time setup failed'); process.exitCode = 1; });
