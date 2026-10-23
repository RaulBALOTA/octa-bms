import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * pnpm --filter @octa-bms/api auth:setup            → reports status only
 * pnpm --filter @octa-bms/api auth:setup --apply    → local DB: pg_dump backup, then apply
 * Non-local databases are never modified automatically: take a reviewed backup and apply
 * prisma/sql/add_secure_auth.sql with psql (docs/security/MIGRATION_AND_ROLLBACK.md).
 */
async function main() {
  const db = new PrismaClient();
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    const schema = url.searchParams.get('schema') ?? 'public';
    const tables = await db.$queryRaw<{ name: string }[]>`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ${schema} AND table_name IN ('auth_sessions', 'mfa_authenticators', 'recovery_codes', 'security_events', 'auth_rate_limits', 'webauthn_credentials', 'webauthn_challenges')`;
    const installed = tables.length === 7;
    if (tables.length && !installed) console.log('Partial secure-auth schema detected; the idempotent script will complete it.');
    console.log(`Secure authentication schema: ${installed ? 'installed' : 'not installed'}`);
    if (installed || !process.argv.includes('--apply')) return;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Automatic setup is restricted to a local database; follow MIGRATION_AND_ROLLBACK.md');
    const pg = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: url.pathname.slice(1), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGOPTIONS: `-c search_path=${schema}` };
    const backups = resolve(process.cwd(), '../../backups');
    mkdirSync(backups, { recursive: true });
    const backup = join(backups, `before-secure-auth-${Date.now()}.dump`);
    execFileSync(process.env.PG_DUMP_PATH ?? 'pg_dump', ['--format=custom', '--file', backup], { env: pg, stdio: ['ignore', 'pipe', 'pipe'] });
    // both scripts are idempotent; order matters (passkeys extend the secure-auth tables)
    for (const file of ['prisma/sql/add_secure_auth.sql', 'prisma/sql/add_passkeys.sql']) {
      execFileSync(process.env.PSQL_PATH ?? 'psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', file], { env: pg, stdio: ['ignore', 'pipe', 'pipe'] });
    }
    console.log(`Secure authentication schema installed. Backup: ${backup}`);
    console.log('Next: pnpm db:seed (adds identity.security.* permissions), then sign in again — legacy JWT sessions were revoked.');
  } finally {
    await db.$disconnect();
  }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Secure auth setup failed'); process.exitCode = 1; });
