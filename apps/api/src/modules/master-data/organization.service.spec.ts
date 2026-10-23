import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { OrganizationService } from './organization.service';
import { CreateCompanyDto, CreateOfficeDto, UpdateCompanyDto, UpdateOfficeDto } from './organization.dto';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { AuthUser } from '../../core/auth/decorators';

const admin: AuthUser = { id: 'admin', email: 'admin@example.com', isSystemAdmin: true, companyId: 'root', permissions: [] };
const member: AuthUser = { ...admin, id: 'member', isSystemAdmin: false };
function setup(options: { businessRecords?: number; employees?: number; roles?: number } = {}) {
  const companies = [
    { id: 'root', code: 'ROOT', name: 'Holding', parentCompanyId: null as string | null, isActive: true, deletedAt: null as Date | null, members: ['member'], offices: [] },
    { id: 'child', code: 'CHILD', name: 'Subsidiary', parentCompanyId: 'root' as string | null, isActive: true, deletedAt: null as Date | null, members: [], offices: [] },
    { id: 'empty', code: 'EMPTY', name: 'Empty', parentCompanyId: null as string | null, isActive: true, deletedAt: null as Date | null, members: [], offices: [] },
    { id: 'deleted', code: 'OLD', name: 'Deleted', parentCompanyId: null as string | null, isActive: false, deletedAt: new Date() as Date | null, members: [], offices: [] },
  ];
  const offices = [{ id: 'office', companyId: 'empty', code: 'HQ', name: 'Office', isActive: true, deletedAt: null as Date | null }];
  type CompanyWhere = { id?: string | { not: string }; code?: string; deletedAt?: null; parentCompanyId?: string; memberships?: { some: { userId: string } } };
  const matches = (row: typeof companies[number], where: CompanyWhere) => (!where.id || (typeof where.id === 'string' ? row.id === where.id : row.id !== where.id.not))
    && (!where.code || row.code === where.code) && (!('deletedAt' in where) || row.deletedAt === null)
    && (!where.parentCompanyId || row.parentCompanyId === where.parentCompanyId)
    && (!where.memberships || row.members.includes(where.memberships.some.userId));
  const tx = {
    company: {
      findFirst: vi.fn(async ({ where }: { where: CompanyWhere }) => companies.find((row) => matches(row, where)) ?? null),
      findMany: vi.fn(async ({ where }: { where: CompanyWhere }) => companies.filter((row) => matches(row, where))),
      count: vi.fn(async ({ where }: { where: CompanyWhere }) => companies.filter((row) => matches(row, where)).length),
      findUniqueOrThrow: vi.fn(async () => ({ _count: { invoices: options.businessRecords ?? 0 } })),
      create: vi.fn(async ({ data }: { data: { code: string; name: string; memberships: { create: { userId: string } } } }) => ({ id: 'new', ...data })),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<typeof companies[number]> }) => Object.assign(companies.find((row) => row.id === where.id)!, data)),
    },
    office: {
      findFirst: vi.fn(async ({ where }: { where: { id?: string | { not: string }; companyId: string; code?: string; deletedAt?: null } }) => offices.find((row) =>
        row.companyId === where.companyId && (!where.id || (typeof where.id === 'string' ? row.id === where.id : row.id !== where.id.not)) && (!where.code || row.code === where.code) && (!('deletedAt' in where) || row.deletedAt === null)) ?? null),
      create: vi.fn(async ({ data }: { data: object }) => ({ id: 'new-office', ...data })),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<typeof offices[number]> }) => Object.assign(offices.find((row) => row.id === where.id)!, data)),
      updateMany: vi.fn(async ({ where, data }: { where: { companyId: string }; data: Partial<typeof offices[number]> }) => {
        const rows = offices.filter((row) => row.companyId === where.companyId && row.deletedAt === null); rows.forEach((row) => Object.assign(row, data)); return { count: rows.length };
      }),
    },
    country: { findUnique: vi.fn(async () => ({ code: 'DE' })) },
    currency: { findUnique: vi.fn(async () => ({ code: 'EUR' })) },
    employee: { count: vi.fn(async () => options.employees ?? 0) },
    userRole: { count: vi.fn(async () => options.roles ?? 0) },
  };
  const prisma = { ...tx, $transaction: vi.fn(async (fn: (db: typeof tx) => Promise<unknown>) => fn(tx)) };
  return { service: new OrganizationService(prisma as unknown as PrismaService), tx, companies, offices };
}

