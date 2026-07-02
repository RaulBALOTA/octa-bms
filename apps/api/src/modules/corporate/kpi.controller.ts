import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CompanyId, RequirePermission } from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';

const FUNNEL = ['LEAD', 'QUALIFIED', 'GO_NO_GO', 'PROPOSAL', 'NEGOTIATION'] as const;

/**
 * Aggregated numbers for the executive dashboard. Computed live — replace
 * with event-refreshed materialized views when volume demands (doc 20 §1).
 */
@ApiTags('corporate')
@ApiBearerAuth()
@Controller('corporate/kpis')
export class KpiController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('corporate.dashboard.read')
  async kpis(@CompanyId() companyId: string) {
    const year = new Date().getFullYear();
    const startOfYear = new Date(Date.UTC(year, 0, 1));

    const [
      clients,
      activeContracts,
      openInvoices,
      employees,
      openLeave,
      invoices,
      pipeline,
      contractValue,
    ] = await Promise.all([
      this.prisma.businessPartner.count({
        where: { companyId, deletedAt: null, type: 'CLIENT', status: 'ACTIVE' },
      }),
      this.prisma.contract.count({
        where: { companyId, deletedAt: null, status: 'ACTIVE' },
      }),
      this.prisma.invoice.count({
        where: {
          companyId,
          deletedAt: null,
          direction: 'OUTGOING',
          status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] },
        },
      }),
      this.prisma.employee.count({
        where: { companyId, deletedAt: null, status: 'ACTIVE' },
      }),
      this.prisma.leaveRequest.count({
        where: { status: 'REQUESTED', employee: { companyId } },
      }),
      this.prisma.invoice.findMany({
        where: {
          companyId,
          deletedAt: null,
          direction: 'OUTGOING',
          status: { notIn: ['DRAFT', 'CANCELLED'] },
          invoiceDate: { gte: startOfYear },
        },
        select: { invoiceDate: true, netAmount: true },
      }),
      this.prisma.opportunity.groupBy({
        by: ['stage'],
        where: { companyId, deletedAt: null, stage: { in: [...FUNNEL] } },
        _count: { _all: true },
        _sum: { estimatedValue: true },
      }),
      this.prisma.contract.aggregate({
        where: { companyId, deletedAt: null, status: 'ACTIVE' },
        _sum: { value: true },
      }),
    ]);

    const revenueByMonth = Array.from({ length: 12 }, (_, month) => ({
      month: month + 1,
      net: 0,
    }));
    for (const invoice of invoices) {
      const month = invoice.invoiceDate.getUTCMonth();
      revenueByMonth[month].net += Number(invoice.netAmount);
    }

    return {
      year,
      counts: { clients, activeContracts, openInvoices, employees, openLeave },
      orderBacklog: Number(contractValue._sum.value ?? 0),
      revenueByMonth,
      pipelineByStage: FUNNEL.map((stage) => {
        const row = pipeline.find((p) => p.stage === stage);
        return {
          stage,
          count: row?._count._all ?? 0,
          value: Number(row?._sum.estimatedValue ?? 0),
        };
      }),
    };
  }
}
