import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CalendarDomain, CalendarStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { AuthUser } from '../../core/auth/decorators';
import { allowedDomains, attention, recurrenceDate, shiftDate, validDate, validateDates, visibility } from './calendar-domain';
import { CalendarEntityQueryDto, CalendarQueryDto, CreateCalendarItemDto, EvidenceDto, UpdateCalendarItemDto } from './calendar.dto';

const include = { owner: { select: { id: true, firstName: true, lastName: true } }, checklist: true, evidence: true, grants: true } satisfies Prisma.BusinessCalendarItemInclude;
type Item = Prisma.BusinessCalendarItemGetPayload<{ include: typeof include }>;
const editable = ['title', 'description', 'domain', 'kind', 'sensitivity', 'priority', 'ownerUserId', 'timezoneIana', 'allDay', 'dateOnly', 'endDateOnly', 'startsAt', 'endsAt', 'hardDueDate', 'internalTargetDate', 'forecastDate', 'hardDueAt', 'completionEvidenceRequired', 'sourceUrl', 'businessEntityType', 'businessEntityId'] as const;
const entityPermissions: Record<string, string> = { contract: 'contracts.contracts.read', invoice: 'finance.invoices.read', opportunity: 'sales.opportunities.read', partner: 'crm.partners.read', employee: 'hr.reviews.read' };
const transitions: Record<CalendarStatus, CalendarStatus[]> = {
  DRAFT: ['OPEN', 'CANCELED'], OPEN: ['IN_PROGRESS', 'AWAITING', 'AT_RISK', 'COMPLETED', 'CANCELED'],
  IN_PROGRESS: ['OPEN', 'AWAITING', 'AT_RISK', 'COMPLETED', 'CANCELED'], AWAITING: ['OPEN', 'IN_PROGRESS', 'AT_RISK', 'COMPLETED', 'CANCELED'],
  AT_RISK: ['OPEN', 'IN_PROGRESS', 'AWAITING', 'COMPLETED', 'CANCELED'], COMPLETED: ['OPEN'], CANCELED: ['OPEN'],
};

