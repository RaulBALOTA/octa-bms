import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PositionStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { AuthUser, CompanyId, CurrentUser, RequirePermission } from '../../core/auth/decorators';
import { OrgChartService } from './org-chart.service';

export class PositionStatusDto {
  @IsEnum(PositionStatus) status!: PositionStatus;
}
export class SaveOrgChartVersionDto {
  @IsString() @Matches(/\S/) @MaxLength(120) title!: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr/org-chart')
export class OrgChartController {
  constructor(private readonly chart: OrgChartService) {}

  @Get('versions')
  @RequirePermission('hr.employees.read')
  versions(@CompanyId() companyId: string) { return this.chart.listVersions(companyId); }

  @Get('versions/:id')
  @RequirePermission('hr.employees.read')
  version(@CompanyId() companyId: string, @Param('id') id: string) { return this.chart.getVersion(companyId, id); }

  @Post('versions')
  @RequirePermission('hr.employees.read', 'hr.employees.update')
  save(@CompanyId() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: SaveOrgChartVersionDto) {
    return this.chart.saveVersion(companyId, user.id, dto.title, dto.note);
  }

  @Patch('positions/:id/status')
  @RequirePermission('hr.employees.read', 'hr.employees.update')
  status(@CompanyId() companyId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: PositionStatusDto) {
    return this.chart.setStatus(companyId, user.id, id, dto.status);
  }
}
