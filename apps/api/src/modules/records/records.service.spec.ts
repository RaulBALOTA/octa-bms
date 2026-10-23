import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../core/auth/decorators';
import type { PrismaService } from '../../core/prisma/prisma.service';
import { RbacService } from '../../core/rbac/rbac.service';
import { PageQueryDto } from '../../common/pagination';
import { OrganizationService } from '../master-data/organization.service';
import { NumberSequenceService } from '../master-data/number-sequence.service';
import { RECORD_MODELS, RECORD_RESOURCES, recordFields } from './record-catalog';
import { RecordsService } from './records.service';
import { RecordsFinanceService } from './records-finance.service';

const admin: AuthUser = { id: 'admin', email: 'admin@example.com', isSystemAdmin: true, companyId: 'own-company', permissions: [] };
type Data = Record<string, unknown>;
function setup() {
  const delegates = Object.fromEntries([...RECORD_MODELS.values()].map((model) => [model.name[0].toLowerCase() + model.name.slice(1), {
    findFirst: vi.fn(async (): Promise<Data | null> => null), findMany: vi.fn(async (): Promise<Data[]> => []),
    create: vi.fn(async ({ data }: { data: Data }) => ({ id: 'created', ...data })), update: vi.fn(async () => ({ id: 'updated' })),
    updateMany: vi.fn(async () => ({ count: 1 })), count: vi.fn(async () => 0), deleteMany: vi.fn(async () => ({ count: 0 })), delete: vi.fn(async () => ({})),
    findUniqueOrThrow: vi.fn(async (): Promise<Data> => ({})),
  }]));
  const db = { ...delegates, $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)) };
  const prisma = db as unknown as PrismaService;
  const rbac = new RbacService(prisma); const invalidate = vi.spyOn(rbac, 'invalidate');
  const organization = new OrganizationService(prisma); const finance = new RecordsFinanceService();
  const service = new RecordsService(prisma, new NumberSequenceService(prisma), organization, finance, rbac);
  return { service, db: Object.assign(db, delegates), invalidate, organization, finance };
}

