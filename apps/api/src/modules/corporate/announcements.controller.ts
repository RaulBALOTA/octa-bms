import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IsIn, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  AuthUser,
  CompanyId,
  CurrentUser,
  RequirePermission,
} from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';

export class CreateAnnouncementDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(250) title!: string;
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(20000) content!: string;
  @ValidateIf((o: CreateAnnouncementDto) => o.priority !== undefined)
  @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']) priority?: string;
}

export class UpdateAnnouncementDto {
  @ValidateIf((o: UpdateAnnouncementDto) => o.title !== undefined)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(250) title?: string;
  @ValidateIf((o: UpdateAnnouncementDto) => o.content !== undefined)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(20000) content?: string;
  @ValidateIf((o: UpdateAnnouncementDto) => o.priority !== undefined)
  @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']) priority?: string;
}

@ApiTags('corporate')
@ApiBearerAuth()
@Controller('corporate/announcements')
export class AnnouncementsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  /** Readable by every authenticated user — it is the company notice board. */
  @Get()
  list(@CompanyId() companyId: string) {
    return this.prisma.announcement.findMany({
      where: {
        deletedAt: null,
        OR: [{ companyId }, { companyId: null }],
        publishAt: { lte: new Date() },
      },
      orderBy: { publishAt: 'desc' },
      take: 50,
    });
  }

  @Get(':id')
  async get(@CompanyId() companyId: string, @Param('id') id: string) {
    const announcement = await this.prisma.announcement.findFirst({
      where: { id, deletedAt: null, OR: [{ companyId }, { companyId: null }], publishAt: { lte: new Date() } },
    });
    if (!announcement) throw new NotFoundException('Announcement not found');
    return announcement;
  }

  @Patch(':id')
  @RequirePermission('corporate.announcements.update')
  async update(@CompanyId() companyId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateAnnouncementDto) {
    const result = await this.prisma.announcement.updateMany({
      where: { id, deletedAt: null, OR: [{ companyId }, ...(user.isSystemAdmin ? [{ companyId: null }] : [])] },
      data: dto,
    });
    if (!result.count) throw new NotFoundException('Announcement not found');
    return this.get(companyId, id);
  }

  @Post()
  @RequirePermission('corporate.announcements.create')
  async create(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAnnouncementDto,
  ) {
    const announcement = await this.prisma.announcement.create({
      data: { ...dto, companyId, authorId: user.id },
    });
    // mirrored to Teams when the webhook is configured
    this.events.emit('corporate.announcement.created', {
      title: announcement.title,
      content: announcement.content,
    });
    return announcement;
  }

  @Delete(':id')
  @RequirePermission('corporate.announcements.delete')
  @HttpCode(204)
  async remove(@CompanyId() companyId: string, @CurrentUser() user: AuthUser, @Param('id') id: string) {
    const result = await this.prisma.announcement.updateMany({
      where: { id, deletedAt: null, OR: [{ companyId }, ...(user.isSystemAdmin ? [{ companyId: null }] : [])] },
      data: { deletedAt: new Date() },
    });
    if (!result.count) throw new NotFoundException('Announcement not found');
  }
}
