import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  AuthUser,
  CompanyId,
  CurrentUser,
  RequirePermission,
} from '../../core/auth/decorators';
import { AiGatewayService } from './ai-gateway.service';
import { ContextBuilderService } from './context-builder.service';

class EntityRefDto {
  @IsIn(['partner', 'contract', 'opportunity', 'invoice', 'meeting'])
  entityType!: string;
  @IsString() entityId!: string;
  @IsOptional() @IsIn(['de', 'en']) language?: string;
}

class DraftDto extends EntityRefDto {
  @IsIn(['email', 'followup', 'summary-report']) kind!: string;
  @IsOptional() @IsString() @MaxLength(2000) instructions?: string;
}

class ExtractInvoiceDto {
  @IsString() @MaxLength(50_000) text!: string;
}

class AskDto {
  @IsString() @MaxLength(2000) question!: string;
  @IsOptional() @IsIn(['de', 'en']) language?: string;
}

const INVOICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['partnerName', 'invoiceDate', 'dueDate', 'lines'],
  properties: {
    partnerName: { type: 'string', description: 'Name of the issuing company' },
    externalNumber: {
      type: ['string', 'null'],
      description: 'Invoice number printed on the document',
    },
    invoiceDate: { type: 'string', format: 'date' },
    serviceDate: { type: ['string', 'null'], format: 'date' },
    dueDate: { type: 'string', format: 'date' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'quantity', 'unit', 'unitPrice', 'vatRate'],
        properties: {
          description: { type: 'string' },
          quantity: { type: 'number' },
          unit: { type: 'string', description: 'h, day, pcs or LS' },
          unitPrice: { type: 'number', description: 'net unit price' },
          vatRate: { type: 'number', description: 'VAT percent, e.g. 19' },
        },
      },
    },
  },
} as const;

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiGatewayService,
    private readonly contextBuilder: ContextBuilderService,
  ) {}

  @Get('status')
  status() {
    return { enabled: this.ai.enabled, model: this.ai.model };
  }

  private static readonly ENTITY_PERMISSION: Record<string, string> = {
    partner: 'crm.partners.read',
    contract: 'contracts.contracts.read',
    opportunity: 'sales.opportunities.read',
    invoice: 'finance.invoices.read',
    meeting: 'communication.meetings.read',
  };

  /** Checked BEFORE any entity data is fetched. */
  private assertCanRead(user: AuthUser, entityType: string) {
    const permission = AiController.ENTITY_PERMISSION[entityType];
    if (user.isSystemAdmin) return;
    if (!permission || !user.permissions.includes(permission)) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }
  }

  private languageLine(language?: string) {
    return language === 'en' ? 'Respond in English.' : 'Antworte auf Deutsch.';
  }

  @Post('summarize')
  async summarize(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: EntityRefDto,
  ) {
    this.assertCanRead(user, dto.entityType);
    const context = await this.contextBuilder.build(
      companyId,
      dto.entityType,
      dto.entityId,
    );

    const summary = await this.ai.complete({
      feature: 'summarize',
      userId: user.id,
      companyId,
      maxTokens: 2048,
      system:
        'You are the assistant inside OCTA BMS, the business management system of a German engineering consultancy. ' +
        'Summarize the given record for a busy manager: current state, money at stake, open points, risks, and the one next action you recommend. ' +
        'Use only the provided data — never invent facts. Be brief (max ~10 lines, short bullet points). ' +
        this.languageLine(dto.language),
      user: context.text,
    });
    return { title: context.title, summary };
  }

  @Post('draft')
  async draft(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: DraftDto,
  ) {
    this.assertCanRead(user, dto.entityType);
    const context = await this.contextBuilder.build(
      companyId,
      dto.entityType,
      dto.entityId,
    );

    const kindInstruction = {
      email:
        'Draft a professional business email to this partner (German business etiquette: formal Sie form when German). Include subject line. Leave sender name as [Name].',
      followup:
        'Draft a short follow-up message referencing the recent activities, moving the relationship or deal forward.',
      'summary-report':
        'Draft a short management report section about this record: status, financials, risks, outlook.',
    }[dto.kind]!;

    const draft = await this.ai.complete({
      feature: 'draft',
      userId: user.id,
      companyId,
      maxTokens: 2048,
      system:
        'You are the writing assistant inside OCTA BMS for a German engineering consultancy. ' +
        `${kindInstruction} Base it strictly on the provided record. ` +
        this.languageLine(dto.language),
      user:
        context.text +
        (dto.instructions ? `\n\nADDITIONAL INSTRUCTIONS: ${dto.instructions}` : ''),
    });
    return { title: context.title, draft };
  }

  @Post('extract-invoice')
  @RequirePermission('finance.invoices.create')
  async extractInvoice(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ExtractInvoiceDto,
  ) {
    const extracted = await this.ai.complete<Record<string, unknown>>({
      feature: 'extract-invoice',
      userId: user.id,
      companyId,
      maxTokens: 4096,
      jsonSchema: INVOICE_SCHEMA as unknown as Record<string, unknown>,
      system:
        'Extract structured invoice data from the given text (usually a German supplier invoice). ' +
        'Dates as ISO yyyy-mm-dd. Amounts are NET unit prices as numbers with dot decimal. ' +
        'German number format uses comma decimals — convert correctly (1.234,56 → 1234.56). ' +
        'If the service date (Leistungsdatum) is missing, use null. Combine identical positions.',
      user: dto.text,
    });
    return extracted;
  }

  @Post('ask')
  async ask(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: AskDto,
  ) {
    const can = (permission: string) =>
      user.isSystemAdmin || user.permissions.includes(permission);
    const snapshot = await this.contextBuilder.companySnapshot(companyId, can);

    const answer = await this.ai.complete({
      feature: 'ask',
      userId: user.id,
      companyId,
      maxTokens: 3000,
      system:
        'You are the assistant inside OCTA BMS, the business management system of a German engineering consultancy. ' +
        'Answer the user question using ONLY the company data snapshot below. ' +
        'If the snapshot does not contain the answer, say so and name the module where the user could look. ' +
        'Quote concrete numbers, names and record numbers from the data. Be concise. ' +
        this.languageLine(dto.language) +
        '\n\n=== COMPANY DATA SNAPSHOT ===\n' +
        snapshot,
      user: dto.question,
    });
    return { answer };
  }
}
