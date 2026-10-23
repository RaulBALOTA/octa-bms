import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { MfaPolicyMode, Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { AccountTokensService } from '../security/account-tokens.service';
import { AuthError } from '../security/auth-errors';
import { AuthorizationService } from '../security/authorization.service';
import { MfaRecoveryService } from '../security/mfa-recovery.service';
import { RATE_LIMITS, RateLimitService } from '../security/rate-limit.service';
import { SecurityAuditService } from '../security/security-audit.service';
import { SecurityPolicyService } from '../security/security-policy.service';
import { SessionService } from '../security/session.service';
import { PrismaService } from '../prisma/prisma.service';
import { type AuthenticatedRequest, type AuthUser, CurrentUser, RequirePermission, RequireRecentAuth } from './decorators';

class PolicyDto {
  @IsOptional() @IsIn(['DISABLED', 'OPTIONAL', 'ENROLLMENT_REQUIRED', 'ENFORCED']) mfaMode?: MfaPolicyMode;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @Type(() => Date) @IsDate() enrollmentDeadline?: Date | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(5) @Max(1440) sessionIdleMinutes?: number | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(1) @Max(336) sessionAbsoluteHours?: number | null;
}
class InvitationDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MaxLength(64) companyId!: string;
  @IsOptional() @IsString() @MaxLength(64) roleId?: string;
}
class MfaRequiredDto {
  @IsBoolean() required!: boolean;
}
class RecoveryRequestDto {
  @IsString() @MaxLength(64) targetUserId!: string;
  @IsString() @MinLength(10) @MaxLength(500) reason!: string;
  @IsString() @MinLength(5) @MaxLength(300) verificationMethod!: string;
}
class EventsQuery {
  @IsOptional() @IsString() @MaxLength(80) action?: string;
  @IsOptional() @IsString() @MaxLength(64) userId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) take?: number;
}

/**
 * Organization security administration. Company admins see and manage only members of
 * their active company; system administrators see everything. Mutations that change
 * access require step-up (recent second factor).
 */
