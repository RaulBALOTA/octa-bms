import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CompanyId, CurrentUser, RequirePermission } from '../../core/auth/decorators';
import { CalendarService } from './calendar.service';
import { CalendarEntityQueryDto, CalendarQueryDto, CreateCalendarItemDto, EvidenceDto, TransitionDto, UpdateCalendarItemDto, VersionDto } from './calendar.dto';

@ApiTags('business-calendar')
@ApiBearerAuth()
@Controller('business-calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}
  @Get('capabilities') @RequirePermission('calendar.items.read')
  capabilities(@CurrentUser() user: AuthUser) { return this.calendar.capability(user); }
  @Get('members') @RequirePermission('calendar.items.read')
  members(@CompanyId() company: string) { return this.calendar.members(company); }
  @Get('entities') @RequirePermission('calendar.items.read')
  entities(@CompanyId() company: string, @CurrentUser() user: AuthUser, @Query() q: CalendarEntityQueryDto) { return this.calendar.entities(company, user, q); }
  @Get('items') @RequirePermission('calendar.items.read')
  list(@CompanyId() company: string, @CurrentUser() user: AuthUser, @Query() q: CalendarQueryDto) { return this.calendar.list(company, user, q); }
  @Get('horizon') @RequirePermission('calendar.items.read')
  horizon(@CompanyId() company: string, @CurrentUser() user: AuthUser, @Query() q: CalendarQueryDto) { return this.calendar.horizon(company, user, q); }
  @Get('items/:id') @RequirePermission('calendar.items.read')
  get(@CompanyId() company: string, @CurrentUser() user: AuthUser, @Param('id') id: string) { return this.calendar.get(company, user, id); }
  @Get('items/:id/history') @RequirePermission('calendar.items.read')
  history(@CompanyId() company: string, @CurrentUser() user: AuthUser, @Param('id') id: string) { return this.calendar.history(company, user, id); }
  @Post('items') @RequirePermission('calendar.items.create')
  create(@CompanyId() company: string, @CurrentUser() user: AuthUser, @Body() dto: CreateCalendarItemDto) { return this.calendar.create(company, user, dto); }
  @Patch('items/:id') @RequirePermission('calendar.items.update')
  update(@CompanyId() company: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateCalendarItemDto) { return this.calendar.update(company, user, id, dto); }
  @Post('items/:id/transition') @RequirePermission('calendar.items.update')
  transition(@CompanyId() company: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: TransitionDto) { return this.calendar.transition(company, user, id, dto.version, dto.status); }
  @Post('items/:id/complete') @RequirePermission('calendar.items.update')
  complete(@CompanyId() company: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: VersionDto) { return this.calendar.transition(company, user, id, dto.version, 'COMPLETED'); }
  @Post('items/:id/reopen') @RequirePermission('calendar.items.update')
  reopen(@CompanyId() company: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: VersionDto) { return this.calendar.transition(company, user, id, dto.version, 'OPEN'); }
  @Post('items/:id/evidence') @RequirePermission('calendar.items.update')
  evidence(@CompanyId() company: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: EvidenceDto) { return this.calendar.evidence(company, user, id, dto); }
  @Post('items/:id/archive') @RequirePermission('calendar.items.delete')
  archive(@CompanyId() company: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: VersionDto) { return this.calendar.archive(company, user, id, dto.version); }
}
