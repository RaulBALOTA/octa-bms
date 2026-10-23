import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { RecordsService } from '../src/modules/records/records.service';
import { RecordsFinanceService } from '../src/modules/records/records-finance.service';
import { RECORD_RESOURCES, recordFields, RecordField } from '../src/modules/records/record-catalog';
import { OrganizationService } from '../src/modules/master-data/organization.service';
import { NumberSequenceService } from '../src/modules/master-data/number-sequence.service';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { RbacService } from '../src/core/rbac/rbac.service';
import type { AuthUser } from '../src/core/auth/decorators';
import { PageQueryDto } from '../src/common/pagination';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OpportunitiesService } from '../src/modules/sales/opportunities.service';
import { PartnersService } from '../src/modules/crm/partners.service';
import { ListPartnersQuery } from '../src/modules/crm/dto';
import { BudgetsController } from '../src/modules/finance/budgets.controller';

const prisma = new PrismaClient();
const nonce = randomUUID().slice(0, 8);
const email = `records-check-${nonce}@example.invalid`;
const rollback = new Error('Rollback verification');
async function main() {
  try {
    await prisma.$transaction(async (tx) => {
      const testUser = await tx.user.create({ data: { email, firstName: 'Temporary', lastName: 'Verification' } });
      const company = await tx.company.create({ data: { code: `CHECK-${nonce}`, name: 'Temporary CRUD verification', memberships: { create: { userId: testUser.id } } } });
      const db = { ...tx, $transaction: (fn: (db: Prisma.TransactionClient) => Promise<unknown>) => fn(tx) } as unknown as PrismaService;
      const user: AuthUser = { id: testUser.id, email, isSystemAdmin: true, companyId: company.id, permissions: [] };
      const service = new RecordsService(db, new NumberSequenceService(db), new OrganizationService(db), new RecordsFinanceService(), new RbacService(db));
      const query = new PageQueryDto();
      for (const resource of service.catalog(user)) {
        await service.list(user, resource.key, query);
        for (const field of resource.fields) {
          if (field.reference) await service.lookup(user, resource.key, field.name, '');
          for (const child of field.fields ?? []) if (child.reference) await service.lookup(user, resource.key, `${field.name}.${child.name}`, '');
        }
      }
      console.log(`All ${Object.keys(RECORD_RESOURCES).length} catalogs and scoped relationship lookups work against PostgreSQL.`);
      await tx.businessPartner.create({ data: { companyId: company.id, partnerNumber: `SUP-${nonce}`, type: 'SUPPLIER', name: 'Temporary supplier' } });
      const created: { key: string; id: string }[] = [];
      async function values(key: string, fields: RecordField[], prefix = ''): Promise<Record<string, unknown>> {
        const data: Record<string, unknown> = {};
        for (const field of fields.filter((field) => !field.readOnly)) {
          const path = prefix + field.name;
          if (!field.required && !field.fields) {
            if (field.list) data[field.name] = [];
            else if (field.default !== undefined) data[field.name] = field.type === 'Decimal' ? String(field.default) : field.default;
            else if (field.nullable) data[field.name] = null;
            continue;
          }
          if (field.fields) data[field.name] = [await values(key, field.fields, `${field.name}.`)];
          else if (field.list) data[field.name] = [];
          else if (field.reference) {
            const choices = await service.lookup(user, key, path);
            const preferred = key === 'orders' ? choices.find((item) => item.label === 'Temporary supplier') : choices[0];
            assert.ok(preferred, `No reference for ${key}.${path}`); data[field.name] = preferred.value;
          } else if (field.values) data[field.name] = field.values[0];
          else if (field.type === 'Int' || field.type === 'Float') data[field.name] = ['year'].includes(field.name) ? 2026 : 2;
          else if (field.type === 'Decimal') data[field.name] = '2.00';
          else if (field.type === 'Boolean') data[field.name] = false;
          else if (field.type === 'DateTime') data[field.name] = '2026-10-12T00:00:00.000Z';
          else if (field.type === 'Json') data[field.name] = key === 'workflows' ? { steps: [{ code: 'review', type: 'APPROVAL' }] } : {};
          else if (field.type === 'Password') data[field.name] = 'Temporary-verification-123!';
          else if (/email/i.test(field.name)) data[field.name] = `${key}-${nonce}@example.invalid`;
          else data[field.name] = `CHECK-${nonce}-${key}-${field.name}`;
        }
        if (key === 'countries') Object.assign(data, { code: 'ZQ', name: 'Temporary country' });
        if (key === 'currencies') Object.assign(data, { code: 'ZQQ', name: 'Temporary currency', symbol: 'Z' });
        if (key === 'languages') data.code = `z-${nonce}`;
        if (key === 'partners') Object.assign(data, { type: 'CLIENT', name: 'Temporary client' });
        if (key === 'evaluations') Object.assign(data, { quality: 2, delivery: 3, price: 4, communication: 5 });
        return data;
      }
      for (const [key, definition] of Object.entries(RECORD_RESOURCES)) {
        if (definition.createNative) continue;
        const input = await values(key, recordFields(definition));
        console.log(`Checking ${key}`);
        const result = await service.create(user, key, input);
        assert.ok(result.id, `${key} created`);
        created.push({ key, id: result.id });
        const fetched = await service.get(user, key, result.id);
        assert.equal(fetched._key, result.id);
        const fields = recordFields(definition).filter((field) => !field.readOnly && !field.createOnly && !field.fields && !field.reference && !field.list);
        const text = fields.find((field) => ['name','title','description','note','subject'].includes(field.name) && field.type === 'String' && !field.values);
        const update: Record<string, unknown> = {};
        function current(fields: RecordField[], row: Record<string, unknown>): Record<string, unknown> {
          return Object.fromEntries(fields.filter((field) => !field.readOnly && !field.createOnly).map((field) => {
            const value = row[field.name];
            return [field.name, field.fields ? (value as Record<string, unknown>[]).map((item) => current(field.fields!, item)) : field.type === 'Decimal' && value != null ? String(value) : value instanceof Date ? value.toISOString() : value];
          }).filter(([, value]) => value !== undefined));
        }
        Object.assign(update, current(recordFields(definition), fetched));
        if (text) update[text.name] = `Updated ${key}`;
        await service.update(user, key, result.id, update);
        const edited = await service.get(user, key, result.id);
        if (text) assert.equal(edited[text.name], `Updated ${key}`);
      }
      const invoice = created.find((row) => row.key === 'invoices')!;
      await service.update(user, 'invoices', invoice.id, { lines: [{ description: 'Replacement', quantity: '3', unitPrice: '10.01', taxCodeId: (await service.lookup(user, 'invoices', 'lines.taxCodeId'))[0].value }] });
      assert.equal(String((await service.get(user, 'invoices', invoice.id)).netAmount), '30.03');
      const employee = created.find((row) => row.key === 'employees')!;
      const opportunity = created.find((row) => row.key === 'opportunities')!;
      const native = [
        { key: 'proposals', row: await tx.proposal.create({ data: { companyId: company.id, opportunityId: opportunity.id, proposalNumber: `CHECK-${nonce}`, title: 'Temporary proposal' } }), input: { title: 'Real proposal' } },
        { key: 'budgets', row: await tx.budget.create({ data: { companyId: company.id, year: 2026, name: 'Temporary budget' } }), input: { name: 'Real budget' } },
        { key: 'costCenters', row: await tx.costCenter.create({ data: { companyId: company.id, code: `CHECK-${nonce}`, name: 'Temporary cost center' } }), input: { name: 'Real cost center' } },
        { key: 'leave', row: await tx.leaveRequest.create({ data: { employeeId: employee.id, type: 'VACATION', startDate: new Date('2026-11-02'), endDate: new Date('2026-11-03'), days: '2' } }), input: { note: 'Real note' } },
      ];
      for (const record of native) {
        await service.update(user, record.key, record.row.id, record.input);
        assert.ok(await service.get(user, record.key, record.row.id));
        if (record.key === 'budgets') {
          const overview = await new BudgetsController(db).overview(company.id, '2026');
          assert.equal(overview.budgetId, record.row.id); assert.equal(overview.budgetName, 'Real budget');
        }
        await service.remove(user, record.key, [record.row.id]);
        await assert.rejects(service.get(user, record.key, record.row.id));
        if (record.key === 'proposals') {
          const nativeSales = new OpportunitiesService(db, new NumberSequenceService(db), new EventEmitter2());
          assert.equal((await nativeSales.get(company.id, opportunity.id)).proposals.some((item) => item.id === record.row.id), false);
        }
      }
      for (const record of [...created].reverse()) {
        console.log(`Deleting ${record.key}`);
        await service.remove(user, record.key, [record.id]);
        await assert.rejects(service.get(user, record.key, record.id));
        if (record.key === 'contacts') {
          const nativeCrm = new PartnersService(db, new NumberSequenceService(db), new EventEmitter2());
          const partner = created.find((item) => item.key === 'partners')!;
          assert.equal((await nativeCrm.get(company.id, partner.id)).contacts.some((item) => item.id === record.id), false);
          const listing = await nativeCrm.list(company.id, new ListPartnersQuery());
          assert.equal(listing.data.find((item) => item.id === partner.id)!._count.contacts, 0);
        }
      }
      const bank = await tx.bankAccount.create({ data: { companyId: company.id, name: 'Temporary reversal check', iban: `CHECK-REVERSAL-${nonce}` } });
      const partner = await tx.businessPartner.create({ data: { companyId: company.id, partnerNumber: `REV-${nonce}`, type: 'CLIENT', name: 'Temporary reversal customer' } });
      const settled = await tx.invoice.create({ data: { companyId: company.id, partnerId: partner.id, direction: 'OUTGOING', invoiceNumber: `REV-${nonce}`, invoiceDate: new Date(), dueDate: new Date('2099-01-01'), netAmount: '10', taxAmount: '1.9', grossAmount: '11.9', paidAmount: '11.9', status: 'PAID' } });
      const payment = await tx.payment.create({ data: { bankAccountId: bank.id, paymentDate: new Date(), direction: 'IN', amount: '11.9', reference: 'Temporary settlement', allocations: { create: { invoiceId: settled.id, amount: '11.9' } } } });
      await service.update(user, 'payments', payment.id, { counterparty: 'Real counterparty' });
      await service.remove(user, 'payments', [payment.id]);
      const reversed = await tx.invoice.findUniqueOrThrow({ where: { id: settled.id } });
      assert.equal(reversed.paidAmount.toString(), '0'); assert.equal(reversed.status, 'SENT');
      const balancing = await tx.payment.findFirstOrThrow({ where: { reference: `REVERSAL:${payment.id}` }, include: { allocations: true } });
      assert.equal(balancing.direction, 'OUT'); assert.equal(balancing.allocations[0].amount.toString(), '-11.9');
      await assert.rejects(service.remove(user, 'payments', [payment.id]));
      await assert.rejects(service.update(user, 'payments', balancing.id, { reference: 'Change reversal' }));
      console.log('Verified native-created records and balanced payment reversal against PostgreSQL.');
      throw rollback;
    }, { timeout: 120000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) { if (error !== rollback) throw error; }
  assert.equal(await prisma.user.count({ where: { email } }), 0);
  console.log('All verification records rolled back; no existing records changed.');
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
