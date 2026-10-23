import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { type AuthenticatedRequest, type AuthUser, CurrentUser, RequirePermission, RequireRecentAuth } from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RbacService } from '../../core/rbac/rbac.service';
import { AuthError } from '../../core/security/auth-errors';
import { AuthorizationService } from '../../core/security/authorization.service';
import { EmailNotificationService } from '../../core/security/email-notification.service';
import { SecurityAuditService } from '../../core/security/security-audit.service';

class AssignRoleDto {
  @IsString() userId!: string;
  @IsString() roleId!: string;
  @IsOptional() @IsString() companyId?: string;
}

class CreateRoleDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsArray() @IsString({ each: true }) permissionCodes!: string[];
}

@ApiTags('identity')
@ApiBearerAuth()
@Controller('identity/roles')
export class RolesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly rbac: RbacService,
    private readonly audit: SecurityAuditService,
    private readonly email: EmailNotificationService,
  ) {}

  @Get()
  @RequirePermission('identity.roles.read')
  async list() {
    return this.prisma.role.findMany({
      where: { deletedAt: null },
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { userRoles: true } },
      },
      orderBy: { code: 'asc' },
    });
  }

  @Get('permissions')
  @RequirePermission('identity.roles.read')
  async permissions() {
    return this.prisma.permission.findMany({ orderBy: { code: 'asc' } });
  }

  @Post()
  @RequireRecentAuth()
  @RequirePermission('identity.roles.create')
  async create(@Body() dto: CreateRoleDto, @CurrentUser() actor: AuthUser, @Req() req: AuthenticatedRequest) {
    // a role may only bundle permissions the creator holds (no escalation via new roles)
    await this.authorization.assertCanBundlePermissions(actor, dto.permissionCodes);
    const permissions = await this.prisma.permission.findMany({
      where: { code: { in: dto.permissionCodes } },
    });
    const role = await this.prisma.role.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description,
        permissions: {
          create: permissions.map((p) => ({ permissionId: p.id })),
        },
      },
      include: { permissions: { include: { permission: true } } },
    });
    await this.audit.record({ action: 'role.created', outcome: 'success', actorUserId: actor.id, companyId: actor.companyId, req, context: { roleId: role.id, code: role.code, permissions: dto.permissionCodes.length } });
    return role;
  }

  @Post('assign')
  @RequireRecentAuth()
  @RequirePermission('identity.roles.update')
  async assign(@Body() dto: AssignRoleDto, @CurrentUser() actor: AuthUser, @Req() req: AuthenticatedRequest) {
    const companyId = dto.companyId ?? null;
    const role = await this.authorization.assertCanGrantRole(actor, { roleId: dto.roleId, companyId, targetUserId: dto.userId });
    if (companyId) {
      const membership = await this.prisma.companyMembership.findUnique({ where: { userId_companyId: { userId: dto.userId, companyId } } });
      if (!membership) throw new AuthError('FORBIDDEN', 'The user is not a member of this company');
    }
    const assignment = await this.prisma.userRole.create({
      data: { userId: dto.userId, roleId: dto.roleId, companyId },
    });
    this.rbac.invalidate(dto.userId);
    await this.audit.record({ action: 'role.granted', outcome: 'success', actorUserId: actor.id, targetUserId: dto.userId, companyId, req, context: { role: role.code } });
    const target = await this.prisma.user.findUnique({ where: { id: dto.userId }, select: { email: true } });
    if (target) this.email.notify(target.email, { kind: 'role-granted', role: role.name }, dto.userId);
    return assignment;
  }

  @Post(':id/revoke/:userRoleId')
  @RequireRecentAuth()
  @RequirePermission('identity.roles.update')
  async revoke(@Param('userRoleId') userRoleId: string, @CurrentUser() actor: AuthUser, @Req() req: AuthenticatedRequest) {
    const assignment = await this.prisma.userRole.findUnique({ where: { id: userRoleId } });
    if (!assignment) throw new AuthError('FORBIDDEN', 'Assignment not found');
    if (!actor.isSystemAdmin) {
      if (!assignment.companyId || assignment.companyId !== actor.companyId) throw new AuthError('FORBIDDEN', 'Assignment is outside your active company');
      await this.authorization.assertCanManageUser(actor, assignment.userId);
    }
    await this.prisma.userRole.delete({ where: { id: userRoleId } });
    this.rbac.invalidate(assignment.userId);
    await this.audit.record({ action: 'role.revoked', outcome: 'success', actorUserId: actor.id, targetUserId: assignment.userId, companyId: assignment.companyId, req, context: { roleId: assignment.roleId } });
    return { ok: true };
  }
}
