import type { PrismaClient } from '@prisma/client';
import { Client, PASSWORD, secretFromManualKey, totpFor, type TestApp } from './harness';

const PERMISSIONS = [
  'crm.partners.read', 'corporate.dashboard.read', 'admin.audit.read',
  'identity.users.read', 'identity.users.create', 'identity.users.update',
  'identity.roles.read', 'identity.roles.create', 'identity.roles.update',
  'identity.security.read', 'identity.security.update', 'identity.security.approve',
];

export interface World {
  companyA: string;
  companyB: string;
  roles: { staff: string; companyAdmin: string; systemAdmin: string };
  users: Record<'super1' | 'super2' | 'adminA' | 'adminA2' | 'staffA' | 'staffA2' | 'staffB' | 'disabled', { id: string; email: string }>;
  partnerA: string;
  partnerB: string;
}

export async function buildWorld(t: TestApp): Promise<World> {
  const db: PrismaClient = t.db;
  for (const code of PERMISSIONS) {
    const [module, resource, action] = code.split('.');
    await db.permission.create({ data: { code, module, resource, action, name: code } });
  }
  const perms = await db.permission.findMany();
  const role = async (code: string, codes: string[]) =>
    (await db.role.create({ data: { code, name: code, isSystem: true, permissions: { create: perms.filter((p) => codes.includes(p.code)).map((p) => ({ permissionId: p.id })) } } })).id;
  const roles = {
    staff: await role('STAFF', ['crm.partners.read']),
    companyAdmin: await role('COMPANY_ADMIN', PERMISSIONS.filter((p) => p !== 'corporate.dashboard.read')),
    systemAdmin: await role('SYSTEM_ADMIN', PERMISSIONS),
  };
  const companyA = (await db.company.create({ data: { code: 'A', name: 'Company A' } })).id;
  const companyB = (await db.company.create({ data: { code: 'B', name: 'Company B' } })).id;
  const passwordHash = await t.hash(PASSWORD);
  const user = async (key: string, company: string | null, roleId: string | null, extra: object = {}) => {
    const email = `${key.toLowerCase()}@octa.test`;
    const created = await db.user.create({
      data: {
        email, emailNormalized: email, firstName: key, lastName: 'Test', passwordHash, ...extra,
        ...(company ? { memberships: { create: { companyId: company, isDefault: true } } } : {}),
      },
    });
    if (roleId) await db.userRole.create({ data: { userId: created.id, roleId, companyId: company } });
    return { id: created.id, email };
  };
  const users = {
    super1: await user('Super1', companyA, null, { isSystemAdmin: true }),
    super2: await user('Super2', companyA, null, { isSystemAdmin: true }),
    adminA: await user('AdminA', companyA, roles.companyAdmin),
    adminA2: await user('AdminA2', companyA, roles.companyAdmin),
    staffA: await user('StaffA', companyA, roles.staff),
    staffA2: await user('StaffA2', companyA, roles.staff),
    staffB: await user('StaffB', companyB, roles.staff),
    disabled: await user('Disabled', companyA, roles.staff, { isActive: false, status: 'DISABLED' }),
  };
  const partner = async (companyId: string, name: string) =>
    (await db.businessPartner.create({ data: { companyId, name, partnerNumber: `BP-${name}`, type: 'CLIENT' } })).id;
  return { companyA, companyB, roles, users, partnerA: await partner(companyA, 'PartnerA'), partnerB: await partner(companyB, 'PartnerB') };
}

let ipCounter = 10;
export function client(t: TestApp) {
  ipCounter += 1;
  return new Client(t.app, `198.51.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`);
}

/** Signs in (no MFA yet) and returns a client holding a full session. */
export async function signedIn(t: TestApp, email: string) {
  const c = client(t);
  const res = await c.login(email);
  if (res.body.status !== 'AUTHENTICATED') throw new Error(`expected AUTHENTICATED, got ${res.status} ${JSON.stringify(res.body)}`);
  return c;
}

/** Enrolls Microsoft-Authenticator-style TOTP from a session or ENROLL challenge. */
export async function enroll(c: Client) {
  const start = await c.post('/auth/mfa/enroll/start');
  if (start.status !== 200) throw new Error(`enroll/start ${start.status} ${JSON.stringify(start.body)}`);
  const secret = secretFromManualKey(start.body.manualKey);
  const confirm = await c.post('/auth/mfa/enroll/confirm', { enrollmentId: start.body.enrollmentId, code: totpFor(secret) });
  if (confirm.status !== 200) throw new Error(`enroll/confirm ${confirm.status} ${JSON.stringify(confirm.body)}`);
  c.csrf = confirm.body.csrfToken;
  return { secret, recoveryCodes: confirm.body.recoveryCodes as string[], start: start.body };
}

/** Simulates time passing for replay protection (the only way to reuse the ±1 window in a fast test). */
export async function forgetLastStep(db: PrismaClient, userId: string) {
  await db.mfaAuthenticator.updateMany({ where: { userId }, data: { lastUsedStep: 0 } });
}

/** Signs in with password + TOTP. */
export async function signedInWithMfa(t: TestApp, email: string, userId: string, secret: string) {
  await forgetLastStep(t.db, userId);
  const c = client(t);
  const first = await c.login(email);
  if (first.body.status !== 'MFA_PENDING') throw new Error(`expected MFA_PENDING, got ${JSON.stringify(first.body)}`);
  const verify = await c.post('/auth/mfa/verify', { code: totpFor(secret) });
  if (verify.status !== 200) throw new Error(`verify ${verify.status} ${JSON.stringify(verify.body)}`);
  c.csrf = verify.body.csrfToken;
  return c;
}

/** Step-up with a fresh TOTP code (for @RequireRecentAuth routes). */
export async function stepUp(t: TestApp, c: Client, userId: string, secret: string) {
  await forgetLastStep(t.db, userId);
  const res = await c.post('/auth/step-up/verify', { code: totpFor(secret) });
  if (res.status !== 200) throw new Error(`step-up ${res.status} ${JSON.stringify(res.body)}`);
  c.csrf = res.body.csrfToken;
}
