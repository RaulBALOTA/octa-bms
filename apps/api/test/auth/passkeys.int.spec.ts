import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootTestApp, type Client, ORIGIN, PASSWORD, totpFor, type TestApp } from './harness';
import { buildWorld, client, enroll, forgetLastStep, signedIn, type World } from './fixtures';
import { VirtualAuthenticator } from './virtual-authenticator';

let t: TestApp;
let w: World;
const RP_ID = new URL(ORIGIN).hostname;
const keys: Record<string, VirtualAuthenticator> = {};

beforeAll(async () => {
  t = await bootTestApp();
  w = await buildWorld(t);
});
afterAll(async () => t?.close());
beforeEach(async () => { await t.db.authRateLimit.deleteMany({}); });

async function registerPasskey(c: Client, key: VirtualAuthenticator, name = 'Laptop') {
  const options = await c.post('/auth/passkeys/register/options');
  if (options.status !== 200) return options;
  const res = await c.post('/auth/passkeys/register/verify', { name, response: key.create(options.body) });
  if (res.body.csrfToken) c.csrf = res.body.csrfToken;
  return res;
}

/** Password step, then the passkey ceremony on the MFA screen. */
async function passkeyLogin(email: string, key: VirtualAuthenticator, overrides?: { origin?: string; rpId?: string }) {
  const c = client(t);
  const first = await c.login(email);
  expect(first.body.status).toBe('MFA_PENDING');
  const options = await c.post('/auth/mfa/passkey/options');
  expect(options.status).toBe(200);
  const assertion = key.get(options.body, overrides);
  const res = await c.post('/auth/mfa/passkey/verify', { response: assertion });
  if (res.body.csrfToken) c.csrf = res.body.csrfToken;
  return { c, res, assertion, options: options.body };
}

describe('passkey registration (administrators only)', () => {
  it('is refused for regular staff', async () => {
    const c = await signedIn(t, w.users.staffA.email);
    expect((await c.post('/auth/passkeys/register/options')).status).toBe(403);
    expect((await c.get('/auth/passkeys')).body.eligible).toBe(false);
  });

  it('registers a system administrator\'s first passkey and issues recovery codes once', async () => {
    const c = await signedIn(t, w.users.super1.email);
    keys.super1 = new VirtualAuthenticator(ORIGIN, RP_ID);
    const options = await c.post('/auth/passkeys/register/options');
    expect(options.body).toMatchObject({ rp: { id: RP_ID, name: 'OCTA BMS' }, attestation: 'none', authenticatorSelection: { userVerification: 'required' } });
    expect(options.body.user.name).toBe(w.users.super1.email);
    const res = await c.post('/auth/passkeys/register/verify', { name: 'YubiKey 5C', response: keys.super1.create(options.body) });
    expect(res.status).toBe(200);
    c.csrf = res.body.csrfToken;
    expect(res.body.recoveryCodes).toHaveLength(10);
    expect(res.body.passkey).toMatchObject({ name: 'YubiKey 5C' });
    expect(JSON.stringify(res.body.passkey)).not.toMatch(/publicKey|credentialId|counter/);
    const listed = await c.get('/auth/passkeys');
    expect(listed.body).toMatchObject({ eligible: true, passkeys: [{ name: 'YubiKey 5C' }] });
    // the same authenticator cannot be registered twice (excludeCredentials + unique id)
    expect((await registerPasskey(c, keys.super1)).status).toBe(401);
  });

  it('company security admins are eligible too', async () => {
    const c = await signedIn(t, w.users.adminA.email);
    keys.adminA = new VirtualAuthenticator(ORIGIN, RP_ID);
    expect((await registerPasskey(c, keys.adminA)).status).toBe(200);
  });

  it('rejects attestations without user verification, from a foreign origin or for another RP ID', async () => {
    const c = await signedIn(t, w.users.super2.email);
    for (const [key, overrides] of [
      [new VirtualAuthenticator(ORIGIN, RP_ID, { userVerified: false }), {}],
      [new VirtualAuthenticator(ORIGIN, RP_ID), { origin: 'https://octa-bms.evil.example' }],
      [new VirtualAuthenticator(ORIGIN, RP_ID), { rpId: 'evil.example' }],
    ] as const) {
      const options = await c.post('/auth/passkeys/register/options');
      const res = await c.post('/auth/passkeys/register/verify', { name: 'x', response: key.create(options.body, overrides) });
      expect(res.status).toBe(401);
    }
    expect(await t.db.webAuthnCredential.count({ where: { userId: w.users.super2.id } })).toBe(0);
  });

  it('needs a session (and a fresh verification) — a pre-auth challenge or stale session cannot register', async () => {
    const anon = client(t);
    expect((await anon.post('/auth/passkeys/register/options')).status).toBe(401);
    const c = await signedIn(t, w.users.super2.email);
    await t.db.authSession.updateMany({ where: { userId: w.users.super2.id, revokedAt: null }, data: { lastReauthAt: new Date(Date.now() - 11 * 60_000) } });
    const res = await c.post('/auth/passkeys/register/options');
    expect(res.body).toMatchObject({ code: 'STEP_UP_REQUIRED', method: 'password' });
  });
});

