import { Body, Controller, Delete, Get, Header, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CompanyId, CurrentUser, RequirePermission } from '../../core/auth/decorators';
import {
  AllocationDto,
  AssignScheduleDto,
  BalanceQueryDto,
  CapacityQueryDto,
  ClockInDto,
  ClockOutDto,
  DecideTimesheetDto,
  EmployeeScopeDto,
  PmoPushDto,
  ProjectEntryDto,
  RangeQueryDto,
  TeamQueryDto,
  TimeRecordDto,
  TimesheetListQueryDto,
  WeekQueryDto,
  WorkScheduleDto,
} from './time.dto';
import { WorkingTimeService } from './working-time.service';
import { PlanningService } from './planning.service';
import { PmoSyncService } from './pmo-sync.service';

@ApiTags('time')
@ApiBearerAuth()
@Controller('time')
export class WorkingTimeController {
  constructor(private readonly time: WorkingTimeService) {}

  @Get('week') @RequirePermission('time.records.read')
  week(@CurrentUser() user: AuthUser, @CompanyId() companyId: string, @Query() query: WeekQueryDto) {
    return this.time.week(user, companyId, query.employeeId, query.week);
  }

  @Get('balance') @RequirePermission('time.records.read')
  balance(@CurrentUser() user: AuthUser, @CompanyId() companyId: string, @Query() query: BalanceQueryDto) {
    return this.time.balance(user, companyId, query.employeeId, query.from, query.to);
  }

  @Get('export.csv') @RequirePermission('time.timesheets.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="working-time.csv"')
  exportCsv(@CurrentUser() user: AuthUser, @CompanyId() companyId: string, @Query() query: RangeQueryDto) {
    return this.time.exportCsv(user, companyId, query.from, query.to, query.employeeId);
  }

  @Post('records') @RequirePermission('time.records.create')
  createRecord(@CurrentUser() user: AuthUser, @CompanyId() companyId: string, @Body() dto: TimeRecordDto) {
    return this.time.createRecord(user, companyId, dto);
  }

  @Put('records/:id') @RequirePermission('time.records.update')
  updateRecord(@CurrentUser() user: AuthUser, @CompanyId() companyId: string, @Param('id') id: string, @Body() dto: TimeRecordDto) {
    return this.time.updateRecord(user, companyId, id, dto);
  }

  @Delete('records/:id') @RequirePermission('time.records.delete')
  deleteRecord(@CurrentUser() user: AuthUser, @CompanyId() companyId: string, @Param('id') id: string) {
    return this.time.deleteRecord(user, companyId, id);
  }

  @Post('clock-in') @RequirePermission('time.records.create')
  clockIn(@CurrentUser() user: AuthUser, @CompanyId() companyId: string, @Body() dto: ClockInDto) {
    return this.time.clockIn(user, companyId, dto);
  }

  @Post('clock-out') @RequirePermission('time.records.update')
  clockOut(@CurrentUser() user: AuthUser, @CompanyId() companyId: string, @Body() dto: ClockOutDto) {
    return this.time.clockOut(user, companyId, dto);
  }

  @Post('entries') @RequirePermission('time.records.create')
  createEntry(@CurrentUser() user: AuthUser, @CompanyId() companyId: string, @Body() dto: ProjectEntryDto) {
    return this.time.createEntry(user, companyId, dto);
  }

  @Put('entries/:id') @RequirePermission('time.records.update')
  updateEntry(@CurrentUser() user: AuthUser, @CompanyId() companyId: string, @Param('id') id: string, @Body() dto: ProjectEntryDto) {
    return this.time.updateEntry(user, companyId, id, dto);
  }

  @Delete('entries/:id') @RequirePermission('time.records.delete')
  deleteEntry(@CurrentUser() user: AuthUser, @CompanyId() companyId: string, @Param('id') id: string) {
    return this.time.deleteEntry(user, companyId, id);
  }

  @Get('timesheets') @RequirePermission('time.timesheets.read')
  timesheets(@CurrentUser() user: AuthUser, @CompanyId() companyId: string, @Query() query: TimesheetListQueryDto) {
    return this.time.listTimesheets(user, companyId, query);
  }

  @Post('timesheets/submit') @RequirePermission('time.timesheets.create')
  submit(@CurrentUser() user: AuthUser, @CompanyId() companyId: string, @Body() dto: WeekQueryDto) {
    return this.time.submit(user, companyId, dto.employeeId, dto.week);
  }

