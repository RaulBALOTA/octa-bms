import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ProposalStatus } from '@prisma/client';
import {
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  AuthUser,
  CompanyId,
  CurrentUser,
  RequirePermission,
} from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';
import { NumberSequenceService } from '../master-data/number-sequence.service';

class GoNoGoDto {
  @IsInt() @Min(1) @Max(5) clientRelation!: number;
  @IsInt() @Min(1) @Max(5) strategicFit!: number;
  @IsInt() @Min(1) @Max(5) capacity!: number;
  @IsInt() @Min(1) @Max(5) winProbability!: number;
  @IsInt() @Min(1) @Max(5) riskLevel!: number; // 5 = low risk
  @IsIn(['GO', 'NO_GO', 'CONDITIONAL']) decision!: string;
  @IsOptional() @IsString() comments?: string;
}

class CreateProposalDto {
  @IsString() title!: string;
}

class AddFeeLineDto {
  @IsString() discipline!: string;
  @IsString() role!: string;
  @IsNumberString() hours!: string;
  @IsNumberString() hourlyRate!: string;
  @IsOptional() @IsNumberString() costRate?: string;
}

const PROPOSAL_TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  DRAFT: ['IN_REVIEW'],
  IN_PREPARATION: ['IN_REVIEW'],
  IN_REVIEW: ['DRAFT', 'APPROVED'],
  APPROVED: ['SUBMITTED'],
  SUBMITTED: ['SHORTLISTED', 'WON', 'LOST', 'WITHDRAWN'],
  SHORTLISTED: ['WON', 'LOST', 'WITHDRAWN'],
  WON: [],
  LOST: [],
  WITHDRAWN: [],
};

