import { Prisma, PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const db = new PrismaClient();
const workspace = realpathSync(resolve(__dirname, '../../..'));
const preserved = new Set(['User','RefreshToken','Role','Permission','RolePermission','Country','Currency','TaxCode','ContractTypeRef','DocumentTypeRef','LanguageRef']);
const models = Prisma.dmmf.datamodel.models;
const business = models.filter((model) => !preserved.has(model.name));
const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
const delegate = (model: string) => (db as any)[model[0].toLowerCase() + model.slice(1)];
function insideWorkspace(path: string) {
  const absolute = resolve(path); const root = workspace.toLowerCase() + sep;
  if (!absolute.toLowerCase().startsWith(root)) throw new Error('Reset path must stay inside the OCTA workspace');
  if (existsSync(absolute) && realpathSync(absolute).toLowerCase() !== absolute.toLowerCase()) throw new Error('Reset paths must not be symbolic links or junctions');
  return absolute;
}
async function waitTask(host: string, headers: Record<string,string>, uid: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await fetch(`${host}/tasks/${uid}`, { headers, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Search index task could not be checked');
    const task = await response.json() as { status: string };
    if (task.status === 'succeeded') return;
    if (task.status === 'failed' || task.status === 'canceled') throw new Error('Search index reset failed');
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error('Search index reset timed out');
}
async function main() {
  const admins = await db.user.findMany({ where: { isSystemAdmin: true, isActive: true, deletedAt: null }, select: { id: true, passwordHash: true, entraObjectId: true } });
  if (!admins.length || admins.some((user) => !user.passwordHash && !user.entraObjectId)) throw new Error('A working super-admin account must remain');
  const adminIds = admins.map((user) => user.id);
  const before: Record<string,number> = {};
  for (const model of models) before[model.name] = await delegate(model.name).count();
  console.log(JSON.stringify({ businessRecordsToRemove: business.reduce((sum, model) => sum + before[model.name], 0), companiesToRemove: before.Company,
    otherUsersToRemove: before.User - admins.length, superAdminsPreserved: admins.length, referenceDataPreserved: [...preserved].filter((name) => !['User','RefreshToken'].includes(name)) }));
  if (!process.argv.includes('--execute')) { console.log('Preview only. --execute creates a backup and applies the reset.'); return; }

  const backups = insideWorkspace(join(workspace, 'backups')); mkdirSync(backups, { recursive: true }); insideWorkspace(backups);
  const backup = insideWorkspace(join(backups, `workspace-reset-${new Date().toISOString().replace(/[:.]/g,'-')}`)); mkdirSync(backup); insideWorkspace(backup);
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  const pgDump = process.env.OCTA_PG_DUMP ?? 'C:/Program Files/PostgreSQL/18/bin/pg_dump.exe';
  const dumpFile = insideWorkspace(join(backup, 'database.dump'));
  const dump = spawnSync(pgDump, ['--format=custom', '--file', dumpFile], { windowsHide: true, env: { ...process.env,
    PGHOST: databaseUrl.hostname, PGPORT: databaseUrl.port || '5432', PGUSER: decodeURIComponent(databaseUrl.username), PGPASSWORD: decodeURIComponent(databaseUrl.password),
    PGDATABASE: decodeURIComponent(databaseUrl.pathname.slice(1)), PGSSLMODE: databaseUrl.searchParams.get('sslmode') ?? 'prefer' }, encoding: 'utf8' });
  if (dump.error || dump.status !== 0 || !existsSync(dumpFile) || statSync(dumpFile).size < 1000 || readFileSync(dumpFile).subarray(0,5).toString() !== 'PGDMP') throw new Error(`Database backup failed; nothing was cleared. ${dump.error?.message ?? dump.stderr}`);

  const uploadRoots = [join(workspace, 'apps/api/uploads'), join(workspace, 'uploads')].filter(existsSync).map(insideWorkspace);
  for (const [index, directory] of uploadRoots.entries()) cpSync(directory, insideWorkspace(join(backup, `uploads-${index + 1}`)), { recursive: true, force: false, errorOnExist: true });
  writeFileSync(join(backup, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), before, preservedModels: [...preserved], preservedAdminIds: adminIds, uploadRoots }, null, 2));
  console.log(`Backup created: ${backup}`);

  const searchHost = process.env.MEILI_HOST?.replace(/\/$/, '');
  const searchHeaders: Record<string, string> = process.env.MEILI_MASTER_KEY ? { Authorization: `Bearer ${process.env.MEILI_MASTER_KEY}` } : {};
  let searchAvailable = false;
  if (searchHost) {
    try { searchAvailable = (await fetch(`${searchHost}/health`, { signal: AbortSignal.timeout(5000) })).ok; } catch {}
    if (searchAvailable) {
      const response = await fetch(`${searchHost}/indexes/records/documents?limit=100000`, { headers: searchHeaders });
      if (response.ok) writeFileSync(join(backup, 'search-records.json'), JSON.stringify(await response.json()));
    }
  }
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`TRUNCATE TABLE ${business.map((model) => `public.${quote(model.dbName ?? model.name)}`).join(', ')} RESTART IDENTITY`);
    await tx.refreshToken.deleteMany({ where: { userId: { notIn: adminIds } } });
    await tx.user.deleteMany({ where: { id: { notIn: adminIds } } });
    await tx.role.deleteMany({ where: { isSystem: false } });
    const adminRole = await tx.role.findUnique({ where: { code: 'SYSTEM_ADMIN' } });
    if (adminRole) await tx.userRole.createMany({ data: adminIds.map((userId) => ({ userId, roleId: adminRole.id })) });
    for (const model of business.filter((model) => model.name !== 'UserRole')) {
      const count = await (tx as any)[model.name[0].toLowerCase() + model.name.slice(1)].count();
      if (count !== 0) throw new Error(`Reset verification failed for ${model.name}`);
    }
    if (await tx.user.count() !== admins.length) throw new Error('Admin preservation verification failed');
  }, { timeout: 60000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  for (const directory of uploadRoots) rmSync(insideWorkspace(directory), { recursive: true });
  if (searchHost && searchAvailable) {
    const response = await fetch(`${searchHost}/indexes/records/documents`, { method: 'DELETE', headers: searchHeaders });
    if (response.status !== 404) {
      if (!response.ok) throw new Error('Business data cleared, but search index clearing failed');
      await waitTask(searchHost, searchHeaders, (await response.json() as { taskUid: number }).taskUid);
    }
  }
  const after: Record<string,number> = {};
  for (const model of models) after[model.name] = await delegate(model.name).count();
  writeFileSync(join(backup, 'result.json'), JSON.stringify({ completedAt: new Date().toISOString(), after, searchIndex: searchHost ? searchAvailable ? 'cleared' : 'not reachable; database fallback is empty' : 'not configured' }, null, 2));
  console.log(JSON.stringify({ completed: true, businessRecordsRemaining: business.filter((model) => model.name !== 'UserRole').reduce((sum, model) => sum + after[model.name], 0), companiesRemaining: after.Company,
    usersRemaining: after.User, uploadedFileDirectoriesRemoved: uploadRoots.length, backup }, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'Reset failed'); process.exitCode = 1; }).finally(() => db.$disconnect());
