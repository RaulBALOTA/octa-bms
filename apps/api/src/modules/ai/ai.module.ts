import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiGatewayService } from './ai-gateway.service';
import { ContextBuilderService } from './context-builder.service';

@Module({
  controllers: [AiController],
  providers: [AiGatewayService, ContextBuilderService],
  exports: [AiGatewayService],
})
export class AiModule {}
