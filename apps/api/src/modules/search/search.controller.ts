import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AuthUser,
  CompanyId,
  CurrentUser,
} from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';

interface SearchHit {
  type: string;
  id: string;
  title: string;
  subtitle?: string | null;
  link: string;
}

/**
 * Global "search everywhere" (Dynamics-style). Database-backed v1; the
 * Meilisearch indexer replaces the per-entity queries transparently later.
 * Results are filtered by the caller's module read permissions.
 */
@ApiTags('search')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async search(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Query('q') q = '',
    @Query('limit') limit = '5',
  ) {
    const term = q.trim();
    if (term.length < 2) return { query: q, groups: [] };
    const take = Math.min(Number(limit) || 5, 20);
    const contains = { contains: term, mode: 'insensitive' as const };

    const can = (perm: string) =>
      user.isSystemAdmin || user.permissions.includes(perm);

    const [partners, contacts, employees, contracts, invoices, assets] =
      await Promise.all([
        can('crm.partners.read')
          ? this.prisma.businessPartner.findMany({
              where: {
                companyId,
                deletedAt: null,
                OR: [{ name: contains }, { partnerNumber: contains }, { city: contains }],
              },
              take,
            })
          : [],
        can('crm.contacts.read')
          ? this.prisma.contact.findMany({
              where: {
                deletedAt: null,
                partner: { companyId },
                OR: [{ lastName: contains }, { firstName: contains }, { email: contains }],
              },
              include: { partner: { select: { name: true } } },
              take,
            })
          : [],
        can('hr.employees.read')
          ? this.prisma.employee.findMany({
              where: {
                companyId,
                deletedAt: null,
                OR: [
                  { lastName: contains },
                  { firstName: contains },
                  { employeeNumber: contains },
                  { discipline: contains },
                ],
              },
              take,
            })
          : [],
        can('contracts.contracts.read')
          ? this.prisma.contract.findMany({
              where: {
                companyId,
                deletedAt: null,
                OR: [{ title: contains }, { contractNumber: contains }],
              },
              take,
            })
          : [],
        can('finance.invoices.read')
          ? this.prisma.invoice.findMany({
              where: {
                companyId,
                deletedAt: null,
                OR: [
                  { invoiceNumber: contains },
                  { externalNumber: contains },
                  { reference: contains },
                ],
              },
              include: { partner: { select: { name: true } } },
              take,
            })
          : [],
        can('assets.assets.read')
          ? this.prisma.asset.findMany({
              where: {
                companyId,
                deletedAt: null,
                OR: [
                  { name: contains },
                  { assetNumber: contains },
                  { serialNumber: contains },
                ],
              },
              take,
            })
          : [],
      ]);

    const groups: { type: string; hits: SearchHit[] }[] = [
      {
        type: 'partners',
        hits: partners.map((p) => ({
          type: 'partner',
          id: p.id,
          title: p.name,
          subtitle: `${p.partnerNumber} · ${p.city ?? ''}`,
          link: `/crm/partners/${p.id}`,
        })),
      },
      {
        type: 'contacts',
        hits: contacts.map((c) => ({
          type: 'contact',
          id: c.id,
          title: `${c.firstName} ${c.lastName}`,
          subtitle: c.partner.name,
          link: `/crm/contacts/${c.id}`,
        })),
      },
      {
        type: 'employees',
        hits: employees.map((e) => ({
          type: 'employee',
          id: e.id,
          title: `${e.firstName} ${e.lastName}`,
          subtitle: e.discipline,
          link: `/hr/employees/${e.id}`,
        })),
      },
      {
        type: 'contracts',
        hits: contracts.map((c) => ({
          type: 'contract',
          id: c.id,
          title: c.title,
          subtitle: c.contractNumber,
          link: `/contracts/${c.id}`,
        })),
      },
      {
        type: 'invoices',
        hits: invoices.map((i) => ({
          type: 'invoice',
          id: i.id,
          title: i.invoiceNumber,
          subtitle: `${i.partner.name} · ${i.grossAmount} ${i.currencyCode}`,
          link: `/finance/invoices/${i.id}`,
        })),
      },
      {
        type: 'assets',
        hits: assets.map((a) => ({
          type: 'asset',
          id: a.id,
          title: a.name,
          subtitle: a.assetNumber,
          link: `/assets/${a.id}`,
        })),
      },
    ].filter((g) => g.hits.length > 0);

    return { query: q, groups };
  }
}
