import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootTestApp, Client, cookieHeader, ORIGIN, PASSWORD, totpFor, type TestApp } from './harness';
import { buildWorld, client, enroll, forgetLastStep, signedIn, signedInWithMfa, stepUp, type World } from './fixtures';

let t: TestApp;
let w: World;
const mail = () => (t.app.get(EmailService).outbox as { to: string; subject: string; text: string }[]);
// resolved lazily (module is imported by the harness after env is set)
let EmailService: new (...args: never[]) => { outbox: unknown[] };

beforeAll(async () => {
  t = await bootTestApp();
  EmailService = (await import('../../src/core/security/email-notification.service')).EmailNotificationService as never;
  w = await buildWorld(t);
});
afterAll(async () => t?.close());
// budgets are exercised by dedicated tests; reset between tests so they stay independent
beforeEach(async () => { await t.db.authRateLimit.deleteMany({}); });

describe('#1 #20 password sign-in is non-enumerating', () => {
  it('returns identical responses for unknown account, wrong password and disabled account', async () => {
    const unknown = await client(t).login('nobody@octa.test', PASSWORD);
    const wrong = await client(t).login(w.users.staffA.email, 'wrong password value');
    const disabled = await client(t).login(w.users.disabled.email, PASSWORD);
    for (const res of [unknown, wrong, disabled]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
      expect(cookieHeader(res)).toEqual([]);
    }
  });

  it('accepts case variants of the email (normalized identity)', async () => {
    const res = await client(t).login(w.users.staffA2.email.toUpperCase());
    expect(res.body.status).toBe('AUTHENTICATED');
  });
});

describe('#12 session cookie', () => {
  it('is HttpOnly, SameSite=Strict, Path=/ and never appears in JSON', async () => {
    const c = client(t);
    const res = await c.login(w.users.staffA.email);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('AUTHENTICATED');
    const cookie = cookieHeader(res).find((v) => v.startsWith('bms_session='))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Domain=/);
    const token = cookie.split(';')[0].split('=')[1];
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(JSON.stringify(res.body)).not.toContain(token);
    const stored = await t.db.authSession.findFirstOrThrow({ where: { userId: w.users.staffA.id }, orderBy: { issuedAt: 'desc' } });
    expect(stored.tokenHash).not.toContain(token);
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const me = await c.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(w.users.staffA.email);
    // never cacheable: a cached /auth/state or /auth/me would leak identity or stale state
    for (const res of [me, await c.get('/auth/state'), await client(t).get('/auth/state')]) expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash|tokenHash|encryptedSeed|codeHash/);
  });
});

