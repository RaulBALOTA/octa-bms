import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import {
  AuthUser,
  CompanyId,
  CurrentUser,
  RequirePermission,
} from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';

class UpsertTemplateDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsString() subjectDe!: string;
  @IsString() subjectEn!: string;
  @IsString() bodyDe!: string;
  @IsString() bodyEn!: string;
  @IsOptional() @IsString() module?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class UpdateTemplateDto extends UpsertTemplateDto {
  @IsOptional() @IsString() declare code: string;
  @IsOptional() @IsString() declare name: string;
  @IsOptional() @IsString() declare subjectDe: string;
  @IsOptional() @IsString() declare subjectEn: string;
  @IsOptional() @IsString() declare bodyDe: string;
  @IsOptional() @IsString() declare bodyEn: string;
}

@ApiTags('communication')
@ApiBearerAuth()
@Controller('communication')
export class CommunicationController {
  constructor(private readonly prisma: PrismaService) {}

  // --------------------------------------------------------- email templates

  @Get('email-templates')
  @RequirePermission('admin.settings.read')
  templates() {
    return this.prisma.emailTemplate.findMany({ orderBy: { code: 'asc' } });
  }

  @Post('email-templates')
  @RequirePermission('admin.settings.update')
  createTemplate(@Body() dto: UpsertTemplateDto) {
    return this.prisma.emailTemplate.create({ data: dto });
  }

  @Patch('email-templates/:id')
  @RequirePermission('admin.settings.update')
  updateTemplate(@Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.prisma.emailTemplate.update({ where: { id }, data: dto });
  }

  // ------------------------------------------------------------ activity feed

  /** Company-wide activity stream derived from the audit trail. */
  @Get('activity')
  @RequirePermission('admin.audit.read')
  async activity(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Query('limit') limit = '50',
  ) {
    const logs = await this.prisma.auditLog.findMany({
      where: { companyId, action: { in: ['CREATE', 'UPDATE', 'DELETE'] } },
      include: {
        user: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit) || 50, 200),
    });
    return logs.map((log) => ({
      id: log.id,
      actor: log.user ? `${log.user.firstName} ${log.user.lastName}` : 'System',
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      createdAt: log.createdAt,
    }));
  }
}
