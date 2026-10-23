import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { AuthError } from './auth-errors';
import { AuthorizationService } from './authorization.service';
import { EmailNotificationService } from './email-notification.service';
import { MfaService } from './mfa.service';
import { SecurityAuditService } from './security-audit.service';
import { SessionService } from './session.service';

const REQUEST_TTL_HOURS = 72;

/**
 * Admin-assisted MFA recovery for users who lost both their authenticator and their
 * recovery codes. Flow: request (with out-of-band identity verification note) →
 * approval by a *different* administrator → completion. Completion revokes every factor,
 * recovery code and session, and flags the account so the user must enroll a new
 * authenticator at next sign-in. Admins never see seeds or codes. Email alone never
 * recovers an account.
 */
@Injectable()
export class MfaRecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly mfa: MfaService,
    private readonly sessions: SessionService,
    private readonly audit: SecurityAuditService,
    private readonly email: EmailNotificationService,
  ) {}

  private async target(id: string) {
    const user = await this.prisma.user.findFirst({ where: { id, deletedAt: null }, select: { id: true, email: true, isSystemAdmin: true } });
    if (!user) throw new AuthError('RECOVERY_REQUEST_INVALID', 'Unknown user');
    return user;
  }

  async create(actor: AuthUser, input: { targetUserId: string; reason: string; verificationMethod: string }, req: Request) {
    if (input.targetUserId === actor.id) throw new AuthError('RECOVERY_REQUEST_INVALID', 'You cannot request recovery for your own account');
    await this.authorization.assertCanManageUser(actor, input.targetUserId);
    const target = await this.target(input.targetUserId);
    if (target.isSystemAdmin && !actor.isSystemAdmin) throw new AuthError('FORBIDDEN');
    const open = await this.prisma.mfaRecoveryRequest.count({ where: { targetUserId: target.id, status: { in: ['PENDING', 'APPROVED'] }, expiresAt: { gt: new Date() } } });
    if (open) throw new AuthError('RECOVERY_REQUEST_INVALID', 'A recovery request for this user is already open');
    const request = await this.prisma.mfaRecoveryRequest.create({
      data: {
        targetUserId: target.id, requestedById: actor.id, reason: input.reason.trim(), verificationMethod: input.verificationMethod.trim(),
        expiresAt: new Date(Date.now() + REQUEST_TTL_HOURS * 3_600_000),
      },
    });
    await this.audit.record({ action: 'mfa.recovery_request.created', outcome: 'success', actorUserId: actor.id, targetUserId: target.id, companyId: actor.companyId, req, context: { requestId: request.id } });
    return request;
  }

  private async load(actor: AuthUser, id: string) {
    const request = await this.prisma.mfaRecoveryRequest.findUnique({ where: { id } });
    if (!request) throw new AuthError('RECOVERY_REQUEST_INVALID', 'Unknown request');
    await this.authorization.assertCanManageUser(actor, request.targetUserId);
    if (request.expiresAt <= new Date() && (request.status === 'PENDING' || request.status === 'APPROVED')) {
      await this.prisma.mfaRecoveryRequest.update({ where: { id }, data: { status: 'EXPIRED' } });
      throw new AuthError('RECOVERY_REQUEST_INVALID', 'The request has expired');
    }
    return request;
  }

  async approve(actor: AuthUser, id: string, req: Request) {
    const request = await this.load(actor, id);
    const target = await this.target(request.targetUserId);
    if (request.requestedById === actor.id) throw new AuthError('RECOVERY_REQUEST_INVALID', 'A different administrator must approve this request');
    if (target.id === actor.id) throw new AuthError('RECOVERY_REQUEST_INVALID', 'You cannot approve recovery of your own account');
    if (target.isSystemAdmin && !actor.isSystemAdmin) throw new AuthError('FORBIDDEN', 'Recovery of a system administrator needs a system administrator approver');
    const { count } = await this.prisma.mfaRecoveryRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'APPROVED', approvedById: actor.id, approvedAt: new Date() } });
    if (count !== 1) throw new AuthError('RECOVERY_REQUEST_INVALID', 'The request is not pending');
    await this.audit.record({ action: 'mfa.recovery_request.approved', outcome: 'success', actorUserId: actor.id, targetUserId: target.id, req, context: { requestId: id } });
    return this.prisma.mfaRecoveryRequest.findUniqueOrThrow({ where: { id } });
  }

  async reject(actor: AuthUser, id: string, req: Request) {
    const request = await this.load(actor, id);
    const { count } = await this.prisma.mfaRecoveryRequest.updateMany({ where: { id, status: { in: ['PENDING', 'APPROVED'] } }, data: { status: 'REJECTED', rejectedById: actor.id, rejectedAt: new Date() } });
    if (count !== 1) throw new AuthError('RECOVERY_REQUEST_INVALID', 'The request is closed');
    await this.audit.record({ action: 'mfa.recovery_request.rejected', outcome: 'success', actorUserId: actor.id, targetUserId: request.targetUserId, req, context: { requestId: id } });
  }

  async complete(actor: AuthUser, id: string, req: Request) {
    const request = await this.load(actor, id);
    if (request.status !== 'APPROVED' || !request.approvedById) throw new AuthError('RECOVERY_REQUEST_INVALID', 'The request must be approved first');
    if (actor.id !== request.requestedById && actor.id !== request.approvedById) throw new AuthError('FORBIDDEN');
    const target = await this.target(request.targetUserId);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.mfaRecoveryRequest.updateMany({ where: { id, status: 'APPROVED' }, data: { status: 'COMPLETED', completedById: actor.id, completedAt: now } });
      if (count !== 1) throw new AuthError('RECOVERY_REQUEST_INVALID', 'The request was already completed');
      await this.mfa.removeAll(target.id, tx);
      await this.sessions.revokeAllForUser(target.id, 'MFA_RESET', undefined, tx);
      await tx.mfaChallenge.updateMany({ where: { userId: target.id, consumedAt: null }, data: { consumedAt: now } });
      // forces a fresh enrollment at next sign-in regardless of global policy mode
      await tx.user.update({ where: { id: target.id }, data: { mfaRequired: true } });
    });
    await this.audit.record({ action: 'mfa.recovery_request.completed', outcome: 'success', actorUserId: actor.id, targetUserId: target.id, req, context: { requestId: id, requestedBy: request.requestedById, approvedBy: request.approvedById } });
    this.email.notify(target.email, { kind: 'mfa-reset' }, target.id);
  }

  async list(actor: AuthUser) {
    const where = actor.isSystemAdmin ? {} : { targetUser: { memberships: { some: { companyId: actor.companyId ?? '__none__' } }, isSystemAdmin: false } };
    return this.prisma.mfaRecoveryRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { targetUser: { select: { id: true, email: true, displayName: true, isSystemAdmin: true } } },
    });
  }
}
