import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { validate as validateDto } from 'class-validator';
import { RbacService } from '../../core/rbac/rbac.service';
import { AuthUser } from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PageQueryDto, paged } from '../../common/pagination';
import { NumberSequenceService } from '../master-data/number-sequence.service';
import { OrganizationService } from '../master-data/organization.service';
import { CreateCompanyDto, CreateOfficeDto, UpdateCompanyDto, UpdateOfficeDto } from '../master-data/organization.dto';
import { CostCentersController } from '../master-data/cost-centers.controller';
import { HIDDEN_FIELDS, RECORD_MODELS, RECORD_RESOURCES, RecordField, ResourceDefinition, recordFields } from './record-catalog';
import { RecordsFinanceService } from './records-finance.service';
import { SearchIndexService } from '../search/search-index.service';

type Data = Record<string, unknown>;
interface Delegate {
  findMany(args: Data): Promise<Data[]>; findFirst(args: Data): Promise<Data | null>; count(args: Data): Promise<number>;
  create(args: Data): Promise<Data>; update(args: Data): Promise<Data>; updateMany(args: Data): Promise<{ count: number }>;
  delete(args: Data): Promise<Data>; deleteMany(args: Data): Promise<{ count: number }>;
}
type Client = Prisma.TransactionClient;
const SYSTEM_COLUMN_FIELDS = new Set(['id','companyId','createdAt','updatedAt','deletedAt','createdById','updatedById','ownerId','authorId','creatorId','requesterId','evaluatedById']);
const lower = (value: string) => value[0].toLowerCase() + value.slice(1);
const label = (row: Data) => ['name','title','subject','invoiceNumber','contractNumber','employeeNumber','code','caseNumber','policyNumber','guaranteeNumber','orderNumber','requestNumber','assetNumber','reference','counterparty','description'].map((key) => row[key]).find((value) => typeof value === 'string' && value.length)
  ?? ([row.firstName,row.lastName].filter(Boolean).join(' ') || row.email || row.id || 'Record');

@Injectable()
export class RecordsService {
  constructor(private readonly prisma: PrismaService, private readonly sequences: NumberSequenceService,
    private readonly organization: OrganizationService, private readonly finance: RecordsFinanceService,
    private readonly rbac: RbacService, @Optional() private readonly search?: SearchIndexService) {}

