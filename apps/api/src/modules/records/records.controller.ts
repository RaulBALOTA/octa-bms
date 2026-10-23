import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsObject, IsString } from 'class-validator';
import { AuthUser, CurrentUser } from '../../core/auth/decorators';
import { PageQueryDto } from '../../common/pagination';
import { RecordsService } from './records.service';

export class RecordDataDto { @IsObject() data!: Record<string, unknown>; }
export class DeleteRecordsDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) ids!: string[];
}
@ApiTags('data-management')
@ApiBearerAuth()
@Controller('records')
export class RecordsController {
  constructor(private readonly records: RecordsService) {}
  @Get('catalog')
  catalog(@CurrentUser() user: AuthUser) { return this.records.catalog(user); }
  @Get(':resource/lookup/:field')
  lookup(@CurrentUser() user: AuthUser, @Param('resource') resource: string, @Param('field') field: string, @Query('q') q?: string, @Query('selected') selected?: string) {
    return this.records.lookup(user, resource, field, q?.slice(0, 250), selected);
  }
  @Get(':resource')
  list(@CurrentUser() user: AuthUser, @Param('resource') resource: string, @Query() query: PageQueryDto) { return this.records.list(user, resource, query); }
  @Get(':resource/archived/list')
  archived(@CurrentUser() user: AuthUser, @Param('resource') resource: string, @Query() query: PageQueryDto) { return this.records.list(user, resource, query, true); }
  @Get(':resource/:id')
  get(@CurrentUser() user: AuthUser, @Param('resource') resource: string, @Param('id') id: string) { return this.records.get(user, resource, id); }
  @Post(':resource')
  create(@CurrentUser() user: AuthUser, @Param('resource') resource: string, @Body() body: RecordDataDto) { return this.records.create(user, resource, body.data); }
  @Patch(':resource/:id')
  update(@CurrentUser() user: AuthUser, @Param('resource') resource: string, @Param('id') id: string, @Body() body: RecordDataDto) { return this.records.update(user, resource, id, body.data); }
  @Delete(':resource/:id')
  remove(@CurrentUser() user: AuthUser, @Param('resource') resource: string, @Param('id') id: string) { return this.records.remove(user, resource, [id]); }
  @Post(':resource/bulk-delete')
  bulkDelete(@CurrentUser() user: AuthUser, @Param('resource') resource: string, @Body() body: DeleteRecordsDto) { return this.records.remove(user, resource, body.ids); }
  @Post(':resource/:id/restore')
  restore(@CurrentUser() user: AuthUser, @Param('resource') resource: string, @Param('id') id: string) { return this.records.restore(user, resource, id); }
}