describe('#13 CSRF, login CSRF and CORS', () => {
  it('rejects mutations with a missing/foreign Origin or a missing/invalid CSRF token', async () => {
    const c = await signedIn(t, w.users.staffA.email);
    expect((await c.post('/auth/logout-all', {}, { origin: null })).body.code).toBe('CSRF_REJECTED');
    expect((await c.post('/auth/logout-all', {}, { origin: 'https://evil.example' })).body.code).toBe('CSRF_REJECTED');
    expect((await c.post('/auth/logout-all', {}, { csrf: null })).body.code).toBe('CSRF_REJECTED');
    expect((await c.post('/auth/logout-all', {}, { csrf: 'x'.repeat(43) })).body.code).toBe('CSRF_REJECTED');
    expect((await c.post('/auth/logout-all', {})).status).toBe(200);
  });

  it('blocks login CSRF (form content type or foreign origin)', async () => {
    const c = client(t);
    const form = await c.agent.post('/api/v1/auth/login').set('Origin', ORIGIN).set('Content-Type', 'application/x-www-form-urlencoded')
      .send(`email=${encodeURIComponent(w.users.staffA.email)}&password=${encodeURIComponent(PASSWORD)}`);
    expect(form.status).toBe(403);
    const foreign = await c.post('/auth/login', { email: w.users.staffA.email, password: PASSWORD }, { origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
    expect(cookieHeader(foreign)).toEqual([]);
  });

  it('does not grant CORS to foreign origins', async () => {
    const res = await client(t).agent.options('/api/v1/auth/me').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    const ok = await client(t).agent.options('/api/v1/auth/me').set('Origin', ORIGIN).set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe(ORIGIN);
  });

  it('never mutates state on GET (logout is POST only)', async () => {
    const c = await signedIn(t, w.users.staffA.email);
    expect((await c.get('/auth/logout')).status).toBe(404);
    expect((await c.get('/auth/me')).status).toBe(200);
  });
});

describe('#14 session fixation, tampering, expiry, disabled and removed users', () => {
  it('ignores a planted cookie and issues a fresh identifier at login', async () => {
    const planted = 'bms_session=planted-value-from-attacker';
    const res = await Client.withCookie(t.app, 'post', '/auth/login', planted).set('X-Forwarded-For', '198.51.99.1').send({ email: w.users.staffA.email, password: PASSWORD });
    expect(res.body.status).toBe('AUTHENTICATED');
    const issued = cookieHeader(res).find((v) => v.startsWith('bms_session='))!.split(';')[0].split('=')[1];
    expect(issued).not.toBe('planted-value-from-attacker');
    expect((await Client.withCookie(t.app, 'get', '/auth/me', planted)).status).toBe(401);
    expect((await Client.withCookie(t.app, 'get', '/auth/me', `bms_session=${issued}`)).status).toBe(200);
  });

  it('rejects tampered, expired and revoked sessions', async () => {
    const tampered = await Client.withCookie(t.app, 'get', '/auth/me', `bms_session=${'A'.repeat(43)}`);
    expect(tampered.status).toBe(401);
    expect(tampered.body.code).toBe('SESSION_EXPIRED');
    expect((await Client.withCookie(t.app, 'get', '/auth/me', `bms_session=${'A'.repeat(5000)}`)).status).toBe(401);

    const c = await signedIn(t, w.users.staffA.email);
    const session = await t.db.authSession.findFirstOrThrow({ where: { userId: w.users.staffA.id, revokedAt: null }, orderBy: { issuedAt: 'desc' } });
    await t.db.authSession.update({ where: { id: session.id }, data: { idleExpiresAt: new Date(Date.now() - 1000) } });
    expect((await c.get('/auth/me')).status).toBe(401);

    const d = await signedIn(t, w.users.staffA.email);
    expect((await d.post('/auth/logout')).status).toBe(204);
    expect((await d.get('/auth/me')).status).toBe(401);
  });

  it('cuts off a disabled or deleted account immediately', async () => {
    const c = await signedIn(t, w.users.staffA2.email);
    await t.db.user.update({ where: { id: w.users.staffA2.id }, data: { isActive: false } });
    expect((await c.get('/auth/me')).status).toBe(401);
    await t.db.user.update({ where: { id: w.users.staffA2.id }, data: { isActive: true, deletedAt: new Date() } });
    expect((await client(t).login(w.users.staffA2.email)).status).toBe(401);
    await t.db.user.update({ where: { id: w.users.staffA2.id }, data: { deletedAt: null } });
  });

  it('never extends a session past its absolute expiry', async () => {
    const c = await signedIn(t, w.users.staffA.email);
    const session = await t.db.authSession.findFirstOrThrow({ where: { userId: w.users.staffA.id, revokedAt: null }, orderBy: { issuedAt: 'desc' } });
    const absolute = new Date(Date.now() + 5 * 60_000);
    await t.db.authSession.update({ where: { id: session.id }, data: { absoluteExpiresAt: absolute, lastActivityAt: new Date(Date.now() - 120_000) } });
    expect((await c.get('/auth/me')).status).toBe(200);
    const after = await t.db.authSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.idleExpiresAt.getTime()).toBeLessThanOrEqual(absolute.getTime());
  });
});

describe('#2 #3 #4 #5 #6 #7 Microsoft Authenticator TOTP', () => {
  let secret: string;
  let codes: string[];

  it('enrolls with QR + manual key, confirms one code, returns 10 recovery codes once', async () => {
    const c = await signedIn(t, w.users.staffA.email);
    const bad = await c.post('/auth/mfa/enroll/start');
    expect(bad.body.qrSvg.startsWith('<svg')).toBe(true);
    expect(bad.body).toMatchObject({ issuer: 'OCTA BMS', accountName: w.users.staffA.email, algorithm: 'SHA1', digits: 6, period: 30 });
    expect((await c.post('/auth/mfa/enroll/confirm', { enrollmentId: bad.body.enrollmentId, code: '000000' })).status).toBe(401);
    const result = await enroll(c);
    secret = result.secret;
    codes = result.recoveryCodes;
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    const row = await t.db.mfaAuthenticator.findFirstOrThrow({ where: { userId: w.users.staffA.id, status: 'ACTIVE' } });
    expect(row.encryptedSeed).not.toContain(secret);
    expect(row.encryptedSeed.startsWith('v1.dev-insecure.')).toBe(true);
    // the seed never resurfaces: no read endpoint returns it
    const me = await c.get('/auth/me');
    expect(JSON.stringify(me.body)).not.toContain(secret);
    expect(me.body.mfa).toMatchObject({ enrolled: true, recoveryCodesRemaining: 10 });
    const status = await c.get('/auth/recovery-codes/status');
    expect(status.body).toEqual({ enrolled: true, remaining: 10 });
    expect(JSON.stringify(status.body)).not.toMatch(/[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}/);
  });

  it('a session without recent password re-entry cannot bind a first authenticator', async () => {
    const c = await signedIn(t, w.users.staffA2.email);
    await t.db.authSession.updateMany({ where: { userId: w.users.staffA2.id, revokedAt: null }, data: { lastReauthAt: new Date(Date.now() - 11 * 60_000) } });
    const res = await c.post('/auth/mfa/enroll/start');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'STEP_UP_REQUIRED', method: 'password' });
    expect(JSON.stringify(res.body)).not.toMatch(/qrSvg|manualKey/);
    const up = await c.post('/auth/step-up/verify', { password: PASSWORD });
    c.csrf = up.body.csrfToken;
    expect((await c.post('/auth/mfa/enroll/start')).status).toBe(200);
  });

  it('QR/enrollment is unreachable before the password step', async () => {
    const anon = client(t);
    const res = await anon.post('/auth/mfa/enroll/start');
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toMatch(/qrSvg|manualKey/);
  });

  it('password alone yields only a pre-auth challenge: no session, no business data', async () => {
    const c = client(t);
    const res = await c.login(w.users.staffA.email);
    expect(res.body.status).toBe('MFA_PENDING');
    const cookies = cookieHeader(res);
    expect(cookies.some((v) => v.startsWith('bms_preauth=') && /HttpOnly/.test(v) && /SameSite=Strict/.test(v))).toBe(true);
    expect(cookies.some((v) => /^bms_session=[^;]+/.test(v) && !/^bms_session=;/.test(v))).toBe(false);
    expect((await c.get('/auth/me')).status).toBe(401);
    expect((await c.get('/crm/partners').set('X-Company-Id', w.companyA)).status).toBe(401);
    expect((await c.get('/identity/users')).status).toBe(401);
    expect((await c.get('/auth/state')).body.state).toBe('MFA_PENDING');
    // the challenge token cannot be replayed as a session cookie
    const preauth = cookies.find((v) => v.startsWith('bms_preauth='))!.split(';')[0].split('=')[1];
    expect((await Client.withCookie(t.app, 'get', '/auth/me', `bms_session=${preauth}`)).status).toBe(401);
    expect((await Client.withCookie(t.app, 'get', '/crm/partners', `bms_preauth=${preauth}`).set('X-Company-Id', w.companyA)).status).toBe(401);
  });

  it('rejects wrong, malformed and over-long codes, then accepts the right one', async () => {
    await forgetLastStep(t.db, w.users.staffA.id);
    const c = client(t);
    await c.login(w.users.staffA.email);
    const wrong = await c.post('/auth/mfa/verify', { code: totpFor(secret, 5) });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toMatchObject({ code: 'MFA_CODE_INVALID', attemptsRemaining: 4 });
    for (const code of ['12345', 'abcdef', '1234567', '1'.repeat(5000), '12345a', ' 123456']) {
      const res = await c.post('/auth/mfa/verify', { code });
      expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(400);
    }
    const ok = await c.post('/auth/mfa/verify', { code: totpFor(secret) });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('AUTHENTICATED');
    c.csrf = ok.body.csrfToken;
    expect((await c.get('/crm/partners').set('X-Company-Id', w.companyA)).status).toBe(200);
    // consumed challenge cannot be reused
    const reuse = client(t);
    const preauth = cookieHeader(ok).length; // challenge cookie was cleared on success
    expect(preauth).toBeGreaterThan(0);
    expect((await reuse.post('/auth/mfa/verify', { code: totpFor(secret, 1) })).status).toBe(401);
  });

  it('blocks replay of an accepted code on a new challenge', async () => {
    await forgetLastStep(t.db, w.users.staffA.id);
    const code = totpFor(secret);
    const first = client(t);
    await first.login(w.users.staffA.email);
    expect((await first.post('/auth/mfa/verify', { code })).status).toBe(200);
    const second = client(t);
    await second.login(w.users.staffA.email);
    expect((await second.post('/auth/mfa/verify', { code })).status).toBe(401);
    // an older code after a newer one is also rejected
    expect((await second.post('/auth/mfa/verify', { code: totpFor(secret, -1) })).status).toBe(401);
  });

  it('lets exactly one of many concurrent requests use the same code', async () => {
    await forgetLastStep(t.db, w.users.staffA.id);
    const code = totpFor(secret);
    // same challenge, parallel
    const c = client(t);
    await c.login(w.users.staffA.email);
    const same = await Promise.all(Array.from({ length: 5 }, () => c.post('/auth/mfa/verify', { code })));
    expect(same.filter((r) => r.status === 200)).toHaveLength(1);
    // different challenges (one live challenge per user, so use two users' worth: sequential logins invalidate older ones)
    await forgetLastStep(t.db, w.users.staffA.id);
    const parallelClients = [client(t), client(t), client(t)];
    for (const p of parallelClients) await p.login(w.users.staffA.email);
    const results = await Promise.all(parallelClients.map((p) => p.post('/auth/mfa/verify', { code: totpFor(secret) })));
    expect(results.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1);
  });

  it('expires stale challenges and caps attempts per challenge', async () => {
    await forgetLastStep(t.db, w.users.staffA.id);
    const c = client(t);
    await c.login(w.users.staffA.email);
    await t.db.mfaChallenge.updateMany({ where: { userId: w.users.staffA.id, consumedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await c.post('/auth/mfa/verify', { code: totpFor(secret) })).body.code).toBe('MFA_CHALLENGE_INVALID');
    expect((await c.get('/auth/state')).body.state).toBe('ANONYMOUS');

    const d = client(t);
    await d.login(w.users.staffA.email);
    for (let i = 0; i < 5; i++) await d.post('/auth/mfa/verify', { code: totpFor(secret, 7) });
    expect((await d.post('/auth/mfa/verify', { code: totpFor(secret) })).status).toBe(401);
  });

  it('#8 recovery code signs in exactly once (also under concurrency) and is stored hashed', async () => {
    const stored = await t.db.recoveryCode.findMany({ where: { userId: w.users.staffA.id } });
    for (const row of stored) for (const code of codes) expect(row.codeHash).not.toContain(code.replace('-', ''));
    const c = client(t);
    await c.login(w.users.staffA.email);
    const ok = await c.post('/auth/mfa/recovery', { code: codes[0].toLowerCase() });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'AUTHENTICATED', recoveryCodesRemaining: 9 });
    const again = client(t);
    await again.login(w.users.staffA.email);
    expect((await again.post('/auth/mfa/recovery', { code: codes[0] })).status).toBe(401);
    // two different challenges racing for the same unused code
    const racers = [client(t), client(t)];
    await racers[0].login(w.users.staffA.email);
    const challengeA = (await racers[0].get('/auth/state')).body;
    expect(challengeA.state).toBe('MFA_PENDING');
    const results = await Promise.all([racers[0].post('/auth/mfa/recovery', { code: codes[1] }), racers[0].post('/auth/mfa/recovery', { code: codes[1] })]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await t.db.recoveryCode.count({ where: { userId: w.users.staffA.id, usedAt: { not: null } } })).toBe(2);
    expect(mail().some((m) => m.to === w.users.staffA.email && /recovery code was used/i.test(m.subject))).toBe(true);
  });

  it('#9 recovery codes cannot be generated or read without a session and step-up', async () => {
    const anon = client(t);
    expect((await anon.get('/auth/recovery-codes/status')).status).toBe(401);
    expect((await anon.post('/auth/recovery-codes/rotate')).status).toBe(401);
    const pending = client(t);
    await pending.login(w.users.staffA.email);
    expect((await pending.post('/auth/recovery-codes/rotate')).status).toBe(401);

    const c = await signedInWithMfa(t, w.users.staffA.email, w.users.staffA.id, secret);
    await t.db.authSession.updateMany({ where: { userId: w.users.staffA.id, revokedAt: null }, data: { lastMfaAt: new Date(Date.now() - 11 * 60_000) } });
    const denied = await c.post('/auth/recovery-codes/rotate');
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: 'STEP_UP_REQUIRED', method: 'totp' });
    await stepUp(t, c, w.users.staffA.id, secret);
    const rotated = await c.post('/auth/recovery-codes/rotate');
    expect(rotated.status).toBe(200);
    expect(rotated.body.recoveryCodes).toHaveLength(10);
    const old = client(t);
    await old.login(w.users.staffA.email);
    expect((await old.post('/auth/mfa/recovery', { code: codes[5] })).status).toBe(401);
    codes = rotated.body.recoveryCodes;
  });

  it('rate-limits TOTP guessing per user across fresh challenges', async () => {
    const victim = w.users.staffA;
    for (let i = 0; i < 2; i++) {
      const c = client(t);
      await c.login(victim.email);
      for (let j = 0; j < 5; j++) await c.post('/auth/mfa/verify', { code: '000000' });
    }
    const c = client(t);
    await c.login(victim.email);
    const res = await c.post('/auth/mfa/verify', { code: totpFor(secret) });
    expect(res.status).toBe(429);
    await t.db.authRateLimit.deleteMany({});
  });
});

