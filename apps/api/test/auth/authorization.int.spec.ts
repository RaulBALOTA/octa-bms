import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootTestApp, Client, type TestApp } from './harness';
import { buildWorld, client, enroll, forgetLastStep, signedIn, signedInWithMfa, type World } from './fixtures';

let t: TestApp;
let w: World;
const secrets: Record<string, string> = {};

beforeAll(async () => {
  t = await bootTestApp();
  w = await buildWorld(t);
  // admins enroll first (the rollout order the runbook prescribes)
  for (const key of ['super1', 'adminA', 'adminA2'] as const) {
    const c = await signedIn(t, w.users[key].email);
    secrets[key] = (await enroll(c)).secret;
  }
});
afterAll(async () => t?.close());
beforeEach(async () => { await t.db.authRateLimit.deleteMany({}); });

const as = async (key: keyof World['users']) =>
  secrets[key] ? signedInWithMfa(t, w.users[key].email, w.users[key].id, secrets[key]) : signedIn(t, w.users[key].email);

describe('#16 organization isolation', () => {
  it('rejects a foreign X-Company-Id and never returns another company\'s records', async () => {
    const c = await as('staffA');
    expect((await c.get('/crm/partners').set('X-Company-Id', w.companyB)).status).toBe(403);
    expect((await c.get(`/crm/partners/${w.partnerB}`).set('X-Company-Id', w.companyA)).status).toBe(404);
    const own = await c.get('/crm/partners').set('X-Company-Id', w.companyA);
    expect(own.status).toBe(200);
    expect(JSON.stringify(own.body)).toContain('PartnerA');
    expect(JSON.stringify(own.body)).not.toContain('PartnerB');
  });

  it('scopes user administration to the admin\'s company', async () => {
    const c = await as('adminA');
    const list = await c.get('/identity/users?pageSize=100').set('X-Company-Id', w.companyA);
    const emails = list.body.data.map((u: { email: string }) => u.email);
    expect(emails).toContain(w.users.staffA.email);
    expect(emails).not.toContain(w.users.staffB.email);
    expect((await c.get(`/identity/users/${w.users.staffB.id}`).set('X-Company-Id', w.companyA)).status).toBe(404);
    const security = await c.get('/admin/security/users').set('X-Company-Id', w.companyA);
    expect(security.body.map((u: { email: string }) => u.email)).not.toContain(w.users.staffB.email);
    expect(JSON.stringify(security.body)).not.toMatch(/encryptedSeed|codeHash|tokenHash|passwordHash/);
  });

  it('keeps group financial KPIs behind corporate.dashboard.read', async () => {
    const c = await as('staffA');
    expect((await c.get('/group/overview').set('X-Company-Id', w.companyA)).status).toBe(403);
  });
});