  private admin(user: AuthUser) { if (!user.isSystemAdmin) throw new ForbiddenException('Data management requires a system administrator'); }
  private definition(key: string) {
    if (!Object.hasOwn(RECORD_RESOURCES, key)) throw new NotFoundException('Unknown record type');
    return RECORD_RESOURCES[key];
  }
  private model(name: string) { const model = RECORD_MODELS.get(name); if (!model) throw new NotFoundException('Unknown model'); return model; }
  private delegate(tx: Client, name: string): Delegate { return (tx as unknown as Record<string, Delegate>)[lower(name)]; }
  private scope(definition: ResourceDefinition, companyId: string | null): Data {
    const model = this.model(definition.model);
    const where: Data = model.fields.some((field) => field.name === 'deletedAt') ? { deletedAt: null } : {};
    const company = model.fields.find((field) => field.name === 'companyId');
    if (company) {
      if (!companyId) throw new BadRequestException('Select an active company first');
      Object.assign(where, company.isRequired ? { companyId } : { OR: [{ companyId }, { companyId: null }] });
    } else if (definition.scope) {
      const relation = model.fields.find((field) => field.name === definition.scope && field.kind === 'object');
      if (relation) {
        const parent = Object.values(RECORD_RESOURCES).find((item) => item.model === relation.type) ?? { model: relation.type, module: '', en: '', de: '' };
        const parentScope = this.scope(parent, companyId);
        Object.assign(where, relation.isRequired ? { [relation.name]: parentScope } : { OR: [{ [relation.name]: null }, { [relation.name]: parentScope }] });
      }
    }
    return where;
  }
  private primary(definition: ResourceDefinition) { const key = this.model(definition.model).fields.find((field) => field.isId); if (!key) throw new BadRequestException('This record needs its own management page'); return key.name; }
  private select(definition: ResourceDefinition, companyId: string | null): Data {
    const select: Data = Object.fromEntries(recordFields(definition).filter((field) => !field.fields && field.type !== 'Password' && this.model(definition.model).fields.some((item) => item.name === field.name)).map((field) => [field.name, true]));
    if (definition.children) select[definition.children.field] = true;
    if (definition.model === 'User') select.userRoles = { where: { companyId }, select: { roleId: true } };
    if (definition.model === 'Role') select.permissions = { select: { permission: { select: { code: true } } } };
    if (definition.model === 'Group') select.members = { select: { userId: true } };
    return select;
  }
  private publicRow(definition: ResourceDefinition, row: Data) {
    const result: Data & { _key: string; _label: string } = { ...row, _key: String(row[this.primary(definition)]), _label: String(label(row)) };
    if (definition.model === 'User') { result.roleIds = (row.userRoles as { roleId: string }[]).map((item) => item.roleId); delete result.userRoles; }
    if (definition.model === 'Role') { result.permissionCodes = (row.permissions as { permission: { code: string } }[]).map((item) => item.permission.code); delete result.permissions; }
    if (definition.model === 'Group') { result.userIds = (row.members as { userId: string }[]).map((item) => item.userId); delete result.members; }
    for (const key of HIDDEN_FIELDS) delete result[key];
    return result;
  }
  catalog(user: AuthUser) {
    this.admin(user);
    return Object.entries(RECORD_RESOURCES).map(([key, definition]) => ({ key, module: definition.module, name: { en: definition.en, de: definition.de }, fields: recordFields(definition),
      native: definition.native, createNative: !!definition.createNative, companyScoped: !!definition.scope || this.model(definition.model).fields.some((field) => field.name === 'companyId'),
      canArchive: this.model(definition.model).fields.some((field) => field.name === 'deletedAt'), deleteAction: definition.model === 'Payment' ? 'reverse' : 'delete',
      columns: [...new Set(['name','title','subject','firstName','lastName','email','code',definition.number?.field,'employeeId','partnerId','supplierId','reference','counterparty','paymentDate','amount','bankAccountId','skillId','trainingId','assetId','description','year','status','stage','isActive',
        ...recordFields(definition).filter((field) => !field.fields && !field.list && !SYSTEM_COLUMN_FIELDS.has(field.name)).map((field) => field.name)]
        .filter((key): key is string => !!key && recordFields(definition).some((field) => field.name === key)))].slice(0, 6),
    }));
  }
  async list(user: AuthUser, key: string, query: PageQueryDto, archived = false) {
    this.admin(user); const definition = this.definition(key); const delegate = this.delegate(this.prisma, definition.model);
    const where = this.scope(definition, user.companyId);
    if (archived && this.model(definition.model).fields.some((field) => field.name === 'deletedAt')) where.deletedAt = { not: null };
    if (query.q) {
      const searchable = this.model(definition.model).fields.filter((field) => field.type === 'String' && !field.isList && field.name !== 'id' && !field.name.endsWith('Id') && !HIDDEN_FIELDS.has(field.name)).slice(0, 12);
      if (searchable.length) where.AND = [{ OR: searchable.map((field) => ({ [field.name]: { contains: query.q, mode: 'insensitive' } })) }];
    }
    const [rows, total] = await Promise.all([delegate.findMany({ where, select: this.select(definition, user.companyId), orderBy: { [this.primary(definition)]: 'asc' }, skip: query.skip, take: query.pageSize }), delegate.count({ where })]);
    const data = rows.map((row) => this.publicRow(definition, row));
    await this.references(definition, data, user.companyId);
    return paged(data, total, query);
  }
  async get(user: AuthUser, key: string, id: string, tx: Client = this.prisma, archived = false) {
    this.admin(user); const definition = this.definition(key); const where = { ...this.scope(definition, user.companyId), [this.primary(definition)]: id };
    if (archived) where.deletedAt = { not: null };
    const row = await this.delegate(tx, definition.model).findFirst({ where, select: this.select(definition, user.companyId) });
    if (!row) throw new NotFoundException('Record not found in the active company');
    const result = this.publicRow(definition, row); await this.references(definition, [result], user.companyId, tx); return result;
  }
  private targetScope(name: string, companyId: string | null) {
    return this.scope(Object.values(RECORD_RESOURCES).find((definition) => definition.model === name) ?? { model: name, module: '', en: '', de: '' }, companyId);
  }
  private async references(definition: ResourceDefinition, rows: Data[], companyId: string | null, tx: Client = this.prisma) {
    for (const field of recordFields(definition)) {
      if (field.fields && definition.children) {
        await this.references({ model: definition.children.model, module: '', en: '', de: '' }, rows.flatMap((row) => row[field.name] as Data[] ?? []), companyId, tx);
      }
      if (!field.reference) continue;
      const reference = field.reference!; const ids = [...new Set(rows.flatMap((row) => field.list ? row[field.name] as string[] ?? [] : [row[field.name]]).filter((value): value is string => typeof value === 'string'))];
      if (!ids.length) continue;
      const target = this.model(reference.model); const select = this.lookupSelect(target.name, reference.key);
      const values = await this.delegate(tx, target.name).findMany({ where: { ...this.targetScope(target.name, companyId), [reference.key]: { in: ids } }, select });
      const byId = new Map(values.map((row) => [String(row[reference.key]), String(label(row))]));
      for (const row of rows) {
        if (field.list) row._referenceLists = { ...(row._referenceLists as Data ?? {}), [field.name]: (row[field.name] as string[] ?? []).map((id) => byId.get(id) ?? null) };
        else row._references = { ...(row._references as Data ?? {}), [field.name]: byId.get(String(row[field.name])) ?? null };
      }
    }
  }
  private lookupSelect(name: string, key: string): Data {
    const model = this.model(name); return Object.fromEntries(model.fields.filter((field) => field.name === key || ['name','title','firstName','lastName','code','email','invoiceNumber','contractNumber','employeeNumber','subject','assetNumber','requestNumber','orderNumber','caseNumber','policyNumber','guaranteeNumber'].includes(field.name)).map((field) => [field.name, true]));
  }
  async lookup(user: AuthUser, key: string, fieldPath: string, q = '', selected?: string) {
    this.admin(user); const definition = this.definition(key); const parts = fieldPath.split('.');
    let field = recordFields(definition).find((field) => field.name === parts[0]);
    if (parts[1]) field = field?.fields?.find((child) => child.name === parts[1]);
    if (!field?.reference) throw new NotFoundException('Unknown relationship');
    const reference = field.reference; const select = this.lookupSelect(reference.model, reference.key);
    const where = this.targetScope(reference.model, user.companyId);
    if (q) where.AND = [{ OR: Object.keys(select).filter((key) => key !== 'id').map((key) => ({ [key]: { contains: q, mode: 'insensitive' } })) }];
    const rows = await this.delegate(this.prisma, reference.model).findMany({ where, select, take: 200, orderBy: { [reference.key]: 'asc' } });
    const missing = (selected?.split(',').slice(0, 500) ?? []).filter((id) => id && !rows.some((row) => row[reference.key] === id));
    if (missing.length) {
      const current = await this.delegate(this.prisma, reference.model).findMany({ where: { ...this.targetScope(reference.model, user.companyId), [reference.key]: { in: missing } }, select });
      rows.unshift(...current);
    }
    return rows.map((row) => ({ value: String(row[reference.key]), label: String(label(row)) }));
  }
  private validate(fields: RecordField[], input: Data, creating: boolean): Data {
    const data: Data = {};
    for (const [key, value] of Object.entries(input)) {
      const field = fields.find((field) => field.name === key);
      if (!field || field.readOnly || (!creating && field.createOnly)) throw new BadRequestException(`Field ${key} cannot be changed`);
      if (value === null) { if (!field.nullable) throw new BadRequestException(`${key} cannot be empty`); data[key] = field.type === 'Json' ? Prisma.DbNull : null; continue; }
      if (field.type === 'Rows') {
        if (!Array.isArray(value) || value.length < 1 || value.length > 200 || value.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new BadRequestException(`${key} needs between 1 and 200 rows`);
        data[key] = value.map((row) => this.validate(field.fields ?? [], row as Data, true)); continue;
      }
      if (field.list) {
        if (!Array.isArray(value) || value.length > 500 || value.some((item) => typeof item !== 'string' || item.length > 1000)) throw new BadRequestException(`${key} must be a list of text values`);
        data[key] = [...new Set(value)]; continue;
      }
      if (field.type === 'Boolean') { if (typeof value !== 'boolean') throw new BadRequestException(`${key} must be true or false`); data[key] = value; }
      else if (['Int','Float'].includes(field.type)) {
        if (typeof value !== 'number' || !Number.isFinite(value) || (field.type === 'Int' && (!Number.isInteger(value) || value < -2147483648 || value > 2147483647))) throw new BadRequestException(`${key} must be a valid number`);
        data[key] = value;
        if (key === 'probability' && (value < 0 || value > 100)) throw new BadRequestException('Probability must be between 0 and 100');
        if (['paymentTermDays','durationMin','seats','capacity','entitlement','carriedOver'].includes(key) && value < 0) throw new BadRequestException(`${key} cannot be negative`);
      } else if (field.type === 'Decimal') {
        if (typeof value !== 'string' || !/^-?\d{1,16}(\.\d{1,8})?$/.test(value)) throw new BadRequestException(`${key} must be a decimal amount`);
        if (key === 'rateToEUR' && new Prisma.Decimal(value).lte(0)) throw new BadRequestException('Exchange rates must be positive');
        data[key] = value;
      } else if (field.type === 'DateTime') {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(T|$)/.test(value) || !Number.isFinite(Date.parse(value))) throw new BadRequestException(`${key} must be a valid date`);
        data[key] = new Date(value);
      } else if (field.type === 'Json') {
        if (!value || typeof value !== 'object' || JSON.stringify(value).length > 50000) throw new BadRequestException(`${key} must contain valid structured data`);
        data[key] = value;
      } else {
        if (typeof value !== 'string' || value.length > 20000 || (!field.nullable && !value.trim())) throw new BadRequestException(`${key} must contain text`);
        if (field.values && !field.values.includes(value)) throw new BadRequestException(`Invalid value for ${key}`);
        if (field.type === 'Password' && value.length < 12) throw new BadRequestException('Passwords must contain at least 12 characters');
        if (/email$/i.test(key) && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new BadRequestException(`${key} must be a valid email address`);
        data[key] = field.type === 'Password' ? value : value.trim();
      }
    }
    if (creating) for (const field of fields) if (field.required && !(field.name in data)) throw new BadRequestException(`${field.name} is required`);
    return data;
  }
  private async validateReferences(tx: Client, definition: ResourceDefinition, data: Data, companyId: string | null, id?: string) {
    for (const field of recordFields(definition)) {
      if (field.fields && Array.isArray(data[field.name])) {
        const child = definition.children!;
        for (const row of data[field.name] as Data[]) await this.validateReferences(tx, { model: child.model, module: '', en: '', de: '' }, row, companyId);
      }
      if (!field.reference || data[field.name] == null) continue;
      const reference = field.reference;
      const values = field.list ? data[field.name] as string[] : [String(data[field.name])];
      for (const value of values) {
        const target = await this.delegate(tx, reference.model).findFirst({ where: { ...this.targetScope(reference.model, companyId), [reference.key]: value }, select: { [reference.key]: true } });
        if (!target) throw new BadRequestException(`Choose a valid ${field.name} from the active company`);
        if (id && reference.model === definition.model) {
          let cursor: string | null = value; const visited = new Set<string>();
          while (cursor) {
            if (cursor === id || visited.has(cursor)) throw new BadRequestException('A record cannot be its own ancestor');
            visited.add(cursor);
            const parent: Data | null = await this.delegate(tx, definition.model).findFirst({ where: { [reference.key]: cursor }, select: { [field.name]: true } });
            cursor = typeof parent?.[field.name] === 'string' ? String(parent[field.name]) : null;
          }
        }
      }
    }
  }
  private state(definition: ResourceDefinition, row: Data, deleting: boolean) {
    const states = deleting ? definition.deleteStates ?? definition.states : definition.states;
    if (states && !states.includes(String(row[definition.stateField ?? 'status']))) throw new ConflictException(`This record is ${row[definition.stateField ?? 'status']}. Use its module page to cancel, amend, or change its state.`);
    if (definition.model === 'PaymentMilestone' && row.isInvoiced) throw new ConflictException('An invoiced milestone cannot be changed');
    if (definition.model === 'Role' && row.isSystem) throw new ConflictException('Built-in system roles cannot be changed; create a custom role instead');
  }
  private async transaction<T>(operation: (tx: Client) => Promise<T>) {
    try { return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 }); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') throw new ConflictException('This code or unique value is already used, including archived records. Edit or restore the existing record, or choose a new value.');
        if (error.code === 'P2003') throw new ConflictException('This record is linked to other data. Reassign those records or deactivate it first.');
        if (error.code === 'P2034') throw new ConflictException('Another operation changed these records. Please retry.');
        if (error.code === 'P2020') throw new BadRequestException('A numeric value exceeds the supported range for this record');
      }
      throw error;
    }
  }
  private async special(tx: Client, definition: ResourceDefinition, data: Data, user: AuthUser, id?: string) {
    if (definition.model === 'TaxCode' && id && data.ratePercent !== undefined) {
      const previous = await tx.taxCode.findUniqueOrThrow({ where: { id } });
      if (!previous.ratePercent.equals(String(data.ratePercent)) && await tx.invoiceLine.count({ where: { taxCodeId: id, invoice: { deletedAt: null } } })) throw new ConflictException('This tax rate is used by invoices. Create a new tax code for a different rate.');
    }
    if (definition.model === 'SoftwareLicense') {
      const previous = id ? await tx.softwareLicense.findUniqueOrThrow({ where: { id } }) : null;
      const seats = Number(data.seats ?? previous?.seats ?? 1);
      const assigned = (data.assignedUserIds ?? previous?.assignedUserIds ?? []) as string[];
      if (!Number.isInteger(seats) || seats < 1 || assigned.length > seats) throw new BadRequestException('License seats must cover all assigned users');
      data.usedSeats = assigned.length;
    }
    if (definition.model === 'WorkflowDefinition' && data.definition) {
      const steps = (data.definition as Data).steps;
      if (!Array.isArray(steps) || !steps.length || steps.some((step) => !step || typeof step !== 'object' || typeof step.code !== 'string' || typeof step.type !== 'string')) throw new BadRequestException('A workflow needs valid steps with a code and a type');
      if (id) data.version = { increment: 1 };
    }
    if (definition.model === 'Task' && data.status !== undefined) data.completedAt = data.status === 'DONE' ? new Date() : null;
    if (definition.model === 'User') {
      if (typeof data.email === 'string') data.email = data.email.toLowerCase();
      if (id === user.id && data.isActive === false) throw new ConflictException('You cannot deactivate your own account');
      if (!id) { data.passwordHash = await argon2.hash(String(data.password)); delete data.password; data.memberships = { create: { companyId: user.companyId } }; }
    }
    for (const [virtual, relation, targetModel, targetKey, relationKey] of [
      ['permissionCodes','permissions','Permission','code','permissionId'], ['roleIds','userRoles','Role','id','roleId'], ['userIds','members','User','id','userId'],
    ]) {
      const values = data[virtual]; if (!Array.isArray(values)) continue;
      const selected = await this.delegate(tx, targetModel).findMany({ where: { [targetKey]: { in: values } }, select: { id: true } });
      const nested = selected.map((row) => ({ [relationKey]: row.id, ...(relation === 'userRoles' ? { companyId: user.companyId } : {}) }));
      if (id) {
        const join = relation === 'permissions' ? 'RolePermission' : relation === 'userRoles' ? 'UserRole' : 'UserGroup';
        const key = relation === 'permissions' ? 'roleId' : relation === 'userRoles' ? 'userId' : 'groupId';
        await this.delegate(tx, join).deleteMany({ where: { [key]: id, ...(relation === 'userRoles' ? { companyId: user.companyId } : {}) } });
      }
      data[relation] = { create: nested }; delete data[virtual];
    }
    if (definition.model === 'BankAccount' && id && (data.openingBalance !== undefined || data.currencyCode !== undefined)) {
      const account = await tx.bankAccount.findUniqueOrThrow({ where: { id } });
      if (data.openingBalance !== undefined && !account.openingBalance.equals(String(data.openingBalance)) && await tx.payment.count({ where: { bankAccountId: id } })) throw new ConflictException('Opening balances cannot change after bank movements have been recorded');
      if (data.currencyCode !== undefined && data.currencyCode !== account.currencyCode && await tx.payment.count({ where: { bankAccountId: id } })) throw new ConflictException('Account currency cannot change after bank movements have been recorded');
    }
    if (definition.model === 'KnowledgeArticle' && id && data.content !== undefined) {
      const previous = await tx.knowledgeArticle.findUniqueOrThrow({ where: { id } });
      if (data.content !== previous.content) {
        const last = await tx.articleVersion.findFirst({ where: { articleId: id }, orderBy: { version: 'desc' } });
        await tx.articleVersion.create({ data: { articleId: id, content: previous.content, version: (last?.version ?? 0) + 1, createdById: user.id } });
      }
    }
  }
  private async organizationInput<T extends object>(type: new () => T, data: Data): Promise<T> {
    const dto = Object.assign(new type(), data); const errors = await validateDto(dto);
    if (errors.length) throw new BadRequestException(errors.flatMap((error) => Object.values(error.constraints ?? {})).join('; '));
    return dto;
  }
  async create(user: AuthUser, key: string, input: Data) {
    this.admin(user); const definition = this.definition(key);
    if (definition.createNative) throw new ConflictException('Create this record using its module page');
    const data = this.validate(recordFields(definition), input, true);
    if (definition.model === 'Company') return this.organization.create(user, await this.organizationInput(CreateCompanyDto, data));
    if (definition.model === 'Office') return this.organization.createOffice(user, user.companyId!, await this.organizationInput(CreateOfficeDto, data));
    const result = await this.transaction(async (tx) => {
      await this.validateReferences(tx, definition, data, user.companyId);
      const model = this.model(definition.model); const names = new Set(model.fields.map((field) => field.name));
      if (names.has('companyId')) { if (!user.companyId) throw new BadRequestException('Select an active company first'); data.companyId = user.companyId; }
      for (const field of ['createdById','ownerId','authorId','creatorId','requesterId','evaluatedById']) if (names.has(field)) {
        const reference = recordFields(definition).find((item) => item.name === field)?.reference;
        if (!reference || reference.model === 'User') data[field] = user.id;
      }
      if (definition.number) {
        let { prefix, sequence } = definition.number;
        if (definition.model === 'BusinessPartner') { prefix = ({ CLIENT: 'C', SUPPLIER: 'S', PARTNER: 'P', AUTHORITY: 'A' } as Data)[String(data.type)] as string; sequence = `partner:${data.type}`; }
        if (definition.model === 'Invoice') { prefix = data.direction === 'OUTGOING' ? 'R' : 'ER'; sequence = `invoice:${data.direction}`; }
        data[definition.number.field] = await this.sequences.next(tx, user.companyId!, sequence, prefix);
      }
      await this.special(tx, definition, data, user);
      await this.finance.prepare(tx, definition.model, data, user.companyId!);
      const row = await this.delegate(tx, definition.model).create({ data });
      return { id: String(row[this.primary(definition)]) };
    });
    await this.search?.syncRecord(definition.model, result.id);
    return result;
  }
  async update(user: AuthUser, key: string, id: string, input: Data) {
    this.admin(user); const definition = this.definition(key); const data = this.validate(recordFields(definition), input, false);
    if (definition.model === 'Company') return this.organization.update(user, id, await this.organizationInput(UpdateCompanyDto, data));
    if (definition.model === 'Office') return this.organization.updateOffice(user, user.companyId!, id, await this.organizationInput(UpdateOfficeDto, data));
    if (definition.model === 'CostCenter') return new CostCentersController(this.prisma).update(user.companyId!, id, data);
    const result = await this.transaction(async (tx) => {
      const previous = await this.get(user, key, id, tx); this.state(definition, previous, false);
      if (definition.model === 'User' && data.isActive === false && previous.isSystemAdmin) throw new ConflictException('System administrators cannot be deactivated here');
      if (definition.model === 'Payment' && typeof previous.reference === 'string' && previous.reference.startsWith('REVERSAL:')) throw new ConflictException('A payment reversal cannot be edited');
      if (definition.model === 'Payment' && typeof data.reference === 'string' && data.reference.startsWith('REVERSAL:')) throw new BadRequestException('This reference prefix is reserved for payment reversals');
      if (definition.model === 'PurchaseOrder' && data.items && await tx.goodsReceipt.count({ where: { orderId: id } })) throw new ConflictException('Order items cannot change after goods have been received');
      if (definition.model === 'Invoice') {
        const invoiceDate = data.invoiceDate ?? new Date(String(previous.invoiceDate)); const dueDate = data.dueDate ?? new Date(String(previous.dueDate));
        if (dueDate instanceof Date && invoiceDate instanceof Date && dueDate < invoiceDate) throw new BadRequestException('Due date must not precede the invoice date');
      }
      await this.validateReferences(tx, definition, data, user.companyId, id);
      if (definition.model === 'SupplierEvaluation') for (const field of ['quality','delivery','price','communication']) if (!(field in data)) data[field] = previous[field];
      if (definition.model === 'PurchaseOrder' && data.items && !data.supplierId) data.supplierId = previous.supplierId;
      await this.special(tx, definition, data, user, id);
      if (!definition.children || data[definition.children.field]) {
        await this.finance.prepare(tx, definition.model, data, user.companyId!);
        if (definition.children) await this.delegate(tx, definition.children.model).deleteMany({ where: { [definition.children.relation]: id } });
      }
      if (this.model(definition.model).fields.some((field) => field.name === 'updatedById')) data.updatedById = user.id;
      await this.delegate(tx, definition.model).update({ where: { [this.primary(definition)]: id }, data });
      return { id };
    });
    if (definition.model === 'User' || definition.model === 'Role') this.rbac.invalidate();
    await this.search?.syncRecord(definition.model, id);
    return result;
  }
  private async dependencies(tx: Client, definition: ResourceDefinition, id: string, ignoredIds: string[] = []) {
    for (const model of RECORD_MODELS.values()) for (const relation of model.fields.filter((field) => field.kind === 'object' && field.type === definition.model && field.relationFromFields?.length === 1)) {
      if (definition.owned?.includes(model.name)) continue;
      const foreignKey = relation.relationFromFields![0]; const where: Data = { [foreignKey]: id };
      if (model.fields.some((field) => field.name === 'deletedAt')) where.deletedAt = null;
      if (model.name === definition.model && ignoredIds.length) where[this.primary(definition)] = { notIn: ignoredIds };
      if (model.name === 'AssetAssignment') where.returnedAt = null;
      if (await this.delegate(tx, model.name).count({ where })) throw new ConflictException(`This record is still used by ${Object.values(RECORD_RESOURCES).find((item) => item.model === model.name)?.en ?? model.name}. Reassign or remove those records first, or deactivate this record.`);
    }
    for (const item of Object.values(RECORD_RESOURCES)) {
      const model = this.model(item.model);
      for (const field of recordFields(item).filter((field) => field.reference?.model === definition.model && !field.list
        && model.fields.some((scalar) => scalar.name === field.name) && !model.fields.some((relation) => relation.relationFromFields?.includes(field.name)))) {
        const where: Data = { [field.name]: id, ...(model.fields.some((scalar) => scalar.name === 'deletedAt') ? { deletedAt: null } : {}) };
        if (await this.delegate(tx, model.name).count({ where })) throw new ConflictException(`This record is still used by ${item.en}. Reassign those records first.`);
      }
    }
    if (definition.model === 'MeetingMinute' && await tx.task.count({ where: { entityType: 'meeting', entityId: id, deletedAt: null } })) throw new ConflictException('This meeting has action items. Remove or reassign them first.');
  }
  async remove(user: AuthUser, key: string, ids: string[]) {
    this.admin(user); const definition = this.definition(key);
    if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) throw new BadRequestException('Select between 1 and 100 different records');
    if (definition.model === 'Company' || definition.model === 'Office' || definition.model === 'CostCenter') {
      if (ids.length !== 1) throw new BadRequestException('Delete these organization records individually');
      if (definition.model === 'Company') await this.organization.remove(user, ids[0]);
      else if (definition.model === 'Office') await this.organization.removeOffice(user, user.companyId!, ids[0]);
      else await new CostCentersController(this.prisma).remove(user.companyId!, ids[0]);
      return { deleted: 1 };
    }
    const result = await this.transaction(async (tx) => {
      for (const id of ids) {
        const row = await this.get(user, key, id, tx); this.state(definition, row, true);
        if (definition.model === 'User' && (id === user.id || row.isSystemAdmin)) throw new ConflictException('System administrators and your own account cannot be deleted here');
        if (definition.model === 'Payment') { await this.finance.reversePayment(tx, id, user.companyId!); continue; }
        await this.dependencies(tx, definition, id, ids);
      }
      for (const id of ids) {
        if (definition.model === 'Payment') continue;
        const model = this.model(definition.model);
        if (model.fields.some((field) => field.name === 'deletedAt')) {
          const data: Data = { deletedAt: new Date() }; if (model.fields.some((field) => field.name === 'isActive')) data.isActive = false;
          await this.delegate(tx, model.name).update({ where: { [this.primary(definition)]: id }, data });
          for (const childName of definition.owned ?? []) {
            const child = this.model(childName); const relation = child.fields.find((field) => field.kind === 'object' && field.type === model.name && field.relationFromFields?.length);
            if (relation && child.fields.some((field) => field.name === 'deletedAt')) await this.delegate(tx, child.name).updateMany({ where: { [relation.relationFromFields![0]]: id, deletedAt: null }, data: { deletedAt: new Date() } });
          }
        } else await this.delegate(tx, model.name).delete({ where: { [this.primary(definition)]: id } });
      }
      return { deleted: ids.length };
    });
    if (definition.model === 'User' || definition.model === 'Role') this.rbac.invalidate();
    for (const id of ids) await this.search?.syncRecord(definition.model, id);
    return result;
  }
  async restore(user: AuthUser, key: string, id: string) {
    this.admin(user); const definition = this.definition(key);
    if (!this.model(definition.model).fields.some((field) => field.name === 'deletedAt')) throw new BadRequestException('This record cannot be restored');
    const result = await this.transaction(async (tx) => {
      const row = await this.get(user, key, id, tx, true); const input = Object.fromEntries(recordFields(definition).filter((field) => !field.readOnly && !field.createOnly && !field.fields && this.model(definition.model).fields.some((item) => item.name === field.name)).map((field) => [field.name, row[field.name]]));
      await this.validateReferences(tx, definition, input, user.companyId, id);
      await this.delegate(tx, definition.model).update({ where: { [this.primary(definition)]: id }, data: { deletedAt: null } });
      return { id };
    });
    await this.search?.syncRecord(definition.model, id);
    if (definition.model === 'User' || definition.model === 'Role') this.rbac.invalidate();
    return result;
  }
}
