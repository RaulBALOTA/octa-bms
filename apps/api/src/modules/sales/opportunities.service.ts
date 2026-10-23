import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OpportunityStage, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { paged } from '../../common/pagination';
import { NumberSequenceService } from '../master-data/number-sequence.service';
import {
  CreateOpportunityDto,
  ListOpportunitiesQuery,
  UpdateOpportunityDto,
} from './dto';

/** Funnel order; WON/LOST/CANCELLED are terminal. */
const FUNNEL: OpportunityStage[] = [
  'LEAD',
  'QUALIFIED',
  'GO_NO_GO',
  'PROPOSAL',
  'NEGOTIATION',
];
const TERMINAL: OpportunityStage[] = ['WON', 'LOST', 'CANCELLED'];

/** Default win probability per stage (%), overridable per opportunity. */
const STAGE_PROBABILITY: Record<OpportunityStage, number> = {
  LEAD: 10,
  QUALIFIED: 25,
  GO_NO_GO: 40,
  PROPOSAL: 60,
  NEGOTIATION: 75,
  WON: 100,
  LOST: 0,
  CANCELLED: 0,
};

@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: NumberSequenceService,
    private readonly events: EventEmitter2,
  ) {}

  async list(companyId: string, query: ListOpportunitiesQuery) {
    const where: Prisma.OpportunityWhereInput = {
      companyId,
      deletedAt: null,
      ...(query.stage ? { stage: query.stage } : {}),
      ...(query.partnerId ? { partnerId: query.partnerId } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { opportunityNumber: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.opportunity.findMany({
        where,
        include: {
          partner: { select: { id: true, name: true } },
          owner: { select: { id: true, firstName: true, lastName: true } },
        },
        skip: query.skip,
        take: query.pageSize,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.opportunity.count({ where }),
    ]);
    return paged(data, total, query);
  }

  /** Kanban / funnel aggregate: open opportunities grouped by stage. */
  async pipeline(companyId: string) {
    const open = await this.prisma.opportunity.findMany({
      where: { companyId, deletedAt: null, stage: { in: FUNNEL } },
      include: {
        partner: { select: { id: true, name: true } },
        owner: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return FUNNEL.map((stage) => {
      const items = open.filter((o) => o.stage === stage);
      const totalValue = items.reduce(
        (sum, o) => sum + Number(o.estimatedValue ?? 0),
        0,
      );
      const weightedValue = items.reduce(
        (sum, o) =>
          sum + (Number(o.estimatedValue ?? 0) * o.probability) / 100,
        0,
      );
      return { stage, count: items.length, totalValue, weightedValue, items };
    });
  }

  async get(companyId: string, id: string) {
    const opportunity = await this.prisma.opportunity.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        partner: { select: { id: true, name: true, city: true } },
        owner: { select: { id: true, firstName: true, lastName: true } },
        goNoGo: true,
        proposals: {
          where: { deletedAt: null },
          select: { id: true, proposalNumber: true, title: true, status: true },
        },
        crmActivities: {
          where: { deletedAt: null },
          orderBy: { activityDate: 'desc' },
          take: 20,
        },
      },
    });
    if (!opportunity) throw new NotFoundException('Opportunity not found');
    return opportunity;
  }

  async create(companyId: string, userId: string, dto: CreateOpportunityDto) {
    const opportunity = await this.prisma.$transaction(async (tx) => {
      const opportunityNumber = await this.sequences.next(
        tx,
        companyId,
        'opportunity',
        'OP',
      );
      return tx.opportunity.create({
        data: {
          companyId,
          opportunityNumber,
          title: dto.title,
          partnerId: dto.partnerId,
          description: dto.description,
          estimatedValue: dto.estimatedValue,
          currencyCode: dto.currencyCode ?? 'EUR',
          probability: dto.probability ?? STAGE_PROBABILITY.LEAD,
          expectedAward: dto.expectedAward
            ? new Date(dto.expectedAward)
            : undefined,
          submissionDeadline: dto.submissionDeadline
            ? new Date(dto.submissionDeadline)
            : undefined,
          sector: dto.sector,
          source: dto.source,
          ownerId: dto.ownerId,
          createdById: userId,
        },
        include: { partner: { select: { id: true, name: true } } },
      });
    });
    this.events.emit('sales.opportunity.created', {
      opportunityId: opportunity.id,
      companyId,
      actorId: userId,
    });
    return opportunity;
  }

  async update(
    companyId: string,
    userId: string,
    id: string,
    dto: UpdateOpportunityDto,
  ) {
    await this.get(companyId, id);
    return this.prisma.opportunity.update({
      where: { id },
      data: {
        ...dto,
        expectedAward: dto.expectedAward
          ? new Date(dto.expectedAward)
          : undefined,
        submissionDeadline: dto.submissionDeadline
          ? new Date(dto.submissionDeadline)
          : undefined,
        updatedById: userId,
      },
    });
  }

  async transition(
    companyId: string,
    userId: string,
    id: string,
    target: OpportunityStage,
    lostReason?: string,
  ) {
    const opportunity = await this.get(companyId, id);
    const from = opportunity.stage;

    if (TERMINAL.includes(from)) {
      throw new UnprocessableEntityException({
        code: 'OPPORTUNITY_TERMINAL',
        message: `Opportunity is closed (${from})`,
      });
    }
    const allowed = FUNNEL.includes(target) || TERMINAL.includes(target);
    if (!allowed || target === from) {
      throw new UnprocessableEntityException({
        code: 'OPPORTUNITY_INVALID_TRANSITION',
        message: `Cannot move from ${from} to ${target}`,
      });
    }
    if (target === 'LOST' && !lostReason) {
      throw new UnprocessableEntityException({
        code: 'LOST_REASON_REQUIRED',
        message: 'Closing as LOST requires a reason',
      });
    }

    const updated = await this.prisma.opportunity.update({
      where: { id },
      data: {
        stage: target,
        probability: STAGE_PROBABILITY[target],
        lostReason: target === 'LOST' ? lostReason : undefined,
        wonDate: target === 'WON' ? new Date() : undefined,
        updatedById: userId,
      },
    });
    this.events.emit('sales.opportunity.stageChanged', {
      opportunityId: id,
      companyId,
      from,
      to: target,
      actorId: userId,
    });
    return updated;
  }
}
