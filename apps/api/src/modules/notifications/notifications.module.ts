import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { ExpiryScannerService } from './expiry-scanner.service';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, ExpiryScannerService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
