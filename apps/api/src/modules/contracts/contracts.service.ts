import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ContractStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { paged } from '../../common/pagination';
import { NumberSequenceService } from '../master-data/number-sequence.service';
import {
  CreateContractDto,
  ListContractsQuery,
  UpdateContractDto,
} from './dto';

/** Allowed status transitions — the only way a contract changes state. */
const TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  DRAFT: ['IN_REVIEW'],
  IN_REVIEW: ['DRAFT', 'IN_APPROVAL'],
  IN_APPROVAL: ['IN_REVIEW', 'ACTIVE'],
  ACTIVE: ['RENEWED', 'EXPIRED', 'TERMINATED'],
  RENEWED: [],
  EXPIRED: [],
  TERMINATED: [],
};

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: NumberSequenceService,
    private readonly events: EventEmitter2,
  ) {}

  async list(companyId: string, query: ListContractsQuery) {
    const where: Prisma.ContractWhereInput = {
      companyId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.partnerId ? { partnerId: query.partnerId } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { contractNumber: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        include: {
          partner: { select: { id: true, name: true } },
          contractType: { select: { id: true, code: true, name: true } },
          owner: { select: { id: true, firstName: true, lastName: true } },
        },
        skip: query.skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.contract.count({ where }),
    ]);
    return paged(data, total, query);
  }

  async expiring(companyId: string, withinDays: number) {
    const horizon = new Date(Date.now() + withinDays * 86_400_000);
    return this.prisma.contract.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: 'ACTIVE',
        endDate: { not: null, lte: horizon },
      },
      include: { partner: { select: { id: true, name: true } } },
      orderBy: { endDate: 'asc' },
    });
  }

  async get(companyId: string, id: string) {
    const contract = await this.prisma.contract.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        partner: true,
        contractType: true,
        owner: { select: { id: true, firstName: true, lastName: true } },
        versions: { orderBy: { version: 'desc' } },
        obligations: { orderBy: { dueDate: 'asc' } },
        milestones: true,
        variations: true,
        claims: true,
        guarantees: true,
        callOffs: { select: { id: true, contractNumber: true, title: true } },
      },
    });
    if (!contract) throw new NotFoundException('Contract not found');
    return contract;
  }

  async create(companyId: string, userId: string, dto: CreateContractDto) {
    const contract = await this.prisma.$transaction(async (tx) => {
      const contractNumber = await this.sequences.next(
        tx,
        companyId,
        'contract',
        'CT',
      );
      return tx.contract.create({
        data: {
          ...dto,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          endDate: dto.endDate ? new Date(dto.endDate) : undefined,
          companyId,
          contractNumber,
          createdById: userId,
        },
      });
    });
    this.events.emit('contracts.contract.created', {
      contractId: contract.id,
      companyId,
      actorId: userId,
    });
    return contract;
  }

  async update(
    companyId: string,
    userId: string,
    id: string,
    dto: UpdateContractDto,
  ) {
    await this.get(companyId, id);
    return this.prisma.contract.update({
      where: { id },
      data: {
        ...dto,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        signedDate: dto.signedDate ? new Date(dto.signedDate) : undefined,
        updatedById: userId,
      },
    });
  }

  /**
   * Renewal: the current contract becomes RENEWED and a successor draft is
   * created with the same commercial terms and the new term dates.
   */
  async renew(
    companyId: string,
    userId: string,
    id: string,
    startDate: string,
    endDate?: string,
  ) {
    const contract = await this.get(companyId, id);
    if (contract.status !== 'ACTIVE') {
      throw new UnprocessableEntityException({
        code: 'CONTRACT_NOT_ACTIVE',
        message: 'Only active contracts can be renewed',
      });
    }

    const successor = await this.prisma.$transaction(async (tx) => {
      const contractNumber = await this.sequences.next(tx, companyId, 'contract', 'CT');
      const created = await tx.contract.create({
        data: {
          companyId,
          contractNumber,
          title: contract.title,
          description: `Renewal of ${contract.contractNumber}`,
          contractTypeId: contract.contractTypeId,
          partnerId: contract.partnerId,
          value: contract.value ?? undefined,
          currencyCode: contract.currencyCode,
          startDate: new Date(startDate),
          endDate: endDate ? new Date(endDate) : undefined,
          noticePeriodDays: contract.noticePeriodDays,
          autoRenewal: contract.autoRenewal,
          renewalMonths: contract.renewalMonths,
          ownerId: contract.ownerId,
          createdById: userId,
        },
      });
      await tx.contract.update({
        where: { id },
        data: { status: 'RENEWED', updatedById: userId },
      });
      return created;
    });

    this.events.emit('contracts.contract.renewed', {
      contractId: id,
      successorId: successor.id,
      companyId,
      actorId: userId,
    });
    return successor;
  }

  async transition(
    companyId: string,
    userId: string,
    id: string,
    target: ContractStatus,
  ) {
    const contract = await this.get(companyId, id);
    const allowed = TRANSITIONS[contract.status];
    if (!allowed.includes(target)) {
      throw new UnprocessableEntityException({
        code: 'CONTRACT_INVALID_TRANSITION',
        message: `Cannot transition from ${contract.status} to ${target}`,
      });
    }
    if (target === 'ACTIVE' && !contract.signedDate) {
      throw new UnprocessableEntityException({
        code: 'CONTRACT_NOT_SIGNED',
        message: 'A contract requires a signed date before activation',
      });
    }

    const updated = await this.prisma.contract.update({
      where: { id },
      data: { status: target, updatedById: userId },
    });
    this.events.emit(`contracts.contract.${target.toLowerCase()}`, {
      contractId: id,
      companyId,
      actorId: userId,
      from: contract.status,
    });
    return updated;
  }
}