describe('company CRUD and hierarchy', () => {
  it('creates a company and gives its creator membership for company switching', async () => {
    const { service, tx } = setup();
    await expect(service.create(admin, { code: 'NEW', name: 'New company', parentCompanyId: 'root' })).resolves.toMatchObject({ id: 'new' });
    expect(tx.company.create).toHaveBeenCalledWith({ data: { code: 'NEW', name: 'New company', parentCompanyId: 'root', memberships: { create: { userId: 'admin' } } } });
  });
  it('supports partial editing and clearing optional metadata', async () => {
    const { service, companies } = setup();
    await service.update(admin, 'child', { name: 'Edited', parentCompanyId: null, city: null });
    expect(companies[1]).toMatchObject({ name: 'Edited', parentCompanyId: null });
  });
  it.each(['root', 'child'])('rejects parent %s that would create a cycle', async (parentCompanyId) => {
    const { service, tx } = setup();
    await expect(service.update(admin, 'root', { parentCompanyId })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.company.update).not.toHaveBeenCalled();
  });
  it('reserves existing and previously deleted company codes', async () => {
    for (const code of ['ROOT', 'OLD']) {
      const { service } = setup();
      await expect(service.create(admin, { code, name: 'Duplicate' })).rejects.toBeInstanceOf(ConflictException);
    }
  });
  it('restricts non-admins to their own companies for read, edit, and delete', async () => {
    const { service } = setup();
    await expect(service.list(member)).resolves.toHaveLength(1);
    await expect(service.get(member, 'child')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update(member, 'child', { name: 'Forbidden' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.remove(member, 'child')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('only lets non-admins change the active company, where their permissions were checked', async () => {
    const { service } = setup();
    // a member of "child" whose admin permissions come from the active company "root"
    const memberOfBoth: AuthUser = { ...member, companyId: 'root' };
    await expect(service.update(memberOfBoth, 'child', { name: 'Elsewhere' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.createOffice(memberOfBoth, 'child', { code: 'X', name: 'X' } as any)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.updateOffice(memberOfBoth, 'child', 'office', { name: 'X' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.removeOffice(memberOfBoth, 'child', 'office')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects deleting a holding company with subsidiaries', async () => {
    const { service, tx } = setup();
    await expect(service.remove(admin, 'root')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.company.update).not.toHaveBeenCalled();
  });
  it('rejects deleting business records and allows deactivation instead', async () => {
    const { service, companies } = setup({ businessRecords: 1 });
    await expect(service.remove(admin, 'empty')).rejects.toBeInstanceOf(ConflictException);
    await service.update(admin, 'empty', { isActive: false });
    expect(companies[2]).toMatchObject({ isActive: false, deletedAt: null });
  });
  it('soft deletes an empty company and its offices atomically', async () => {
    const { service, companies, offices } = setup();
    await service.remove(admin, 'empty');
    expect(companies[2]).toMatchObject({ isActive: false, deletedAt: expect.any(Date) });
    expect(offices[0].deletedAt).toEqual(companies[2].deletedAt);
    expect(companies[0].deletedAt).toBeNull();
  });
});

describe('office CRUD', () => {
  it('creates offices in their requested company and edits them partially', async () => {
    const { service, tx, offices } = setup();
    await service.createOffice(admin, 'empty', { code: 'BRANCH', name: 'Branch' });
    expect(tx.office.create).toHaveBeenCalledWith({ data: { companyId: 'empty', code: 'BRANCH', name: 'Branch' } });
    await service.updateOffice(admin, 'empty', 'office', { name: 'Edited office' });
    expect(offices[0].name).toBe('Edited office');
  });
  it('does not read or mutate an office through another company', async () => {
    const { service, tx } = setup();
    await expect(service.getOffice(admin, 'root', 'office')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.updateOffice(admin, 'root', 'office', { name: 'Forbidden' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.removeOffice(admin, 'root', 'office')).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.office.update).not.toHaveBeenCalled();
  });
  it('does not delete offices used by employees or role assignments', async () => {
    for (const options of [{ employees: 1 }, { roles: 1 }]) {
      const { service } = setup(options);
      await expect(service.removeOffice(admin, 'empty', 'office')).rejects.toBeInstanceOf(ConflictException);
    }
  });
  it('soft deletes unused offices', async () => {
    const { service, offices } = setup();
    await service.removeOffice(admin, 'empty', 'office');
    expect(offices[0]).toMatchObject({ isActive: false, deletedAt: expect.any(Date) });
  });
});

describe('organization input validation', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  it.each([UpdateCompanyDto, UpdateOfficeDto])('allows partial updates and clearing optional fields for %s', async (metatype) => {
    await expect(pipe.transform({ city: null, name: ' Updated ' }, { type: 'body', metatype })).resolves.toMatchObject({ city: null, name: 'Updated' });
    for (const body of [{ name: null }, { name: '   ' }, { code: null }, { isActive: null }, { companyId: 'other' }]) {
      await expect(pipe.transform(body, { type: 'body', metatype })).rejects.toBeInstanceOf(BadRequestException);
    }
  });
  it.each([CreateCompanyDto, CreateOfficeDto])('requires a valid code and name for %s', async (metatype) => {
    await expect(pipe.transform({ code: 'HQ', name: ' Office ' }, { type: 'body', metatype })).resolves.toMatchObject({ code: 'HQ', name: 'Office' });
    await expect(pipe.transform({ code: 'bad code', name: 'Office' }, { type: 'body', metatype })).rejects.toBeInstanceOf(BadRequestException);
  });
});
