import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LeaveType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  AuthUser,
  CompanyId,
  CurrentUser,
  RequirePermission,
} from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PageQueryDto, paged } from '../../common/pagination';
import { requireInCompany } from '../../common/tenant-scope';

class CreateLeaveDto {
  @IsString() employeeId!: string;
  @IsEnum(LeaveType) type!: LeaveType;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsOptional() @IsString() note?: string;
}

class DecideLeaveDto {
  @IsIn(['APPROVED', 'REJECTED'])
  decision!: 'APPROVED' | 'REJECTED';
  @IsOptional() @IsString() note?: string;
}

function workingDaysBetween(start: Date, end: Date): number {
  let days = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) days += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr/leave-requests')
export class LeaveController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  @Get()
  @RequirePermission('hr.leave.read')
  async list(@CompanyId() companyId: string, @Query() query: PageQueryDto) {
    const where = { employee: { companyId } };
    const [data, total] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where,
        include: {
          employee: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
        skip: query.skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);
    return paged(data, total, query);
  }

  @Post()
  @RequirePermission('hr.leave.create')
  async create(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: string,
    @Body() dto: CreateLeaveDto,
  ) {
    await requireInCompany(
      this.prisma.employee.findFirst({
        where: { id: dto.employeeId, companyId, deletedAt: null },
        select: { id: true },
      }),
      'Employee',
    );
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (end < start) {
      throw new BadRequestException('endDate must be after startDate');
    }

    const overlap = await this.prisma.leaveRequest.findFirst({
      where: {
        employeeId: dto.employeeId,
        status: { in: ['REQUESTED', 'APPROVED'] },
        startDate: { lte: end },
        endDate: { gte: start },
      },
    });
    if (overlap) {
      throw new UnprocessableEntityException({
        code: 'LEAVE_OVERLAP',
        message: 'An overlapping leave request already exists',
      });
    }

    const days = workingDaysBetween(start, end);

    if (dto.type === 'VACATION') {
      const balance = await this.prisma.leaveBalance.findUnique({
        where: {
          employeeId_year: {
            employeeId: dto.employeeId,
            year: start.getFullYear(),
          },
        },
      });
      if (balance) {
        const remaining =
          Number(balance.entitlement) +
          Number(balance.carryOver) -
          Number(balance.taken);
        if (days > remaining) {
          throw new UnprocessableEntityException({
            code: 'LEAVE_BALANCE_EXCEEDED',
            message: `Requested ${days} days but only ${remaining} remaining`,
          });
        }
      }
    }

    const request = await this.prisma.leaveRequest.create({
      data: {
        employeeId: dto.employeeId,
        type: dto.type,
        startDate: start,
        endDate: end,
        days,
        note: dto.note,
      },
    });
    this.events.emit('hr.leave.requested', {
      leaveRequestId: request.id,
      employeeId: dto.employeeId,
      actorId: user.id,
    });
    return request;
  }

  @Post(':id/decide')
  @RequirePermission('hr.leave.approve')
  async decide(
    @CurrentUser() user: AuthUser,
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: DecideLeaveDto,
  ) {
    const request = await requireInCompany(
      this.prisma.leaveRequest.findFirst({
        where: { id, employee: { companyId } },
      }),
      'Leave request',
    );
    if (request.status !== 'REQUESTED') {
      throw new UnprocessableEntityException({
        code: 'LEAVE_ALREADY_DECIDED',
        message: `Request is already ${request.status}`,
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // conditional on REQUESTED so two concurrent decisions cannot both
      // apply (and book the vacation days twice)
      const decided = await tx.leaveRequest.updateMany({
        where: { id, status: 'REQUESTED' },
        data: {
          status: dto.decision,
          approvedById: user.id,
          decidedAt: new Date(),
        },
      });
      if (decided.count !== 1) {
        throw new UnprocessableEntityException({
          code: 'LEAVE_ALREADY_DECIDED',
          message: 'Request was decided in the meantime',
        });
      }
      const result = await tx.leaveRequest.findUniqueOrThrow({ where: { id } });
      if (dto.decision === 'APPROVED' && request.type === 'VACATION') {
        await tx.leaveBalance.updateMany({
          where: {
            employeeId: request.employeeId,
            year: request.startDate.getFullYear(),
          },
          data: { taken: { increment: request.days } },
        });
      }
      return result;
    });

    this.events.emit('hr.leave.decided', {
      leaveRequestId: id,
      decision: dto.decision,
      actorId: user.id,
    });
    return updated;
  }
}
