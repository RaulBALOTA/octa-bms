import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const TABLES = ['engine_settings', 'engine_services', 'engine_resources', 'engine_assignments', 'engine_scenarios', 'engine_optimization_runs', 'engine_alerts', 'engine_decisions'];

/** pnpm exec tsx --env-file=.env prisma/setup-business-engine.ts [--apply] */
async function main() {
  const db = new PrismaClient();
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    const schema = url.searchParams.get('schema') ?? 'public';
    const tables = await db.$queryRaw<{ name: string }[]>`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ${schema} AND table_name = ANY(${TABLES})`;
    if (tables.length > 0 && tables.length < TABLES.length) throw new Error('Partial business engine schema detected');
    const installed = tables.length === TABLES.length;
    console.log(`Business engine: ${installed ? 'installed' : 'not installed'}`);
    if (!process.argv.includes('--apply')) return;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Automatic setup is restricted to a local database');
    const prisma = createRequire(import.meta.url).resolve('prisma/build/index.js');
    const run = (file: string) => execFileSync(process.execPath, [prisma, 'db', 'execute', '--file', file, '--schema', 'prisma/schema.prisma'], { stdio: ['ignore', 'pipe', 'pipe'] });
    if (!installed) {
      const directory = resolve(process.cwd(), '../../backups'); mkdirSync(directory, { recursive: true });
      execFileSync(process.env.PG_DUMP_PATH ?? 'pg_dump', ['--format=custom', '--file', join(directory, `before-business-engine-${Date.now()}.dump`)], { env: {
        ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: url.pathname.slice(1),
        PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
      }, stdio: ['ignore', 'pipe', 'pipe'] });
      run('prisma/sql/add_business_engine.sql');
      console.log('Business engine tables installed. Database backup saved under backups/.');
    }
    run('prisma/sql/grant_business_engine_permissions.sql');
    console.log('Business engine permissions granted (idempotent).');
  } finally { await db.$disconnect(); }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Business engine setup failed'); process.exitCode = 1; });
