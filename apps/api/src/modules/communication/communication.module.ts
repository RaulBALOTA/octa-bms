import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SearchModule } from '../search/search.module';
import { CommunicationController } from './communication.controller';
import { MeetingsController } from './meetings.controller';
import { MessagesController } from './messages.controller';
import { OutboundService } from './outbound.service';

@Module({
  imports: [AiModule, SearchModule, NotificationsModule],
  controllers: [CommunicationController, MeetingsController, MessagesController],
  providers: [OutboundService],
  exports: [OutboundService],
})
export class CommunicationModule {}