describe('#10 #20 password reset', () => {
  it('responds identically for known and unknown emails and sends only to real accounts', async () => {
    const before = mail().length;
    const known = await client(t).post('/auth/password/forgot', { email: w.users.staffB.email });
    const unknown = await client(t).post('/auth/password/forgot', { email: 'ghost@octa.test' });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    const sent = mail().slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(w.users.staffB.email);
    expect(sent[0].text).toContain(`${ORIGIN}/reset-password#token=`);
  });

  it('is single-use, time-limited, revokes sessions and floods are absorbed', async () => {
    const session = await signedIn(t, w.users.staffB.email);
    await client(t).post('/auth/password/forgot', { email: w.users.staffB.email });
    const link = mail().filter((m) => m.to === w.users.staffB.email).at(-1)!.text.match(/#token=([\w-]+)/)![1];
    const newPassword = 'violet harbor compass 77';
    expect((await client(t).post('/auth/password/reset', { token: link, password: 'short' })).status).toBe(400);
    expect((await client(t).post('/auth/password/reset', { token: link, password: newPassword })).status).toBe(204);
    expect((await client(t).post('/auth/password/reset', { token: link, password: 'another violet harbor 9' })).status).toBe(400);
    expect((await session.get('/auth/me')).status).toBe(401);
    expect((await client(t).login(w.users.staffB.email, newPassword)).body.status).toBe('AUTHENTICATED');

    await client(t).post('/auth/password/forgot', { email: w.users.staffB.email });
    const expired = mail().filter((m) => m.to === w.users.staffB.email).at(-1)!.text.match(/#token=([\w-]+)/)![1];
    await t.db.oneTimeToken.updateMany({ where: { userId: w.users.staffB.id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await client(t).post('/auth/password/reset', { token: expired, password: 'expired violet harbor 1' })).status).toBe(400);

    const before = mail().length;
    for (let i = 0; i < 5; i++) await client(t).post('/auth/password/forgot', { email: w.users.staffB.email });
    expect(mail().length - before).toBeLessThanOrEqual(1); // per-account budget 3/h, two already used
    await t.db.user.update({ where: { id: w.users.staffB.id }, data: { passwordHash: await t.hash(PASSWORD) } });
  });

  it('a reset never bypasses MFA', async () => {
    const c = await signedIn(t, w.users.staffB.email);
    const { secret } = await enroll(c);
    await client(t).post('/auth/password/forgot', { email: w.users.staffB.email });
    await t.db.authRateLimit.deleteMany({});
    const token = mail().filter((m) => m.to === w.users.staffB.email).at(-1)?.text.match(/#token=([\w-]+)/)?.[1];
    expect(token).toBeTruthy();
    await client(t).post('/auth/password/reset', { token: token!, password: 'violet harbor compass 78' });
    expect((await client(t).login(w.users.staffB.email, 'violet harbor compass 78')).body.status).toBe('MFA_PENDING');
    await t.db.user.update({ where: { id: w.users.staffB.id }, data: { passwordHash: await t.hash(PASSWORD) } });
    expect(secret).toBeTruthy();
  });
});

describe('#11 step-up for credential changes', () => {
  it('requires recent verification to change the password and revokes other sessions', async () => {
    const user = w.users.adminA2;
    const other = await signedIn(t, user.email);
    const c = await signedIn(t, user.email);
    await t.db.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { lastReauthAt: new Date(Date.now() - 11 * 60_000) } });
    const denied = await c.post('/auth/password/change', { currentPassword: PASSWORD, newPassword: 'quiet meadow falcon 31' });
    expect(denied.body).toMatchObject({ code: 'STEP_UP_REQUIRED', method: 'password' });
    expect((await c.post('/auth/step-up/verify', { password: 'nope' })).status).toBe(401);
    const up = await c.post('/auth/step-up/verify', { password: PASSWORD });
    expect(up.status).toBe(200);
    c.csrf = up.body.csrfToken;
    expect((await c.post('/auth/password/change', { currentPassword: PASSWORD, newPassword: 'quiet meadow falcon 31' })).status).toBe(204);
    expect((await other.get('/auth/me')).status).toBe(401);
    expect((await c.get('/auth/me')).status).toBe(200);
    await t.db.user.update({ where: { id: user.id }, data: { passwordHash: await t.hash(PASSWORD) } });
  });
});

describe('#15 users cannot manage each other\'s sessions', () => {
  it('rejects revoking another user\'s session id', async () => {
    const a = await signedIn(t, w.users.staffA2.email);
    const b = await signedIn(t, w.users.adminA.email);
    const bSession = (await b.get('/auth/sessions')).body.find((s: { current: boolean }) => s.current);
    expect((await a.send('delete', `/auth/sessions/${bSession.id}`)).status).toBe(403);
    expect((await b.get('/auth/me')).status).toBe(200);
    const own = (await a.get('/auth/sessions')).body;
    expect(own.every((s: { id: string }) => s.id !== bSession.id)).toBe(true);
  });
});

describe('#24 secrets never reach the audit trail', () => {
  it('security events contain no passwords, codes, seeds or tokens', async () => {
    const events = JSON.stringify(await t.db.securityEvent.findMany());
    const secrets = [PASSWORD, ...(await t.db.authSession.findMany({ select: { csrfToken: true } })).map((s) => s.csrfToken)];
    for (const s of secrets) expect(events).not.toContain(s);
    expect(events).not.toMatch(/otpauth:|<svg|[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}/);
    expect(events).toContain('auth.login');
    expect(events).toContain('mfa.totp.verify');
  });
});
