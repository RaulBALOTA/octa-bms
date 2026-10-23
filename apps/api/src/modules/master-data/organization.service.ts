import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CreateCompanyDto, CreateOfficeDto, UpdateCompanyDto, UpdateOfficeDto } from './organization.dto';

@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService) {}

  private visibility(user: AuthUser): Prisma.CompanyWhereInput {
    return { deletedAt: null, ...(user.isSystemAdmin ? {} : { memberships: { some: { userId: user.id } } }) };
  }

  list(user: AuthUser) {
    return this.prisma.company.findMany({
      where: this.visibility(user), include: {
        offices: { where: { deletedAt: null }, orderBy: { code: 'asc' } },
        _count: { select: { employees: { where: { deletedAt: null } }, departments: { where: { deletedAt: null } } } },
      }, orderBy: { code: 'asc' },
    });
  }

  async get(user: AuthUser, id: string, tx: Prisma.TransactionClient = this.prisma) {
    const company = await tx.company.findFirst({
      where: { ...this.visibility(user), id },
      include: {
        offices: { where: { deletedAt: null }, orderBy: { code: 'asc' } },
        departments: { where: { deletedAt: null } }, businessUnits: { where: { deletedAt: null } }, costCenters: { where: { deletedAt: null } },
      },
    });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  /**
   * Permissions are resolved for the active company (X-Company-Id), so a
   * non-system admin may only change that company and its offices; being a
   * plain member of another company does not grant admin rights there.
   */
  private assertActiveCompany(user: AuthUser, companyId: string) {
    if (!user.isSystemAdmin && user.companyId !== companyId) {
      throw new ForbiddenException('Switch to this company to change it');
    }
  }

  private async transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try { return await this.prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') throw new ConflictException('This code is already in use');
        if (error.code === 'P2034') throw new ConflictException('The organization changed during this operation. Please retry.');
      }
      throw error;
    }
  }

  private async country(tx: Prisma.TransactionClient, code?: string | null) {
    if (code && !await tx.country.findUnique({ where: { code } })) throw new BadRequestException('Unknown country code');
  }

  private async companyReferences(tx: Prisma.TransactionClient, user: AuthUser, dto: UpdateCompanyDto, id?: string) {
    await this.country(tx, dto.countryCode);
    if (dto.defaultCurrency && !await tx.currency.findUnique({ where: { code: dto.defaultCurrency } })) throw new BadRequestException('Unknown currency code');
    if (dto.code && await tx.company.findFirst({ where: { code: dto.code, ...(id ? { id: { not: id } } : {}) } })) throw new ConflictException('Company code is already in use');
    if (dto.parentCompanyId) {
      const parent = await this.get(user, dto.parentCompanyId, tx);
      if (!parent.isActive) throw new BadRequestException('Parent company is inactive');
      const rows = await tx.company.findMany({ where: { deletedAt: null }, select: { id: true, parentCompanyId: true } });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const visited = new Set<string>();
      let cursor: string | null = parent.id;
      while (cursor) {
        if (cursor === id || visited.has(cursor)) throw new BadRequestException('A company cannot be its own ancestor');
        visited.add(cursor);
        cursor = byId.get(cursor)?.parentCompanyId ?? null;
      }
    }
  }

  create(user: AuthUser, dto: CreateCompanyDto) {
    return this.transaction(async (tx) => {
      await this.companyReferences(tx, user, dto);
      return tx.company.create({ data: { ...dto, memberships: { create: { userId: user.id } } } });
    });
  }

  update(user: AuthUser, id: string, dto: UpdateCompanyDto) {
    return this.transaction(async (tx) => {
      this.assertActiveCompany(user, id);
      await this.get(user, id, tx);
      await this.companyReferences(tx, user, dto, id);
      return tx.company.update({ where: { id }, data: dto });
    });
  }

  remove(user: AuthUser, id: string) {
    return this.transaction(async (tx) => {
      this.assertActiveCompany(user, id);
      await this.get(user, id, tx);
      if (await tx.company.count({ where: { parentCompanyId: id, deletedAt: null } })) throw new ConflictException('Company has subsidiaries. Reassign or delete them first.');
      const company = await tx.company.findUniqueOrThrow({ where: { id }, include: { _count: { select: {
        employees: { where: { deletedAt: null } }, businessPartners: { where: { deletedAt: null } },
        contracts: { where: { deletedAt: null } }, invoices: { where: { deletedAt: null } },
        budgets: { where: { deletedAt: null } }, assets: { where: { deletedAt: null } },
        opportunities: { where: { deletedAt: null } }, proposals: { where: { deletedAt: null } },
        purchaseRequests: { where: { deletedAt: null } }, purchaseOrders: { where: { deletedAt: null } },
        announcements: { where: { deletedAt: null } }, companyGoals: { where: { deletedAt: null } },
        departments: { where: { deletedAt: null } }, businessUnits: { where: { deletedAt: null } },
        costCenters: { where: { deletedAt: null } }, profitCenters: { where: { deletedAt: null } },
        bankAccounts: { where: { deletedAt: null } }, groups: { where: { deletedAt: null } },
      } } } });
      if (Object.values(company._count).some((count) => count > 0)) throw new ConflictException('Company has business records. Deactivate it instead of deleting it.');
      const deletedAt = new Date();
      await tx.office.updateMany({ where: { companyId: id, deletedAt: null }, data: { deletedAt, isActive: false } });
      await tx.company.update({ where: { id }, data: { deletedAt, isActive: false } });
    });
  }

  async getOffice(user: AuthUser, companyId: string, id: string, tx: Prisma.TransactionClient = this.prisma) {
    await this.get(user, companyId, tx);
    const office = await tx.office.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!office) throw new NotFoundException('Office not found');
    return office;
  }

  private async officeReferences(tx: Prisma.TransactionClient, companyId: string, dto: UpdateOfficeDto, id?: string) {
    await this.country(tx, dto.countryCode);
    if (dto.code && await tx.office.findFirst({ where: { companyId, code: dto.code, ...(id ? { id: { not: id } } : {}) } })) throw new ConflictException('Office code is already in use in this company');
  }

  createOffice(user: AuthUser, companyId: string, dto: CreateOfficeDto) {
    return this.transaction(async (tx) => {
      this.assertActiveCompany(user, companyId);
      await this.get(user, companyId, tx);
      await this.officeReferences(tx, companyId, dto);
      return tx.office.create({ data: { ...dto, companyId } });
    });
  }

  updateOffice(user: AuthUser, companyId: string, id: string, dto: UpdateOfficeDto) {
    return this.transaction(async (tx) => {
      this.assertActiveCompany(user, companyId);
      await this.getOffice(user, companyId, id, tx);
      await this.officeReferences(tx, companyId, dto, id);
      return tx.office.update({ where: { id }, data: dto });
    });
  }

  removeOffice(user: AuthUser, companyId: string, id: string) {
    return this.transaction(async (tx) => {
      this.assertActiveCompany(user, companyId);
      await this.getOffice(user, companyId, id, tx);
      const employees = await tx.employee.count({ where: { officeId: id, deletedAt: null } });
      const roles = await tx.userRole.count({ where: { officeId: id } });
      if (employees || roles) throw new ConflictException('Office is in use by employees or role assignments. Deactivate it instead.');
      await tx.office.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    });
  }
}