@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales')
export class ProposalsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: NumberSequenceService,
    private readonly events: EventEmitter2,
  ) {}

  // ------------------------------------------------------------- go / no-go

  @Post('opportunities/:id/go-no-go')
  @RequirePermission('sales.gonogo.create')
  async goNoGo(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') opportunityId: string,
    @Body() dto: GoNoGoDto,
  ) {
    const opportunity = await this.prisma.opportunity.findFirst({
      where: { id: opportunityId, companyId, deletedAt: null },
    });
    if (!opportunity) throw new NotFoundException('Opportunity not found');
    if (['WON', 'LOST', 'CANCELLED'].includes(opportunity.stage)) {
      throw new UnprocessableEntityException({
        code: 'OPPORTUNITY_TERMINAL',
        message: `Opportunity is closed (${opportunity.stage})`,
      });
    }

    const totalScore =
      dto.clientRelation +
      dto.strategicFit +
      dto.capacity +
      dto.winProbability +
      dto.riskLevel;

    const evaluation = await this.prisma.goNoGoEvaluation.upsert({
      where: { opportunityId },
      update: {
        ...dto,
        totalScore,
        decisionDate: new Date(),
        decisionById: user.id,
      },
      create: {
        opportunityId,
        ...dto,
        totalScore,
        decisionDate: new Date(),
        decisionById: user.id,
      },
    });

    // decision drives the funnel: GO → PROPOSAL, NO_GO → CANCELLED,
    // CONDITIONAL → parked at GO_NO_GO for re-evaluation
    const stageByDecision: Record<string, string> = {
      GO: 'PROPOSAL',
      NO_GO: 'CANCELLED',
      CONDITIONAL: 'GO_NO_GO',
    };
    const nextStage = stageByDecision[dto.decision];
    if (nextStage && nextStage !== opportunity.stage) {
      await this.prisma.opportunity.update({
        where: { id: opportunityId },
        data: {
          stage: nextStage as never,
          lostReason: dto.decision === 'NO_GO' ? `No-Go: ${dto.comments ?? ''}` : undefined,
          updatedById: user.id,
        },
      });
    }

    this.events.emit('sales.opportunity.goNoGo', {
      opportunityId,
      companyId,
      decision: dto.decision,
      totalScore,
      actorId: user.id,
    });
    return evaluation;
  }

  // ---------------------------------------------------------------- proposals

  @Post('opportunities/:id/proposals')
  @RequirePermission('sales.proposals.create')
  async createProposal(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') opportunityId: string,
    @Body() dto: CreateProposalDto,
  ) {
    const opportunity = await this.prisma.opportunity.findFirst({
      where: { id: opportunityId, companyId, deletedAt: null },
    });
    if (!opportunity) throw new NotFoundException('Opportunity not found');

    return this.prisma.$transaction(async (tx) => {
      const proposalNumber = await this.sequences.next(tx, companyId, 'proposal', 'P');
      return tx.proposal.create({
        data: {
          companyId,
          opportunityId,
          proposalNumber,
          title: dto.title,
          createdById: user.id,
        },
      });
    });
  }

  @Get('proposals/:id')
  @RequirePermission('sales.proposals.read')
  async getProposal(@CompanyId() companyId: string, @Param('id') id: string) {
    const proposal = await this.prisma.proposal.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        opportunity: {
          select: {
            id: true,
            title: true,
            partner: { select: { name: true } },
          },
        },
        feeLines: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!proposal) throw new NotFoundException('Proposal not found');
    return proposal;
  }

  /** Recomputes fee / cost / margin from the fee lines. */
  private async recalcProposal(proposalId: string) {
    const lines = await this.prisma.feeCalculationLine.findMany({
      where: { proposalId },
    });
    let feeCents = 0;
    let costCents = 0;
    let hours = 0;
    for (const line of lines) {
      feeCents += Math.round(Number(line.hours) * Number(line.hourlyRate) * 100);
      costCents += Math.round(Number(line.hours) * Number(line.costRate ?? 0) * 100);
      hours += Number(line.hours);
    }
    const margin =
      feeCents > 0 && costCents > 0
        ? (((feeCents - costCents) / feeCents) * 100).toFixed(2)
        : null;
    return this.prisma.proposal.update({
      where: { id: proposalId },
      data: {
        totalFee: (feeCents / 100).toFixed(2),
        estimatedCost: costCents > 0 ? (costCents / 100).toFixed(2) : null,
        estimatedHours: hours.toFixed(2),
        marginPercent: margin,
      },
      include: { feeLines: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  @Post('proposals/:id/lines')
  @RequirePermission('sales.proposals.update')
  async addLine(
    @CompanyId() companyId: string,
    @Param('id') proposalId: string,
    @Body() dto: AddFeeLineDto,
  ) {
    await this.getProposal(companyId, proposalId);
    const count = await this.prisma.feeCalculationLine.count({
      where: { proposalId },
    });
    await this.prisma.feeCalculationLine.create({
      data: {
        proposalId,
        discipline: dto.discipline,
        role: dto.role,
        hours: dto.hours,
        hourlyRate: dto.hourlyRate,
        costRate: dto.costRate,
        sortOrder: count,
      },
    });
    return this.recalcProposal(proposalId);
  }

  @Delete('proposals/lines/:lineId')
  @RequirePermission('sales.proposals.update')
  @HttpCode(200)
  async removeLine(@Param('lineId') lineId: string) {
    const line = await this.prisma.feeCalculationLine.findUniqueOrThrow({
      where: { id: lineId },
    });
    await this.prisma.feeCalculationLine.delete({ where: { id: lineId } });
    return this.recalcProposal(line.proposalId);
  }

  @Post('proposals/:id/transition')
  @RequirePermission('sales.proposals.update')
  async transitionProposal(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { status: ProposalStatus },
  ) {
    const proposal = await this.getProposal(companyId, id);
    const allowed = PROPOSAL_TRANSITIONS[proposal.status] ?? [];
    if (!allowed.includes(body.status)) {
      throw new UnprocessableEntityException({
        code: 'PROPOSAL_INVALID_TRANSITION',
        message: `Cannot transition from ${proposal.status} to ${body.status}`,
      });
    }
    if (body.status === 'SUBMITTED' && Number(proposal.totalFee ?? 0) <= 0) {
      throw new UnprocessableEntityException({
        code: 'PROPOSAL_NO_FEE',
        message: 'A proposal needs fee lines before submission',
      });
    }

    const updated = await this.prisma.proposal.update({
      where: { id },
      data: {
        status: body.status,
        submissionDate: body.status === 'SUBMITTED' ? new Date() : undefined,
      },
    });

    // proposal outcome drives the opportunity
    const oppStage =
      body.status === 'WON'
        ? 'WON'
        : body.status === 'LOST'
          ? 'LOST'
          : body.status === 'SUBMITTED'
            ? 'NEGOTIATION'
            : null;
    if (oppStage) {
      await this.prisma.opportunity.update({
        where: { id: proposal.opportunityId },
        data: {
          stage: oppStage as never,
          probability: oppStage === 'WON' ? 100 : oppStage === 'LOST' ? 0 : 75,
          wonDate: oppStage === 'WON' ? new Date() : undefined,
          lostReason: oppStage === 'LOST' ? 'Proposal lost' : undefined,
          // the submitted fee becomes the best estimate of the deal value
          estimatedValue:
            body.status === 'SUBMITTED' && proposal.totalFee
              ? proposal.totalFee
              : undefined,
          updatedById: user.id,
        },
      });
      this.events.emit(`sales.opportunity.${oppStage.toLowerCase()}`, {
        opportunityId: proposal.opportunityId,
        companyId,
        actorId: user.id,
      });
    }
    return updated;
  }

  // ------------------------------------------------------------- win / loss

  @Get('win-loss')
  @RequirePermission('sales.opportunities.read')
  async winLoss(@CompanyId() companyId: string) {
    const closed = await this.prisma.opportunity.findMany({
      where: { companyId, deletedAt: null, stage: { in: ['WON', 'LOST', 'CANCELLED'] } },
      include: {
        partner: { select: { name: true } },
        owner: { select: { firstName: true, lastName: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const won = closed.filter((o) => o.stage === 'WON');
    const lost = closed.filter((o) => o.stage !== 'WON');
    const wonValue = won.reduce((sum, o) => sum + Number(o.estimatedValue ?? 0), 0);
    const lostValue = lost.reduce((sum, o) => sum + Number(o.estimatedValue ?? 0), 0);

    return {
      wonCount: won.length,
      lostCount: lost.length,
      wonValue,
      lostValue,
      winRate: closed.length ? Math.round((won.length / closed.length) * 100) : 0,
      items: closed.map((o) => ({
        id: o.id,
        opportunityNumber: o.opportunityNumber,
        title: o.title,
        partner: o.partner.name,
        stage: o.stage,
        value: Number(o.estimatedValue ?? 0),
        lostReason: o.lostReason,
        closedAt: (o.wonDate ?? o.updatedAt).toISOString(),
        owner: o.owner ? `${o.owner.firstName} ${o.owner.lastName}` : null,
      })),
    };
  }
}
