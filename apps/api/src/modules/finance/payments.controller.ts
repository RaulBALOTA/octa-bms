import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { CompanyId, RequirePermission } from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PageQueryDto, paged } from '../../common/pagination';

class AllocationDto {
  @IsString() invoiceId!: string;
  @IsNumberString() amount!: string;
}

class CreatePaymentDto {
  @IsString() bankAccountId!: string;
  @IsDateString() paymentDate!: string;
  @IsNumberString() amount!: string;
  @IsIn(['IN', 'OUT']) direction!: 'IN' | 'OUT';
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() counterparty?: string;

  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => AllocationDto)
  allocations!: AllocationDto[];
}

class CreateBankAccountDto {
  @IsString() name!: string;
  @IsString() iban!: string;
  @IsOptional() @IsString() bic?: string;
  @IsOptional() @IsNumberString() openingBalance?: string;
}

@ApiTags('finance')
@ApiBearerAuth()
@Controller('finance')
export class PaymentsController {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------ bank accounts

  @Get('bank-accounts')
  @RequirePermission('finance.payments.read')
  async bankAccounts(@CompanyId() companyId: string) {
    const accounts = await this.prisma.bankAccount.findMany({
      where: { companyId, deletedAt: null, isActive: true },
      include: { payments: { select: { amount: true, direction: true } } },
      orderBy: { name: 'asc' },
    });
    return accounts.map(({ payments, ...account }) => ({
      ...account,
      balance:
        Number(account.openingBalance) +
        payments.reduce(
          (sum, p) => sum + Number(p.amount) * (p.direction === 'IN' ? 1 : -1),
          0,
        ),
    }));
  }

  @Post('bank-accounts')
  @RequirePermission('finance.payments.create')
  createBankAccount(
    @CompanyId() companyId: string,
    @Body() dto: CreateBankAccountDto,
  ) {
    return this.prisma.bankAccount.create({
      data: {
        companyId,
        name: dto.name,
        iban: dto.iban.replace(/\s+/g, '').toUpperCase(),
        bic: dto.bic,
        openingBalance: dto.openingBalance ?? '0',
      },
    });
  }

  // ---------------------------------------------------------------- payments

  @Get('payments')
  @RequirePermission('finance.payments.read')
  async list(@CompanyId() companyId: string, @Query() query: PageQueryDto) {
    const where = {
      bankAccount: { companyId },
      ...(query.q
        ? {
            OR: [
              { reference: { contains: query.q, mode: 'insensitive' as const } },
              { counterparty: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: {
          bankAccount: { select: { id: true, name: true } },
          allocations: {
            include: {
              invoice: {
                select: {
                  id: true,
                  invoiceNumber: true,
                  partner: { select: { name: true } },
                },
              },
            },
          },
        },
        skip: query.skip,
        take: query.pageSize,
        orderBy: { paymentDate: 'desc' },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return paged(data, total, query);
  }

  /**
   * Records a bank movement and settles the allocated invoices atomically.
   * Invoice status follows the paid amount: >= gross → PAID, > 0 → PARTIALLY_PAID.
   */
  @Post('payments')
  @RequirePermission('finance.payments.create')
  async create(@CompanyId() companyId: string, @Body() dto: CreatePaymentDto) {
    const allocatedCents = dto.allocations.reduce(
      (sum, a) => sum + Math.round(Number(a.amount) * 100),
      0,
    );
    const paymentCents = Math.round(Number(dto.amount) * 100);
    if (allocatedCents > paymentCents) {
      throw new UnprocessableEntityException({
        code: 'OVERALLOCATED',
        message: 'Allocations exceed the payment amount',
      });
    }

    const invoices = await this.prisma.invoice.findMany({
      where: {
        id: { in: dto.allocations.map((a) => a.invoiceId) },
        companyId,
        deletedAt: null,
      },
    });
    const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
    const expectedDirection = dto.direction === 'IN' ? 'OUTGOING' : 'INCOMING';

    for (const allocation of dto.allocations) {
      const invoice = invoiceById.get(allocation.invoiceId);
      if (!invoice) {
        throw new UnprocessableEntityException({
          code: 'INVOICE_NOT_FOUND',
          message: `Unknown invoice ${allocation.invoiceId}`,
        });
      }
      if (invoice.direction !== expectedDirection) {
        throw new UnprocessableEntityException({
          code: 'DIRECTION_MISMATCH',
          message: `${invoice.invoiceNumber}: an ${dto.direction} payment settles ${expectedDirection} invoices`,
        });
      }
      if (!['SENT', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status)) {
        throw new UnprocessableEntityException({
          code: 'INVOICE_NOT_OPEN',
          message: `${invoice.invoiceNumber} is ${invoice.status} — not open for settlement`,
        });
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          bankAccountId: dto.bankAccountId,
          paymentDate: new Date(dto.paymentDate),
          amount: dto.amount,
          direction: dto.direction,
          reference: dto.reference,
          counterparty: dto.counterparty,
          allocations: {
            create: dto.allocations.map((a) => ({
              invoiceId: a.invoiceId,
              amount: a.amount,
            })),
          },
        },
        include: { allocations: true },
      });

      for (const allocation of dto.allocations) {
        const invoice = invoiceById.get(allocation.invoiceId)!;
        const paidCents =
          Math.round(Number(invoice.paidAmount) * 100) +
          Math.round(Number(allocation.amount) * 100);
        const grossCents = Math.round(Number(invoice.grossAmount) * 100);
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            paidAmount: (paidCents / 100).toFixed(2),
            status: paidCents >= grossCents ? 'PAID' : 'PARTIALLY_PAID',
          },
        });
      }

      return payment;
    });
  }
}
