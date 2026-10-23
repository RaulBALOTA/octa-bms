import { Module } from '@nestjs/common';
import { CompaniesController } from './companies.controller';
import { CostCentersController } from './cost-centers.controller';
import { ReferenceDataController } from './reference-data.controller';
import { NumberSequenceService } from './number-sequence.service';
import { OrganizationService } from './organization.service';

@Module({
  controllers: [CompaniesController, CostCentersController, ReferenceDataController],
  providers: [NumberSequenceService, OrganizationService],
  exports: [NumberSequenceService, OrganizationService],
})
export class MasterDataModule {}
