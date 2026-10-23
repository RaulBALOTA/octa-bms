import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

/** pnpm exec tsx --env-file=.env prisma/setup-org-chart.ts [--apply] */
async function main() {
  const db = new PrismaClient();
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    const schema = url.searchParams.get('schema') ?? 'public';
    const tables = await db.$queryRaw<{ name: string }[]>`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ${schema} AND table_name IN ('position_plans', 'org_chart_versions')`;
    if (tables.length === 1) throw new Error('Partial org chart schema detected; reconcile the migration before proceeding');
    console.log(`Org chart versioning: ${tables.length === 2 ? 'installed' : 'not installed'}`);
    if (tables.length === 2 || !process.argv.includes('--apply')) return;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Automatic setup is restricted to a local database');
    const backupDirectory = resolve(process.cwd(), '../../backups');
    mkdirSync(backupDirectory, { recursive: true });
    const backup = join(backupDirectory, `before-org-chart-${Date.now()}.dump`);
    execFileSync(process.env.PG_DUMP_PATH ?? 'pg_dump', ['--format=custom', '--file', backup], { env: {
      ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: url.pathname.slice(1),
      PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    const require = createRequire(import.meta.url);
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'execute', '--file', 'prisma/sql/add_org_chart_versioning.sql', '--schema', 'prisma/schema.prisma'], { stdio: ['ignore', 'pipe', 'pipe'] });
    console.log('Org chart schema installed. Database backup saved under backups/.');
  } finally { await db.$disconnect(); }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Org chart setup failed'); process.exitCode = 1; });
