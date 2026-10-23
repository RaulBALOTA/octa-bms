import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { EnableBankingProvider } from '../src/modules/banking/providers/enable-banking.provider';
import { CredentialVault } from '../src/modules/banking/credential-vault';

/**
 * Bank connections go-live helper. Run from apps/api:
 *   tsx --env-file=.env prisma/setup-banking.ts            status + config check (read-only)
 *   tsx --env-file=.env prisma/setup-banking.ts --apply    backup, then install schema + permissions
 *   ... --apply --enable-local                             also enable the flag and create a key in a LOCAL .env
 *   ... --probe                                            verify Enable Banking app credentials (one read-only GET)
 */
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  const db = new PrismaClient();
  try {
    const schema = url.searchParams.get('schema') ?? 'public';
    const tables = await db.$queryRaw<{ name: string }[]>`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ${schema} AND table_name IN ('bank_connections', 'bank_transactions')`;
    const columns = await db.$queryRaw<{ name: string }[]>`SELECT column_name AS name FROM information_schema.columns WHERE table_schema = ${schema} AND table_name = 'bank_accounts' AND column_name IN ('connectionId', 'externalId', 'syncedBalance', 'syncedBalanceAt')`;
    const parts = tables.length + columns.length;
    if (parts && parts !== 6) throw new Error('Partial bank connection schema detected; reconcile prisma/sql/add_bank_connections.sql before proceeding');
    let installed = parts === 6;
    console.log(`Bank connection schema: ${installed ? 'installed' : 'not installed'}`);

    if (process.argv.includes('--apply')) {
      const backupDirectory = resolve(process.cwd(), '../../backups'); mkdirSync(backupDirectory, { recursive: true });
      const backup = join(backupDirectory, `before-bank-connections-${Date.now()}.dump`);
      execFileSync(process.env.PG_DUMP_PATH ?? 'pg_dump', ['--format=custom', '--file', backup], { env: {
        ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: url.pathname.slice(1), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
      }, stdio: ['ignore', 'pipe', 'pipe'] });
      const require = createRequire(import.meta.url); const cli = require.resolve('prisma/build/index.js');
      if (!installed) execFileSync(process.execPath, [cli, 'db', 'execute', '--file', 'prisma/sql/add_bank_connections.sql', '--schema', 'prisma/schema.prisma'], { stdio: ['ignore', 'pipe', 'pipe'] });
      execFileSync(process.execPath, [cli, 'db', 'execute', '--file', 'prisma/sql/grant_banking_permissions.sql', '--schema', 'prisma/schema.prisma'], { stdio: ['ignore', 'pipe', 'pipe'] });
      installed = true;
      console.log(`Bank connection schema and existing-role permissions installed. Database backup: ${backup}`);

      if (process.argv.includes('--enable-local')) {
        if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error('Automatic enabling is restricted to a local database; set BANKING_ENABLED and BANKING_ENCRYPTION_KEY in your secret store');
        const envPath = resolve(process.cwd(), '.env');
        if (!existsSync(envPath)) throw new Error('Local .env missing');
        let content = readFileSync(envPath, 'utf8');
        content = setVar(content, 'BANKING_ENABLED', 'true');
        if (!new CredentialVault(readVar(content, 'BANKING_ENCRYPTION_KEY')).ready) {
          content = setVar(content, 'BANKING_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
          console.log('Generated BANKING_ENCRYPTION_KEY in .env — back it up; losing it means reconnecting every bank.');
        }
        writeFileSync(envPath, content);
        process.env.BANKING_ENABLED = 'true';
        process.env.BANKING_ENCRYPTION_KEY = readVar(content, 'BANKING_ENCRYPTION_KEY');
        console.log('Local feature flag enabled. Restart the API to reload configuration.');
      }
    }

    // ----------------------------------------------------------- readiness
    const appUrl = process.env.APP_URL ?? 'http://localhost:5180';
    const ebConfigured = Boolean(process.env.ENABLE_BANKING_APP_ID && process.env.ENABLE_BANKING_PRIVATE_KEY);
    const checks: [string, boolean, string][] = [
      ['Schema installed', installed, 'run with --apply'],
      ['BANKING_ENABLED=true', process.env.BANKING_ENABLED === 'true', 'set it and restart the API'],
      ['BANKING_ENCRYPTION_KEY valid', new CredentialVault(process.env.BANKING_ENCRYPTION_KEY).ready, 'openssl rand -base64 32'],
      ['Qonto', true, 'no server config needed; connect in Finance → Bank connections'],
      ['Enable Banking (other banks)', ebConfigured, 'optional: set ENABLE_BANKING_APP_ID and ENABLE_BANKING_PRIVATE_KEY'],
    ];
    for (const [label, ok, hint] of checks) console.log(`${ok ? '✔' : '✘'} ${label}${ok ? '' : ` — ${hint}`}`);
    if (ebConfigured) console.log(`  Enable Banking redirect URL to register: ${appUrl}/finance/banking/callback`);

    if (process.argv.includes('--probe')) {
      if (!ebConfigured) throw new Error('--probe needs ENABLE_BANKING_APP_ID and ENABLE_BANKING_PRIVATE_KEY');
      const key = process.env.ENABLE_BANKING_PRIVATE_KEY!;
      const pem = key.includes('-----BEGIN') ? key.replace(/\\n/g, '\n') : readFileSync(key, 'utf8');
      const provider = new EnableBankingProvider(process.env.ENABLE_BANKING_APP_ID, pem, process.env.ENABLE_BANKING_API_BASE || undefined);
      const banks = await provider.listInstitutions('DE');
      console.log(`✔ Enable Banking credentials accepted — ${banks.length} German banks available`);
    }
  } finally { await db.$disconnect(); }
}

function readVar(content: string, name: string) {
  return new RegExp(`^${name}=(.*)$`, 'm').exec(content)?.[1]?.trim() || undefined;
}

function setVar(content: string, name: string, value: string) {
  const line = new RegExp(`^${name}=.*$`, 'm');
  return line.test(content) ? content.replace(line, `${name}=${value}`) : `${content.replace(/\n?$/, '\n')}${name}=${value}\n`;
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Bank connection setup failed'); process.exitCode = 1; });
