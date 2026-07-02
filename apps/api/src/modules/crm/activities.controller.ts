import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CrmActivityType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  AuthUser,
  CurrentUser,
  RequirePermission,
} from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';

class CreateActivityDto {
  @IsEnum(CrmActivityType) type!: CrmActivityType;
  @IsString() subject!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsDateString() activityDate?: string;
  @IsOptional() @IsInt() durationMin?: number;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() outcome?: string;
  @IsOptional() @IsString() contactId?: string;
  @IsOptional() @IsString() opportunityId?: string;
}

@ApiTags('crm')
@ApiBearerAuth()
@Controller('crm')
export class ActivitiesController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('partners/:partnerId/activities')
  @RequirePermission('crm.activities.create')
  async create(
    @CurrentUser() user: AuthUser,
    @Param('partnerId') partnerId: string,
    @Body() dto: CreateActivityDto,
  ) {
    // Attribute to the caller's employee profile when one exists.
    const employee = await this.prisma.employee.findFirst({
      where: { userId: user.id, deletedAt: null },
      select: { id: true },
    });
    return this.prisma.crmActivity.create({
      data: {
        partnerId,
        type: dto.type,
        subject: dto.subject,
        description: dto.description,
        activityDate: dto.activityDate ? new Date(dto.activityDate) : new Date(),
        durationMin: dto.durationMin,
        location: dto.location,
        outcome: dto.outcome,
        contactId: dto.contactId,
        opportunityId: dto.opportunityId,
        ownerId: employee?.id,
        createdById: user.id,
      },
      include: {
        owner: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }
}