describe('#17 vertical escalation is blocked', () => {
  it('staff cannot reach admin endpoints', async () => {
    const c = await as('staffA');
    for (const path of ['/admin/security/users', '/admin/security/events', '/admin/security/policy', '/identity/users', '/identity/roles']) {
      expect((await c.get(path).set('X-Company-Id', w.companyA)).status).toBe(403);
    }
    expect((await c.post('/identity/roles/assign', { userId: w.users.staffA.id, roleId: w.roles.systemAdmin, companyId: w.companyA }).set('X-Company-Id', w.companyA)).status).toBe(403);
  });

  it('a company admin cannot grant SYSTEM_ADMIN, global roles, roles above their own, or to themselves', async () => {
    const c = await as('adminA');
    const assign = (body: object) => c.post('/identity/roles/assign', body).set('X-Company-Id', w.companyA);
    expect((await assign({ userId: w.users.adminA.id, roleId: w.roles.staff, companyId: w.companyA })).status).toBe(403); // self
    expect((await assign({ userId: w.users.staffA.id, roleId: w.roles.systemAdmin, companyId: w.companyA })).status).toBe(403);
    expect((await assign({ userId: w.users.staffA.id, roleId: w.roles.companyAdmin })).status).toBe(403); // global scope
    expect((await assign({ userId: w.users.staffB.id, roleId: w.roles.staff, companyId: w.companyB })).status).toBe(403); // other company
    expect((await c.post('/identity/roles', { code: 'X', name: 'X', permissionCodes: ['corporate.dashboard.read'] }).set('X-Company-Id', w.companyA)).status).toBe(403);
    const ok = await assign({ userId: w.users.staffA2.id, roleId: w.roles.companyAdmin, companyId: w.companyA });
    expect(ok.status).toBe(201);
    await t.db.userRole.delete({ where: { id: ok.body.id } });
  });

  it('a company admin cannot modify or disable a system administrator', async () => {
    const c = await as('adminA');
    expect((await c.send('patch', `/identity/users/${w.users.super1.id}`, { isActive: false }).set('X-Company-Id', w.companyA)).status).toBe(403);
    expect((await c.send('patch', '/admin/security/policy', { mfaMode: 'DISABLED' }).set('X-Company-Id', w.companyA)).status).toBe(403);
  });

  it('#11 role grants require a recent second factor', async () => {
    const c = await as('adminA');
    await t.db.authSession.updateMany({ where: { userId: w.users.adminA.id, revokedAt: null }, data: { lastMfaAt: new Date(Date.now() - 11 * 60_000) } });
    const res = await c.post('/identity/roles/assign', { userId: w.users.staffA2.id, roleId: w.roles.staff, companyId: w.companyA }).set('X-Company-Id', w.companyA);
    expect(res.body.code).toBe('STEP_UP_REQUIRED');
  });

  it('disabling a user revokes their sessions and notifies them', async () => {
    const victim = await as('staffA2');
    const admin = await as('adminA');
    expect((await admin.send('patch', `/identity/users/${w.users.staffA2.id}`, { isActive: false }).set('X-Company-Id', w.companyA)).status).toBe(200);
    expect((await victim.get('/auth/me')).status).toBe(401);
    expect((await client(t).login(w.users.staffA2.email)).status).toBe(401);
    await admin.send('patch', `/identity/users/${w.users.staffA2.id}`, { isActive: true }).set('X-Company-Id', w.companyA);
  });
});

