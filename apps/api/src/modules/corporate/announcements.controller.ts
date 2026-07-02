import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import {
  AuthUser,
  CompanyId,
  CurrentUser,
  RequirePermission,
} from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';

class CreateAnnouncementDto {
  @IsString() title!: string;
  @IsString() content!: string;
  @IsOptional() @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']) priority?: string;
}

@ApiTags('corporate')
@ApiBearerAuth()
@Controller('corporate/announcements')
export class AnnouncementsController {
  constructor(private readonly prisma: PrismaService) {}

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

  @Post()
  @RequirePermission('corporate.announcements.create')
  create(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAnnouncementDto,
  ) {
    return this.prisma.announcement.create({
      data: { ...dto, companyId, authorId: user.id },
    });
  }

  @Delete(':id')
  @RequirePermission('corporate.announcements.delete')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.prisma.announcement.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
