import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';
import {
  AuthUser,
  CurrentUser,
  RequirePermission,
} from '../../core/auth/decorators';
import { RbacService } from '../../core/rbac/rbac.service';
import { PrismaService } from '../../core/prisma/prisma.service';

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
    private readonly rbac: RbacService,
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
  @RequirePermission('identity.roles.create')
  async create(@Body() dto: CreateRoleDto) {
    const permissions = await this.prisma.permission.findMany({
      where: { code: { in: dto.permissionCodes } },
    });
    return this.prisma.role.create({
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
  }

  @Post('assign')
  @RequirePermission('identity.roles.update')
  async assign(@CurrentUser() user: AuthUser, @Body() dto: AssignRoleDto) {
    const companyId = dto.companyId ?? null;
    // Global assignments apply in every company, and other companies are out
    // of the caller's reach: only system administrators may grant those.
    if (!user.isSystemAdmin && companyId !== user.companyId) {
      throw new ForbiddenException(
        'Roles can only be assigned within the active company',
      );
    }
    if (companyId) {
      const member = await this.prisma.companyMembership.findFirst({
        where: { userId: dto.userId, companyId },
      });
      if (!member) {
        throw new NotFoundException('User is not a member of this company');
      }
    }
    const assignment = await this.prisma.userRole.create({
      data: { userId: dto.userId, roleId: dto.roleId, companyId },
    });
    this.rbac.invalidate(dto.userId);
    return assignment;
  }

  @Post(':id/revoke/:userRoleId')
  @RequirePermission('identity.roles.update')
  async revoke(
    @CurrentUser() user: AuthUser,
    @Param('id') roleId: string,
    @Param('userRoleId') userRoleId: string,
  ) {
    const assignment = await this.prisma.userRole.findFirst({
      where: { id: userRoleId, roleId },
    });
    if (!assignment) throw new NotFoundException('Role assignment not found');
    if (!user.isSystemAdmin && assignment.companyId !== user.companyId) {
      throw new ForbiddenException(
        'Roles can only be revoked within the active company',
      );
    }
    await this.prisma.userRole.delete({ where: { id: userRoleId } });
    // drop cached permissions so the revocation applies on the next request
    this.rbac.invalidate(assignment.userId);
    return { ok: true };
  }
}
