import {
  Body,
  Controller,
  Delete,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  UnprocessableEntityException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  IsDateString,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  AuthUser,
  CompanyId,
  CurrentUser,
  RequirePermission,
} from '../../core/auth/decorators';
import { requireInCompany } from '../../common/tenant-scope';
import { PrismaService } from '../../core/prisma/prisma.service';
import { InvoicesService } from '../finance/invoices.service';

const UPLOAD_DIR = join(process.cwd(), 'uploads');

class CreateObligationDto {
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsIn(['NONE', 'MONTHLY', 'QUARTERLY', 'YEARLY']) recurrence?: string;
}

class CreateMilestoneDto {
  @IsString() title!: string;
  @IsNumberString() amount!: string;
  @IsOptional() @IsNumberString() percentage?: string;
  @IsOptional() @IsDateString() dueDate?: string;
}

class CreateVariationOrderDto {
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsNumberString() amount!: string;
}

class CreateClaimDto {
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsIn(['OUTGOING', 'INCOMING']) direction!: string;
  @IsOptional() @IsNumberString() amount?: string;
}

@ApiTags('contracts')
@ApiBearerAuth()
@Controller('contracts')
export class ContractItemsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
  ) {}

  private async assertContract(companyId: string, contractId: string) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, companyId, deletedAt: null },
    });
    if (!contract) throw new NotFoundException('Contract not found');
    return contract;
  }

  // -------------------------------------------------------------- obligations

  @Post(':id/obligations')
  @RequirePermission('contracts.contracts.update')
  async addObligation(
    @CompanyId() companyId: string,
    @Param('id') contractId: string,
    @Body() dto: CreateObligationDto,
  ) {
    await this.assertContract(companyId, contractId);
    return this.prisma.contractObligation.create({
      data: {
        contractId,
        title: dto.title,
        description: dto.description,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        recurrence: dto.recurrence,
      },
    });
  }

  @Patch('obligations/:id/fulfill')
  @RequirePermission('contracts.contracts.update')
  async fulfillObligation(@CompanyId() companyId: string, @Param('id') id: string) {
    const obligation = await requireInCompany(
      this.prisma.contractObligation.findFirst({
        where: { id, contract: { companyId } },
      }),
      'Obligation',
    );
    return this.prisma.contractObligation.update({
      where: { id },
      data: {
        isFulfilled: !obligation.isFulfilled,
        fulfilledAt: obligation.isFulfilled ? null : new Date(),
      },
    });
  }

  // --------------------------------------------------------------- milestones

  @Post(':id/milestones')
  @RequirePermission('contracts.contracts.update')
  async addMilestone(
    @CompanyId() companyId: string,
    @Param('id') contractId: string,
    @Body() dto: CreateMilestoneDto,
  ) {
    const contract = await this.assertContract(companyId, contractId);
    // Σ milestones must not exceed the contract value (doc 05 invariant)
    if (contract.value) {
      const existing = await this.prisma.paymentMilestone.aggregate({
        where: { contractId },
        _sum: { amount: true },
      });
      const total = Number(existing._sum.amount ?? 0) + Number(dto.amount);
      if (total > Number(contract.value) + 0.005) {
        throw new UnprocessableEntityException({
          code: 'MILESTONES_EXCEED_VALUE',
          message: `Milestones (${total.toFixed(2)}) would exceed the contract value (${contract.value})`,
        });
      }
    }
    return this.prisma.paymentMilestone.create({
      data: {
        contractId,
        title: dto.title,
        amount: dto.amount,
        percentage: dto.percentage,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
    });
  }

  @Delete('milestones/:id')
  @RequirePermission('contracts.contracts.update')
  @HttpCode(204)
  async removeMilestone(@CompanyId() companyId: string, @Param('id') id: string) {
    const milestone = await requireInCompany(
      this.prisma.paymentMilestone.findFirst({
        where: { id, contract: { companyId } },
      }),
      'Milestone',
    );
    if (milestone.isInvoiced) {
      throw new UnprocessableEntityException({
        code: 'MILESTONE_INVOICED',
        message: 'An invoiced milestone cannot be deleted',
      });
    }
    await this.prisma.paymentMilestone.delete({ where: { id } });
  }

  /** Generates a draft outgoing invoice from a payment milestone. */
  @Post('milestones/:id/invoice')
  @RequirePermission('finance.invoices.create')
  async invoiceMilestone(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    const milestone = await requireInCompany(
      this.prisma.paymentMilestone.findFirst({
        where: { id, contract: { companyId } },
        include: { contract: true },
      }),
      'Milestone',
    );
    if (milestone.isInvoiced) {
      throw new UnprocessableEntityException({
        code: 'MILESTONE_INVOICED',
        message: 'Milestone is already invoiced',
      });
    }
    if (!milestone.contract.partnerId) {
      throw new UnprocessableEntityException({
        code: 'CONTRACT_HAS_NO_PARTNER',
        message: 'The contract has no partner to invoice',
      });
    }

    const taxCode = await this.prisma.taxCode.findUniqueOrThrow({
      where: { code: 'DE-19' },
    });
    const today = new Date().toISOString().slice(0, 10);
    const due = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

    const invoice = await this.invoices.create(companyId, user.id, {
      direction: 'OUTGOING',
      partnerId: milestone.contract.partnerId,
      invoiceDate: today,
      serviceDate: today,
      dueDate: due,
      reference: milestone.contract.contractNumber,
      contractId: milestone.contractId,
      lines: [
        {
          description: `${milestone.title} — ${milestone.contract.title} (${milestone.contract.contractNumber})`,
          quantity: '1',
          unit: 'LS',
          unitPrice: String(milestone.amount),
          taxCodeId: taxCode.id,
        },
      ],
    });

    await this.prisma.paymentMilestone.update({
      where: { id },
      data: { isInvoiced: true, invoiceId: invoice.id },
    });

    return invoice;
  }

  // --------------------------------------------------------- variation orders

  @Post(':id/variation-orders')
  @RequirePermission('contracts.contracts.update')
  async addVariationOrder(
    @CompanyId() companyId: string,
    @Param('id') contractId: string,
    @Body() dto: CreateVariationOrderDto,
  ) {
    await this.assertContract(companyId, contractId);
    const count = await this.prisma.variationOrder.count({ where: { contractId } });
    return this.prisma.variationOrder.create({
      data: {
        contractId,
        voNumber: `VO-${String(count + 1).padStart(2, '0')}`,
        title: dto.title,
        description: dto.description,
        amount: dto.amount,
      },
    });
  }

  @Patch('variation-orders/:id/status')
  @RequirePermission('contracts.contracts.update')
  async updateVariationOrder(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body() body: { status: 'SUBMITTED' | 'APPROVED' | 'REJECTED' },
  ) {
    if (!['SUBMITTED', 'APPROVED', 'REJECTED'].includes(body.status)) {
      throw new UnprocessableEntityException({
        code: 'INVALID_STATUS',
        message: 'status must be SUBMITTED, APPROVED or REJECTED',
      });
    }
    const vo = await requireInCompany(
      this.prisma.variationOrder.findFirst({
        where: { id, contract: { companyId } },
        include: { contract: { select: { id: true, value: true } } },
      }),
      'Variation order',
    );
    if (vo.status === 'APPROVED') {
      throw new UnprocessableEntityException({
        code: 'VO_ALREADY_APPROVED',
        message: 'An approved variation order is final',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.variationOrder.update({
        where: { id },
        data: {
          status: body.status,
          submittedAt: body.status === 'SUBMITTED' ? new Date() : undefined,
          decidedAt: ['APPROVED', 'REJECTED'].includes(body.status)
            ? new Date()
            : undefined,
        },
      });
      // an approved VO increases the effective contract value
      if (body.status === 'APPROVED') {
        const newValue = Number(vo.contract.value ?? 0) + Number(vo.amount);
        await tx.contract.update({
          where: { id: vo.contract.id },
          data: { value: newValue.toFixed(2) },
        });
      }
      return updated;
    });
  }

  // ------------------------------------------------------------------- claims

  @Post(':id/claims')
  @RequirePermission('contracts.contracts.update')
  async addClaim(
    @CompanyId() companyId: string,
    @Param('id') contractId: string,
    @Body() dto: CreateClaimDto,
  ) {
    await this.assertContract(companyId, contractId);
    const count = await this.prisma.claim.count({ where: { contractId } });
    return this.prisma.claim.create({
      data: {
        contractId,
        claimNumber: `CL-${String(count + 1).padStart(2, '0')}`,
        title: dto.title,
        description: dto.description,
        direction: dto.direction,
        amount: dto.amount,
        notifiedAt: new Date(),
        status: 'NOTIFIED',
      },
    });
  }

  @Patch('claims/:id/status')
  @RequirePermission('contracts.contracts.update')
  async updateClaim(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body() body: { status: string; settledAmount?: string },
  ) {
    const allowed = ['OPEN', 'NOTIFIED', 'NEGOTIATION', 'SETTLED', 'REJECTED', 'LITIGATION'];
    if (!allowed.includes(body.status)) {
      throw new UnprocessableEntityException({
        code: 'INVALID_STATUS',
        message: `status must be one of ${allowed.join(', ')}`,
      });
    }
    await requireInCompany(
      this.prisma.claim.findFirst({
        where: { id, contract: { companyId } },
        select: { id: true },
      }),
      'Claim',
    );
    return this.prisma.claim.update({
      where: { id },
      data: {
        status: body.status,
        settledAt: body.status === 'SETTLED' ? new Date() : undefined,
        settledAmount: body.status === 'SETTLED' ? body.settledAmount : undefined,
      },
    });
  }

  // ----------------------------------------------------------------- versions

  /** Uploads a contract file as a new version (stored via the DMS tables). */
  @Post(':id/versions')
  @RequirePermission('contracts.contracts.update')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async addVersion(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') contractId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { note?: string },
  ) {
    await this.assertContract(companyId, contractId);

    let fileId: string | undefined;
    if (file) {
      if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
      const storageKey = `${randomUUID()}-${file.originalname.replace(/[^\w.\-]/g, '_')}`;
      writeFileSync(join(UPLOAD_DIR, storageKey), file.buffer);
      const document = await this.prisma.document.create({
        data: {
          companyId,
          name: file.originalname,
          entityType: 'contract',
          entityId: contractId,
          createdById: user.id,
          versions: {
            create: {
              version: 1,
              fileName: file.originalname,
              mimeType: file.mimetype,
              sizeBytes: file.size,
              storageKey,
              checksum: createHash('sha256').update(file.buffer).digest('hex'),
              createdById: user.id,
            },
          },
        },
      });
      fileId = document.id;
    }

    const last = await this.prisma.contractVersion.findFirst({
      where: { contractId },
      orderBy: { version: 'desc' },
    });
    return this.prisma.contractVersion.create({
      data: {
        contractId,
        version: (last?.version ?? 0) + 1,
        fileId,
        changeNote: body.note,
        createdById: user.id,
      },
    });
  }
}
