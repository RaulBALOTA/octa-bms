import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AuthUser,
  CompanyId,
  CurrentUser,
} from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface ApprovalItem {
  kind: 'LEAVE' | 'INVOICE' | 'CONTRACT' | 'PURCHASE';
  id: string;
  title: string;
  subtitle: string;
  amount?: string | null;
  requestedAt: string;
}

/**
 * "My Approvals" inbox — aggregates everything the caller may decide on,
 * based on their approve permissions. The full workflow engine
 * (WorkflowInstance/ApprovalTask) replaces this aggregation in a later phase;
 * the endpoint contract stays.
 */
@ApiTags('workflow')
@ApiBearerAuth()
@Controller('workflow/tasks')
export class ApprovalsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('my')
  async my(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ items: ApprovalItem[]; count: number }> {
    const can = (perm: string) =>
      user.isSystemAdmin || user.permissions.includes(perm);

    const [leave, invoices, contracts, purchases] = await Promise.all([
      can('hr.leave.approve')
        ? this.prisma.leaveRequest.findMany({
            where: { status: 'REQUESTED', employee: { companyId } },
            include: {
              employee: { select: { firstName: true, lastName: true } },
            },
            orderBy: { createdAt: 'asc' },
            take: 50,
          })
        : [],
      can('finance.invoices.approve')
        ? this.prisma.invoice.findMany({
            where: { companyId, deletedAt: null, status: 'IN_APPROVAL' },
            include: { partner: { select: { name: true } } },
            orderBy: { createdAt: 'asc' },
            take: 50,
          })
        : [],
      can('contracts.contracts.approve')
        ? this.prisma.contract.findMany({
            where: { companyId, deletedAt: null, status: 'IN_APPROVAL' },
            include: { partner: { select: { name: true } } },
            orderBy: { createdAt: 'asc' },
            take: 50,
          })
        : [],
      can('procurement.requests.approve')
        ? this.prisma.purchaseRequest.findMany({
            where: { companyId, deletedAt: null, status: 'SUBMITTED' },
            include: { items: { take: 1 } },
            orderBy: { createdAt: 'asc' },
            take: 50,
          })
        : [],
    ]);

    const items: ApprovalItem[] = [
      ...leave.map((request) => ({
        kind: 'LEAVE' as const,
        id: request.id,
        title: `${request.employee.firstName} ${request.employee.lastName}`,
        subtitle: `${request.type} · ${request.startDate.toISOString().slice(0, 10)} → ${request.endDate.toISOString().slice(0, 10)} (${Number(request.days)}d)`,
        requestedAt: request.createdAt.toISOString(),
      })),
      ...invoices.map((invoice) => ({
        kind: 'INVOICE' as const,
        id: invoice.id,
        title: invoice.invoiceNumber,
        subtitle: invoice.partner.name,
        amount: `${invoice.grossAmount} ${invoice.currencyCode}`,
        requestedAt: invoice.createdAt.toISOString(),
      })),
      ...contracts.map((contract) => ({
        kind: 'CONTRACT' as const,
        id: contract.id,
        title: contract.contractNumber,
        subtitle: `${contract.title}${contract.partner ? ` · ${contract.partner.name}` : ''}`,
        amount: contract.value ? `${contract.value} ${contract.currencyCode}` : null,
        requestedAt: contract.createdAt.toISOString(),
      })),
      ...purchases.map((request) => ({
        kind: 'PURCHASE' as const,
        id: request.id,
        title: request.requestNumber,
        subtitle: `${request.category} · ${request.items[0]?.description ?? ''}`,
        amount: request.totalEstimate ? `${request.totalEstimate} EUR` : null,
        requestedAt: request.createdAt.toISOString(),
      })),
    ].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));

    return { items, count: items.length };
  }
}
