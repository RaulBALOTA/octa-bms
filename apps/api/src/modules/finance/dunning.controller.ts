import {
  Controller,
  Get,
  Param,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CompanyId, RequirePermission } from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';

const MAX_DUNNING_LEVEL = 3;

/**
 * Dunning (Mahnwesen) on top of the open-items aging: overdue outgoing
 * invoices carry a Mahnstufe 0–3. Level advances manually per reminder sent;
 * the printable letter is rendered client-side from the same data.
 */
@ApiTags('finance')
@ApiBearerAuth()
@Controller('finance/dunning')
export class DunningController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('finance.invoices.read')
  async list(@CompanyId() companyId: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        companyId,
        deletedAt: null,
        direction: 'OUTGOING',
        status: { in: ['OVERDUE', 'PARTIALLY_PAID', 'SENT'] },
        dueDate: { lt: new Date() },
      },
      include: { partner: true },
      orderBy: [{ dunningLevel: 'desc' }, { dueDate: 'asc' }],
    });
    const now = Date.now();
    return invoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      partner: invoice.partner,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      grossAmount: invoice.grossAmount,
      paidAmount: invoice.paidAmount,
      open: Number(invoice.grossAmount) - Number(invoice.paidAmount),
      overdueDays: Math.floor((now - invoice.dueDate.getTime()) / 86_400_000),
      dunningLevel: invoice.dunningLevel,
      lastDunnedAt: invoice.lastDunnedAt,
      currencyCode: invoice.currencyCode,
    }));
  }

  /** Advances the Mahnstufe (max 3) and stamps the reminder date. */
  @Post(':id/dun')
  @RequirePermission('finance.invoices.update')
  async dun(@CompanyId() companyId: string, @Param('id') id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, companyId, deletedAt: null, direction: 'OUTGOING' },
    });
    if (!invoice) {
      throw new UnprocessableEntityException({
        code: 'INVOICE_NOT_FOUND',
        message: 'Invoice not found',
      });
    }
    if (invoice.dueDate >= new Date()) {
      throw new UnprocessableEntityException({
        code: 'NOT_OVERDUE',
        message: 'Invoice is not overdue',
      });
    }
    if (invoice.dunningLevel >= MAX_DUNNING_LEVEL) {
      throw new UnprocessableEntityException({
        code: 'MAX_DUNNING_LEVEL',
        message: `Mahnstufe ${MAX_DUNNING_LEVEL} reached — hand over to collections/legal`,
      });
    }
    return this.prisma.invoice.update({
      where: { id },
      data: {
        dunningLevel: { increment: 1 },
        lastDunnedAt: new Date(),
        status: 'OVERDUE',
      },
    });
  }
}
