import { Module } from '@nestjs/common';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
// The module is always registered; server-side capability checks control rollout.
@Module({ controllers: [CalendarController], providers: [CalendarService] })
export class CalendarModule {}
