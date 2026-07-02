import { Module } from '@nestjs/common';
import { CommunicationController } from './communication.controller';

@Module({
  controllers: [CommunicationController],
})
export class CommunicationModule {}
