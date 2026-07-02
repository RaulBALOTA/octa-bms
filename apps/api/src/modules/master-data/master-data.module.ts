import { Module } from '@nestjs/common';
import { CompaniesController } from './companies.controller';
import { ReferenceDataController } from './reference-data.controller';
import { NumberSequenceService } from './number-sequence.service';

@Module({
  controllers: [CompaniesController, ReferenceDataController],
  providers: [NumberSequenceService],
  exports: [NumberSequenceService],
})
export class MasterDataModule {}
