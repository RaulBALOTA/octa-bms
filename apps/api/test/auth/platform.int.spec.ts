import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ALLOW_PRE_AUTH_KEY, IS_PUBLIC_KEY, PERMISSIONS_KEY, RECENT_AUTH_KEY } from '../../src/core/auth/decorators';
import { baselineSchema } from './baseline-schema';
import { bootTestApp, Client, ORIGIN, PASSWORD, type TestApp } from './harness';
import { buildWorld, client, enroll, signedIn, signedInWithMfa, type World } from './fixtures';

let t: TestApp;
let w: World;

beforeAll(async () => {
  t = await bootTestApp();
  w = await buildWorld(t);
});
afterAll(async () => t?.close());
beforeEach(async () => { await t.db.authRateLimit.deleteMany({}); });

interface Route { method: string; path: string; isPublic: boolean; preAuth: boolean; stepUp: boolean; permissions: string[]; controller: string }

function routes(): Route[] {
  const out: Route[] = [];
  for (const module of t.app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const type = wrapper.metatype as (new (...args: never[]) => unknown) | undefined;
      if (!type) continue;
      const base = ([] as string[]).concat(Reflect.getMetadata(PATH_METADATA, type) ?? '')[0];
      for (const key of Object.getOwnPropertyNames(type.prototype)) {
        const handler = type.prototype[key];
        if (key === 'constructor' || typeof handler !== 'function') continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler);
        const method = Reflect.getMetadata(METHOD_METADATA, handler);
        if (path === undefined || method === undefined) continue;
        const meta = (k: string) => Reflect.getMetadata(k, handler) ?? Reflect.getMetadata(k, type);
        out.push({
          method: RequestMethod[method], path: `/${[base, ...([] as string[]).concat(path)].filter(Boolean).join('/')}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1'),
          isPublic: !!meta(IS_PUBLIC_KEY), preAuth: !!meta(ALLOW_PRE_AUTH_KEY), stepUp: !!meta(RECENT_AUTH_KEY), permissions: meta(PERMISSIONS_KEY) ?? [], controller: type.name,
        });
      }
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/** Authenticated routes intentionally without a permission code, each reviewed in AUTH_AUDIT.md §3. */
const SELF_SERVICE = [
  /^\/auth\//, /^\/notifications/, /^\/workflow\/tasks\/my$/, /^\/master\//, /^\/finance\/budgets\/categories$/,
  /^\/corporate\/announcements(\/:id)?$/, /^\/search$/, /^\/ai\//, /^\/records/, /^\/admin\/security\/policy$/,
];
const PUBLIC = [
  'POST /auth/login', 'GET /auth/state', 'POST /auth/logout', 'POST /auth/password/forgot', 'POST /auth/password/reset',
  'GET /auth/invitations/preview', 'POST /auth/invitations/accept', 'GET /auth/config',
  'GET /auth/oidc/status', 'GET /auth/oidc/login', 'GET /auth/oidc/callback', 'GET /health',
];

describe('route coverage map (deny by default)', () => {
  it('only the reviewed allow-list is public; everything else needs a permission or is reviewed self-service', () => {
    const all = routes();
    expect(all.length).toBeGreaterThan(230);
    expect(all.filter((r) => r.isPublic).map((r) => `${r.method} ${r.path}`).sort()).toEqual([...PUBLIC].sort());
    const unreviewed = all.filter((r) => !r.isPublic && !r.permissions.length && !SELF_SERVICE.some((rx) => rx.test(r.path)));
    expect(unreviewed.map((r) => `${r.method} ${r.path}`)).toEqual([]);
    expect(all.filter((r) => r.preAuth).map((r) => `${r.method} ${r.path}`).sort()).toEqual(['POST /auth/mfa/enroll/confirm', 'POST /auth/mfa/enroll/start', 'POST /auth/mfa/recovery', 'POST /auth/mfa/verify']);
    if (process.env.WRITE_ROUTE_MAP) {
      const rows = all.map((r) => `| ${r.method} | \`${r.path}\` | ${r.isPublic ? 'public' : r.preAuth ? 'session or pre-auth' : 'session'} | ${r.permissions.join(', ') || (r.isPublic ? '—' : 'self-service / in-code check')} | ${r.stepUp ? 'yes' : ''} |`);
      writeFileSync(process.env.WRITE_ROUTE_MAP, `| Method | Route (/api/v1) | Authentication | Permission | Step-up |\n|---|---|---|---|---|\n${rows.join('\n')}\n`);
    }
  });

  it('every non-public route answers 401 to anonymous callers and to a pre-auth challenge', async () => {
    const pending = client(t);
    await signedIn(t, w.users.staffB.email).then(() => undefined);
    const c = await signedIn(t, w.users.staffA2.email);
    await enroll(c);
    expect((await pending.login(w.users.staffA2.email)).body.status).toBe('MFA_PENDING');
    const failures: string[] = [];
    for (const route of routes().filter((r) => !r.isPublic)) {
      const path = `/api/v1${route.path.replace(/:\w+/g, 'x')}`;
      const method = route.method.toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete';
      const anon = await client(t).agent[method](path).set('Origin', ORIGIN).set('Content-Type', 'application/json').send({});
      if (anon.status !== 401) failures.push(`anonymous ${route.method} ${route.path} → ${anon.status}`);
      if (!route.preAuth) {
        const pre = await pending.agent[method](path).set('Origin', ORIGIN).set('Content-Type', 'application/json').set('X-CSRF-Token', pending.csrf ?? '').send({});
        if (pre.status !== 401) failures.push(`pre-auth ${route.method} ${route.path} → ${pre.status}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('#20 invitations', () => {
  it('admin invites, invitee sets a password, token is single-use and bound to the invited email', async () => {
    const super1 = await signedIn(t, w.users.super1.email);
    const { secret } = await enroll(super1);
    const admin = await signedInWithMfa(t, w.users.super1.email, w.users.super1.id, secret);
    const { EmailNotificationService } = await import('../../src/core/security/email-notification.service');
    const outbox = t.app.get(EmailNotificationService).outbox;
    const res = await admin.post('/admin/security/invitations', { email: 'New.Hire@Octa.Test', companyId: w.companyA, roleId: w.roles.staff });
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toMatch(/token/i);
    const token = outbox.at(-1)!.text.match(/\/invite#token=([\w-]+)/)![1];
    expect(outbox.at(-1)!.to).toBe('new.hire@octa.test');

    const anon = client(t);
    expect((await anon.get(`/auth/invitations/preview?token=${token}`)).body).toMatchObject({ email: 'new.hire@octa.test', companyName: 'Company A' });
    expect((await anon.post('/auth/invitations/accept', { token, firstName: 'New', lastName: 'Hire', password: 'password1234' })).status).toBe(400);
    expect((await anon.post('/auth/invitations/accept', { token, firstName: 'New', lastName: 'Hire', password: PASSWORD })).status).toBe(201);
    expect((await anon.post('/auth/invitations/accept', { token, firstName: 'Evil', lastName: 'Twin', password: PASSWORD })).status).toBe(400);
    const hire = await client(t).login('new.hire@octa.test');
    expect(hire.body.status).toBe('AUTHENTICATED');

    // duplicates/foreign company/expired
    expect((await admin.post('/admin/security/invitations', { email: w.users.staffA.email, companyId: w.companyA })).status).toBe(409);
    await admin.post('/admin/security/invitations', { email: 'late@octa.test', companyId: w.companyB });
    const late = outbox.at(-1)!.text.match(/#token=([\w-]+)/)![1];
    await t.db.invitation.updateMany({ where: { email: 'late@octa.test' }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await anon.post('/auth/invitations/accept', { token: late, firstName: 'L', lastName: 'Ate', password: PASSWORD })).status).toBe(400);
  });

  it('there is no public self-registration or bootstrap route', () => {
    const paths = routes().filter((r) => r.isPublic).map((r) => r.path);
    expect(paths.some((p) => /register|signup|bootstrap|setup/.test(p))).toBe(false);
  });
});

describe('#22 additive migration on a pre-existing database', () => {
  it('upgrades a legacy schema without losing rows, is idempotent and matches the Prisma schema', async () => {
    const require = createRequire(import.meta.url);
    const prisma = (...args: string[]) => execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const dir = mkdtempSync(join(tmpdir(), 'octa-auth-migration-'));
    const baselineFile = join(dir, 'baseline.prisma');
    writeFileSync(baselineFile, baselineSchema());
    const legacySql = join(dir, 'legacy.sql');
    writeFileSync(legacySql, prisma('migrate', 'diff', '--from-empty', '--to-schema-datamodel', baselineFile, '--script'));

    const schema = `auth_migration_${randomUUID().replaceAll('-', '')}`;
    const url = new URL(t.baseUrl);
    const root = new PrismaClient({ datasources: { db: { url: t.baseUrl } } });
    const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: url.pathname.slice(1), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGOPTIONS: `-c search_path=${schema}` };
    const psql = (file: string) => execFileSync(process.env.PSQL_PATH ?? 'psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', file], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    await root.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    try {
      psql(legacySql);
      const legacyUrl = new URL(t.baseUrl); legacyUrl.searchParams.set('schema', schema);
      const legacyHash = await argon2.hash(PASSWORD); // node-argon2 defaults, as the legacy app stored them
      const q = (sql: string) => root.$executeRawUnsafe(sql.replaceAll('$S', `"${schema}"`));
      await q(`INSERT INTO $S."companies" (id, code, name, "updatedAt") VALUES ('c1', 'KEEP', 'Existing GmbH', now())`);
      await q(`INSERT INTO $S."users" (id, email, "passwordHash", "firstName", "lastName", "isSystemAdmin", "isActive", "updatedAt") VALUES
        ('u1', 'legacy.admin@octa.test', '${legacyHash}', 'Legacy', 'Admin', true, true, now()),
        ('u2', 'former@octa.test', '${legacyHash}', 'Former', 'Staff', false, false, now()),
        ('u3', 'sso.only@octa.test', NULL, 'Sso', 'Only', false, true, now())`);
      await q(`INSERT INTO $S."company_memberships" (id, "userId", "companyId", "isDefault") VALUES ('m1', 'u1', 'c1', true)`);
      await q(`INSERT INTO $S."refresh_tokens" (id, "userId", "tokenHash", "expiresAt") VALUES ('r1', 'u1', 'legacyhash', now() + interval '7 days')`);
      const fingerprint = () => root.$queryRawUnsafe<{ f: string }[]>(`SELECT md5(string_agg(concat_ws('|', id, email, "passwordHash", "isActive", "isSystemAdmin", "firstName"), ',' ORDER BY id)) AS f FROM "${schema}"."users"`);
      const before = (await fingerprint())[0].f;

      const migration = join(__dirname, '../../prisma/sql/add_secure_auth.sql');
      psql(migration);
      psql(migration); // idempotent

      expect((await fingerprint())[0].f).toBe(before);
      const users = await root.$queryRawUnsafe<{ id: string; emailNormalized: string; status: string }[]>(`SELECT id, "emailNormalized", status::text FROM "${schema}"."users" ORDER BY id`);
      expect(users).toEqual([
        { id: 'u1', emailNormalized: 'legacy.admin@octa.test', status: 'ACTIVE' },
        { id: 'u2', emailNormalized: 'former@octa.test', status: 'DISABLED' },
        { id: 'u3', emailNormalized: 'sso.only@octa.test', status: 'ACTIVE' },
      ]);
      expect(await root.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${schema}"."refresh_tokens" WHERE "revokedAt" IS NULL`)).toEqual([{ n: 0 }]);
      expect(await root.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${schema}"."companies"`)).toEqual([{ n: 1 }]);
      const drift = prisma('migrate', 'diff', '--from-url', legacyUrl.toString(), '--to-schema-datamodel', join(__dirname, '../../prisma/schema.prisma'), '--exit-code');
      expect(drift).toMatch(/No difference detected|^\s*$/);

      // the legacy admin signs in on the upgraded database with the old hash (rehash on login)
      const upgraded = await bootTestApp({}, { reuseSchemaOf: { schema, baseUrl: t.baseUrl } });
      try {
        const legacy = new Client(upgraded.app, '198.51.200.1');
        const res = await legacy.login('Legacy.Admin@octa.test');
        expect(res.body.status).toBe('AUTHENTICATED');
        expect((await legacy.get('/auth/me')).body.memberships[0].company.code).toBe('KEEP');
        expect((await new Client(upgraded.app, '198.51.200.2').login('former@octa.test')).status).toBe(401);
      } finally {
        await upgraded.close();
      }
    } finally {
      await root.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await root.$disconnect();
    }
  });
});