describe('passkey sign-in', () => {
  it('offers the passkey only after the password and signs in with it', async () => {
    const anonymous = client(t);
    expect((await anonymous.get('/auth/mfa/methods')).status).toBe(401);
    const { c, res } = await passkeyLogin(w.users.super1.email, keys.super1);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('AUTHENTICATED');
    expect((await c.get('/auth/me')).body.mfa).toMatchObject({ enrolled: true, passkeys: 1, totp: false, passkeyEligible: true });
    const stored = await t.db.webAuthnCredential.findFirstOrThrow({ where: { userId: w.users.super1.id } });
    expect(Number(stored.counter)).toBe(keys.super1.counter);
    expect(stored.lastUsedAt).not.toBeNull();
  });

  it('lists methods for the pending sign-in', async () => {
    const c = client(t);
    await c.login(w.users.super1.email);
    expect((await c.get('/auth/mfa/methods')).body).toEqual({ totp: false, passkey: true, passkeyRequired: false, recoveryCode: true });
  });

  it('rejects a replayed assertion, a phishing origin, a wrong RP ID and another user\'s passkey', async () => {
    const first = await passkeyLogin(w.users.super1.email, keys.super1);
    expect(first.res.status).toBe(200);
    // replay the accepted assertion on a fresh challenge
    const c = client(t);
    await c.login(w.users.super1.email);
    await c.post('/auth/mfa/passkey/options');
    expect((await c.post('/auth/mfa/passkey/verify', { response: first.assertion })).status).toBe(401);

    expect((await passkeyLogin(w.users.super1.email, keys.super1, { origin: 'https://0cta-bms.example' })).res.status).toBe(401);
    expect((await passkeyLogin(w.users.super1.email, keys.super1, { rpId: 'evil.example' })).res.status).toBe(401);
    // adminA's genuine passkey presented in super1's ceremony
    const d = client(t);
    await d.login(w.users.super1.email);
    const options = await d.post('/auth/mfa/passkey/options');
    expect((await d.post('/auth/mfa/passkey/verify', { response: keys.adminA.get(options.body) })).status).toBe(401);
    expect((await d.get('/auth/me')).status).toBe(401);
  });

  it('cannot be completed without first passing the password step', async () => {
    const c = client(t);
    expect((await c.post('/auth/mfa/passkey/options')).status).toBe(401);
    expect((await c.post('/auth/mfa/passkey/verify', { response: { id: 'x', response: { clientDataJSON: 'e30' } } })).status).toBe(401);
  });
});

describe('passkey step-up', () => {
  it('re-verifies with a passkey for high-risk actions', async () => {
    const { c } = await passkeyLogin(w.users.super1.email, keys.super1);
    await t.db.authSession.updateMany({ where: { userId: w.users.super1.id, revokedAt: null }, data: { lastMfaAt: new Date(Date.now() - 11 * 60_000) } });
    const denied = await c.post('/auth/recovery-codes/rotate');
    expect(denied.body).toMatchObject({ code: 'STEP_UP_REQUIRED', method: 'passkey', methods: ['passkey'] });
    const options = await c.post('/auth/step-up/passkey/options');
    const up = await c.post('/auth/step-up/passkey/verify', { response: keys.super1.get(options.body) });
    expect(up.status).toBe(200);
    c.csrf = up.body.csrfToken;
    expect((await c.post('/auth/recovery-codes/rotate')).status).toBe(200);
  });
});

