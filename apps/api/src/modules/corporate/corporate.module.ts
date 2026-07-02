import { Module } from '@nestjs/common';
import { AnnouncementsController } from './announcements.controller';
import { GoalsController } from './goals.controller';
import { KpiController } from './kpi.controller';

@Module({
  controllers: [KpiController, GoalsController, AnnouncementsController],
})
export class CorporateModule {}
