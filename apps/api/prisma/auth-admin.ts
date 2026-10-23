/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { hostname, userInfo } from 'node:os';

/**
 * Operator CLI (runs on a host with database access; never exposed over HTTP).
 *
 *   pnpm --filter @octa-bms/api auth:admin list-admins
 *   pnpm --filter @octa-bms/api auth:admin generate-key
 *   AUTH_BREAK_GLASS_CONFIRM=<email> pnpm --filter @octa-bms/api auth:admin \
 *        break-glass-reset-mfa --email <email> --reason "<ticket + why>" --operator "<name>"
 *
 * Break-glass is the last resort when no second administrator can approve an in-app
 * recovery request. It requires the target email twice (argument + environment), records
 * an audit event, revokes factors/recovery codes/sessions and forces re-enrollment.
 */
const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

async function listAdmins() {
  const admins = await prisma.user.findMany({
    where: { isSystemAdmin: true, deletedAt: null },
    select: { email: true, isActive: true, lastLoginAt: true, mfaAuthenticators: { where: { status: 'ACTIVE' }, select: { confirmedAt: true } }, webauthnCredentials: { where: { revokedAt: null }, select: { id: true } }, recoveryCodes: { where: { usedAt: null, revokedAt: null }, select: { id: true } } },
    orderBy: { email: 'asc' },
  });
  console.table(admins.map((a) => ({ email: a.email, active: a.isActive, totp: a.mfaAuthenticators.length > 0, passkeys: a.webauthnCredentials.length, recoveryCodes: a.recoveryCodes.length, lastLogin: a.lastLoginAt?.toISOString() ?? '-' })));
  const ready = admins.filter((a) => a.isActive && (a.mfaAuthenticators.length || a.webauthnCredentials.length) && a.recoveryCodes.length).length;
  console.log(`${ready} administrator(s) with MFA and recovery codes — enforcement requires at least 2.`);
}

async function breakGlass() {
  const email = arg('email')?.trim().toLowerCase();
  const reason = arg('reason')?.trim();
  const operator = arg('operator')?.trim();
  if (!email || !reason || reason.length < 10 || !operator) throw new Error('Usage: break-glass-reset-mfa --email <email> --reason "<ticket + why, ≥10 chars>" --operator "<name>"');
  if (process.env.AUTH_BREAK_GLASS_CONFIRM?.trim().toLowerCase() !== email) throw new Error('Set AUTH_BREAK_GLASS_CONFIRM to the same email to confirm');
  const user = await prisma.user.findFirst({ where: { OR: [{ emailNormalized: email }, { email }], deletedAt: null } });
  if (!user) throw new Error('No such user');
  const now = new Date();
  await prisma.$transaction([
    prisma.mfaAuthenticator.updateMany({ where: { userId: user.id, status: 'ACTIVE' }, data: { status: 'REVOKED', revokedAt: now } }),
    prisma.recoveryCode.updateMany({ where: { userId: user.id, usedAt: null, revokedAt: null }, data: { revokedAt: now } }),
    prisma.webAuthnCredential.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } }),
    prisma.webAuthnChallenge.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: now } }),
    prisma.mfaEnrollment.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: now } }),
    prisma.mfaChallenge.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: now } }),
    prisma.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now, revokeReason: 'MFA_RESET' } }),
    prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaEnrolledAt: null, mfaRequired: true } }),
    prisma.securityEvent.create({ data: { action: 'breakglass.mfa_reset', outcome: 'success', targetUserId: user.id, context: { operator, reason, host: hostname(), osUser: userInfo().username } } }),
  ]);
  console.log(`MFA reset for ${email}. All sessions revoked; the user must enroll a new authenticator at next sign-in.`);
  console.log('Follow the runbook: notify the user out of band, review the audit trail, and file the incident record.');
}

async function main() {
  switch (process.argv[2]) {
    case 'list-admins': return listAdmins();
    case 'break-glass-reset-mfa': return breakGlass();
    case 'generate-key':
      // printed to the operator's terminal only — store it in the secret manager, never in git
      console.log(randomBytes(32).toString('base64'));
      return;
    default:
      console.log('Commands: list-admins | generate-key | break-glass-reset-mfa');
  }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'failed'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