@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}
  enabled() { return this.config.get<string>('COMPANY_CALENDAR_ENABLED') === 'true'; }
  requireEnabled() { if (!this.enabled()) throw new ServiceUnavailableException('Company Calendar is disabled; complete schema setup and enable the feature flag'); }
  capability(user: AuthUser) {
    return { enabled: this.enabled(), domains: allowedDomains(user), entityTypes: Object.keys(entityPermissions).filter((type) => user.isSystemAdmin || user.permissions.includes(entityPermissions[type])), microsoft: { connected: false, state: 'UNCONNECTED' }, ai: { connected: false } };
  }
  async entities(companyId: string, user: AuthUser, q: CalendarEntityQueryDto) {
    this.requireEnabled();
    if (!entityPermissions[q.type] || (!user.isSystemAdmin && !user.permissions.includes(entityPermissions[q.type]))) throw new ForbiddenException('Missing linked entity permission');
    const base = { companyId, deletedAt: null };
    const text = { contains: q.search ?? '', mode: 'insensitive' as const };
    const selected = q.selectedId ? [{ id: q.selectedId }] : [];
    if (q.type === 'contract') return (await this.prisma.contract.findMany({ where: { ...base, OR: [{ title: text }, { contractNumber: text }, ...selected] }, select: { id: true, title: true, contractNumber: true }, take: 100, orderBy: { title: 'asc' } })).map((x) => ({ id: x.id, label: `${x.contractNumber} · ${x.title}` }));
    if (q.type === 'invoice') return (await this.prisma.invoice.findMany({ where: { ...base, OR: [{ invoiceNumber: text }, ...selected] }, select: { id: true, invoiceNumber: true }, take: 100, orderBy: { invoiceNumber: 'desc' } })).map((x) => ({ id: x.id, label: x.invoiceNumber }));
    if (q.type === 'opportunity') return (await this.prisma.opportunity.findMany({ where: { ...base, OR: [{ title: text }, { opportunityNumber: text }, ...selected] }, select: { id: true, title: true, opportunityNumber: true }, take: 100, orderBy: { title: 'asc' } })).map((x) => ({ id: x.id, label: `${x.opportunityNumber} · ${x.title}` }));
    if (q.type === 'partner') return (await this.prisma.businessPartner.findMany({ where: { ...base, OR: [{ name: text }, ...selected] }, select: { id: true, name: true }, take: 100, orderBy: { name: 'asc' } })).map((x) => ({ id: x.id, label: x.name }));
    return (await this.prisma.employee.findMany({ where: { ...base, OR: [{ firstName: text }, { lastName: text }, ...selected] }, select: { id: true, firstName: true, lastName: true }, take: 100, orderBy: { lastName: 'asc' } })).map((x) => ({ id: x.id, label: `${x.firstName} ${x.lastName}` }));
  }
  async members(companyId: string) {
    this.requireEnabled();
    return this.prisma.user.findMany({ where: { isActive: true, deletedAt: null, memberships: { some: { companyId } } }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: 'asc' }, take: 1000 });
  }
  private async getWith(db: Prisma.TransactionClient, companyId: string, user: AuthUser, id: string): Promise<Item> {
    const item = await db.businessCalendarItem.findFirst({ where: { AND: [visibility(companyId, user), { id }] }, include });
    if (!item) throw new NotFoundException('Calendar item not found');
    return item;
  }
  async get(companyId: string, user: AuthUser, id: string) {
    this.requireEnabled(); const item = await this.getWith(this.prisma, companyId, user, id);
    return { ...item, attention: attention(item), canEdit: this.canEdit(user, item) };
  }
  private canEdit(user: AuthUser, item: Item) {
    if (!['MANUAL', 'AI_APPROVED'].includes(item.sourceKind)) return false;
    if (!user.isSystemAdmin && !user.permissions.includes('calendar.items.update')) return false;
    return item.createdById === user.id || item.ownerUserId === user.id || item.grants.some((g) => g.userId === user.id && g.canEdit) ||
      (item.sensitivity === 'PUBLIC_INTERNAL' && (user.isSystemAdmin || user.permissions.includes('calendar.items.approve')));
  }
  private assertEdit(user: AuthUser, item: Item, version: number) {
    if (!this.canEdit(user, item)) throw new ForbiddenException('Calendar item is read-only for this user');
    if (item.sourceKind !== 'MANUAL' && item.sourceKind !== 'AI_APPROVED') throw new ConflictException('Change this item in its authoritative source');
    if (item.version !== version) throw new ConflictException('Calendar item changed; reload before saving');
  }
  private filter(companyId: string, user: AuthUser, q: CalendarQueryDto) {
    if ((q.from && !validDate(q.from)) || (q.to && !validDate(q.to)) || (q.from && q.to && q.to < q.from)) throw new BadRequestException('Invalid date range');
    const criteria: Prisma.BusinessCalendarItemWhereInput[] = [visibility(companyId, user)];
    if (q.domain) criteria.push({ domain: q.domain });
    if (q.owner) criteria.push({ ownerUserId: q.owner === 'me' ? user.id : q.owner });
    if (q.status) criteria.push({ status: q.status });
    if (q.search) criteria.push({ OR: [{ title: { contains: q.search, mode: 'insensitive' } }, { description: { contains: q.search, mode: 'insensitive' } }] });
    if (q.from || q.to) {
      // UTC bounds include all IANA offsets; exact local-date check follows in calendar UI.
      const range = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
      const timed = { ...(q.from ? { gte: new Date(q.from + 'T00:00:00+14:00') } : {}), ...(q.to ? { lt: new Date(shiftDate(q.to, 1) + 'T00:00:00-12:00') } : {}) };
      criteria.push({ OR: [{ dateOnly: range }, { hardDueDate: range }, { internalTargetDate: range }, { forecastDate: range }, { startsAt: timed }, { hardDueAt: timed },
        ...(q.from && q.to ? [{ AND: [{ dateOnly: { lte: q.to } }, { endDateOnly: { gt: q.from } }] }, { AND: [{ startsAt: { lt: timed.lt } }, { endsAt: { gt: timed.gte } }] }] : []),
      ] });
    }
    return { AND: criteria };
  }
  async list(companyId: string, user: AuthUser, q: CalendarQueryDto) {
    this.requireEnabled(); const where = this.filter(companyId, user, q);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.businessCalendarItem.findMany({ where, include, orderBy: [{ dateOnly: 'asc' }, { startsAt: 'asc' }, { id: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.businessCalendarItem.count({ where }),
    ]);
    return { data: data.map((item) => ({ ...item, attention: attention(item), canEdit: this.canEdit(user, item) })), meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) } };
  }
  async horizon(companyId: string, user: AuthUser, q: CalendarQueryDto) {
    this.requireEnabled();
    const where = this.filter(companyId, user, { ...q, status: undefined });
    // Exact total; summary and attention are bounded with explicit truncation disclosure.
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.businessCalendarItem.findMany({ where: { AND: [where, { status: { notIn: ['COMPLETED', 'CANCELED', 'DRAFT'] } }] }, include, orderBy: [{ priority: 'desc' }, { hardDueDate: 'asc' }, { dateOnly: 'asc' }], take: 1000 }),
      this.prisma.businessCalendarItem.count({ where: { AND: [where, { status: { notIn: ['COMPLETED', 'CANCELED', 'DRAFT'] } }] } }),
    ]);
    const ranked = rows.map((item) => ({ ...item, attention: attention(item), canEdit: this.canEdit(user, item) })).sort((a, b) => b.attention.score - a.attention.score);
    return { items: ranked, total, truncated: total > rows.length, summary: {
      critical: ranked.filter((x) => x.attention.score >= 60).length,
      overdue: ranked.filter((x) => x.attention.overdue).length,
      awaiting: ranked.filter((x) => x.status === 'AWAITING').length,
      missingOwner: ranked.filter((x) => !x.ownerUserId).length,
    } };
  }
  private async validateReferences(db: Prisma.TransactionClient, companyId: string, user: AuthUser, item: { domain: CalendarDomain; ownerUserId?: string | null; businessEntityType?: string | null; businessEntityId?: string | null }, grants?: { userId: string }[]) {
    if (grants && new Set(grants.map((g) => g.userId)).size !== grants.length) throw new BadRequestException('Duplicate access grants');
    if (!allowedDomains(user).includes(item.domain)) throw new ForbiddenException('Missing domain permission');
    for (const userId of new Set([item.ownerUserId, ...(grants?.map((g) => g.userId) ?? [])].filter((id): id is string => !!id))) {
      if (!await db.user.findFirst({ where: { id: userId, isActive: true, deletedAt: null, memberships: { some: { companyId } } }, select: { id: true } })) throw new BadRequestException('Owner or participant is not an active company member');
    }
    const { businessEntityType: type, businessEntityId: id } = item;
    if (!!type !== !!id) throw new BadRequestException('Business entity type and ID are required together');
    if (!type || !id) return;
    const permission = entityPermissions[type];
    if (!permission || (!user.isSystemAdmin && !user.permissions.includes(permission))) throw new ForbiddenException('Missing linked entity permission');
    if ((type === 'employee' && item.domain !== 'HR') || (type === 'invoice' && item.domain !== 'FINANCE')) throw new BadRequestException('Sensitive links must use the corresponding domain');
    const where = { id, companyId, deletedAt: null };
    const entity = type === 'contract' ? await db.contract.findFirst({ where, select: { id: true } }) :
      type === 'invoice' ? await db.invoice.findFirst({ where, select: { id: true } }) :
      type === 'opportunity' ? await db.opportunity.findFirst({ where, select: { id: true } }) :
      type === 'partner' ? await db.businessPartner.findFirst({ where, select: { id: true } }) :
      await db.employee.findFirst({ where, select: { id: true } });
    if (!entity) throw new BadRequestException('Linked entity not found in this company');
  }
  private snapshot(item: Item): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify({ ...item, owner: undefined, grants: item.grants.map(({ userId, canEdit }) => ({ userId, canEdit })), checklist: item.checklist.map(({ title, done }) => ({ title, done })) })) as Prisma.InputJsonValue;
  }
  private async log(db: Prisma.TransactionClient, item: Item, user: AuthUser, action: string, before: Item | null) {
    await db.businessCalendarHistory.create({ data: { itemId: item.id, actorId: user.id, action, version: item.version, changes: { before: before ? this.snapshot(before) : null, after: this.snapshot(item) } } });
  }
  async create(companyId: string, user: AuthUser, dto: CreateCalendarItemDto) {
    this.requireEnabled();
    return this.prisma.$transaction(async (db) => {
      const { checklist, grants, startsAt, endsAt, hardDueAt, ...fields } = dto;
      const data = { ...fields, companyId, createdById: user.id, timezoneIana: dto.timezoneIana ?? 'Europe/Berlin', allDay: dto.allDay ?? false,
        startsAt: startsAt ? new Date(startsAt) : null, endsAt: endsAt ? new Date(endsAt) : null, hardDueAt: hardDueAt ? new Date(hardDueAt) : null,
        recurrenceSeriesId: dto.recurrenceFrequency ? randomUUID() : null, recurrenceAnchor: dto.recurrenceFrequency ? dto.dateOnly : null,
        originalOccurrenceKey: dto.recurrenceFrequency ? dto.dateOnly : null };
      validateDates(data); await this.validateReferences(db, companyId, user, data, grants);
      const item = await db.businessCalendarItem.create({ data: { ...data, checklist: { create: checklist ?? [] }, grants: { create: grants ?? [] } }, include });
      await this.log(db, item, user, 'CREATED', null); return item;
    });
  }
  async update(companyId: string, user: AuthUser, id: string, dto: UpdateCalendarItemDto) {
    this.requireEnabled();
    return this.prisma.$transaction(async (db) => {
      const before = await this.getWith(db, companyId, user, id); this.assertEdit(user, before, dto.version);
      if (['COMPLETED', 'CANCELED'].includes(before.status)) throw new ConflictException('Reopen the item before editing');
      if (dto.recurrenceFrequency !== undefined || dto.recurrenceInterval !== undefined || dto.recurrenceUntil !== undefined) throw new BadRequestException('Recurrence rules are fixed for this series; cancel it and create a replacement series');
      if ((dto.grants || (dto.sensitivity !== undefined && dto.sensitivity !== before.sensitivity)) && before.createdById !== user.id && before.ownerUserId !== user.id) throw new ForbiddenException('Only owner or creator can change sharing');
      const data: Prisma.BusinessCalendarItemUpdateManyMutationInput = {};
      for (const key of editable) if (dto[key] !== undefined) Object.assign(data, { [key]: ['startsAt', 'endsAt', 'hardDueAt'].includes(key) && dto[key] ? new Date(dto[key] as string) : dto[key] });
      const candidate = { ...before, ...data } as Item;
      validateDates(candidate); await this.validateReferences(db, companyId, user, candidate, dto.grants);
      const changed = await db.businessCalendarItem.updateMany({ where: { id, companyId, deletedAt: null, version: dto.version }, data: { ...data, version: { increment: 1 } } });
      if (!changed.count) throw new ConflictException('Calendar item changed; reload before saving');
      if (dto.checklist) { await db.businessCalendarChecklistItem.deleteMany({ where: { itemId: id } }); await db.businessCalendarChecklistItem.createMany({ data: dto.checklist.map((c) => ({ ...c, itemId: id })) }); }
      if (dto.grants) { await db.businessCalendarAccessGrant.deleteMany({ where: { itemId: id } }); await db.businessCalendarAccessGrant.createMany({ data: dto.grants.map((g) => ({ ...g, itemId: id })) }); }
      // Return is scoped to company; ownership transfer can remove caller visibility.
      const after = await db.businessCalendarItem.findFirstOrThrow({ where: { id, companyId }, include });
      await this.log(db, after, user, 'UPDATED', before); return { id: after.id, version: after.version };
    });
  }
  async evidence(companyId: string, user: AuthUser, id: string, dto: EvidenceDto) {
    this.requireEnabled();
    return this.prisma.$transaction(async (db) => {
      const before = await this.getWith(db, companyId, user, id); this.assertEdit(user, before, dto.version);
      const changed = await db.businessCalendarItem.updateMany({ where: { id, companyId, version: dto.version }, data: { version: { increment: 1 } } });
      if (!changed.count) throw new ConflictException('Calendar item changed');
      await db.businessCalendarEvidence.create({ data: { itemId: id, title: dto.title, url: dto.url, createdById: user.id } });
      const after = await this.getWith(db, companyId, user, id); await this.log(db, after, user, 'EVIDENCE_ADDED', before); return after;
    });
  }
  async transition(companyId: string, user: AuthUser, id: string, version: number, status: CalendarStatus) {
    this.requireEnabled();
    return this.prisma.$transaction(async (db) => {
      const before = await this.getWith(db, companyId, user, id); this.assertEdit(user, before, version);
      if (!transitions[before.status].includes(status)) throw new ConflictException('Invalid calendar status transition');
      if (status === 'COMPLETED' && (before.checklist.some((c) => !c.done) || (before.completionEvidenceRequired && !before.evidence.length))) throw new BadRequestException('Complete preparation and add required evidence first');
      if (status === 'OPEN' && before.status === 'COMPLETED' && before.recurrenceFrequency) throw new ConflictException('A completed recurring occurrence is immutable; its next occurrence already exists');
      const changed = await db.businessCalendarItem.updateMany({ where: { id, companyId, version, deletedAt: null }, data: { status, version: { increment: 1 }, completedAt: status === 'COMPLETED' ? new Date() : null, completedById: status === 'COMPLETED' ? user.id : null } });
      if (!changed.count) throw new ConflictException('Calendar item changed; reload before saving');
      const after = await this.getWith(db, companyId, user, id);
      if (status === 'COMPLETED' && before.recurrenceFrequency && before.recurrenceAnchor && before.recurrenceSeriesId) {
        const nextDate = recurrenceDate(before.recurrenceAnchor, before.recurrenceFrequency, before.recurrenceInterval, before.occurrenceNumber + 1);
        if (validDate(nextDate) && (!before.recurrenceUntil || nextDate <= before.recurrenceUntil)) {
          const { id: _id, owner: _owner, checklist: _checklist, evidence: _evidence, grants: _grants, createdAt: _created, updatedAt: _updated, ...copy } = before;
          const delta = Math.round((Date.parse(nextDate) - Date.parse(before.dateOnly ?? nextDate)) / 86400000);
          const next = await db.businessCalendarItem.upsert({ where: { companyId_recurrenceSeriesId_originalOccurrenceKey: { companyId, recurrenceSeriesId: before.recurrenceSeriesId, originalOccurrenceKey: nextDate } }, update: {}, create: {
            ...copy, dateOnly: nextDate, endDateOnly: before.endDateOnly ? shiftDate(before.endDateOnly, delta) : null,
            hardDueDate: before.hardDueDate ? shiftDate(before.hardDueDate, delta) : null,
            internalTargetDate: before.internalTargetDate ? shiftDate(before.internalTargetDate, delta) : null,
            forecastDate: before.forecastDate ? shiftDate(before.forecastDate, delta) : null,
            originalOccurrenceKey: nextDate, occurrenceNumber: before.occurrenceNumber + 1, status: 'OPEN', completedAt: null, completedById: null, version: 1,
            checklist: { create: before.checklist.map((c) => ({ title: c.title, done: false })) }, grants: { create: before.grants.map((g) => ({ userId: g.userId, canEdit: g.canEdit })) },
          }, include });
          await this.log(db, next, user, 'RECURRENCE_GENERATED', null);
        }
      }
      await this.log(db, after, user, status, before); return after;
    });
  }
  async archive(companyId: string, user: AuthUser, id: string, version: number) {
    this.requireEnabled();
    return this.prisma.$transaction(async (db) => {
      const before = await this.getWith(db, companyId, user, id); this.assertEdit(user, before, version);
      const changed = await db.businessCalendarItem.updateMany({ where: { id, companyId, version, deletedAt: null }, data: { deletedAt: new Date(), version: { increment: 1 } } });
      if (!changed.count) throw new ConflictException('Calendar item changed');
      await this.log(db, { ...before, version: version + 1, deletedAt: new Date() }, user, 'ARCHIVED', before);
      return { archived: true };
    });
  }
  async history(companyId: string, user: AuthUser, id: string) {
    this.requireEnabled(); const item = await this.getWith(this.prisma, companyId, user, id);
    // Sharing snapshots are only visible to the owner/creator; history may contain earlier private fields.
    if (item.ownerUserId !== user.id && item.createdById !== user.id) throw new ForbiddenException('History is restricted to owner or creator');
    return this.prisma.businessCalendarHistory.findMany({ where: { itemId: id }, orderBy: { createdAt: 'desc' }, take: 100 });
  }
}
