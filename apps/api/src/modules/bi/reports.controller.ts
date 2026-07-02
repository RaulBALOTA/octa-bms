import {
  Controller,
  Get,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CompanyId, RequirePermission } from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface ReportResult {
  code: string;
  columns: { key: string; label: string; type: 'text' | 'number' | 'money' | 'date' }[];
  rows: Record<string, unknown>[];
}

/**
 * Predefined operational reports, computed live. The generic report builder
 * (ReportDefinition.query) supersedes this catalog in a later phase; the
 * /bi/reports contract stays.
 */
@ApiTags('bi')
@ApiBearerAuth()
@Controller('bi/reports')
export class ReportsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('bi.reports.read')
  catalog() {
    return [
      { code: 'revenue-by-client', name: 'Revenue by Client', nameDe: 'Umsatz nach Kunde' },
      { code: 'open-items', name: 'Open Items (AR)', nameDe: 'Offene Posten (Debitoren)' },
      { code: 'pipeline-summary', name: 'Pipeline Summary', nameDe: 'Pipeline-Übersicht' },
      { code: 'leave-overview', name: 'Leave Overview', nameDe: 'Urlaubsübersicht' },
      { code: 'asset-inventory', name: 'Asset Inventory', nameDe: 'Geräteinventar' },
    ];
  }

  @Get(':code')
  @RequirePermission('bi.reports.read')
  async run(
    @CompanyId() companyId: string,
    @Param('code') code: string,
  ): Promise<ReportResult> {
    switch (code) {
      case 'revenue-by-client': {
        const invoices = await this.prisma.invoice.findMany({
          where: {
            companyId,
            deletedAt: null,
            direction: 'OUTGOING',
            status: { notIn: ['DRAFT', 'CANCELLED'] },
          },
          include: { partner: { select: { name: true } } },
        });
        const byClient = new Map<string, { net: number; gross: number; count: number }>();
        for (const invoice of invoices) {
          const entry = byClient.get(invoice.partner.name) ?? { net: 0, gross: 0, count: 0 };
          entry.net += Number(invoice.netAmount);
          entry.gross += Number(invoice.grossAmount);
          entry.count += 1;
          byClient.set(invoice.partner.name, entry);
        }
        return {
          code,
          columns: [
            { key: 'client', label: 'Client', type: 'text' },
            { key: 'invoices', label: 'Invoices', type: 'number' },
            { key: 'net', label: 'Net', type: 'money' },
            { key: 'gross', label: 'Gross', type: 'money' },
          ],
          rows: [...byClient.entries()]
            .map(([client, v]) => ({ client, invoices: v.count, net: v.net, gross: v.gross }))
            .sort((a, b) => b.net - a.net),
        };
      }

      case 'open-items': {
        const invoices = await this.prisma.invoice.findMany({
          where: {
            companyId,
            deletedAt: null,
            direction: 'OUTGOING',
            status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] },
          },
          include: { partner: { select: { name: true } } },
          orderBy: { dueDate: 'asc' },
        });
        const now = Date.now();
        return {
          code,
          columns: [
            { key: 'number', label: 'Invoice', type: 'text' },
            { key: 'client', label: 'Client', type: 'text' },
            { key: 'dueDate', label: 'Due', type: 'date' },
            { key: 'overdueDays', label: 'Days overdue', type: 'number' },
            { key: 'open', label: 'Open amount', type: 'money' },
          ],
          rows: invoices.map((invoice) => ({
            number: invoice.invoiceNumber,
            client: invoice.partner.name,
            dueDate: invoice.dueDate,
            overdueDays: Math.max(
              0,
              Math.floor((now - invoice.dueDate.getTime()) / 86_400_000),
            ),
            open: Number(invoice.grossAmount) - Number(invoice.paidAmount),
          })),
        };
      }

      case 'pipeline-summary': {
        const opportunities = await this.prisma.opportunity.findMany({
          where: { companyId, deletedAt: null },
          include: {
            partner: { select: { name: true } },
            owner: { select: { firstName: true, lastName: true } },
          },
          orderBy: { updatedAt: 'desc' },
        });
        return {
          code,
          columns: [
            { key: 'number', label: 'No.', type: 'text' },
            { key: 'title', label: 'Opportunity', type: 'text' },
            { key: 'client', label: 'Client', type: 'text' },
            { key: 'stage', label: 'Stage', type: 'text' },
            { key: 'value', label: 'Value', type: 'money' },
            { key: 'weighted', label: 'Weighted', type: 'money' },
          ],
          rows: opportunities.map((opp) => ({
            number: opp.opportunityNumber,
            title: opp.title,
            client: opp.partner.name,
            stage: opp.stage,
            value: Number(opp.estimatedValue ?? 0),
            weighted: (Number(opp.estimatedValue ?? 0) * opp.probability) / 100,
          })),
        };
      }

      case 'leave-overview': {
        const balances = await this.prisma.leaveBalance.findMany({
          where: { year: new Date().getFullYear(), employee: { companyId, deletedAt: null } },
          include: {
            employee: { select: { firstName: true, lastName: true, employeeNumber: true } },
          },
        });
        return {
          code,
          columns: [
            { key: 'employee', label: 'Employee', type: 'text' },
            { key: 'entitlement', label: 'Entitlement', type: 'number' },
            { key: 'carryOver', label: 'Carry-over', type: 'number' },
            { key: 'taken', label: 'Taken', type: 'number' },
            { key: 'remaining', label: 'Remaining', type: 'number' },
          ],
          rows: balances.map((balance) => ({
            employee: `${balance.employee.lastName}, ${balance.employee.firstName}`,
            entitlement: Number(balance.entitlement),
            carryOver: Number(balance.carryOver),
            taken: Number(balance.taken),
            remaining:
              Number(balance.entitlement) + Number(balance.carryOver) - Number(balance.taken),
          })),
        };
      }

      case 'asset-inventory': {
        const assets = await this.prisma.asset.findMany({
          where: { companyId, deletedAt: null },
          include: {
            category: { select: { name: true } },
            assignments: {
              where: { returnedAt: null },
              include: {
                employee: { select: { firstName: true, lastName: true } },
              },
            },
          },
          orderBy: { assetNumber: 'asc' },
        });
        return {
          code,
          columns: [
            { key: 'number', label: 'No.', type: 'text' },
            { key: 'name', label: 'Asset', type: 'text' },
            { key: 'category', label: 'Category', type: 'text' },
            { key: 'status', label: 'Status', type: 'text' },
            { key: 'holder', label: 'Assigned to', type: 'text' },
          ],
          rows: assets.map((asset) => ({
            number: asset.assetNumber,
            name: asset.name,
            category: asset.category.name,
            status: asset.status,
            holder: asset.assignments[0]
              ? `${asset.assignments[0].employee.firstName} ${asset.assignments[0].employee.lastName}`
              : '',
          })),
        };
      }

      default:
        throw new NotFoundException(`Unknown report: ${code}`);
    }
  }
}