describe('MFA configuration policy guard rails', () => {
  it('refuses to require passkeys until every system administrator has one', async () => {
    const { c } = await passkeyLogin(w.users.super1.email, keys.super1);
    const res = await c.send('patch', '/admin/security/policy', { requirePasskeyForAdmins: true });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'POLICY_CHANGE_REJECTED', admins: 2, withPasskey: 1 });
    expect((await c.send('patch', '/admin/security/policy', { passkeysEnabled: false, requirePasskeyForAdmins: true })).status).toBe(409);
    expect((await c.send('patch', '/admin/security/policy', { stepUpMaxAgeMinutes: 0 })).status).toBe(400);
  });

  it('once required: TOTP is refused for administrators, passkey and recovery codes work', async () => {
    // super2 has TOTP and then adds a passkey
    const s2 = await signedIn(t, w.users.super2.email);
    const { secret, recoveryCodes } = await enroll(s2);
    keys.super2 = new VirtualAuthenticator(ORIGIN, RP_ID);
    const reg = await registerPasskey(s2, keys.super2, 'Phone');
    expect(reg.status).toBe(200);
    expect(reg.body.recoveryCodes).toBeUndefined(); // not the first factor: existing codes stay

    const { c } = await passkeyLogin(w.users.super1.email, keys.super1);
    const saved = await c.send('patch', '/admin/security/policy', { requirePasskeyForAdmins: true, stepUpMaxAgeMinutes: 5 });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ requirePasskeyForAdmins: true, passkeysEnabled: true, stepUpMaxAgeMinutes: 5 });

    await forgetLastStep(t.db, w.users.super2.id);
    const viaTotp = client(t);
    await viaTotp.login(w.users.super2.email);
    expect((await viaTotp.get('/auth/mfa/methods')).body).toMatchObject({ totp: false, passkey: true, passkeyRequired: true });
    const refused = await viaTotp.post('/auth/mfa/verify', { code: totpFor(secret) });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('PASSKEY_REQUIRED');
    expect((await viaTotp.get('/auth/me')).status).toBe(401);

    const viaCode = client(t);
    await viaCode.login(w.users.super2.email);
    expect((await viaCode.post('/auth/mfa/recovery', { code: recoveryCodes[0] })).status).toBe(200);
    expect((await passkeyLogin(w.users.super2.email, keys.super2)).res.status).toBe(200);

    // step-up with a TOTP code is refused as well
    const session = (await passkeyLogin(w.users.super2.email, keys.super2)).c;
    await forgetLastStep(t.db, w.users.super2.id);
    expect((await session.post('/auth/step-up/verify', { code: totpFor(secret) })).body.code).toBe('PASSKEY_REQUIRED');
    // non-admins keep using TOTP
    const staff = await signedIn(t, w.users.staffB.email);
    const staffSecret = (await enroll(staff)).secret;
    await forgetLastStep(t.db, w.users.staffB.id);
    const staffLogin = client(t);
    await staffLogin.login(w.users.staffB.email);
    expect((await staffLogin.post('/auth/mfa/verify', { code: totpFor(staffSecret) })).status).toBe(200);
  });

  it('an administrator cannot remove their last passkey while passkeys are required', async () => {
    const { c } = await passkeyLogin(w.users.super1.email, keys.super1);
    const [passkey] = (await c.get('/auth/passkeys')).body.passkeys;
    const res = await c.send('delete', `/auth/passkeys/${passkey.id}`);
    expect(res.status).toBe(409); // also its last factor
    expect(await t.db.webAuthnCredential.count({ where: { userId: w.users.super1.id, revokedAt: null } })).toBe(1);
    // nor someone else's passkey
    const other = (await t.db.webAuthnCredential.findFirstOrThrow({ where: { userId: w.users.adminA.id } })).id;
    expect((await c.send('delete', `/auth/passkeys/${other}`)).status).toBe(403);
  });

  it('admin-assisted recovery revokes passkeys too', async () => {
    const s1 = (await passkeyLogin(w.users.super1.email, keys.super1)).c;
    const created = await s1.post('/admin/security/recovery-requests', { targetUserId: w.users.adminA.id, reason: 'Security key lost on travel', verificationMethod: 'Video call, ID card checked' });
    expect(created.status).toBe(201);
    const s2 = (await passkeyLogin(w.users.super2.email, keys.super2)).c;
    expect((await s2.post(`/admin/security/recovery-requests/${created.body.id}/approve`)).status).toBe(200);
    expect((await s2.post(`/admin/security/recovery-requests/${created.body.id}/complete`)).status).toBe(204);
    expect(await t.db.webAuthnCredential.count({ where: { userId: w.users.adminA.id, revokedAt: null } })).toBe(0);
    expect((await client(t).login(w.users.adminA.email)).body.status).toBe('MFA_ENROLLMENT_REQUIRED');
  });

  it('exposes read-only configuration and passkey coverage to the configuration page', async () => {
    const c = (await passkeyLogin(w.users.super1.email, keys.super1)).c;
    const config = await c.get('/admin/security/config');
    expect(config.body).toMatchObject({ totp: { issuer: 'OCTA BMS', algorithm: 'SHA1', digits: 6, periodSeconds: 30 }, passkeys: { rpId: RP_ID, userVerification: 'required' } });
    expect(JSON.stringify(config.body)).not.toMatch(/key":"[A-Za-z0-9+/=]{40,}/);
    expect((await c.get('/admin/security/overview')).body).toMatchObject({ systemAdmins: 2, adminsWithPasskey: 2 });
    const staff = await signedIn(t, w.users.staffA.email);
    expect((await staff.get('/admin/security/config')).status).toBe(403);
    expect(PASSWORD).toBeTruthy();
  });
});