  @Post('timesheets/:id/withdraw') @RequirePermission('time.timesheets.create')
  withdraw(@CurrentUser() user: AuthUser, @CompanyId() companyId: string, @Param('id') id: string) {
    return this.time.withdraw(user, companyId, id);
  }

  @Post('timesheets/:id/decide') @RequirePermission('time.timesheets.approve')
  decide(@CurrentUser() user: AuthUser, @CompanyId() companyId: string, @Param('id') id: string, @Body() dto: DecideTimesheetDto) {
    return this.time.decide(user, companyId, id, dto);
  }

  @Post('timesheets/:id/reopen') @RequirePermission('time.timesheets.approve')
  reopen(@CurrentUser() user: AuthUser, @CompanyId() companyId: string, @Param('id') id: string) {
    return this.time.reopen(user, companyId, id);
  }

  @Get('team') @RequirePermission('time.timesheets.approve')
  team(@CurrentUser() user: AuthUser, @CompanyId() companyId: string, @Query() query: TeamQueryDto) {
    return this.time.team(user, companyId, query);
  }
}

@ApiTags('time')
@ApiBearerAuth()
@Controller('time')
export class TimePlanningController {
  constructor(private readonly planning: PlanningService) {}

  @Get('schedules') @RequirePermission('time.schedules.read')
  schedules(@CompanyId() companyId: string) { return this.planning.schedules(companyId); }

  @Post('schedules') @RequirePermission('time.schedules.create')
  createSchedule(@CompanyId() companyId: string, @Body() dto: WorkScheduleDto) { return this.planning.saveSchedule(companyId, dto); }

  @Put('schedules/:id') @RequirePermission('time.schedules.update')
  updateSchedule(@CompanyId() companyId: string, @Param('id') id: string, @Body() dto: WorkScheduleDto) { return this.planning.saveSchedule(companyId, dto, id); }

  @Get('schedule-assignments') @RequirePermission('time.schedules.read')
  assignments(@CompanyId() companyId: string, @Query() query: EmployeeScopeDto) { return this.planning.assignments(companyId, query.employeeId); }

  @Post('schedule-assignments') @RequirePermission('time.schedules.update')
  assign(@CompanyId() companyId: string, @Body() dto: AssignScheduleDto) { return this.planning.assign(companyId, dto); }

  @Get('projects') @RequirePermission('time.records.read')
  projects(@CompanyId() companyId: string) { return this.planning.projects(companyId); }

  @Get('capacity') @RequirePermission('time.planning.read')
  capacity(@CompanyId() companyId: string, @Query() query: CapacityQueryDto) { return this.planning.capacity(companyId, query); }

  @Post('allocations') @RequirePermission('time.planning.create')
  allocate(@CompanyId() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: AllocationDto) { return this.planning.allocate(companyId, user.id, dto); }

  @Delete('allocations/:id') @RequirePermission('time.planning.delete')
  removeAllocation(@CompanyId() companyId: string, @Param('id') id: string) { return this.planning.removeAllocation(companyId, id); }
}

@ApiTags('time')
@ApiBearerAuth()
@Controller('time/integration')
export class PmoIntegrationController {
  constructor(private readonly pmo: PmoSyncService) {}

  @Get('pmo') @RequirePermission('time.integration.read')
  status(@CompanyId() companyId: string) { return this.pmo.status(companyId); }

  @Post('pmo/sync') @RequirePermission('time.integration.create')
  sync(@CompanyId() companyId: string, @CurrentUser() user: AuthUser) { return this.pmo.sync(companyId, 'MANUAL', user.id); }

  /** Inbound: the PMO app pushes created/changed/deleted time entries. */
  @Post('pmo/entries') @RequirePermission('time.integration.create')
  push(@CompanyId() companyId: string, @CurrentUser() user: AuthUser, @Body() dto: PmoPushDto) { return this.pmo.push(companyId, user.id, dto); }

  /** Outbound: capacity, absences and allocations for the PMO resource planning. */
  @Get('capacity') @RequirePermission('time.integration.read')
  capacity(@CompanyId() companyId: string, @Query() query: RangeQueryDto) { return this.pmo.capacityExport(companyId, query.from, query.to); }
}
