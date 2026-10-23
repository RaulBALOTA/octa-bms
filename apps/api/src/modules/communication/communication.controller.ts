import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UnprocessableEntityException,
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
import { AiGatewayService } from '../ai/ai-gateway.service';
import { SearchIndexService } from '../search/search-index.service';
import { OutboundService } from './outbound.service';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbound: OutboundService,
    private readonly searchIndex: SearchIndexService,
    private readonly ai: AiGatewayService,
  ) {}

  // ------------------------------------------------------------ integrations

  @Get('integrations')
  @RequirePermission('admin.settings.read')
  async integrations() {
    return {
      entraSso: Boolean(
        process.env.ENTRA_TENANT_ID &&
          process.env.ENTRA_CLIENT_ID &&
          process.env.ENTRA_CLIENT_SECRET,
      ),
      graphMail: this.outbound.graphMailEnabled,
      teamsWebhook: this.outbound.teamsEnabled,
      meilisearch: await this.searchIndex.isAvailable(),
      ai: this.ai.enabled,
    };
  }

  @Post('integrations/test-teams')
  @RequirePermission('admin.settings.update')
  async testTeams() {
    const ok = await this.outbound.postToTeams(
      'OCTA BMS — Testnachricht',
      'Die Teams-Integration funktioniert. ✅',
    );
    if (!ok) {
      throw new UnprocessableEntityException({
        code: 'TEAMS_FAILED',
        message: 'Teams webhook is not configured or unreachable',
      });
    }
    return { ok: true };
  }

  @Post('integrations/test-mail')
  @RequirePermission('admin.settings.update')
  async testMail(@Body() body: { to: string }) {
    if (!body.to?.includes('@')) {
      throw new UnprocessableEntityException({
        code: 'INVALID_RECIPIENT',
        message: 'Provide a recipient email in "to"',
      });
    }
    const ok = await this.outbound.sendMail(
      body.to,
      'OCTA BMS — Testmail',
      'Die Microsoft Graph Mail-Integration funktioniert.',
    );
    if (!ok) {
      throw new UnprocessableEntityException({
        code: 'GRAPH_MAIL_FAILED',
        message: 'Graph mail is not configured or the send failed',
      });
    }
    return { ok: true };
  }

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

  /**
   * Sends a templated email via Graph mail. Placeholders like {name} and
   * {company} are replaced from `variables`. When a partner is given, the
   * send is logged as an EMAIL activity on that partner's CRM timeline.
   */
  @Post('email-templates/:id/send')
  @RequirePermission('communication.mail.create')
  async sendTemplate(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body: {
      to: string;
      language?: 'de' | 'en';
      partnerId?: string;
      variables?: Record<string, string>;
    },
  ) {
    if (!body.to?.includes('@')) {
      throw new UnprocessableEntityException({
        code: 'INVALID_RECIPIENT',
        message: 'Provide a recipient email in "to"',
      });
    }
    const template = await this.prisma.emailTemplate.findUniqueOrThrow({
      where: { id },
    });
    const render = (text: string) =>
      text.replace(/\{(\w+)\}/g, (match, key: string) =>
        body.variables?.[key] !== undefined ? body.variables[key] : match,
      );
    const de = body.language !== 'en';
    const subject = render(de ? template.subjectDe : template.subjectEn);
    const mailBody = render(de ? template.bodyDe : template.bodyEn);

    const sent = await this.outbound.sendMail(body.to, subject, mailBody);
    if (!sent) {
      throw new UnprocessableEntityException({
        code: 'GRAPH_MAIL_FAILED',
        message:
          'Sending failed — Microsoft Graph mail is not configured (ENTRA_* + GRAPH_SENDER_UPN) or rejected the message',
      });
    }

    // log on the partner's CRM timeline
    if (body.partnerId) {
      const partner = await this.prisma.businessPartner.findFirst({
        where: { id: body.partnerId, companyId, deletedAt: null },
      });
      if (partner) {
        const employee = await this.prisma.employee.findFirst({
          where: { userId: user.id, deletedAt: null },
          select: { id: true },
        });
        await this.prisma.crmActivity.create({
          data: {
            partnerId: partner.id,
            type: 'EMAIL',
            subject: `E-Mail: ${subject}`,
            description: `An ${body.to} (Vorlage „${template.name}")`,
            activityDate: new Date(),
            ownerId: employee?.id,
            createdById: user.id,
          },
        });
      }
    }
    return { ok: true, subject };
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
