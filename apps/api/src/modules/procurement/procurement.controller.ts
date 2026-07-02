import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, PurchaseStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import {
  AuthUser,
  CompanyId,
  CurrentUser,
  RequirePermission,
} from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PageQueryDto, paged } from '../../common/pagination';
import { NumberSequenceService } from '../master-data/number-sequence.service';

class RequestItemDto {
  @IsString() description!: string;
  @IsNumberString() quantity!: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsNumberString() estimatedPrice?: string;
}

class CreateRequestDto {
  @IsIn(['IT', 'SOFTWARE', 'OFFICE', 'VEHICLE', 'FURNITURE', 'SERVICE', 'OTHER'])
  category!: string;
  @IsOptional() @IsString() justification?: string;
  @IsOptional() @IsDateString() neededBy?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RequestItemDto)
  items!: RequestItemDto[];
}

class ListRequestsQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: PurchaseStatus })
  @IsOptional()
  @IsEnum(PurchaseStatus)
  status?: PurchaseStatus;
}

@ApiTags('procurement')
@ApiBearerAuth()
@Controller('procurement/requests')
export class ProcurementController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: NumberSequenceService,
    private readonly events: EventEmitter2,
  ) {}

  @Get()
  @RequirePermission('procurement.requests.read')
  async list(@CompanyId() companyId: string, @Query() query: ListRequestsQuery) {
    const where: Prisma.PurchaseRequestWhereInput = {
      companyId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { requestNumber: { contains: query.q, mode: 'insensitive' } },
              { justification: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.purchaseRequest.findMany({
        where,
        include: { items: true },
        skip: query.skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.purchaseRequest.count({ where }),
    ]);
    return paged(data, total, query);
  }

  @Get(':id')
  @RequirePermission('procurement.requests.read')
  async get(@CompanyId() companyId: string, @Param('id') id: string) {
    const request = await this.prisma.purchaseRequest.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { items: true, orders: true },
    });
    if (!request) throw new NotFoundException();
    return request;
  }

  @Post()
  @RequirePermission('procurement.requests.create')
  async create(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateRequestDto,
  ) {
    const totalEstimate = dto.items.reduce(
      (sum, item) =>
        sum + Number(item.quantity) * Number(item.estimatedPrice ?? 0),
      0,
    );
    return this.prisma.$transaction(async (tx) => {
      const requestNumber = await this.sequences.next(
        tx,
        companyId,
        'purchase-request',
        'PR',
      );
      return tx.purchaseRequest.create({
        data: {
          companyId,
          requestNumber,
          requesterId: user.id,
          category: dto.category,
          justification: dto.justification,
          neededBy: dto.neededBy ? new Date(dto.neededBy) : undefined,
          totalEstimate: totalEstimate.toFixed(2),
          createdById: user.id,
          items: {
            create: dto.items.map((item) => ({
              description: item.description,
              quantity: item.quantity,
              unit: item.unit ?? 'pcs',
              estimatedPrice: item.estimatedPrice,
            })),
          },
        },
        include: { items: true },
      });
    });
  }

  @Post(':id/submit')
  @RequirePermission('procurement.requests.update')
  async submit(@CompanyId() companyId: string, @Param('id') id: string) {
    const request = await this.get(companyId, id);
    if (request.status !== 'DRAFT') {
      throw new UnprocessableEntityException({
        code: 'PR_NOT_DRAFT',
        message: `Request is ${request.status}`,
      });
    }
    const updated = await this.prisma.purchaseRequest.update({
      where: { id },
      data: { status: 'SUBMITTED' },
    });
    this.events.emit('procurement.request.submitted', {
      requestId: id,
      companyId,
    });
    return updated;
  }

  @Post(':id/decide')
  @RequirePermission('procurement.requests.approve')
  async decide(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body() body: { decision: 'APPROVED' | 'REJECTED' },
  ) {
    const request = await this.get(companyId, id);
    if (request.status !== 'SUBMITTED') {
      throw new UnprocessableEntityException({
        code: 'PR_NOT_SUBMITTED',
        message: `Request is ${request.status}`,
      });
    }
    if (!['APPROVED', 'REJECTED'].includes(body.decision)) {
      throw new UnprocessableEntityException({
        code: 'INVALID_DECISION',
        message: 'decision must be APPROVED or REJECTED',
      });
    }
    return this.prisma.purchaseRequest.update({
      where: { id },
      data: { status: body.decision },
    });
  }
}
