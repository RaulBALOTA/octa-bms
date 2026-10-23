import { Module } from '@nestjs/common';
import { PmoIntegrationController, TimePlanningController, WorkingTimeController } from './working-time.controller';
import { WorkingTimeService } from './working-time.service';
import { TimeCalendarService } from './time-calendar.service';
import { PlanningService } from './planning.service';
import { PmoSyncService } from './pmo-sync.service';

@Module({
  controllers: [WorkingTimeController, TimePlanningController, PmoIntegrationController],
  providers: [WorkingTimeService, TimeCalendarService, PlanningService, PmoSyncService],
})
export class WorkingTimeModule {}
