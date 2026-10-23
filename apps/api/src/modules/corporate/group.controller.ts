import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';

const OPEN_STATUSES = ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] as const;
const FUNNEL = ['LEAD', 'QUALIFIED', 'GO_NO_GO', 'PROPOSAL', 'NEGOTIATION'] as const;

export interface GroupCompanyRow {
  id: string;
  code: string;
  name: string;
  city: string | null;
  countryCode: string | null;
  currency: string;
  isParent: boolean;
  parentCompanyId: string | null;
  fxRateToEUR: number;
  offices: { name: string; city: string | null }[];
  headcount: number;
  activeClients: number;
  revenueYtd: number; // local currency
  revenueYtdEUR: number;
  openItems: number;
  openItemsEUR: number;
  backlog: number;
  backlogEUR: number;
  pipelineWeightedEUR: number;
  revenueByMonthEUR: number[]; // 12 entries, current year
}

/**
 * Group (Konzern) consolidation: one master view across every legal entity
 * the caller is a member of (system admins see all). Local companies stay
 * fully separated operationally — this endpoint aggregates their KPIs and
 * converts to EUR via the exchange-rate table for a comparable group total.
 */
@ApiTags('corporate')
@ApiBearerAuth()
@Controller('group')
export class GroupController {
  constructor(private readonly prisma: PrismaService) {}

  private async fxRate(currency: string): Promise<number> {
    if (currency === 'EUR') return 1;
    const rate = await this.prisma.exchangeRate.findFirst({
      where: { currencyCode: currency, validFrom: { lte: new Date() } },
      orderBy: { validFrom: 'desc' },
    });
    return rate ? Number(rate.rateToEUR) : 1;
  }

  @Get('overview')
  async overview(@CurrentUser() user: AuthUser) {
    const companies = await this.prisma.company.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(user.isSystemAdmin
          ? {}
          : { memberships: { some: { userId: user.id } } }),
      },
      include: { offices: { where: { deletedAt: null, isActive: true } } },
      orderBy: [{ parentCompanyId: 'asc' }, { code: 'asc' }],
    });

    const year = new Date().getFullYear();
    const startOfYear = new Date(Date.UTC(year, 0, 1));

    const rows: GroupCompanyRow[] = [];
    for (const company of companies) {
      const fx = await this.fxRate(company.defaultCurrency);

      const [headcount, activeClients, revenue, openInvoices, backlog, pipeline] =
        await Promise.all([
          this.prisma.employee.count({
            where: { companyId: company.id, deletedAt: null, status: 'ACTIVE' },
          }),
          this.prisma.businessPartner.count({
            where: {
              companyId: company.id,
              deletedAt: null,
              type: 'CLIENT',
              status: 'ACTIVE',
            },
          }),
          this.prisma.invoice.findMany({
            where: {
              companyId: company.id,
              deletedAt: null,
              direction: 'OUTGOING',
              status: { notIn: ['DRAFT', 'CANCELLED'] },
              invoiceDate: { gte: startOfYear },
            },
            select: { invoiceDate: true, netAmount: true },
          }),
          this.prisma.invoice.findMany({
            where: {
              companyId: company.id,
              deletedAt: null,
              direction: 'OUTGOING',
              status: { in: [...OPEN_STATUSES] },
            },
            select: { grossAmount: true, paidAmount: true },
          }),
          this.prisma.contract.aggregate({
            where: { companyId: company.id, deletedAt: null, status: 'ACTIVE' },
            _sum: { value: true },
          }),
          this.prisma.opportunity.findMany({
            where: {
              companyId: company.id,
              deletedAt: null,
              stage: { in: [...FUNNEL] },
            },
            select: { estimatedValue: true, probability: true },
          }),
        ]);

      const revenueYtd = revenue.reduce(
        (sum, invoice) => sum + Number(invoice.netAmount),
        0,
      );
      const revenueByMonthEUR = Array.from({ length: 12 }, () => 0);
      for (const invoice of revenue) {
        revenueByMonthEUR[invoice.invoiceDate.getUTCMonth()] +=
          Number(invoice.netAmount) * fx;
      }
      const openItems = openInvoices.reduce(
        (sum, invoice) =>
          sum + Number(invoice.grossAmount) - Number(invoice.paidAmount),
        0,
      );
      const backlogValue = Number(backlog._sum.value ?? 0);
      const pipelineWeighted = pipeline.reduce(
        (sum, opp) =>
          sum + (Number(opp.estimatedValue ?? 0) * opp.probability) / 100,
        0,
      );

      rows.push({
        id: company.id,
        code: company.code,
        name: company.name,
        city: company.city,
        countryCode: company.countryCode,
        currency: company.defaultCurrency,
        isParent: company.parentCompanyId === null,
        parentCompanyId: company.parentCompanyId,
        fxRateToEUR: fx,
        offices: company.offices.map((office) => ({
          name: office.name,
          city: office.city,
        })),
        headcount,
        activeClients,
        revenueYtd,
        revenueYtdEUR: revenueYtd * fx,
        openItems,
        openItemsEUR: openItems * fx,
        backlog: backlogValue,
        backlogEUR: backlogValue * fx,
        pipelineWeightedEUR: pipelineWeighted * fx,
        revenueByMonthEUR,
      });
    }

    return {
      year,
      companies: rows,
      totals: {
        companies: rows.length,
        offices: rows.reduce((sum, row) => sum + row.offices.length, 0),
        headcount: rows.reduce((sum, row) => sum + row.headcount, 0),
        activeClients: rows.reduce((sum, row) => sum + row.activeClients, 0),
        revenueYtdEUR: rows.reduce((sum, row) => sum + row.revenueYtdEUR, 0),
        openItemsEUR: rows.reduce((sum, row) => sum + row.openItemsEUR, 0),
        backlogEUR: rows.reduce((sum, row) => sum + row.backlogEUR, 0),
        pipelineWeightedEUR: rows.reduce(
          (sum, row) => sum + row.pipelineWeightedEUR,
          0,
        ),
      },
    };
  }
}
