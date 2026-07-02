import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNumberString,
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

class UpsertGoalDto {
  @IsInt() year!: number;
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional()
  @IsIn(['FINANCIAL', 'GROWTH', 'PEOPLE', 'QUALITY', 'DIGITALIZATION'])
  category?: string;
  @IsOptional() @IsNumberString() targetValue?: string;
  @IsOptional() @IsNumberString() currentValue?: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional()
  @IsIn(['ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'ACHIEVED'])
  status?: string;
}

class UpdateGoalDto extends UpsertGoalDto {
  @IsOptional() @IsInt() declare year: number;
  @IsOptional() @IsString() declare title: string;
}

@ApiTags('corporate')
@ApiBearerAuth()
@Controller('corporate/goals')
export class GoalsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('corporate.goals.read')
  list(@CompanyId() companyId: string) {
    return this.prisma.companyGoal.findMany({
      where: { companyId, deletedAt: null },
      orderBy: [{ year: 'desc' }, { category: 'asc' }],
    });
  }

  @Post()
  @RequirePermission('corporate.goals.create')
  create(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpsertGoalDto,
  ) {
    return this.prisma.companyGoal.create({
      data: { ...dto, companyId, ownerId: user.id },
    });
  }

  @Patch(':id')
  @RequirePermission('corporate.goals.update')
  update(@Param('id') id: string, @Body() dto: UpdateGoalDto) {
    return this.prisma.companyGoal.update({ where: { id }, data: dto });
  }

  @Delete(':id')
  @RequirePermission('corporate.goals.delete')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.prisma.companyGoal.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
