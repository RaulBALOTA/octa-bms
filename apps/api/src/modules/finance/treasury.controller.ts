import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CompanyId, RequirePermission } from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';

const OPEN_STATUSES = ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] as const;
const AGING_BUCKETS = [
  { key: 'current', min: -Infinity, max: 0 },
  { key: 'd1_30', min: 1, max: 30 },
  { key: 'd31_60', min: 31, max: 60 },
  { key: 'd61_90', min: 61, max: 90 },
  { key: 'd90plus', min: 91, max: Infinity },
] as const;

@ApiTags('finance')
@ApiBearerAuth()
@Controller('finance')
export class TreasuryController {
  constructor(private readonly prisma: PrismaService) {}

  /** Open items (OP-Liste) with aging buckets, AR or AP. */
  @Get('open-items')
  @RequirePermission('finance.invoices.read')
  async openItems(
    @CompanyId() companyId: string,
    @Query('direction') direction: 'OUTGOING' | 'INCOMING' = 'OUTGOING',
  ) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        companyId,
        deletedAt: null,
        direction,
        status: { in: [...OPEN_STATUSES] },
      },
      include: { partner: { select: { id: true, name: true } } },
      orderBy: { dueDate: 'asc' },
    });

    const now = Date.now();
    const items = invoices.map((invoice) => {
      const open = Number(invoice.grossAmount) - Number(invoice.paidAmount);
      const overdueDays = Math.floor((now - invoice.dueDate.getTime()) / 86_400_000);
      const bucket = AGING_BUCKETS.find(
        (b) => overdueDays >= b.min && overdueDays <= b.max,
      )!.key;
      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        partner: invoice.partner,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        status: invoice.status,
        gross: Number(invoice.grossAmount),
        paid: Number(invoice.paidAmount),
        open,
        overdueDays: Math.max(0, overdueDays),
        bucket,
      };
    });

    const buckets = AGING_BUCKETS.map((b) => ({
      key: b.key,
      total: items
        .filter((item) => item.bucket === b.key)
        .reduce((sum, item) => sum + item.open, 0),
      count: items.filter((item) => item.bucket === b.key).length,
    }));

    return {
      direction,
      totalOpen: items.reduce((sum, item) => sum + item.open, 0),
      buckets,
      items,
    };
  }

  /**
   * Cash flow projection: current bank balance plus expected in/out flows from
   * open invoices, grouped by due-date week over the given horizon.
   */
  @Get('cashflow')
  @RequirePermission('finance.invoices.read')
  async cashflow(
    @CompanyId() companyId: string,
    @Query('weeks') weeks = '12',
  ) {
    const horizon = Math.min(Number(weeks) || 12, 26);

    const [accounts, openInvoices] = await Promise.all([
      this.prisma.bankAccount.findMany({
        where: { companyId, deletedAt: null, isActive: true },
        include: { payments: { select: { amount: true, direction: true } } },
      }),
      this.prisma.invoice.findMany({
        where: {
          companyId,
          deletedAt: null,
          status: { in: [...OPEN_STATUSES] },
        },
        select: {
          direction: true,
          dueDate: true,
          grossAmount: true,
          paidAmount: true,
        },
      }),
    ]);

    // bank-synced accounts start from the balance the bank reports
    const startingBalance = accounts.reduce(
      (sum, account) =>
        sum +
        (account.syncedBalance !== null
          ? Number(account.syncedBalance)
          : Number(account.openingBalance) +
            account.payments.reduce(
              (s, p) => s + Number(p.amount) * (p.direction === 'IN' ? 1 : -1),
              0,
            )),
      0,
    );

    // week 0 starts on the current Monday; overdue items land in week 0
    const monday = new Date();
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));

    const rows = Array.from({ length: horizon }, (_, index) => {
      const weekStart = new Date(monday.getTime() + index * 7 * 86_400_000);
      return {
        weekStart: weekStart.toISOString().slice(0, 10),
        expectedIn: 0,
        expectedOut: 0,
        net: 0,
        balance: 0,
      };
    });

    for (const invoice of openInvoices) {
      const open = Number(invoice.grossAmount) - Number(invoice.paidAmount);
      const weekIndex = Math.floor(
        (invoice.dueDate.getTime() - monday.getTime()) / (7 * 86_400_000),
      );
      const clamped = Math.max(0, Math.min(horizon - 1, weekIndex));
      if (weekIndex >= horizon) continue; // beyond the horizon
      if (invoice.direction === 'OUTGOING') rows[clamped].expectedIn += open;
      else rows[clamped].expectedOut += open;
    }

    let running = startingBalance;
    for (const row of rows) {
      row.net = row.expectedIn - row.expectedOut;
      running += row.net;
      row.balance = running;
    }

    return {
      startingBalance,
      totalExpectedIn: rows.reduce((sum, row) => sum + row.expectedIn, 0),
      totalExpectedOut: rows.reduce((sum, row) => sum + row.expectedOut, 0),
      endBalance: running,
      weeks: rows,
    };
  }
}
