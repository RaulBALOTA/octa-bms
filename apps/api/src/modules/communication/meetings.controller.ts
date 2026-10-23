import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import {
  IsArray,
  IsDateString,
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
import { NotificationsService } from '../notifications/notifications.service';

class UpsertMeetingDto {
  @IsString() title!: string;
  @IsDateString() meetingDate!: string;
  @IsOptional() @IsString() location?: string;
  @IsArray() @IsString({ each: true }) participants!: string[];
  @IsString() content!: string;
}

class UpdateMeetingDto extends UpsertMeetingDto {
  @IsOptional() @IsString() declare title: string;
  @IsOptional() @IsDateString() declare meetingDate: string;
  @IsOptional() @IsArray() declare participants: string[];
  @IsOptional() @IsString() declare content: string;
}

class ActionItemDto {
  @IsString() title!: string;
  @IsString() assigneeId!: string; // User id
  @IsOptional() @IsDateString() dueDate?: string;
}

@ApiTags('communication')
@ApiBearerAuth()
@Controller('communication/meetings')
export class MeetingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  @RequirePermission('communication.meetings.read')
  async list(@CompanyId() companyId: string, @Query() query: PageQueryDto) {
    const where: Prisma.MeetingMinuteWhereInput = {
      companyId,
      deletedAt: null,
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { content: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.meetingMinute.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: { meetingDate: 'desc' },
      }),
      this.prisma.meetingMinute.count({ where }),
    ]);
    return paged(data, total, query);
  }

  @Get(':id')
  @RequirePermission('communication.meetings.read')
  async get(@CompanyId() companyId: string, @Param('id') id: string) {
    const meeting = await this.prisma.meetingMinute.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    const actionItems = await this.prisma.task.findMany({
      where: { entityType: 'meeting', entityId: id, deletedAt: null },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return { ...meeting, actionItems };
  }

  @Post()
  @RequirePermission('communication.meetings.create')
  create(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpsertMeetingDto,
  ) {
    return this.prisma.meetingMinute.create({
      data: {
        companyId,
        title: dto.title,
        meetingDate: new Date(dto.meetingDate),
        location: dto.location,
        participants: dto.participants,
        content: dto.content,
        createdById: user.id,
      },
    });
  }

  @Patch(':id')
  @RequirePermission('communication.meetings.update')
  async update(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMeetingDto,
  ) {
    const meeting = await this.prisma.meetingMinute.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    if (meeting.status === 'FINAL') {
      throw new UnprocessableEntityException({
        code: 'MEETING_FINAL',
        message: 'A finalized protocol cannot be edited',
      });
    }
    return this.prisma.meetingMinute.update({
      where: { id },
      data: {
        ...dto,
        meetingDate: dto.meetingDate ? new Date(dto.meetingDate) : undefined,
      },
    });
  }

  /** FINAL freezes the protocol — German practice for signed-off minutes. */
  @Post(':id/finalize')
  @RequirePermission('communication.meetings.update')
  async finalize(@CompanyId() companyId: string, @Param('id') id: string) {
    const meeting = await this.prisma.meetingMinute.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    return this.prisma.meetingMinute.update({
      where: { id },
      data: { status: 'FINAL' },
    });
  }

  // ------------------------------------------------------------ action items

  @Post(':id/action-items')
  @RequirePermission('communication.meetings.update')
  async addActionItem(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ActionItemDto,
  ) {
    const meeting = await this.prisma.meetingMinute.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');

    const task = await this.prisma.task.create({
      data: {
        title: dto.title,
        entityType: 'meeting',
        entityId: id,
        assigneeId: dto.assigneeId,
        creatorId: user.id,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    await this.notifications.notify({
      userIds: [dto.assigneeId],
      type: 'TASK_ASSIGNED',
      title: `Neue Aufgabe: ${dto.title}`,
      body: `Aus Protokoll „${meeting.title}"`,
      entityType: 'meeting',
      entityId: id,
      link: '/communication',
    });
    return task;
  }

  @Patch('action-items/:taskId/toggle')
  @RequirePermission('communication.meetings.update')
  async toggleActionItem(@Param('taskId') taskId: string) {
    const task = await this.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
    });
    const done = task.status !== 'DONE';
    return this.prisma.task.update({
      where: { id: taskId },
      data: { status: done ? 'DONE' : 'OPEN', completedAt: done ? new Date() : null },
    });
  }
}