describe('#18 policy rollout and enforcement', () => {
  it('refuses enforcement until two system administrators have MFA', async () => {
    const c = await as('super1');
    const res = await c.send('patch', '/admin/security/policy', { mfaMode: 'ENFORCED' });
    expect(res.status).toBe(409);
    expect(res.body.enrolledAdmins).toBe(1);
    const s2 = await signedIn(t, w.users.super2.email);
    secrets.super2 = (await enroll(s2)).secret;
  });

  it('enforced mode: unenrolled users get only an enrollment challenge; old sessions are cut', async () => {
    const legacy = await signedIn(t, w.users.staffB.email); // session created before enforcement
    const s1 = await as('super1');
    const res = await s1.send('patch', '/admin/security/policy', { mfaMode: 'ENFORCED' });
    expect(res.status).toBe(200);
    expect(res.body.mfaMode).toBe('ENFORCED');
    t.app.get((await import('../../src/core/security/security-policy.service')).SecurityPolicyService).invalidate();

    const old = await legacy.get('/crm/partners').set('X-Company-Id', w.companyB);
    expect(old.status).toBe(401);
    expect(old.body.code).toBe('SESSION_POLICY_REAUTH');

    const c = client(t);
    const login = await c.login(w.users.staffB.email);
    expect(login.body.status).toBe('MFA_ENROLLMENT_REQUIRED');
    expect((await c.get('/crm/partners').set('X-Company-Id', w.companyB)).status).toBe(401);
    expect((await c.get('/auth/me')).status).toBe(401);
    expect((await c.post('/auth/mfa/verify', { code: '123456' })).status).toBe(401); // wrong challenge purpose
    const { secret, recoveryCodes } = await enroll(c);
    expect(recoveryCodes).toHaveLength(10);
    expect((await c.get('/crm/partners').set('X-Company-Id', w.companyB)).status).toBe(200);
    secrets.staffB = secret;

    await s1.send('patch', '/admin/security/policy', { mfaMode: 'OPTIONAL' });
    t.app.get((await import('../../src/core/security/security-policy.service')).SecurityPolicyService).invalidate();
  });

  it('enrollment_required honours the deadline, then requires enrollment', async () => {
    const s1 = await as('super1');
    const policy = (await import('../../src/core/security/security-policy.service')).SecurityPolicyService;
    await s1.send('patch', '/admin/security/policy', { mfaMode: 'ENROLLMENT_REQUIRED', enrollmentDeadline: new Date(Date.now() + 86_400_000).toISOString() });
    t.app.get(policy).invalidate();
    const before = await client(t).login(w.users.staffA2.email);
    expect(before.body.status).toBe('AUTHENTICATED');
    expect(before.body.enrollmentDue).toBeTruthy();
    await s1.send('patch', '/admin/security/policy', { enrollmentDeadline: new Date(Date.now() - 1000).toISOString() });
    t.app.get(policy).invalidate();
    expect((await client(t).login(w.users.staffA2.email)).body.status).toBe('MFA_ENROLLMENT_REQUIRED');
    await s1.send('patch', '/admin/security/policy', { mfaMode: 'OPTIONAL', enrollmentDeadline: null });
    t.app.get(policy).invalidate();
  });

  it('pilot cohort flag requires MFA for selected users in optional mode', async () => {
    const admin = await as('adminA');
    expect((await admin.send('patch', `/admin/security/users/${w.users.staffA2.id}/mfa-required`, { required: true }).set('X-Company-Id', w.companyA)).status).toBe(200);
    expect((await client(t).login(w.users.staffA2.email)).body.status).toBe('MFA_ENROLLMENT_REQUIRED');
    await admin.send('patch', `/admin/security/users/${w.users.staffA2.id}/mfa-required`, { required: false }).set('X-Company-Id', w.companyA);
  });
});

describe('admin-assisted MFA recovery (dual control)', () => {
  it('requires a second administrator, then resets factors, sessions and forces re-enrollment', async () => {
    const target = w.users.staffA;
    const victimSession = await signedIn(t, target.email);
    const tSecret = (await enroll(victimSession)).secret;

    const a1 = await as('adminA');
    const created = await a1.post('/admin/security/recovery-requests', { targetUserId: target.id, reason: 'Phone lost, recovery codes not available', verificationMethod: 'Video call + HR badge check' }).set('X-Company-Id', w.companyA);
    expect(created.status).toBe(201);
    expect((await a1.post(`/admin/security/recovery-requests/${created.body.id}/approve`).set('X-Company-Id', w.companyA)).status).toBe(409);
    expect((await a1.post(`/admin/security/recovery-requests/${created.body.id}/complete`).set('X-Company-Id', w.companyA)).status).toBe(409);
    const a2 = await as('adminA2');
    expect((await a2.post(`/admin/security/recovery-requests/${created.body.id}/approve`).set('X-Company-Id', w.companyA)).status).toBe(200);
    expect((await a2.post(`/admin/security/recovery-requests/${created.body.id}/complete`).set('X-Company-Id', w.companyA)).status).toBe(204);

    expect((await victimSession.get('/auth/me')).status).toBe(401);
    expect(await t.db.mfaAuthenticator.count({ where: { userId: target.id, status: 'ACTIVE' } })).toBe(0);
    expect(await t.db.recoveryCode.count({ where: { userId: target.id, usedAt: null, revokedAt: null } })).toBe(0);
    await forgetLastStep(t.db, target.id);
    const login = await client(t).login(target.email);
    expect(login.body.status).toBe('MFA_ENROLLMENT_REQUIRED'); // old factor useless, new enrollment forced
    expect(tSecret).toBeTruthy();
    const events = await t.db.securityEvent.findMany({ where: { action: { startsWith: 'mfa.recovery_request' }, targetUserId: target.id } });
    expect(events.map((e) => e.action).sort()).toEqual(['mfa.recovery_request.approved', 'mfa.recovery_request.completed', 'mfa.recovery_request.created']);
  });

  it('company admins cannot touch a system administrator\'s MFA', async () => {
    const a1 = await as('adminA');
    const res = await a1.post('/admin/security/recovery-requests', { targetUserId: w.users.super1.id, reason: 'Attempted takeover of admin', verificationMethod: 'none at all' }).set('X-Company-Id', w.companyA);
    expect(res.status).toBe(403);
  });

  it('admins never receive seeds or recovery codes', async () => {
    const s1 = await as('super1');
    for (const path of ['/admin/security/users', '/admin/security/recovery-requests', '/admin/security/events?take=500', '/admin/security/overview']) {
      const body = JSON.stringify((await s1.get(path)).body);
      expect(body).not.toMatch(/encryptedSeed|codeHash|manualKey|qrSvg|otpauth|tokenHash/);
      for (const secret of Object.values(secrets)) expect(body).not.toContain(secret);
    }
  });
});

