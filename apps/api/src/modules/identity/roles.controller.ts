import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { RequirePermission } from '../../core/auth/decorators';
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
  constructor(private readonly prisma: PrismaService) {}

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
  async assign(@Body() dto: AssignRoleDto) {
    return this.prisma.userRole.create({
      data: {
        userId: dto.userId,
        roleId: dto.roleId,
        companyId: dto.companyId ?? null,
      },
    });
  }

  @Post(':id/revoke/:userRoleId')
  @RequirePermission('identity.roles.update')
  async revoke(@Param('userRoleId') userRoleId: string) {
    await this.prisma.userRole.delete({ where: { id: userRoleId } });
    return { ok: true };
  }
}
