import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { assertReferenceInCompany, inCompany } from '../../common/tenant-scope';
import { PrismaService } from '../../core/prisma/prisma.service';
import { paged } from '../../common/pagination';
import { NumberSequenceService } from '../master-data/number-sequence.service';
import { CreateInvoiceDto, ListInvoicesQuery } from './dto';

const TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  DRAFT: ['IN_APPROVAL', 'CANCELLED'],
  IN_APPROVAL: ['APPROVED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['SENT', 'CANCELLED'],
  SENT: ['PARTIALLY_PAID', 'PAID', 'OVERDUE', 'DISPUTED'],
  PARTIALLY_PAID: ['PAID', 'OVERDUE', 'DISPUTED'],
  OVERDUE: ['PARTIALLY_PAID', 'PAID', 'DISPUTED'],
  DISPUTED: ['SENT', 'PAID', 'CANCELLED'],
  PAID: [],
  CANCELLED: [],
};

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: NumberSequenceService,
    private readonly events: EventEmitter2,
  ) {}

  async list(companyId: string, query: ListInvoicesQuery) {
    const where: Prisma.InvoiceWhereInput = {
      companyId,
      deletedAt: null,
      ...(query.direction ? { direction: query.direction } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.partnerId ? { partnerId: query.partnerId } : {}),
      ...(query.q
        ? {
            OR: [
              { invoiceNumber: { contains: query.q, mode: 'insensitive' } },
              { externalNumber: { contains: query.q, mode: 'insensitive' } },
              { reference: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total, sums] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: { partner: { select: { id: true, name: true } } },
        skip: query.skip,
        take: query.pageSize,
        orderBy: { invoiceDate: 'desc' },
      }),
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.aggregate({
        where,
        _sum: { netAmount: true, grossAmount: true, paidAmount: true },
      }),
    ]);
    return {
      ...paged(data, total, query),
      totals: {
        net: sums._sum.netAmount ?? 0,
        gross: sums._sum.grossAmount ?? 0,
        paid: sums._sum.paidAmount ?? 0,
      },
    };
  }

  async get(companyId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        partner: true,
        lines: {
          include: { taxCode: true, costCenter: true },
          orderBy: { position: 'asc' },
        },
        payments: { include: { payment: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async create(companyId: string, userId: string, dto: CreateInvoiceDto) {
    await assertReferenceInCompany(dto.partnerId, 'partnerId', inCompany(this.prisma, 'businessPartner', companyId));
    await assertReferenceInCompany(dto.contractId, 'contractId', inCompany(this.prisma, 'contract', companyId));
    for (const line of dto.lines) {
      await assertReferenceInCompany(line.costCenterId, 'costCenterId', inCompany(this.prisma, 'costCenter', companyId));
    }
    const taxCodes = await this.prisma.taxCode.findMany({
      where: { id: { in: dto.lines.map((l) => l.taxCodeId) } },
    });
    const taxById = new Map(taxCodes.map((t) => [t.id, t]));
    for (const line of dto.lines) {
      if (!taxById.has(line.taxCodeId)) {
        throw new UnprocessableEntityException({
          code: 'INVALID_TAX_CODE',
          message: `Unknown tax code ${line.taxCodeId}`,
        });
      }
    }

    // Compute totals server-side; cents-safe integer arithmetic.
    let netCents = 0;
    let taxCents = 0;
    const lines = dto.lines.map((line, index) => {
      const lineNetCents = Math.round(
        Number(line.quantity) * Number(line.unitPrice) * 100,
      );
      const rate = Number(taxById.get(line.taxCodeId)!.ratePercent);
      netCents += lineNetCents;
      taxCents += Math.round((lineNetCents * rate) / 100);
      return {
        position: index + 1,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit ?? 'pcs',
        unitPrice: line.unitPrice,
        netAmount: (lineNetCents / 100).toFixed(2),
        taxCodeId: line.taxCodeId,
        costCenterId: line.costCenterId,
        budgetCategory: line.budgetCategory,
      };
    });

    const invoice = await this.prisma.$transaction(async (tx) => {
      const prefix = dto.direction === 'OUTGOING' ? 'R' : 'ER';
      const invoiceNumber = await this.sequences.next(
        tx,
        companyId,
        `invoice:${dto.direction}`,
        prefix,
      );
      return tx.invoice.create({
        data: {
          companyId,
          partnerId: dto.partnerId,
          direction: dto.direction,
          invoiceNumber,
          externalNumber: dto.externalNumber,
          invoiceDate: new Date(dto.invoiceDate),
          serviceDate: dto.serviceDate ? new Date(dto.serviceDate) : undefined,
          dueDate: new Date(dto.dueDate),
          currencyCode: dto.currencyCode ?? 'EUR',
          netAmount: (netCents / 100).toFixed(2),
          taxAmount: (taxCents / 100).toFixed(2),
          grossAmount: ((netCents + taxCents) / 100).toFixed(2),
          reference: dto.reference,
          contractId: dto.contractId,
          createdById: userId,
          lines: { create: lines },
        },
        include: { lines: true },
      });
    });

    this.events.emit('finance.invoice.created', {
      invoiceId: invoice.id,
      companyId,
      direction: dto.direction,
      actorId: userId,
    });
    return invoice;
  }

  async transition(
    companyId: string,
    userId: string,
    id: string,
    target: InvoiceStatus,
  ) {
    const invoice = await this.get(companyId, id);
    if (!TRANSITIONS[invoice.status].includes(target)) {
      throw new UnprocessableEntityException({
        code: 'INVOICE_INVALID_TRANSITION',
        message: `Cannot transition from ${invoice.status} to ${target}`,
      });
    }
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { status: target, updatedById: userId },
    });
    this.events.emit(`finance.invoice.${target.toLowerCase()}`, {
      invoiceId: id,
      companyId,
      actorId: userId,
    });
    return updated;
  }
}