@ApiTags('admin-security')
@Controller('admin/security')
export class AdminSecurityController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: SecurityPolicyService,
    private readonly sessions: SessionService,
    private readonly tokens: AccountTokensService,
    private readonly recovery: MfaRecoveryService,
    private readonly authorization: AuthorizationService,
    private readonly audit: SecurityAuditService,
    private readonly limits: RateLimitService,
  ) {}

  private scope(actor: AuthUser): Prisma.UserWhereInput {
    if (actor.isSystemAdmin) return { deletedAt: null };
    return { deletedAt: null, memberships: { some: { companyId: actor.companyId ?? '__none__' } } };
  }

  @Get('overview')
  @RequirePermission('identity.security.read')
  async overview(@CurrentUser() actor: AuthUser) {
    const scope = this.scope(actor);
    const now = new Date();
    const [users, enrolled, pendingEnrollments, activeSessions, pendingRecovery, policy, enrolledAdmins] = await Promise.all([
      this.prisma.user.count({ where: { ...scope, isActive: true } }),
      this.prisma.user.count({ where: { ...scope, isActive: true, mfaAuthenticators: { some: { status: 'ACTIVE' } } } }),
      this.prisma.mfaEnrollment.count({ where: { consumedAt: null, expiresAt: { gt: now }, user: scope } }),
      this.prisma.authSession.count({ where: { revokedAt: null, idleExpiresAt: { gt: now }, absoluteExpiresAt: { gt: now }, user: scope } }),
      this.prisma.mfaRecoveryRequest.count({ where: { status: { in: ['PENDING', 'APPROVED'] }, targetUser: scope } }),
      this.policy.get(),
      this.policy.enrolledAdminCount(),
    ]);
    return { users, enrolled, notEnrolled: users - enrolled, pendingEnrollments, activeSessions, pendingRecovery, policy, enrolledAdmins };
  }

  @Get('users')
  @RequirePermission('identity.security.read')
  async users(@CurrentUser() actor: AuthUser) {
    const now = new Date();
    const rows = await this.prisma.user.findMany({
      where: this.scope(actor),
      orderBy: { email: 'asc' },
      take: 500,
      select: {
        id: true, email: true, displayName: true, isActive: true, status: true, isSystemAdmin: true, lastLoginAt: true, mfaRequired: true, mfaEnrolledAt: true,
        mfaAuthenticators: { where: { status: 'ACTIVE' }, select: { confirmedAt: true, lastUsedAt: true } },
        recoveryCodes: { where: { usedAt: null, revokedAt: null }, select: { id: true } },
        authSessions: { where: { revokedAt: null, idleExpiresAt: { gt: now }, absoluteExpiresAt: { gt: now } }, select: { id: true } },
      },
    });
    // never seeds, codes or hashes — status and counts only
    return rows.map(({ mfaAuthenticators, recoveryCodes, authSessions, ...user }) => ({
      ...user,
      mfaEnrolled: mfaAuthenticators.length > 0,
      mfaLastUsedAt: mfaAuthenticators[0]?.lastUsedAt ?? null,
      recoveryCodesRemaining: mfaAuthenticators.length ? recoveryCodes.length : 0,
      activeSessions: authSessions.length,
    }));
  }

  @RequireRecentAuth()
  @Patch('users/:id/mfa-required')
  @RequirePermission('identity.security.update')
  async setMfaRequired(@Param('id') id: string, @Body() dto: MfaRequiredDto, @CurrentUser() actor: AuthUser, @Req() req: AuthenticatedRequest) {
    await this.limits.assertHit(RATE_LIMITS.adminActor, actor.id);
    await this.authorization.assertCanManageUser(actor, id);
    await this.prisma.user.update({ where: { id }, data: { mfaRequired: dto.required } });
    await this.audit.record({ action: 'user.mfa_required.updated', outcome: 'success', actorUserId: actor.id, targetUserId: id, companyId: actor.companyId, req, context: { required: dto.required } });
    return { id, mfaRequired: dto.required };
  }

  @RequireRecentAuth()
  @Post('users/:id/revoke-sessions')
  @HttpCode(200)
  @RequirePermission('identity.security.update')
  async revokeSessions(@Param('id') id: string, @CurrentUser() actor: AuthUser, @Req() req: AuthenticatedRequest) {
    await this.limits.assertHit(RATE_LIMITS.adminActor, actor.id);
    await this.authorization.assertCanManageUser(actor, id);
    const revoked = await this.sessions.revokeAllForUser(id, 'ADMIN_REVOKED');
    await this.audit.record({ action: 'session.revoked_by_admin', outcome: 'success', actorUserId: actor.id, targetUserId: id, companyId: actor.companyId, req, context: { revoked } });
    return { revoked };
  }

  @Get('events')
  @RequirePermission('admin.audit.read')
  async events(@Query() query: EventsQuery, @CurrentUser() actor: AuthUser) {
    const where: Prisma.SecurityEventWhereInput = {
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.userId ? { OR: [{ targetUserId: query.userId }, { actorUserId: query.userId }] } : {}),
    };
    if (!actor.isSystemAdmin) {
      const members = await this.prisma.companyMembership.findMany({ where: { companyId: actor.companyId ?? '__none__' }, select: { userId: true } });
      const ids = members.map((m) => m.userId);
      where.AND = [{ OR: [{ companyId: actor.companyId }, { targetUserId: { in: ids } }] }];
    }
    return this.prisma.securityEvent.findMany({ where, orderBy: { createdAt: 'desc' }, take: query.take ?? 100 });
  }

  @Get('policy')
  @RequirePermission('identity.security.read')
  getPolicy() {
    return this.policy.get(true);
  }

  @RequireRecentAuth()
  @Patch('policy')
  async updatePolicy(@Body() dto: PolicyDto, @CurrentUser() actor: AuthUser, @Req() req: AuthenticatedRequest) {
    if (!actor.isSystemAdmin) throw new AuthError('FORBIDDEN', 'Only system administrators can change the authentication policy');
    return this.policy.update(actor, dto, req);
  }

  // ------------------------------------------------------------ invitations

  @Get('invitations')
  @RequirePermission('identity.users.read')
  invitations(@CurrentUser() actor: AuthUser) {
    return this.prisma.invitation.findMany({
      where: actor.isSystemAdmin ? {} : { companyId: actor.companyId ?? '__none__' },
      select: { id: true, email: true, companyId: true, roleId: true, expiresAt: true, redeemedAt: true, revokedAt: true, createdAt: true, company: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  @RequireRecentAuth()
  @Post('invitations')
  @RequirePermission('identity.users.create')
  invite(@Body() dto: InvitationDto, @CurrentUser() actor: AuthUser, @Req() req: AuthenticatedRequest) {
    return this.tokens.invite(actor, dto, req);
  }

  @Post('invitations/:id/revoke')
  @HttpCode(204)
  @RequirePermission('identity.users.create')
  async revokeInvitation(@Param('id') id: string, @CurrentUser() actor: AuthUser, @Req() req: AuthenticatedRequest) {
    await this.tokens.revokeInvitation(actor, id, req);
  }

  // ------------------------------------------------------------ MFA recovery requests

  @Get('recovery-requests')
  @RequirePermission('identity.security.read')
  recoveryRequests(@CurrentUser() actor: AuthUser) {
    return this.recovery.list(actor);
  }

  @RequireRecentAuth()
  @Post('recovery-requests')
  @RequirePermission('identity.security.update')
  createRecovery(@Body() dto: RecoveryRequestDto, @CurrentUser() actor: AuthUser, @Req() req: AuthenticatedRequest) {
    return this.recovery.create(actor, dto, req);
  }

  @RequireRecentAuth()
  @Post('recovery-requests/:id/approve')
  @HttpCode(200)
  @RequirePermission('identity.security.approve')
  approveRecovery(@Param('id') id: string, @CurrentUser() actor: AuthUser, @Req() req: AuthenticatedRequest) {
    return this.recovery.approve(actor, id, req);
  }

  @RequireRecentAuth()
  @Post('recovery-requests/:id/reject')
  @HttpCode(204)
  @RequirePermission('identity.security.update')
  async rejectRecovery(@Param('id') id: string, @CurrentUser() actor: AuthUser, @Req() req: AuthenticatedRequest) {
    await this.recovery.reject(actor, id, req);
  }

  @RequireRecentAuth()
  @Post('recovery-requests/:id/complete')
  @HttpCode(204)
  @RequirePermission('identity.security.update')
  async completeRecovery(@Param('id') id: string, @CurrentUser() actor: AuthUser, @Req() req: AuthenticatedRequest) {
    await this.recovery.complete(actor, id, req);
  }
}
