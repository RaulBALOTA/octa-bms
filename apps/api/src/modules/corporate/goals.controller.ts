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
import {
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  AuthUser,
  CompanyId,
  CurrentUser,
  RequirePermission,
} from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';

export class UpsertGoalDto {
  @IsInt() @Min(1900) @Max(9999) year!: number;
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(250) title!: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string | null;
  @IsOptional()
  @IsIn(['FINANCIAL', 'GROWTH', 'PEOPLE', 'QUALITY', 'DIGITALIZATION'])
  category?: string | null;
  @IsOptional() @IsNumberString() targetValue?: string | null;
  @IsOptional() @IsNumberString() currentValue?: string | null;
  @IsOptional() @IsString() @MaxLength(50) unit?: string | null;
  @ValidateIf((o: UpsertGoalDto) => o.status !== undefined)
  @IsIn(['ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'ACHIEVED'])
  status?: string;
}

export class UpdateGoalDto {
  @ValidateIf((o: UpdateGoalDto) => o.year !== undefined)
  @IsInt() @Min(1900) @Max(9999) year?: number;
  @ValidateIf((o: UpdateGoalDto) => o.title !== undefined)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(250) title?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string | null;
  @IsOptional() @IsIn(['FINANCIAL', 'GROWTH', 'PEOPLE', 'QUALITY', 'DIGITALIZATION']) category?: string | null;
  @IsOptional() @IsNumberString() targetValue?: string | null;
  @IsOptional() @IsNumberString() currentValue?: string | null;
  @IsOptional() @IsString() @MaxLength(50) unit?: string | null;
  @ValidateIf((o: UpdateGoalDto) => o.status !== undefined)
  @IsIn(['ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'ACHIEVED']) status?: string;
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

  @Get(':id')
  @RequirePermission('corporate.goals.read')
  async get(@CompanyId() companyId: string, @Param('id') id: string) {
    const goal = await this.prisma.companyGoal.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!goal) throw new NotFoundException('Goal not found');
    return goal;
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
  async update(@CompanyId() companyId: string, @Param('id') id: string, @Body() dto: UpdateGoalDto) {
    const result = await this.prisma.companyGoal.updateMany({ where: { id, companyId, deletedAt: null }, data: dto });
    if (!result.count) throw new NotFoundException('Goal not found');
    return this.get(companyId, id);
  }

  @Delete(':id')
  @RequirePermission('corporate.goals.delete')
  @HttpCode(204)
  async remove(@CompanyId() companyId: string, @Param('id') id: string) {
    const result = await this.prisma.companyGoal.updateMany({
      where: { id, companyId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!result.count) throw new NotFoundException('Goal not found');
  }
}
