import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PartnerType, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PageQueryDto, paged } from '../../common/pagination';
import { NumberSequenceService } from '../master-data/number-sequence.service';
import { CreatePartnerDto, ListPartnersQuery, UpdatePartnerDto } from './dto';

const NUMBER_PREFIX: Record<PartnerType, string> = {
  CLIENT: 'C',
  SUPPLIER: 'S',
  PARTNER: 'P',
  AUTHORITY: 'A',
};

@Injectable()
export class PartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: NumberSequenceService,
    private readonly events: EventEmitter2,
  ) {}

  async list(companyId: string, query: ListPartnersQuery) {
    const where: Prisma.BusinessPartnerWhereInput = {
      companyId,
      deletedAt: null,
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.segment ? { segment: query.segment } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { city: { contains: query.q, mode: 'insensitive' } },
              { partnerNumber: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.businessPartner.findMany({
        where,
        include: {
          accountManager: {
            select: { id: true, firstName: true, lastName: true },
          },
          _count: { select: { contacts: { where: { deletedAt: null } }, opportunities: { where: { deletedAt: null } } } },
        },
        skip: query.skip,
        take: query.pageSize,
        orderBy: query.orderBy(['name', 'partnerNumber', 'city', 'createdAt'])
          .length
          ? query.orderBy(['name', 'partnerNumber', 'city', 'createdAt'])
          : [{ name: 'asc' }],
      }),
      this.prisma.businessPartner.count({ where }),
    ]);
    return paged(data, total, query);
  }

  async get(companyId: string, id: string) {
    const partner = await this.prisma.businessPartner.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        contacts: { where: { deletedAt: null }, orderBy: { isPrimary: 'desc' } },
        crmActivities: {
          where: { deletedAt: null },
          orderBy: { activityDate: 'desc' },
          take: 20,
          include: {
            owner: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        accountManager: {
          select: { id: true, firstName: true, lastName: true },
        },
        country: true,
      },
    });
    if (!partner) throw new NotFoundException('Business partner not found');
    return partner;
  }

  async create(companyId: string, userId: string, dto: CreatePartnerDto) {
    const partner = await this.prisma.$transaction(async (tx) => {
      const partnerNumber = await this.sequences.next(
        tx,
        companyId,
        `partner:${dto.type}`,
        NUMBER_PREFIX[dto.type],
      );
      return tx.businessPartner.create({
        data: {
          ...dto,
          companyId,
          partnerNumber,
          createdById: userId,
        },
      });
    });

    this.events.emit('crm.partner.created', {
      partnerId: partner.id,
      companyId,
      actorId: userId,
    });
    return partner;
  }

  async update(
    companyId: string,
    userId: string,
    id: string,
    dto: UpdatePartnerDto,
  ) {
    await this.get(companyId, id);
    return this.prisma.businessPartner.update({
      where: { id },
      data: { ...dto, updatedById: userId },
    });
  }

  async remove(companyId: string, id: string) {
    await this.get(companyId, id);
    await this.prisma.businessPartner.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
