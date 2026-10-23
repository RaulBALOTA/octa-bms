import { Module } from '@nestjs/common';
import { MasterDataModule } from '../master-data/master-data.module';
import { OpportunitiesController } from './opportunities.controller';
import { OpportunitiesService } from './opportunities.service';
import { ProposalsController } from './proposals.controller';

@Module({
  imports: [MasterDataModule],
  controllers: [ProposalsController, OpportunitiesController],
  providers: [OpportunitiesService],
})
export class SalesModule {}
