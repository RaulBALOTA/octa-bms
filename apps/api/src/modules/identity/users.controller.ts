import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import * as argon2 from 'argon2';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import {
  AuthUser,
  CurrentUser,
  RequirePermission,
} from '../../core/auth/decorators';
import { requireInCompany } from '../../common/tenant-scope';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PageQueryDto, paged } from '../../common/pagination';

class CreateUserDto {
  @IsEmail() email!: string;
  @IsString() firstName!: string;
  @IsString() lastName!: string;
  @IsString() @MinLength(12) password!: string;
  @IsOptional() @IsString() locale?: string;
}

class UpdateUserDto {
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() locale?: string;
  @IsOptional() @IsString() theme?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/**
 * Company administrators see and manage the users of their active company;
 * only system administrators reach users across all companies.
 */
function visibleUsers(caller: AuthUser) {
  return caller.isSystemAdmin
    ? {}
    : { memberships: { some: { companyId: caller.companyId ?? '' } } };
}

const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  displayName: true,
  locale: true,
  theme: true,
  isActive: true,
  isSystemAdmin: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

@ApiTags('identity')
@ApiBearerAuth()
@Controller('identity/users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('identity.users.read')
  async list(@CurrentUser() caller: AuthUser, @Query() query: PageQueryDto) {
    const where = {
      deletedAt: null,
      ...visibleUsers(caller),
      ...(query.q
        ? {
            OR: [
              { email: { contains: query.q, mode: 'insensitive' as const } },
              { lastName: { contains: query.q, mode: 'insensitive' as const } },
              { firstName: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        skip: query.skip,
        take: query.pageSize,
        orderBy: query.orderBy(['email', 'lastName', 'createdAt', 'lastLoginAt']),
      }),
      this.prisma.user.count({ where }),
    ]);
    return paged(data, total, query);
  }

  @Get(':id')
  @RequirePermission('identity.users.read')
  async get(@CurrentUser() caller: AuthUser, @Param('id') id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null, ...visibleUsers(caller) },
      select: {
        ...USER_SELECT,
        userRoles: {
          select: {
            id: true,
            companyId: true,
            role: { select: { id: true, code: true, name: true } },
          },
        },
        memberships: {
          select: { company: { select: { id: true, code: true, name: true } } },
        },
      },
    });
    if (!user) throw new NotFoundException();
    return user;
  }

  @Post()
  @RequirePermission('identity.users.create')
  async create(@CurrentUser() caller: AuthUser, @Body() dto: CreateUserDto) {
    const passwordHash = await argon2.hash(dto.password);
    return this.prisma.user.create({
      data: {
        // join the active company, so the new user is visible to its admins
        ...(caller.companyId
          ? { memberships: { create: { companyId: caller.companyId, isDefault: true } } }
          : {}),
        email: dto.email.toLowerCase(),
        firstName: dto.firstName,
        lastName: dto.lastName,
        displayName: `${dto.firstName} ${dto.lastName}`,
        locale: dto.locale ?? 'de',
        passwordHash,
      },
      select: USER_SELECT,
    });
  }

  @Patch(':id')
  @RequirePermission('identity.users.update')
  async update(
    @CurrentUser() caller: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    await requireInCompany(
      this.prisma.user.findFirst({
        where: { id, deletedAt: null, ...visibleUsers(caller) },
        select: { id: true },
      }),
      'User',
    );
    return this.prisma.user.update({
      where: { id },
      data: dto,
      select: USER_SELECT,
    });
  }
}
