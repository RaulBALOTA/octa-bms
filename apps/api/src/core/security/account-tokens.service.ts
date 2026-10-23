import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { AUTH_CONFIG, type AuthConfig } from './auth-config';
import { AuthError } from './auth-errors';
import { normalizeEmail } from './auth.service';
import { AuthorizationService } from './authorization.service';
import { hashToken, ipBucket, randomToken } from './crypto';
import { EmailNotificationService } from './email-notification.service';
import { PasswordService } from './password.service';
import { RATE_LIMITS, RateLimitService } from './rate-limit.service';
import { SecurityAuditService } from './security-audit.service';
import { SessionService } from './session.service';

/**
 * Password reset and invitation flows. Tokens: 256-bit random, only SHA-256 stored,
 * short TTL, single use via conditional update, newer tokens supersede older ones.
 * Links carry the token in the URL fragment (not sent to servers / Referer).
 * Responses never reveal whether an email address is registered.
 */
@Injectable()
export class AccountTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly limits: RateLimitService,
    private readonly audit: SecurityAuditService,
    private readonly email: EmailNotificationService,
    private readonly authorization: AuthorizationService,
    private readonly rbac: RbacService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  // ------------------------------------------------------------ password reset

  /** Always resolves the same way; email is sent only to an existing active account within budget. */
  async requestPasswordReset(rawEmail: string, req: Request): Promise<void> {
    const email = normalizeEmail(rawEmail);
    await this.limits.assertHit(RATE_LIMITS.forgotIp, ipBucket(req.ip));
    const withinBudget = (await this.limits.hit(RATE_LIMITS.forgotAccount, email)).allowed;
    const user = await this.prisma.user.findFirst({ where: { OR: [{ emailNormalized: email }, { email }], deletedAt: null, isActive: true, status: 'ACTIVE' } });
    if (!user || !withinBudget) {
      await this.audit.record({ action: 'password.reset.request', outcome: 'denied', targetUserId: user?.id ?? null, req, context: { reason: user ? 'throttled' : 'unknown_account' } });
      return;
    }
    const token = randomToken(32);
    await this.prisma.$transaction([
      this.prisma.oneTimeToken.updateMany({ where: { userId: user.id, purpose: 'PASSWORD_RESET', usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.oneTimeToken.create({
        data: { userId: user.id, purpose: 'PASSWORD_RESET', tokenHash: hashToken('password-reset', token), expiresAt: new Date(Date.now() + this.config.resetTokenTtlMinutes * 60_000) },
      }),
    ]);
    await this.audit.record({ action: 'password.reset.request', outcome: 'success', targetUserId: user.id, req });
    this.email.notify(user.email, { kind: 'password-reset', link: `${this.email.appUrl}/reset-password#token=${token}`, minutes: this.config.resetTokenTtlMinutes }, user.id);
  }

  async resetPassword(token: string, newPassword: string, req: Request): Promise<void> {
    await this.limits.assertHit(RATE_LIMITS.tokenIp, ipBucket(req.ip));
    const row = await this.prisma.oneTimeToken.findUnique({ where: { tokenHash: hashToken('password-reset', token) }, include: { user: true } });
    if (!row || row.purpose !== 'PASSWORD_RESET' || row.usedAt || row.expiresAt <= new Date() || !row.user.isActive || row.user.deletedAt) {
      await this.audit.record({ action: 'password.reset.complete', outcome: 'failure', targetUserId: row?.userId ?? null, req, context: { reason: 'token' } });
      throw new AuthError('TOKEN_INVALID');
    }
    const issues = await this.passwords.validate(newPassword, row.user);
    if (issues.length) throw new AuthError('PASSWORD_POLICY', issues[0], { issues });
    const passwordHash = await this.passwords.hash(newPassword);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.oneTimeToken.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
      if (count !== 1) throw new AuthError('TOKEN_INVALID');
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash, passwordChangedAt: now, credentialUpdatedAt: now, emailVerifiedAt: row.user.emailVerifiedAt ?? now, failedLoginCount: 0 } });
      await this.sessions.revokeAllForUser(row.userId, 'PASSWORD_RESET', undefined, tx);
      await tx.mfaChallenge.updateMany({ where: { userId: row.userId, consumedAt: null }, data: { consumedAt: now } });
    });
    // MFA is untouched: the next sign-in still requires the second factor.
    await this.audit.record({ action: 'password.reset.complete', outcome: 'success', targetUserId: row.userId, req });
    this.email.notify(row.user.email, { kind: 'password-changed' }, row.userId);
  }

  async changePassword(userId: string, sessionId: string, currentPassword: string, newPassword: string, req: Request): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash || !(await this.passwords.verify(user.passwordHash, currentPassword)).valid) {
      await this.limits.hit(RATE_LIMITS.stepUpUserFailures, userId);
      await this.audit.record({ action: 'password.change', outcome: 'failure', actorUserId: userId, targetUserId: userId, req });
      throw new AuthError('STEP_UP_INVALID', 'Current password is incorrect');
    }
    const issues = await this.passwords.validate(newPassword, user);
    if (issues.length) throw new AuthError('PASSWORD_POLICY', issues[0], { issues });
    const now = new Date();
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await this.passwords.hash(newPassword), passwordChangedAt: now, credentialUpdatedAt: now } });
    const revoked = await this.sessions.revokeAllForUser(userId, 'PASSWORD_CHANGED', sessionId);
    await this.audit.record({ action: 'password.change', outcome: 'success', actorUserId: userId, targetUserId: userId, req, context: { otherSessionsRevoked: revoked } });
    this.email.notify(user.email, { kind: 'password-changed' }, userId);
  }

  // --------------------------------------------------------------- invitations

  async invite(actor: AuthUser, input: { email: string; companyId: string; roleId?: string }, req: Request) {
    await this.limits.assertHit(RATE_LIMITS.invitationsActor, actor.id);
    const email = normalizeEmail(input.email);
    if (!actor.isSystemAdmin && input.companyId !== actor.companyId) throw new AuthError('FORBIDDEN', 'Invitations are limited to your active company');
    const company = await this.prisma.company.findFirst({ where: { id: input.companyId, deletedAt: null, isActive: true } });
    if (!company) throw new AuthError('FORBIDDEN', 'Unknown company');
    if (input.roleId) await this.authorization.assertCanGrantRole(actor, { roleId: input.roleId, companyId: input.companyId });
    const existing = await this.prisma.user.findFirst({ where: { OR: [{ emailNormalized: email }, { email }] } });
    if (existing) throw new ConflictException({ code: 'USER_EXISTS', message: 'An account with this email already exists; assign a role instead' });

    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + this.config.invitationTtlHours * 3_600_000);
    const [, invitation] = await this.prisma.$transaction([
      this.prisma.invitation.updateMany({ where: { email, companyId: input.companyId, redeemedAt: null, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.invitation.create({
        data: { email, companyId: input.companyId, roleId: input.roleId ?? null, invitedById: actor.id, tokenHash: hashToken('invitation', token), expiresAt },
        select: { id: true, email: true, companyId: true, roleId: true, expiresAt: true, createdAt: true },
      }),
    ]);
    await this.audit.record({ action: 'invitation.created', outcome: 'success', actorUserId: actor.id, companyId: input.companyId, req, context: { invitationId: invitation.id, roleId: input.roleId ?? null } });
    const delivered = await this.email.send(email, { kind: 'invitation', link: `${this.email.appUrl}/invite#token=${token}`, companyName: company.name, hours: this.config.invitationTtlHours });
    return { ...invitation, emailDelivered: delivered };
  }

  async revokeInvitation(actor: AuthUser, id: string, req: Request) {
    const invitation = await this.prisma.invitation.findUnique({ where: { id } });
    if (!invitation || (!actor.isSystemAdmin && invitation.companyId !== actor.companyId)) throw new AuthError('FORBIDDEN');
    await this.prisma.invitation.updateMany({ where: { id, redeemedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.record({ action: 'invitation.revoked', outcome: 'success', actorUserId: actor.id, companyId: invitation.companyId, req, context: { invitationId: id } });
  }

  private async liveInvitation(token: string) {
    const invitation = await this.prisma.invitation.findUnique({ where: { tokenHash: hashToken('invitation', token) }, include: { company: { select: { name: true } } } });
    if (!invitation || invitation.redeemedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) return null;
    return invitation;
  }

  async previewInvitation(token: string, req: Request) {
    await this.limits.assertHit(RATE_LIMITS.tokenIp, ipBucket(req.ip));
    const invitation = await this.liveInvitation(token);
    if (!invitation) throw new AuthError('TOKEN_INVALID');
    return { email: invitation.email, companyName: invitation.company.name, expiresAt: invitation.expiresAt };
  }

  /** Creates the account bound to the invited email. MFA enrollment follows at first sign-in per policy. */
  async acceptInvitation(token: string, input: { firstName: string; lastName: string; password: string }, req: Request) {
    await this.limits.assertHit(RATE_LIMITS.tokenIp, ipBucket(req.ip));
    const invitation = await this.liveInvitation(token);
    if (!invitation) {
      await this.audit.record({ action: 'invitation.accept', outcome: 'failure', req, context: { reason: 'token' } });
      throw new AuthError('TOKEN_INVALID');
    }
    const issues = await this.passwords.validate(input.password, { email: invitation.email, firstName: input.firstName, lastName: input.lastName });
    if (issues.length) throw new AuthError('PASSWORD_POLICY', issues[0], { issues });
    const passwordHash = await this.passwords.hash(input.password);
    const now = new Date();
    const user = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.invitation.updateMany({ where: { id: invitation.id, redeemedAt: null, revokedAt: null, expiresAt: { gt: now } }, data: { redeemedAt: now } });
      if (count !== 1) throw new AuthError('TOKEN_INVALID');
      const created = await tx.user.create({
        data: {
          email: invitation.email, emailNormalized: invitation.email, emailVerifiedAt: now, firstName: input.firstName.trim(), lastName: input.lastName.trim(),
          displayName: `${input.firstName.trim()} ${input.lastName.trim()}`.trim(), passwordHash, passwordChangedAt: now, credentialUpdatedAt: now, status: 'ACTIVE',
          memberships: { create: { companyId: invitation.companyId, isDefault: true } },
        },
      });
      if (invitation.roleId) await tx.userRole.create({ data: { userId: created.id, roleId: invitation.roleId, companyId: invitation.companyId } });
      await tx.invitation.update({ where: { id: invitation.id }, data: { redeemedUserId: created.id } });
      return created;
    });
    this.rbac.invalidate(user.id);
    await this.audit.record({ action: 'invitation.accept', outcome: 'success', actorUserId: user.id, targetUserId: user.id, companyId: invitation.companyId, req, context: { invitationId: invitation.id } });
    return { email: user.email };
  }
}
