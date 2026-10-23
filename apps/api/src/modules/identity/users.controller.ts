import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import type { Prisma } from '@prisma/client';
import { type AuthenticatedRequest, type AuthUser, CurrentUser, RequirePermission, RequireRecentAuth } from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuthError } from '../../core/security/auth-errors';
import { normalizeEmail } from '../../core/security/auth.service';
import { AuthorizationService } from '../../core/security/authorization.service';
import { EmailNotificationService } from '../../core/security/email-notification.service';
import { PasswordService } from '../../core/security/password.service';
import { SecurityAuditService } from '../../core/security/security-audit.service';
import { SessionService } from '../../core/security/session.service';
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
  status: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

@ApiTags('identity')
@ApiBearerAuth()
@Controller('identity/users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly authorization: AuthorizationService,
    private readonly audit: SecurityAuditService,
    private readonly email: EmailNotificationService,
  ) {}

  /** Company admins see members of their active company only; system admins see all. */
  private scope(actor: AuthUser): Prisma.UserWhereInput {
    return actor.isSystemAdmin ? {} : { memberships: { some: { companyId: actor.companyId ?? '__none__' } } };
  }

  @Get()
  @RequirePermission('identity.users.read')
  async list(@Query() query: PageQueryDto, @CurrentUser() actor: AuthUser) {
    const where = {
      deletedAt: null,
      ...this.scope(actor),
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
  async get(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null, ...this.scope(actor) },
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
  @RequireRecentAuth()
  @RequirePermission('identity.users.create')
  async create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthUser, @Req() req: AuthenticatedRequest) {
    const email = normalizeEmail(dto.email);
    const issues = await this.passwords.validate(dto.password, { email, firstName: dto.firstName, lastName: dto.lastName });
    if (issues.length) throw new AuthError('PASSWORD_POLICY', issues[0], { issues });
    if (!actor.isSystemAdmin && !actor.companyId) throw new AuthError('FORBIDDEN');
    const passwordHash = await this.passwords.hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        displayName: `${dto.firstName} ${dto.lastName}`,
        locale: dto.locale ?? 'de',
        passwordHash,
        passwordChangedAt: new Date(),
        credentialUpdatedAt: new Date(),
        // company admins create members of their own company (no orphan or foreign accounts)
        ...(actor.companyId ? { memberships: { create: { companyId: actor.companyId, isDefault: true } } } : {}),
      },
      select: USER_SELECT,
    });
    await this.audit.record({ action: 'user.created', outcome: 'success', actorUserId: actor.id, targetUserId: user.id, companyId: actor.companyId, req });
    return user;
  }

  @Patch(':id')
  @RequirePermission('identity.users.update')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: AuthUser, @Req() req: AuthenticatedRequest) {
    await this.authorization.assertCanManageUser(actor, id);
    if (dto.isActive === false && id === actor.id) throw new AuthError('FORBIDDEN', 'You cannot disable your own account');
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id }, select: { isActive: true, email: true } });
    const user = await this.prisma.user.update({
      where: { id },
      data: { ...dto, ...(dto.isActive === undefined ? {} : { status: dto.isActive ? 'ACTIVE' : 'DISABLED' }) },
      select: USER_SELECT,
    });
    if (dto.isActive === false && before.isActive) {
      const revoked = await this.sessions.revokeAllForUser(id, 'ACCOUNT_DISABLED');
      await this.prisma.mfaChallenge.updateMany({ where: { userId: id, consumedAt: null }, data: { consumedAt: new Date() } });
      await this.audit.record({ action: 'user.disabled', outcome: 'success', actorUserId: actor.id, targetUserId: id, companyId: actor.companyId, req, context: { sessionsRevoked: revoked } });
      this.email.notify(before.email, { kind: 'account-disabled' }, id);
    } else if (dto.isActive === true && !before.isActive) {
      await this.audit.record({ action: 'user.enabled', outcome: 'success', actorUserId: actor.id, targetUserId: id, companyId: actor.companyId, req });
    }
    return user;
  }
}