describe('#19 #25 multi-instance consistency', () => {
  it('sessions, revocations and policy are shared by every API instance', async () => {
    // a second, independently booted AppModule on the same database = a second node
    const node2 = await bootTestApp({}, { reuseSchemaOf: { schema: t.schema, baseUrl: t.baseUrl } });
    try {
      const n1 = await signedInWithMfa(t, w.users.adminA2.email, w.users.adminA2.id, secrets.adminA2);
      const cookie = (await t.db.authSession.findFirstOrThrow({ where: { userId: w.users.adminA2.id, revokedAt: null }, orderBy: { issuedAt: 'desc' } })).id;
      expect(cookie).toBeTruthy();
      // reuse the node-1 cookie jar against node 2
      const jar = n1.agent.jar.getCookies({ domain: '127.0.0.1', path: '/', secure: false, script: false }).toValueString();
      const onNode2 = () => Client.withCookie(node2.app, 'get', '/auth/me', jar);
      expect((await onNode2()).status).toBe(200);
      const other = await signedInWithMfa(t, w.users.adminA2.email, w.users.adminA2.id, secrets.adminA2);
      expect((await other.post('/auth/logout-all')).status).toBe(200); // revoked via node 1 …
      expect((await onNode2()).status).toBe(401); // … rejected by node 2 on the very next request
    } finally {
      await node2.close();
    }
  });

  it('rate-limit counters are atomic across concurrent callers and instances', async () => {
    const { RateLimitService } = await import('../../src/core/security/rate-limit.service');
    const { PrismaService } = await import('../../src/core/prisma/prisma.service');
    // two independent Prisma connection pools = two API processes sharing the database
    const other = new RateLimitService(new PrismaService({ datasources: { db: { url: process.env.DATABASE_URL! } } }));
    const mine = t.app.get(RateLimitService);
    const rule = { name: 'test:atomic', limit: 25, windowSeconds: 60 };
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => (i % 2 ? other : mine).hit(rule, 'subject')));
    expect(results.filter((r) => r.allowed)).toHaveLength(25);
    expect(Math.max(...results.map((r) => r.count))).toBe(60);
  });

  it('account throttling: correct password is refused after repeated failures, other accounts unaffected', async () => {
    for (let i = 0; i < 10; i++) await client(t).login(w.users.staffA2.email, `wrong-${i}-password-value`);
    const blocked = await client(t).login(w.users.staffA2.email);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('TOO_MANY_ATTEMPTS');
    expect((await client(t).login(w.users.adminA2.email)).body.status).toBe('MFA_PENDING');
    // unknown accounts are throttled the same way (no enumeration through 429)
    for (let i = 0; i < 10; i++) await client(t).login('ghost@octa.test', `wrong-${i}-password-value`);
    expect((await client(t).login('ghost@octa.test')).status).toBe(429);
  });
});
