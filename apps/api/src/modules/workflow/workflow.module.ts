import { Module } from '@nestjs/common';
import { ApprovalsController } from './approvals.controller';
import { DefinitionsController } from './definitions.controller';

@Module({
  controllers: [ApprovalsController, DefinitionsController],
})
export class WorkflowModule {}