describe('administrator record management', () => {
  it('denies every operation to non-system administrators before touching data', async () => {
    const { service, db } = setup(); const user = { ...admin, isSystemAdmin: false };
    expect(() => service.catalog(user)).toThrow(ForbiddenException);
    for (const operation of [() => service.list(user, 'partners', new PageQueryDto()), () => service.get(user, 'partners', 'p'),
      () => service.lookup(user, 'partners', 'countryCode'), () => service.create(user, 'partners', {}),
      () => service.update(user, 'partners', 'p', {}), () => service.remove(user, 'partners', ['p']), () => service.restore(user, 'partners', 'p')]) {
      await expect(operation()).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(db.$transaction).not.toHaveBeenCalled(); expect(db.businessPartner.findMany).not.toHaveBeenCalled();
  });
  it('allows only catalog resources, including when prototype names are supplied', async () => {
    const { service } = setup();
    for (const key of ['auditLog','refreshToken','constructor','__proto__']) await expect(service.list(admin, key, new PageQueryDto())).rejects.toBeInstanceOf(NotFoundException);
  });
  it('never exposes authentication secrets and gives every catalog a usable column', () => {
    const { service } = setup();
    const catalog = service.catalog(admin);
    for (const item of catalog) expect(item.columns.length).toBeGreaterThan(0);
    const fields = catalog.find((item) => item.key === 'users')!.fields.map((field) => field.name);
    expect(fields).not.toContain('passwordHash'); expect(fields).not.toContain('mfaSecret'); expect(fields).not.toContain('entraObjectId');
    expect(recordFields(RECORD_RESOURCES.requests).find((field) => field.name === 'requesterId')).toMatchObject({ readOnly: false, required: true, reference: { model: 'Employee' } });
  });
  it('rejects tenant, calculated, workflow state and unknown fields', async () => {
    const { service, db } = setup();
    for (const field of ['companyId','grossAmount','status','arbitrary']) await expect(service.update(admin, 'invoices', 'i', { [field]: 'changed' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update(admin, 'users', 'u', { passwordHash: 'changed' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update(admin, 'users', 'u', { password: 'changed' })).rejects.toBeInstanceOf(BadRequestException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('applies company scope through parent relations and keeps shared reference data usable', async () => {
    const { service, db } = setup();
    await service.list(admin, 'certificates', new PageQueryDto());
    expect(db.employeeCertificate.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { employee: { companyId: admin.companyId, deletedAt: null } } }));
    await service.list(admin, 'countries', new PageQueryDto());
    expect(db.country.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    await expect(service.list({ ...admin, companyId: null }, 'employees', new PageQueryDto())).rejects.toBeInstanceOf(BadRequestException);
  });
  it('rejects references from another company before writing', async () => {
    const { service, db } = setup();
    await expect(service.create(admin, 'contacts', { partnerId: 'foreign-partner', firstName: 'Real', lastName: 'Contact' })).rejects.toThrow('active company');
    expect(db.businessPartner.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: admin.companyId, deletedAt: null, id: 'foreign-partner' } }));
    expect(db.contact.create).not.toHaveBeenCalled();
  });
  it('includes selected relationship values even when the search or page excludes them', async () => {
    const { service, db } = setup();
    db.user.findMany.mockResolvedValueOnce([{ id: 'a', firstName: 'First', lastName: 'User' }]);
    db.user.findMany.mockResolvedValueOnce([{ id: 'b', firstName: 'Second', lastName: 'User' }, { id: 'c', firstName: 'Third', lastName: 'User' }]);
    const choices = await service.lookup(admin, 'groups', 'userIds', 'First', 'a,b,c');
    expect(choices.map((choice) => choice.value)).toEqual(['b','c','a']);
    expect(db.user.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { deletedAt: null, id: { in: ['b','c'] } } }));
  });
  it('validates company fiscal year and office codes with the native DTO rules', async () => {
    const { service, organization } = setup(); const create = vi.spyOn(organization, 'create');
    await expect(service.create(admin, 'companies', { code: 'REAL', name: 'Real company', fiscalYearStart: 13 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(admin, 'offices', { code: 'bad code', name: 'Real office' })).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });
  it('prevents editing and deleting posted invoices', async () => {
    const { service, db } = setup(); db.invoice.findFirst.mockResolvedValue({ id: 'i', status: 'PAID' });
    await expect(service.update(admin, 'invoices', 'i', { reference: 'new' })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.remove(admin, 'invoices', ['i'])).rejects.toBeInstanceOf(ConflictException);
    expect(db.invoice.update).not.toHaveBeenCalled();
  });
  it('blocks a bulk deletion before any record is removed if a dependency exists', async () => {
    const { service, db } = setup();
    db.skill.findFirst.mockImplementation(async () => ({ id: 'skill', name: 'Skill' }));
    db.employeeSkill.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    await expect(service.remove(admin, 'skills', ['one','two'])).rejects.toThrow('still used');
    expect(db.skill.delete).not.toHaveBeenCalled();
  });
  it('archives unused records and excludes them from normal lists', async () => {
    const { service, db } = setup(); db.department.findFirst.mockResolvedValue({ id: 'category', name: 'Real category', isActive: true });
    await service.remove(admin, 'departments', ['category']);
    expect(db.department.update).toHaveBeenCalledWith({ where: { id: 'category' }, data: { deletedAt: expect.any(Date), isActive: false } });
    await service.list(admin, 'departments', new PageQueryDto());
    expect(db.department.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { deletedAt: null, companyId: admin.companyId } }));
    await service.list(admin, 'departments', new PageQueryDto(), true);
    expect(db.department.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { deletedAt: { not: null }, companyId: admin.companyId } }));
  });
  it('restores archived records without silently reactivating them', async () => {
    const { service, db } = setup(); db.department.findFirst.mockResolvedValue({ id: 'a', name: 'Archived', isActive: false, deletedAt: new Date() });
    await service.restore(admin, 'departments', 'a');
    expect(db.department.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { deletedAt: null } });
  });
  it('protects built-in roles, administrator accounts, and self deactivation', async () => {
    const { service, db } = setup();
    db.role.findFirst.mockResolvedValue({ id: 'role', isSystem: true, permissions: [] });
    await expect(service.update(admin, 'roles', 'role', { name: 'changed' })).rejects.toThrow('Built-in');
    db.user.findFirst.mockResolvedValue({ id: 'another-admin', isSystemAdmin: true, userRoles: [] });
    await expect(service.remove(admin, 'users', ['another-admin'])).rejects.toThrow('System administrators');
    await expect(service.update(admin, 'users', 'another-admin', { isActive: false })).rejects.toThrow('System administrators');
    db.user.findFirst.mockResolvedValue({ id: admin.id, isSystemAdmin: false, userRoles: [] });
    await expect(service.update(admin, 'users', admin.id, { isActive: false })).rejects.toThrow('own account');
  });
  it('prevents changing account balances or currency after movements exist', async () => {
    const { service, db } = setup(); db.bankAccount.findFirst.mockResolvedValue({ id: 'bank', name: 'Bank', currencyCode: 'EUR', openingBalance: new Prisma.Decimal('100') });
    db.currency.findFirst.mockResolvedValue({ code: 'USD' });
    db.bankAccount.findUniqueOrThrow.mockResolvedValue({ id: 'bank', currencyCode: 'EUR', openingBalance: new Prisma.Decimal('100') }); db.payment.count.mockResolvedValue(1);
    await expect(service.update(admin, 'bankAccounts', 'bank', { openingBalance: '101' })).rejects.toThrow('Opening balances');
    await expect(service.update(admin, 'bankAccounts', 'bank', { currencyCode: 'USD' })).rejects.toThrow('Account currency');
    await service.update(admin, 'bankAccounts', 'bank', { openingBalance: '100' });
    expect(db.bankAccount.update).toHaveBeenCalledOnce();
  });
  it('requires module creation for records with allocation or approval workflows', async () => {
    const { service } = setup();
    for (const key of ['payments','leave','budgets','proposals','costCenters']) await expect(service.create(admin, key, {})).rejects.toThrow('module page');
  });
  it('detects hierarchy cycles before writing a new parent', async () => {
    const { service, db } = setup(); db.department.findFirst.mockResolvedValue({ id: 'self', name: 'Department' });
    await expect(service.update(admin, 'departments', 'self', { parentId: 'self' })).rejects.toThrow('own ancestor');
    expect(db.department.update).not.toHaveBeenCalled();
  });
  it('updates a custom role and immediately invalidates cached permissions', async () => {
    const { service, db, invalidate } = setup(); db.role.findFirst.mockResolvedValue({ id: 'r', isSystem: false, permissions: [] });
    await service.update(admin, 'roles', 'r', { name: 'Real role', permissionCodes: [] });
    expect(db.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { roleId: 'r' } });
    expect(db.role.update).toHaveBeenCalledWith({ where: { id: 'r' }, data: { name: 'Real role', permissions: { create: [] } } });
    expect(invalidate).toHaveBeenCalledOnce();
  });
  it('clears completion timestamps when a task is reopened', async () => {
    const { service, db } = setup(); db.task.findFirst.mockResolvedValue({ id: 't', status: 'DONE' });
    await service.update(admin, 'tasks', 't', { status: 'OPEN' });
    expect(db.task.update).toHaveBeenCalledWith({ where: { id: 't' }, data: { status: 'OPEN', completedAt: null } });
  });
  it('rejects deleting more than 100 records or duplicate selections', async () => {
    const { service } = setup();
    await expect(service.remove(admin, 'skills', ['a','a'])).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.remove(admin, 'skills', Array.from({ length: 101 }, (_, index) => String(index)))).rejects.toBeInstanceOf(BadRequestException);
  });
  it('protects reference values used by scalar links without database foreign keys', async () => {
    const { service, db } = setup(); db.currency.findFirst.mockResolvedValue({ code: 'EUR', name: 'Euro' });
    db.company.count.mockResolvedValue(1);
    await expect(service.remove(admin, 'currencies', ['EUR'])).rejects.toThrow('still used by Companies');
    expect(db.currency.delete).not.toHaveBeenCalled();
  });
  it('accepts exchange rates to eight decimal places and rejects zero rates', async () => {
    const { service, db } = setup(); db.exchangeRate.findFirst.mockResolvedValue({ id: 'rate', currencyCode: 'EUR', rateToEUR: new Prisma.Decimal(1) });
    await service.update(admin, 'exchangeRates', 'rate', { rateToEUR: '0.12345678' });
    expect(db.exchangeRate.update).toHaveBeenCalledWith({ where: { id: 'rate' }, data: { rateToEUR: '0.12345678' } });
    await expect(service.update(admin, 'exchangeRates', 'rate', { rateToEUR: '0' })).rejects.toThrow('positive');
  });
  it('keeps tax rates already used by invoices from changing their history', async () => {
    const { service, db } = setup(); db.taxCode.findFirst.mockResolvedValue({ id: 'vat', ratePercent: new Prisma.Decimal(19) });
    db.taxCode.findUniqueOrThrow.mockResolvedValue({ id: 'vat', ratePercent: new Prisma.Decimal(19) }); db.invoiceLine.count.mockResolvedValue(1);
    await expect(service.update(admin, 'taxCodes', 'vat', { ratePercent: '20' })).rejects.toThrow('used by invoices');
    await service.update(admin, 'taxCodes', 'vat', { ratePercent: '19', name: 'Real VAT label' });
    expect(db.taxCode.update).toHaveBeenCalledOnce();
  });
});
